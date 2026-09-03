import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { ActingAsProvider } from './admin/ActingAsProvider';
import { MembersDirectoryProvider } from './members/MembersDirectoryProvider';
import { ProgrammeProvider } from './programme/ProgrammeProvider';
import { InvitesProvider } from './invites/InvitesProvider';
import { NotificationsProvider } from './notifications/NotificationsProvider';
import { VisitorsProvider } from './visitors/VisitorsProvider';
import { TeamsProvider } from './teams/TeamsProvider';
import { AppShell } from './components/AppShell';
import { RedirectIfSignedIn, RequireAdmin, RequireMember } from './components/RouteGuards';
import { SignInScreen } from './screens/SignInScreen';
import { HomeScreen } from './screens/HomeScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { VisitorsScreen } from './screens/VisitorsScreen';
import { ProgrammeScreen } from './screens/ProgrammeScreen';
import { CalendarScreen } from './screens/CalendarScreen';
import { SessionScreen } from './screens/SessionScreen';
import { InvitesScreen } from './screens/InvitesScreen';
import { NotificationsScreen } from './screens/NotificationsScreen';
import { PrivacyScreen } from './screens/PrivacyScreen';
import { HelpScreen } from './screens/HelpScreen';
import { AdminRoutes } from './AdminRoutes';
import { ErrorBoundary } from './components/ErrorBoundary';

export function App() {
  return (
    <ErrorBoundary>
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
          <Route path="/privacy" element={<PrivacyScreen />} />
          <Route
            element={
              <RequireMember>
                <ActingAsProvider>
                  <MembersDirectoryProvider>
                    <ProgrammeProvider>
                      <InvitesProvider>
                        <NotificationsProvider>
                          <VisitorsProvider>
                            <TeamsProvider>
                              <AppShell />
                            </TeamsProvider>
                          </VisitorsProvider>
                        </NotificationsProvider>
                      </InvitesProvider>
                    </ProgrammeProvider>
                  </MembersDirectoryProvider>
                </ActingAsProvider>
              </RequireMember>
            }
          >
            <Route path="/" element={<HomeScreen />} />
            <Route path="/profile" element={<ProfileScreen />} />
            <Route path="/visitors" element={<VisitorsScreen />} />
            <Route path="/programme" element={<ProgrammeScreen />} />
            <Route path="/calendar" element={<CalendarScreen />} />
            <Route path="/session/:year/:sessionId" element={<SessionScreen />} />
            <Route path="/invites" element={<InvitesScreen />} />
            <Route path="/notifications" element={<NotificationsScreen />} />
            <Route path="/help" element={<HelpScreen />} />
            <Route
              path="/admin/*"
              element={
                <RequireAdmin>
                  <AdminRoutes />
                </RequireAdmin>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </ErrorBoundary>
  );
}
