/**
 * @file lazyPages.ts
 * @description Lazy-loaded page components for route code splitting
 * @feature routing
 */

import { lazy } from 'react';

// ============================================================================
// FEATURE PAGES
// ============================================================================

/**
 * Dashboard page - Fleet overview with stats and map
 */
export const LazyDashboardPage = lazy(() =>
  import('@/features/dashboard').then((m) => ({ default: m.DashboardPage }))
);

/**
 * Robot detail page - Single robot view
 */
export const LazyRobotDetailPage = lazy(() =>
  import('@/features/robots').then((m) => ({ default: m.RobotDetailPage }))
);

/**
 * Robot Control Center — single-screen cockpit (camera, LiDAR, vitals, control)
 */
export const LazyRobotCockpitPage = lazy(() =>
  import('@/features/robots').then((m) => ({ default: m.RobotCockpitPage }))
);

/**
 * Processes list page - All processes/workflows with filtering
 */
export const LazyProcessesPage = lazy(() =>
  import('@/features/processes').then((m) => ({ default: m.ProcessesPage }))
);

/**
 * Process detail page - Single process/workflow view
 */
export const LazyProcessDetailPage = lazy(() =>
  import('@/features/processes').then((m) => ({ default: m.ProcessDetailPage }))
);

/**
 * Fleet page - Fleet management with map and zones
 */
export const LazyFleetPage = lazy(() =>
  import('@/features/fleet').then((m) => ({ default: m.FleetPage }))
);

/**
 * Digital Twin — sites gallery and the 3D twin viewer / room scanner
 */
export const LazySitesGalleryPage = lazy(() =>
  import('@/features/digitaltwin').then((m) => ({ default: m.SitesGalleryPage }))
);
export const LazyTwinViewerPage = lazy(() =>
  import('@/features/digitaltwin').then((m) => ({ default: m.TwinViewerPage }))
);

/**
 * Alerts page - Alert history and management
 */
export const LazyAlertsPage = lazy(() =>
  import('@/features/alerts').then((m) => ({ default: m.AlertsPage }))
);

/**
 * A2A Chat page - Main chat interface
 */
export const LazyA2AChatPage = lazy(() =>
  import('@/features/a2a').then((m) => ({ default: m.ChatPage }))
);

/**
 * A2A Agent List page - All registered agents
 */
export const LazyA2AAgentListPage = lazy(() =>
  import('@/features/a2a').then((m) => ({ default: m.AgentListPage }))
);

/**
 * A2A Agent Detail page - Single agent details
 */
export const LazyA2AAgentDetailPage = lazy(() =>
  import('@/features/a2a').then((m) => ({ default: m.AgentDetailPage }))
);

/**
 * A2A Task List page - All tasks with filtering
 */
export const LazyA2ATaskListPage = lazy(() =>
  import('@/features/a2a').then((m) => ({ default: m.TaskListPage }))
);

/**
 * A2A Events page - Event viewer for A2A interactions
 */
export const LazyA2AEventsPage = lazy(() =>
  import('@/features/a2a').then((m) => ({ default: m.EventsPage }))
);

/**
 * Compliance page - Audit logging (EU AI Act Art. 12, GDPR Art. 30)
 */
export const LazyCompliancePage = lazy(() =>
  import('@/features/compliance').then((m) => ({ default: m.CompliancePage }))
);

/**
 * Incident detail page - Single incident view
 */
export const LazyIncidentDetailPage = lazy(() =>
  import('@/features/incidents').then((m) => ({ default: m.IncidentDetailPage }))
);

/**
 * DataCollection page - Robot data collection sessions
 */
export const LazyDataCollectionPage = lazy(() =>
  import('@/features/datacollection').then((m) => ({ default: m.DataCollectionPage }))
);

/**
 * New session page - Start new data collection session
 */
export const LazyNewSessionPage = lazy(() =>
  import('@/features/datacollection').then((m) => ({ default: m.NewSessionPage }))
);

/**
 * Session detail page - Single data collection session view
 */
export const LazySessionDetailPage = lazy(() =>
  import('@/features/datacollection').then((m) => ({ default: m.SessionDetailPage }))
);

/**
 * Datasets page - VLA training dataset management
 */
export const LazyDatasetsPage = lazy(() =>
  import('@/features/training').then((m) => ({ default: m.DatasetsPage }))
);

/**
 * Dataset episodes page - Episode viewer with video and joint state chart
 */
export const LazyDatasetEpisodesPage = lazy(() =>
  import('@/features/training').then((m) => ({ default: m.DatasetEpisodesPage }))
);

