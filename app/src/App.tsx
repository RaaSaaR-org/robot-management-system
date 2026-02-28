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
  LazyRegisterPage,
  LazyForgotPasswordPage,
  LazyResetPasswordPage,
  LazyAccountPage,
  LazyDashboardPage,
  LazyOrchestratorChatPage,
  LazyRobotsPage,
  LazyRobotDetailPage,
  LazyFleetPage,
  LazyAlertsPage,
  LazyProcessesPage,
  LazyProcessDetailPage,
  LazyA2AChatPage,
  LazyA2AAgentListPage,
  LazyA2AAgentDetailPage,
  LazyA2ATaskListPage,
  LazyA2AEventsPage,
  LazySettingsPage,
  LazyExplainabilityPage,
  LazyCompliancePage,
  LazyGDPRPortalPage,
  LazyIncidentsPage,
  LazyIncidentDetailPage,
  LazyOversightPage,
  LazyApprovalsPage,
  LazyDatasetsPage,
  LazyTrainingPage,
  LazyModelsPage,
  LazyDeploymentsPage,
  LazyDeploymentDetailPage,
  LazySkillsPage,
  LazyContributionsPage,
  LazyNewContributionPage,
  LazyContributionDetailPage,
  LazyEvaluationDashboardPage,
  LazyUpdatesPage,
  LazySimulationPage,
  LazyDocsPage,
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
            path="/fleet"
            element={
              <ProtectedAppRoute>
                <LazyFleetPage />
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
            path="/account"
            element={
              <ProtectedAppRoute>
                <LazyAccountPage />
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
          {/* Explainability - AI transparency (EU AI Act) */}
          <Route
            path="/explainability"
            element={
              <ProtectedAppRoute>
                <LazyExplainabilityPage />
              </ProtectedAppRoute>
            }
          />
          {/* Compliance - Audit logging (EU AI Act Art. 12, GDPR Art. 30) */}
          <Route
            path="/compliance"
            element={
              <ProtectedAppRoute>
                <LazyCompliancePage />
              </ProtectedAppRoute>
            }
          />
          {/* GDPR - Data subject rights self-service (GDPR Articles 15-22) */}
          <Route
            path="/gdpr"
            element={
              <ProtectedAppRoute>
                <LazyGDPRPortalPage />
              </ProtectedAppRoute>
            }
          />
          {/* Incidents - Incident management and regulatory reporting */}
          <Route
            path="/incidents"
            element={
              <ProtectedAppRoute>
                <LazyIncidentsPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/incidents/:id"
            element={
              <ProtectedAppRoute>
                <LazyIncidentDetailPage />
              </ProtectedAppRoute>
            }
          />
          {/* Oversight - Human oversight dashboard (EU AI Act Art. 14) */}
          <Route
            path="/oversight"
            element={
              <ProtectedAppRoute>
                <LazyOversightPage />
              </ProtectedAppRoute>
            }
          />
          {/* Approvals - Human approval workflows (GDPR Art. 22, AI Act Art. 14) */}
          <Route
            path="/approvals"
            element={
              <ProtectedAppRoute>
                <LazyApprovalsPage />
              </ProtectedAppRoute>
            }
          />

          {/* Training - VLA model fine-tuning */}
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
          <Route
            path="/models"
            element={
              <ProtectedAppRoute>
                <LazyModelsPage />
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
          <Route
            path="/skills"
            element={
              <ProtectedAppRoute>
                <LazySkillsPage />
              </ProtectedAppRoute>
            }
          />

          {/* Evaluation - VLA model evaluation dashboard */}
          <Route
            path="/evaluation"
            element={
              <ProtectedAppRoute>
                <LazyEvaluationDashboardPage />
              </ProtectedAppRoute>
            }
          />

          {/* Contributions - Data contribution portal */}
          <Route
            path="/contributions"
            element={
              <ProtectedAppRoute>
                <LazyContributionsPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/contributions/new"
            element={
              <ProtectedAppRoute>
                <LazyNewContributionPage />
              </ProtectedAppRoute>
            }
          />
          <Route
            path="/contributions/:id"
            element={
              <ProtectedAppRoute>
                <LazyContributionDetailPage />
              </ProtectedAppRoute>
            }
          />

          {/* Simulation - MuJoCo/Isaac Lab policy testing (TASK-081) */}
          <Route
            path="/simulation"
            element={
              <ProtectedAppRoute>
                <LazySimulationPage />
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

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AlertProvider>
  );
}

export { App };
