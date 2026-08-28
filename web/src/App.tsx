import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { AppShell } from './components/AppShell';
import { RedirectIfSignedIn, RequireAdmin, RequireMember } from './components/RouteGuards';
import { SignInScreen } from './screens/SignInScreen';
import { HomeScreen } from './screens/HomeScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { MembersImportScreen } from './screens/admin/MembersImportScreen';

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
              <AppShell />
            </RequireMember>
          }
        >
          <Route path="/" element={<HomeScreen />} />
          <Route path="/profile" element={<ProfileScreen />} />
          <Route
            path="/admin/members"
            element={
              <RequireAdmin>
                <MembersImportScreen />
              </RequireAdmin>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
