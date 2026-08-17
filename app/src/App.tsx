/**
 * @file App.tsx
 * @description Main application component with routes and lazy loading
 * @feature app
 * @dependencies react-router-dom, react
 */

import { Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ProtectedRoute } from './features/auth';
import { useAuthStore, selectMustChangePassword, selectUserRole } from './features/auth/store/authStore';
import type { UserRole } from './features/auth/types/auth.types';
import { AppLayout } from './components/layout';
import { AlertProvider } from './features/alerts';
import { PageLoader } from './shared/components/ui/PageLoader';
import {
  LazyLandingPage,
  LazyLoginPage,
  LazyRegisterPage,
  LazyForgotPasswordPage,
  LazyResetPasswordPage,
  LazyAccountPage,
  LazyForcePasswordChangePage,
  LazyDashboardPage,
  LazyRobotDetailPage,
  LazyRobotCockpitPage,
  LazyFleetPage,
  LazyAgentModePage,
  LazyAlertsPage,
  LazyPatrolPage,
  LazyPatrolRouteEditorPage,
  LazyPatrolRunDetailPage,
  LazyTourPage,
  LazyTourEditorPage,
  LazyTourRunDetailPage,
  LazyProcessesPage,
  LazyProcessDetailPage,
  LazyA2AChatPage,
  LazyA2AAgentListPage,
  LazyA2AAgentDetailPage,
  LazyA2ATaskListPage,
  LazyA2AEventsPage,
  LazySettingsPage,
  LazyOrganizationsPage,
  LazyTeamPage,
  LazyCompliancePage,
  LazyIncidentDetailPage,
  LazyDatasetsPage,
  LazyDatasetEpisodesPage,
  LazyTrainingPage,
  LazyDeploymentsPage,
  LazyDeploymentDetailPage,
  LazyMarketplacePage,
  LazyMarketplaceDetailPage,
  LazyMyMarketplacePage,
  LazyUpdatesPage,
  LazyPipelinePage,
  LazyFleetLearningPage,
  LazyFleetLearningRoundDetailPage,
  LazyDataCollectionPage,
  LazyNewSessionPage,
  LazySessionDetailPage,
  LazyDocsPage,
  LazySitesGalleryPage,
  LazyTwinViewerPage,
  LazyNotFoundPage,
} from './routes/lazyPages';

// ============================================================================
// ROUTE HELPERS
// ============================================================================

/**
 * Wrapper for protected routes with AppLayout.
 *
 * TASK-164: if the signed-in user has `mustChangePassword === true`
 * (from login or /me), redirect to /set-password and block every
 * other page. The /set-password route bypasses this guard so the
 * user can actually complete the set.
 *
 * `requiresRole` gates a specific route to users with a qualifying
 * role. Users hitting a role-gated route without the right role get
 * bounced to /dashboard so they can't even see the feature's shell
 * (the server also enforces 403 on every mutation; this is
 * defense-in-depth + UX hygiene).
 */
