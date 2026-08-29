/**
 * Admin screens, code-split from the member bundle (plan §14.1 "Admin
 * (web only)"; Phase 7b task deliverable E). Nobody but an admin ever
 * navigates here, so none of `MembersScreen`/`ProgrammeImportScreen`/
 * `BroadcastScreen`/`AuditLogScreen`/`IntegrityScreen` (and everything they
 * import — the CSV import UI, the programme editor, the audit-log table)
 * needs to be in the initial JS an ordinary member downloads.
 *
 * Mounted once from `App.tsx` behind a single `/admin/*` route already
 * wrapped in `RequireAdmin` — the server-side check is the real guard (plan
 * §14.1: "All admin routes are also guarded server-side; the UI check is
 * cosmetic"), so lazy-loading the bundle costs nothing security-wise, it's
 * purely a download-size optimisation.
 */
import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';

const MembersScreen = lazy(() =>
  import('./screens/admin/MembersScreen').then((m) => ({ default: m.MembersScreen })),
);
const ProgrammeImportScreen = lazy(() =>
  import('./screens/admin/ProgrammeImportScreen').then((m) => ({
    default: m.ProgrammeImportScreen,
  })),
);
const BroadcastScreen = lazy(() =>
  import('./screens/admin/BroadcastScreen').then((m) => ({ default: m.BroadcastScreen })),
);
const AuditLogScreen = lazy(() =>
  import('./screens/admin/AuditLogScreen').then((m) => ({ default: m.AuditLogScreen })),
);
const IntegrityScreen = lazy(() =>
  import('./screens/admin/IntegrityScreen').then((m) => ({ default: m.IntegrityScreen })),
);

export function AdminRoutes() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <Routes>
        <Route path="members" element={<MembersScreen />} />
        <Route path="programme" element={<ProgrammeImportScreen />} />
        <Route path="broadcast" element={<BroadcastScreen />} />
        <Route path="audit" element={<AuditLogScreen />} />
        <Route path="integrity" element={<IntegrityScreen />} />
      </Routes>
    </Suspense>
  );
}
