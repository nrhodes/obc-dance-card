/**
 * Whether the signed-in person is a platform administrator (plan §21 B14.3):
 * whether `platformAdmins/{uid}` exists. Cosmetic — it only decides whether
 * to show the Platform area; the server re-checks on every platform callable.
 */
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { paths } from '@obc/shared';
import { db } from '../firebase';
import { useAuth } from '../auth/useAuth';

export interface PlatformAdminState {
  isPlatformAdmin: boolean;
  /** True until the answer is known for the current person. */
  loading: boolean;
}

export function usePlatformAdmin(): PlatformAdminState {
  const { member } = useAuth();
  const uid = member?.id;
  const [state, setState] = useState<{ uid: string; isPlatformAdmin: boolean } | null>(null);

  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      doc(db, paths.platformAdmin(uid)),
      (snap) => setState({ uid, isPlatformAdmin: snap.exists() }),
      () => setState({ uid, isPlatformAdmin: false }),
    );
  }, [uid]);

  if (!uid) return { isPlatformAdmin: false, loading: false };
  if (state?.uid !== uid) return { isPlatformAdmin: false, loading: true };
  return { isPlatformAdmin: state.isPlatformAdmin, loading: false };
}