function ProtectedAppRoute({
  children,
  requiresRole,
}: {
  children: React.ReactNode;
  requiresRole?: UserRole[];
}) {
  const mustChangePassword = useAuthStore(selectMustChangePassword);
  const role = useAuthStore(selectUserRole);
  const location = useLocation();

  const roleAllowed =
    !requiresRole || (role !== null && requiresRole.includes(role));

  return (
    <ProtectedRoute onUnauthenticated={() => {
        if (import.meta.env.VITE_DEMO_MODE === 'true') {
          window.location.href = import.meta.env.BASE_URL || '/';
        } else {
          window.location.href = '/login';
        }
      }}>
      {mustChangePassword && location.pathname !== '/set-password' ? (
        <Navigate to="/set-password" replace />
      ) : !roleAllowed ? (
        <Navigate to="/dashboard" replace />
      ) : (
        <AppLayout>{children}</AppLayout>
      )}
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
          <Route
            path="/register"
            element={
              <LazyRegisterPage
                onRegisterSuccess={() => (window.location.href = '/dashboard')}
              />
            }
          />
          <Route path="/forgot-password" element={<LazyForgotPasswordPage />} />
          <Route path="/reset-password" element={<LazyResetPasswordPage />} />

          {/* Protected routes */}
          <Route
            path="/dashboard"
            element={
              <ProtectedAppRoute>
                <LazyDashboardPage />
              </ProtectedAppRoute>
            }
          />
          {/* Orchestrator - merged into Dashboard chat drawer (TASK-147) */}
          <Route path="/orchestrator" element={<Navigate to="/dashboard?drawer=chat" replace />} />
          {/* Robots - merged into Fleet tabs (TASK-147). Detail route stays. */}
          <Route path="/robots" element={<Navigate to="/fleet?tab=list" replace />} />
          <Route
            path="/robots/:id"
            element={
              <ProtectedAppRoute>
                <LazyRobotDetailPage />
              </ProtectedAppRoute>
            }
          />
          {/* Robot Control Center — cockpit (camera, LiDAR, vitals, control) */}
          <Route
            path="/control-center"
            element={
              <ProtectedAppRoute>
                <LazyRobotCockpitPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/robots/:id/cockpit"
            element={
              <ProtectedAppRoute>
                <LazyRobotCockpitPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/fleet"
            element={
              <ProtectedAppRoute>
                <LazyFleetPage />
              </ProtectedAppRoute>
            }
          />
          {/* Digital Twin — room scanning + 3D twin viewer */}
          <Route
            path="/sites"
            element={
              <ProtectedAppRoute>
                <LazySitesGalleryPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/sites/:siteId"
            element={
              <ProtectedAppRoute>
                <LazyTwinViewerPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/alerts"
            element={
              <ProtectedAppRoute>
                <LazyAlertsPage />
              </ProtectedAppRoute>
            }
          />
          {/* Patrol (TASK-212) - routes, editor, run detail */}
          <Route
            path="/patrol"
            element={
              <ProtectedAppRoute>
                <LazyPatrolPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/patrol/routes/new"
            element={
              <ProtectedAppRoute>
                <LazyPatrolRouteEditorPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/patrol/routes/:id"
            element={
              <ProtectedAppRoute>
                <LazyPatrolRouteEditorPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/patrol/runs/:runId"
            element={
              <ProtectedAppRoute>
                <LazyPatrolRunDetailPage />
              </ProtectedAppRoute>
            }
          />
          {/* Guide (TASK-213) - host mode: tours, editor, visit detail */}
          <Route
            path="/tour"
            element={
              <ProtectedAppRoute>
                <LazyTourPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/tour/routes/new"
            element={
              <ProtectedAppRoute>
                <LazyTourEditorPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/tour/routes/:id"
            element={
              <ProtectedAppRoute>
                <LazyTourEditorPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/tour/runs/:runId"
            element={
              <ProtectedAppRoute>
                <LazyTourRunDetailPage />
              </ProtectedAppRoute>
            }
          />
          {/* Processes - workflow management */}
          <Route
            path="/processes"
            element={
              <ProtectedAppRoute>
                <LazyProcessesPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/processes/:id"
            element={
              <ProtectedAppRoute>
                <LazyProcessDetailPage />
              </ProtectedAppRoute>
            }
          />
          {/* Redirect old /tasks routes to /processes */}
          <Route path="/tasks" element={<Navigate to="/processes" replace />} />
          <Route path="/tasks/:id" element={<Navigate to="/processes" replace />} />
          {/* /chat route — shows A2A chat (demo placeholder in demo mode) */}
          <Route
            path="/chat"
            element={
              <ProtectedAppRoute>
                <LazyA2AChatPage />
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
          <Route
            path="/organizations"
            element={
              <ProtectedAppRoute requiresRole={['super-admin']}>
                <LazyOrganizationsPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/team"
            element={
              <ProtectedAppRoute requiresRole={['super-admin', 'owner']}>
                <LazyTeamPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/account"
            element={
              <ProtectedAppRoute>
                <LazyAccountPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/set-password"
            element={
              <ProtectedRoute onUnauthenticated={() => {
                window.location.href = '/login';
              }}>
                <LazyForcePasswordChangePage />
              </ProtectedRoute>
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
          {/* Explainability - merged into Compliance tabs (TASK-147) */}
          <Route path="/explainability" element={<Navigate to="/compliance?tab=explainability" replace />} />
          {/* Compliance - Audit logging (EU AI Act Art. 12, GDPR Art. 30) */}
          <Route
            path="/compliance"
            element={
              <ProtectedAppRoute>
                <LazyCompliancePage />
              </ProtectedAppRoute>
            }
          />
          {/* GDPR - merged into Compliance tabs (TASK-147) */}
          <Route path="/gdpr" element={<Navigate to="/compliance?tab=gdpr" replace />} />
          {/* Incidents - merged into Alerts tabs (TASK-147). Detail route stays. */}
          <Route path="/incidents" element={<Navigate to="/alerts?tab=incidents" replace />} />
          <Route
            path="/incidents/:id"
            element={
              <ProtectedAppRoute>
                <LazyIncidentDetailPage />
              </ProtectedAppRoute>
            }
          />
          {/* Oversight - merged into Compliance tabs (TASK-147) */}
          <Route path="/oversight" element={<Navigate to="/compliance?tab=oversight" replace />} />
          {/* Approvals - merged into Compliance tabs (TASK-147) */}
          <Route path="/approvals" element={<Navigate to="/compliance?tab=approvals" replace />} />

          {/* Training - VLA model fine-tuning */}
          <Route
            path="/datasets/:datasetId/episodes"
            element={
              <ProtectedAppRoute>
                <LazyDatasetEpisodesPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/datasets"
            element={
              <ProtectedAppRoute>
                <LazyDatasetsPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/training"
            element={
              <ProtectedAppRoute>
                <LazyTrainingPage />
              </ProtectedAppRoute>
            }
          />
          {/* /models removed (TASK-142): MLflow registry deleted */}
          <Route path="/models" element={<Navigate to="/training" replace />} />

          {/* DataCollection - Robot data collection sessions */}
          <Route
            path="/data-collection"
            element={
              <ProtectedAppRoute>
                <LazyDataCollectionPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/data-collection/new"
            element={
              <ProtectedAppRoute>
                <LazyNewSessionPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/data-collection/:sessionId"
            element={
              <ProtectedAppRoute>
                <LazySessionDetailPage />
              </ProtectedAppRoute>
            }
          />
          {/*
            TASK-117: alias path explicitly named in the task body. The
            recording-focused dashboard lives on the same SessionDetailPage
            because the page already covers the full record workflow
            (start/pause/end + cameras + joints + auto-export).
          */}
          <Route
            path="/data-collection/record/:sessionId"
            element={
              <ProtectedAppRoute>
                <LazySessionDetailPage />
              </ProtectedAppRoute>
            }
          />

          {/* Deployment - VLA fleet deployment management */}
          <Route
            path="/deployments"
            element={
              <ProtectedAppRoute>
                <LazyDeploymentsPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/deployments/:id"
            element={
              <ProtectedAppRoute>
                <LazyDeploymentDetailPage />
              </ProtectedAppRoute>
            }
          />
          {/* Skill Library - merged into Deployments tabs (TASK-147) */}
          <Route path="/skills" element={<Navigate to="/deployments?tab=skills" replace />} />

          {/* Fleet Learning - federated learning rounds */}
          <Route
            path="/fleet-learning"
            element={
              <ProtectedAppRoute>
                <LazyFleetLearningPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/fleet-learning/rounds/:id"
            element={
              <ProtectedAppRoute>
                <LazyFleetLearningRoundDetailPage />
              </ProtectedAppRoute>
            }
          />

          {/* Evaluation - merged into Training tabs (TASK-147) */}
          <Route path="/evaluation" element={<Navigate to="/training?tab=evaluation" replace />} />

          {/* Contributions - orphan route (TASK-147), redirected to Marketplace */}
          <Route path="/contributions" element={<Navigate to="/marketplace" replace />} />
          <Route path="/contributions/new" element={<Navigate to="/marketplace" replace />} />
          <Route path="/contributions/:id" element={<Navigate to="/marketplace" replace />} />

          {/* Marketplace - Skill & Data Marketplace */}
          <Route
            path="/marketplace"
            element={
              <ProtectedAppRoute>
                <LazyMarketplacePage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/marketplace/mine"
            element={
              <ProtectedAppRoute>
                <LazyMyMarketplacePage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/marketplace/:id"
            element={
              <ProtectedAppRoute>
                <LazyMarketplaceDetailPage />
              </ProtectedAppRoute>
            }
          />

          {/* Simulation - merged into Training tabs (TASK-147) */}
          <Route path="/simulation" element={<Navigate to="/training?tab=simulation" replace />} />

          {/* Pipeline - unified training workflow overview (TASK-134) */}
          <Route
            path="/pipeline"
            element={
              <ProtectedAppRoute>
                <LazyPipelinePage />
              </ProtectedAppRoute>
            }
          />

          {/* Docs - Documentation viewer */}
          <Route
            path="/docs"
            element={
              <ProtectedAppRoute>
                <LazyDocsPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/docs/*"
            element={
              <ProtectedAppRoute>
                <LazyDocsPage />
              </ProtectedAppRoute>
            }
          />

          {/* Updates - Secure OTA update management (CRA Art. 13, MR Art. 10) */}
          <Route
            path="/updates"
            element={
              <ProtectedAppRoute>
                <LazyUpdatesPage />
              </ProtectedAppRoute>
            }
          />

          {/* Agent Mode - local LLM plans and runs blocks on a robot (TASK-194) */}
          <Route
            path="/agent"
            element={
              <ProtectedAppRoute>
                <LazyAgentModePage />
              </ProtectedAppRoute>
            }
          />

          {/* Fallback — proper 404 page instead of a silent redirect */}
          <Route path="*" element={<LazyNotFoundPage />} />
        </Routes>
      </Suspense>
    </AlertProvider>
  );
}

export { App };
