/**
 * Decides which club the app is showing (plan §21 B14) and tells the API
 * layer, so club-scoped callables carry the same `clubId` the screens read.
 *
 * The signed-in person's clubs come from `users/{uid}.clubIds`, which the
 * server maintains. With one club there is nothing to choose and nothing
 * extra on screen. With several, the header offers a switcher (`AppShell`);
 * the choice is remembered per person on this device.
 *
 * This is the stage-4 stopgap, not the merged multi-club UI: every screen
 * shows one club at a time.
 *
 * Sits above `AuthProvider`, because that provider reads the person's
 * membership of the *current* club — so the club has to be known first.
 * While a signed-in person's clubs are still loading, nothing below is
 * rendered: showing the default club for a moment would tell a member of
 * another club that they are not a member at all.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { clubPaths, paths, type Club, type ClubId, type UserDoc } from '@obc/shared';
import { setCurrentClubId } from '../api';
import { auth, db } from '../firebase';
import { ClubContext, ClubsContext, type ClubsState } from './ClubContext';
import { chooseClub, readStoredClub, storeClub } from './clubChoice';

interface Memberships {
  /** The uid these belong to — stale results for a previous user are ignored. */
  uid: string;
  clubIds: ClubId[];
}

export function ClubProvider({ children }: { children: ReactNode }) {
  /** `undefined` until Firebase Auth has reported; `null` when signed out. */
  const [uid, setUid] = useState<string | null | undefined>(undefined);
  const [memberships, setMemberships] = useState<Memberships | null>(null);
  const [selected, setSelected] = useState<ClubId | null>(null);
  const [names, setNames] = useState<Record<ClubId, string>>({});

  useEffect(() => onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null)), []);

  useEffect(() => {
    if (!uid) return;
    setSelected(readStoredClub(uid));
    return onSnapshot(
      doc(db, paths.user(uid)),
      (snap) => {
        const clubIds = (snap.data() as UserDoc | undefined)?.clubIds ?? [];
        setMemberships({ uid, clubIds });
      },
      (err) => {
        // Could not read the index: carry on with the default club rather than
        // block the whole app. `AuthProvider` reports any real problem.
        console.error('subscription_failed', 'user_clubs', err.code);
        setMemberships({ uid, clubIds: [] });
      },
    );
  }, [uid]);

  const loaded = uid === null || (uid !== undefined && memberships?.uid === uid);
  const clubIds = useMemo(
    () => (uid && memberships?.uid === uid ? memberships.clubIds : []),
    [uid, memberships],
  );
  const currentClubId = chooseClub(clubIds, selected);

  // Club names, for the header. Only clubs the person belongs to are readable.
  const clubIdsKey = clubIds.join(',');
  useEffect(() => {
    let cancelled = false;
    for (const clubId of clubIdsKey ? clubIdsKey.split(',') : []) {
      getDoc(doc(db, paths.club(clubId)))
        .then((snap) => {
          const name = (snap.data() as Club | undefined)?.name;
          if (!cancelled && name) setNames((prev) => (prev[clubId] === name ? prev : { ...prev, [clubId]: name }));
        })
        .catch(() => {
          // The id is shown instead; not worth an error state.
        });
    }
    return () => {
      cancelled = true;
    };
  }, [clubIdsKey]);

  const cp = useMemo(() => {
    // Set while rendering, not in an effect: children may issue a callable
    // from their own effects, which run before a parent's.
    setCurrentClubId(currentClubId);
    return clubPaths(currentClubId);
  }, [currentClubId]);

  const selectClub = useCallback(
    (clubId: ClubId) => {
      if (uid) storeClub(uid, clubId);
      setSelected(clubId);
    },
    [uid],
  );

  const clubsState = useMemo<ClubsState>(
    () => ({
      clubs: clubIds.map((id) => ({ id, name: names[id] ?? id })),
      currentClubId,
      selectClub,
    }),
    [clubIds, names, currentClubId, selectClub],
  );

  if (!loaded) return <p>Loading…</p>;

  return (
    <ClubsContext.Provider value={clubsState}>
      <ClubContext.Provider value={cp}>
        {/* Keyed by club: switching remounts everything below, so no state
            from one club (subscriptions, an admin's "acting as", an open
            dialog) survives into another. */}
        <div key={currentClubId} style={{ display: 'contents' }}>
          {children}
        </div>
      </ClubContext.Provider>
    </ClubsContext.Provider>
  );
}

