/**
 * Shared "my entries" subscription (plan §21 B2/B4), extracted from
 * `HomeScreen` so both "My Dance Card" and the new Calendar screen
 * (`CalendarScreen`) read the exact same live data — one Firestore listener
 * per signed-in session, not two. Behaviour is unchanged from the
 * pre-extraction `HomeScreen` effect: entries where `memberId == X` ordered
 * by `date` (the existing `entries(memberId, date)` index), re-subscribing
 * whenever the effective member changes (plan Phase 6b task deliverable 2:
 * while an admin is acting on behalf of a member, this reads that member's
 * entries instead of the admin's own).
 */
import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { paths, type Entry } from '@obc/shared';
import { db } from '../firebase';
import { useEffectiveMember } from '../admin/useEffectiveMember';

export interface MyEntriesResult {
  entries: Entry[];
  /** True until the first snapshot (or error) for the current effective member has arrived. */
  loading: boolean;
  /** Set when the live subscription failed (e.g. a rules denial) — never conflated with "no entries yet". */
  error: { code: string } | null;
}

export function useMyEntries(): MyEntriesResult {
  const { effectiveMemberId } = useEffectiveMember();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<{ code: string } | null>(null);

  useEffect(() => {
    if (!effectiveMemberId) {
      setEntries([]);
      setLoaded(true);
      return;
    }
    setLoaded(false);
    const q = query(collection(db, paths.entries()), where('memberId', '==', effectiveMemberId), orderBy('date', 'asc'));
    return onSnapshot(
      q,
      (snap) => {
        setEntries(snap.docs.map((d) => d.data() as Entry));
        setError(null);
        setLoaded(true);
      },
      (err) => {
        console.error('subscription_failed', 'my_entries', err.code);
        setEntries([]);
        setError({ code: err.code });
        setLoaded(true);
      },
    );
  }, [effectiveMemberId]);

  return { entries, loading: !loaded, error };
}
