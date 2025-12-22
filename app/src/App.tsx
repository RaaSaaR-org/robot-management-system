/**
 * @file App.tsx
 * @description Main application component with routes and lazy loading
 * @feature app
 * @dependencies react-router-dom, react
 */

import { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './features/auth';
import { AppLayout } from './components/layout';
import { AlertProvider } from './features/alerts';
import { PageLoader } from './shared/components/ui/PageLoader';
import {
  LazyLandingPage,
  LazyLoginPage,
  LazyDashboardPage,
  LazyOrchestratorChatPage,
  LazyRobotsPage,
  LazyRobotDetailPage,
  LazyTasksPage,
  LazyTaskDetailPage,
  LazyA2AChatPage,
  LazyA2AAgentListPage,
  LazyA2AAgentDetailPage,
  LazyA2ATaskListPage,
  LazyA2AEventsPage,
  LazySettingsPage,
} from './routes/lazyPages';

// ============================================================================
// ROUTE HELPERS
// ============================================================================

/**
 * Wrapper for protected routes with AppLayout
 */
function ProtectedAppRoute({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute onUnauthenticated={() => (window.location.href = '/login')}>
      <AppLayout>{children}</AppLayout>
    </ProtectedRoute>
  );
}

// ============================================================================
// APP COMPONENT
// ============================================================================

function App() {
  return (
    <AlertProvider>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<LazyLandingPage />} />
          <Route
            path="/login"
            element={
              <LazyLoginPage
                onLoginSuccess={() => (window.location.href = '/dashboard')}
              />
            }
          />

          {/* Protected routes */}
          <Route
            path="/dashboard"
            element={
              <ProtectedAppRoute>
                <LazyDashboardPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/orchestrator"
            element={
              <ProtectedAppRoute>
                <LazyOrchestratorChatPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/robots"
            element={
              <ProtectedAppRoute>
                <LazyRobotsPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/robots/:id"
            element={
              <ProtectedAppRoute>
                <LazyRobotDetailPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/tasks"
            element={
              <ProtectedAppRoute>
                <LazyTasksPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/tasks/:id"
            element={
              <ProtectedAppRoute>
                <LazyTaskDetailPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedAppRoute>
                <LazySettingsPage />
              </ProtectedAppRoute>
            }
          />
          {/* A2A Routes */}
          <Route
            path="/a2a"
            element={
              <ProtectedAppRoute>
                <LazyA2AChatPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/a2a/agents"
            element={
              <ProtectedAppRoute>
                <LazyA2AAgentListPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/a2a/agents/:name"
            element={
              <ProtectedAppRoute>
                <LazyA2AAgentDetailPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/a2a/tasks"
            element={
              <ProtectedAppRoute>
                <LazyA2ATaskListPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/a2a/events"
            element={
              <ProtectedAppRoute>
                <LazyA2AEventsPage />
              </ProtectedAppRoute>
            }
          />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AlertProvider>
  );
}

export default App;
