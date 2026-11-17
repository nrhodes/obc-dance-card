/**
 * Central auth/member state. Subscribes to Firebase Auth state and, once
 * signed in, to the caller's own `members/{uid}` and `memberPrivate/{uid}`
 * documents (rules allow self-read for both — plan §10).
 *
 * `status`:
 *  - `loading`    — auth state (or the member doc) hasn't resolved yet
 *  - `signedOut`  — no Firebase Auth user
 *  - `signedIn`   — Auth user + an active member doc
 *  - `notActive`  — Auth user, but the member doc is missing, `active !==
 *                   true`, or reading it failed with `permission-denied`
 *                   (exactly what a deactivated member's rules evaluation
 *                   returns, since `members/{id}` read requires
 *                   `resource.data.active == true` for anyone but the admin
 *                   or the doc's own still-active self). Nothing under
 *                   `member`/`memberPrivate` is ever rendered in this state.
 *
 * See `AuthContext.ts` for the context/type definitions and `useAuth.ts` for
 * the consuming hook — split out so this file exports only the
 * `AuthProvider` component (react-refresh needs a component-only module).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signOut as firebaseSignOut, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { paths, type Member, type MemberPrivate } from '@obc/shared';
import { appCheckWorking, auth, db } from '../firebase';
import { AuthContext, type AuthContextValue, type AuthStatus } from './AuthContext';
import { classifyMemberDocError } from './memberDocError';
import { classifyStall } from './connectivity';
import { writeLastActivity } from '../session/idleSignOut';

type MemberDocState = 'pending' | 'active' | 'notActive' | 'browser-not-verified' | 'unavailable' | 'blocked';

/**
 * How long the member doc may stay unresolved before we stop showing
 * "Loading…" and explain. A healthy read takes well under a second; the
 * Firestore SDK never errors when its transport is blocked in-browser, so
 * without this the app would spin forever (see `connectivity.ts`). The
 * listener stays live: if the doc arrives later, the state flips to active.
 */
export const MEMBER_LOAD_STALL_MS = 8000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [memberPrivate, setMemberPrivate] = useState<MemberPrivate | null>(null);
  const [memberDocState, setMemberDocState] = useState<MemberDocState>('pending');

  useEffect(() => {
    let seenFirstState = false;
    let previousUid: string | null = null;
    return onAuthStateChanged(auth, (u) => {
      // A sign-in that happens in this page (null -> user, after the initial
      // restored state) is activity. Stamp it before `AppShell` mounts and
      // `useIdleSignOut` reads the stamp; otherwise a browser idle for 30+
      // days signed the member out of the session they had just opened, on
      // every attempt (incident 2026-11-17).
      if (seenFirstState && u && previousUid === null && typeof localStorage !== 'undefined') {
        writeLastActivity(localStorage, Date.now());
      }
      seenFirstState = true;
      previousUid = u?.uid ?? null;
      setUser(u);
      setAuthReady(true);
      if (!u) {
        setMember(null);
        setMemberPrivate(null);
        setMemberDocState('pending');
      }
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    setMemberDocState('pending');
    let cancelled = false;
    let resolved = false;

    const stallTimer = window.setTimeout(() => {
      if (cancelled || resolved) return;
      void classifyStall().then((cause) => {
        if (cancelled || resolved) return;
        setMemberDocState(cause);
      });
    }, MEMBER_LOAD_STALL_MS);

    const unsubMember = onSnapshot(
      doc(db, paths.member(user.uid)),
      (snap) => {
        resolved = true;
        if (!snap.exists()) {
          setMember(null);
          setMemberDocState('notActive');
          return;
        }
        const data = snap.data() as Member;
        setMember(data);
        setMemberDocState(data.active === true ? 'active' : 'notActive');
      },
      (err) => {
        resolved = true;
        setMember(null);
        // A deactivated member's read of their own doc is denied by rules
        // (plan §10) — that arrives here as `permission-denied`. But so does
        // EVERY read when App Check rejects this browser (enforced in
        // production), and telling that member "your membership is not
        // active" would be false — so ask App Check before deciding
        // (memberDocError.ts).
        void appCheckWorking().then((appCheckOk) => {
          if (cancelled) return;
          const problem = classifyMemberDocError(err.code, appCheckOk);
          setMemberDocState(problem === 'not-active' ? 'notActive' : problem);
        });
      },
    );

    const unsubPrivate = onSnapshot(
      doc(db, paths.memberPrivate(user.uid)),
      (snap) => setMemberPrivate(snap.exists() ? (snap.data() as MemberPrivate) : null),
      () => setMemberPrivate(null),
    );

    return () => {
      cancelled = true;
      window.clearTimeout(stallTimer);
      unsubMember();
      unsubPrivate();
    };
  }, [user]);

  const status: AuthStatus = useMemo(() => {
    if (!authReady) return 'loading';
    if (!user) return 'signedOut';
    if (memberDocState === 'pending') return 'loading';
    if (memberDocState === 'active') return 'signedIn';
    return memberDocState === 'notActive' ? 'notActive' : 'unavailable';
  }, [authReady, user, memberDocState]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      problem:
        memberDocState === 'browser-not-verified' || memberDocState === 'unavailable' || memberDocState === 'blocked'
          ? memberDocState
          : null,
      user,
      member: status === 'signedIn' ? member : null,
      memberPrivate: status === 'signedIn' ? memberPrivate : null,
      signOut: async () => {
        await firebaseSignOut(auth);
      },
    }),
    [status, memberDocState, user, member, memberPrivate],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
