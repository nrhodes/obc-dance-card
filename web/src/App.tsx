import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { MembersDirectoryProvider } from './members/MembersDirectoryProvider';
import { ProgrammeProvider } from './programme/ProgrammeProvider';
import { AppShell } from './components/AppShell';
import { RedirectIfSignedIn, RequireAdmin, RequireMember } from './components/RouteGuards';
import { SignInScreen } from './screens/SignInScreen';
import { HomeScreen } from './screens/HomeScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { ProgrammeScreen } from './screens/ProgrammeScreen';
import { SessionScreen } from './screens/SessionScreen';
import { MembersImportScreen } from './screens/admin/MembersImportScreen';
import { ProgrammeImportScreen } from './screens/admin/ProgrammeImportScreen';

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route
          path="/signin"
          element={
            <RedirectIfSignedIn>
              <SignInScreen />
            </RedirectIfSignedIn>
          }
        />
        <Route
          element={
            <RequireMember>
              <MembersDirectoryProvider>
                <ProgrammeProvider>
                  <AppShell />
                </ProgrammeProvider>
              </MembersDirectoryProvider>
            </RequireMember>
          }
        >
          <Route path="/" element={<HomeScreen />} />
          <Route path="/profile" element={<ProfileScreen />} />
          <Route path="/programme" element={<ProgrammeScreen />} />
          <Route path="/session/:year/:sessionId" element={<SessionScreen />} />
          <Route
            path="/admin/members"
            element={
              <RequireAdmin>
                <MembersImportScreen />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/programme"
            element={
              <RequireAdmin>
                <ProgrammeImportScreen />
              </RequireAdmin>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
