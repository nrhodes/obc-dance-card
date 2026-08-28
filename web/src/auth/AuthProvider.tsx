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
import { auth, db } from '../firebase';
import { AuthContext, type AuthContextValue, type AuthStatus } from './AuthContext';

type MemberDocState = 'pending' | 'active' | 'notActive';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [memberPrivate, setMemberPrivate] = useState<MemberPrivate | null>(null);
  const [memberDocState, setMemberDocState] = useState<MemberDocState>('pending');

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
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

    const unsubMember = onSnapshot(
      doc(db, paths.member(user.uid)),
      (snap) => {
        if (!snap.exists()) {
          setMember(null);
          setMemberDocState('notActive');
          return;
        }
        const data = snap.data() as Member;
        setMember(data);
        setMemberDocState(data.active === true ? 'active' : 'notActive');
      },
      () => {
        // A deactivated member's read of their own doc is denied by rules
        // (plan §10) — that arrives here as `permission-denied`.
        setMember(null);
        setMemberDocState('notActive');
      },
    );

    const unsubPrivate = onSnapshot(
      doc(db, paths.memberPrivate(user.uid)),
      (snap) => setMemberPrivate(snap.exists() ? (snap.data() as MemberPrivate) : null),
      () => setMemberPrivate(null),
    );

    return () => {
      unsubMember();
      unsubPrivate();
    };
  }, [user]);

  const status: AuthStatus = useMemo(() => {
    if (!authReady) return 'loading';
    if (!user) return 'signedOut';
    if (memberDocState === 'pending') return 'loading';
    return memberDocState === 'active' ? 'signedIn' : 'notActive';
  }, [authReady, user, memberDocState]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      member: status === 'signedIn' ? member : null,
      memberPrivate: status === 'signedIn' ? memberPrivate : null,
      signOut: async () => {
        await firebaseSignOut(auth);
      },
    }),
    [status, user, member, memberPrivate],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