/**
 * Training page - VLA model fine-tuning
 */
export const LazyTrainingPage = lazy(() =>
  import('@/features/training').then((m) => ({ default: m.TrainingPage }))
);

/**
 * Deployments page - VLA fleet deployment management
 */
export const LazyDeploymentsPage = lazy(() =>
  import('@/features/deployment').then((m) => ({ default: m.DeploymentsPage }))
);

/**
 * Deployment detail page - Single deployment view with metrics
 */
export const LazyDeploymentDetailPage = lazy(() =>
  import('@/features/deployment').then((m) => ({ default: m.DeploymentDetailPage }))
);

/**
 * Marketplace browse page
 */
export const LazyMarketplacePage = lazy(() =>
  import('@/features/contributions').then((m) => ({ default: m.MarketplacePage }))
);

/**
 * Marketplace listing detail page
 */
export const LazyMarketplaceDetailPage = lazy(() =>
  import('@/features/contributions').then((m) => ({ default: m.MarketplaceDetailPage }))
);

/**
 * My marketplace page - purchases and listings
 */
export const LazyMyMarketplacePage = lazy(() =>
  import('@/features/contributions').then((m) => ({ default: m.MyMarketplacePage }))
);

/**
 * Updates page - Secure OTA update management (CRA Art. 13, MR Art. 10)
 */
export const LazyUpdatesPage = lazy(() =>
  import('@/features/updates').then((m) => ({ default: m.UpdatesPage }))
);

/**
 * Pipeline page - unified training pipeline overview (TASK-134)
 */
export const LazyPipelinePage = lazy(() =>
  import('@/features/pipeline').then((m) => ({ default: m.PipelinePage }))
);

/**
 * Fleet Learning page - Federated learning rounds, privacy budgets, ROHE
 */
export const LazyFleetLearningPage = lazy(() =>
  import('@/features/fleetlearning').then((m) => ({ default: m.FleetLearningPage }))
);

/**
 * Fleet Learning round detail page - Single federated round view
 */
export const LazyFleetLearningRoundDetailPage = lazy(() =>
  import('@/features/fleetlearning').then((m) => ({ default: m.RoundDetailPage }))
);

// ============================================================================
// STANDALONE PAGES
// ============================================================================

/**
 * Docs page - Documentation viewer with markdown rendering
 */
export const LazyDocsPage = lazy(() =>
  import('@/pages/DocsPage').then((m) => ({ default: m.DocsPage }))
);

/**
 * Settings page - User preferences and app configuration (TASK-014)
 */
export const LazySettingsPage = lazy(() =>
  import('@/features/settings').then((m) => ({ default: m.SettingsPage }))
);

/**
 * Landing page - Public marketing page
 */
export const LazyLandingPage = lazy(() =>
  import('@/pages/LandingPage').then((m) => ({ default: m.LandingPage }))
);

/**
 * Not-found page - 404 fallback for unknown routes
 */
export const LazyNotFoundPage = lazy(() =>
  import('@/pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage }))
);

/**
 * Login page - Authentication
 */
export const LazyLoginPage = lazy(() =>
  import('@/features/auth').then((m) => ({ default: m.LoginPage }))
);

/**
 * Register page - User registration
 */
export const LazyRegisterPage = lazy(() =>
  import('@/features/auth').then((m) => ({ default: m.RegisterPage }))
);

/**
 * Forgot password page - Request password reset
 */
export const LazyForgotPasswordPage = lazy(() =>
  import('@/features/auth').then((m) => ({ default: m.ForgotPasswordPage }))
);

/**
 * Reset password page - Set new password with token
 */
export const LazyResetPasswordPage = lazy(() =>
  import('@/features/auth').then((m) => ({ default: m.ResetPasswordPage }))
);

/**
 * Account page - User account settings
 */
export const LazyAccountPage = lazy(() =>
  import('@/features/auth').then((m) => ({ default: m.AccountPage }))
);

/**
 * Force-password-change page - TASK-164 first-login gate
 */
export const LazyForcePasswordChangePage = lazy(() =>
  import('@/features/auth').then((m) => ({ default: m.ForcePasswordChangePage }))
);

/**
 * Organizations page - Customer tenant management (TASK-155 Wave 2)
 */
export const LazyOrganizationsPage = lazy(() =>
  import('@/features/organizations').then((m) => ({ default: m.OrganizationsPage }))
);

/**
 * Team page - Tenant-scoped team management (TASK-163)
 */
export const LazyTeamPage = lazy(() =>
  import('@/features/team').then((m) => ({ default: m.TeamPage }))
);
