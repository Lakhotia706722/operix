import { useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import useAuthStore from './store/useAuthStore';
import useUIStore from './store/useUIStore';
import useSocketStore from './store/useSocketStore';
import { useKeyboardShortcuts } from './hooks/useKeyboard';
import { useOffline } from './hooks/useOffline';
import { initTheme } from './utils/theme';
import Sidebar from './components/layout/Sidebar';
import CommandPalette from './components/ui/CommandPalette';
import ErrorBoundary from './components/ui/ErrorBoundary';
import PrivateRoute from './components/ui/PrivateRoute';

// Public pages — loaded immediately (small)
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import NotFoundPage from './pages/NotFoundPage';

// Lazy-loaded pages — code split for performance
const BoardsListPage      = lazy(() => import('./pages/BoardsListPage'));
const BoardPage           = lazy(() => import('./pages/BoardPage'));
const AnalyticsPage       = lazy(() => import('./pages/AnalyticsPage'));
const SettingsPage        = lazy(() => import('./pages/SettingsPage'));
const NotificationsPage   = lazy(() => import('./pages/NotificationsPage'));
const ForgotPasswordPage  = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage   = lazy(() => import('./pages/ResetPasswordPage'));
const EmailVerificationPage = lazy(() => import('./pages/EmailVerificationPage'));
const AcceptInvitePage    = lazy(() => import('./pages/AcceptInvitePage'));

const PageLoader = () => (
  <div className="flex items-center justify-center h-screen bg-[var(--bg-primary)]">
    <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
  </div>
);

function App() {
  const { isAuthenticated, user, refreshAuth } = useAuthStore();
  const { activeModal, closeModal, sidebarOpen } = useUIStore();
  const { disconnect } = useSocketStore();

  // Global hooks
  useKeyboardShortcuts();
  useOffline();

  // Apply saved theme on load
  useEffect(() => {
    initTheme(user?.preferences?.theme);
  }, [user?.preferences?.theme]);

  // Verify auth on app load (hydrate from cookie)
  useEffect(() => {
    if (isAuthenticated) refreshAuth();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Disconnect socket when logged out
  useEffect(() => {
    if (!isAuthenticated) disconnect();
  }, [isAuthenticated, disconnect]);

  // Handle unauthorized events from axios interceptor
  useEffect(() => {
    const handleUnauthorized = () => {
      useAuthStore.setState({ user: null, isAuthenticated: false });
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  return (
    <ErrorBoundary>
      <div className="flex h-screen overflow-hidden bg-[var(--bg-primary)]">
        {/* Persistent sidebar for authenticated users */}
        {isAuthenticated && <Sidebar />}

        {/* Main content area — shifts right when sidebar is open */}
        <div
          className="flex-1 flex flex-col min-w-0 transition-all duration-200"
          style={{ marginLeft: isAuthenticated && sidebarOpen ? '256px' : '0' }}
        >
          <Suspense fallback={<PageLoader />}>
            <Routes>
              {/* ── Public routes ─────────────────────────────────────── */}
              <Route
                path="/login"
                element={isAuthenticated ? <Navigate to="/boards" replace /> : <LoginPage />}
              />
              <Route
                path="/register"
                element={isAuthenticated ? <Navigate to="/boards" replace /> : <RegisterPage />}
              />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
              <Route path="/verify-email/:token" element={<EmailVerificationPage />} />
              <Route path="/accept-invite/:token" element={<AcceptInvitePage />} />

              {/* ── Private routes ────────────────────────────────────── */}
              <Route path="/" element={<Navigate to="/boards" replace />} />
              <Route
                path="/boards"
                element={<PrivateRoute><BoardsListPage /></PrivateRoute>}
              />
              <Route
                path="/boards/:boardId"
                element={<PrivateRoute><BoardPage /></PrivateRoute>}
              />
              <Route
                path="/boards/:boardId/analytics"
                element={<PrivateRoute><AnalyticsPage /></PrivateRoute>}
              />
              <Route
                path="/notifications"
                element={<PrivateRoute><NotificationsPage /></PrivateRoute>}
              />
              <Route
                path="/settings"
                element={<PrivateRoute><SettingsPage /></PrivateRoute>}
              />

              {/* ── 404 ───────────────────────────────────────────────── */}
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </div>
      </div>

      {/* ── Global modals / overlays ─────────────────────────────────── */}
      <CommandPalette
        isOpen={activeModal === 'command-palette'}
        onClose={closeModal}
      />
    </ErrorBoundary>
  );
}

export default App;
