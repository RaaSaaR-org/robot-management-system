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
 * Robots list page - All robots with filtering
 */
export const LazyRobotsPage = lazy(() =>
  import('@/features/robots').then((m) => ({ default: m.RobotsPage }))
);

/**
 * Robot detail page - Single robot view
 */
export const LazyRobotDetailPage = lazy(() =>
  import('@/features/robots').then((m) => ({ default: m.RobotDetailPage }))
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
 * Alerts page - Alert history and management
 */
export const LazyAlertsPage = lazy(() =>
  import('@/features/alerts').then((m) => ({ default: m.AlertsPage }))
);

/**
 * A2A page - Agent-to-Agent communication (legacy, replaced by ChatPage)
 */
export const LazyA2APage = lazy(() =>
  import('@/features/a2a').then((m) => ({ default: m.A2APage }))
);

/**
 * A2A Chat page - Main chat interface
 */
export const LazyA2AChatPage = lazy(() =>
  import('@/features/a2a').then((m) => ({ default: m.ChatPage }))
);

/**
 * Orchestrator Chat page - Chat with intelligent agent routing
 */
export const LazyOrchestratorChatPage = lazy(() =>
  import('@/features/a2a').then((m) => ({ default: m.OrchestratorChatPage }))
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
 * Explainability page - AI decision transparency (EU AI Act)
 */
export const LazyExplainabilityPage = lazy(() =>
  import('@/features/explainability').then((m) => ({ default: m.ExplainabilityPage }))
);

/**
 * Compliance page - Audit logging (EU AI Act Art. 12, GDPR Art. 30)
 */
export const LazyCompliancePage = lazy(() =>
  import('@/features/compliance').then((m) => ({ default: m.CompliancePage }))
);

/**
 * GDPR Portal page - Data subject rights self-service (GDPR Articles 15-22)
 */
export const LazyGDPRPortalPage = lazy(() =>
  import('@/features/gdpr').then((m) => ({ default: m.GDPRPortalPage }))
);

/**
 * Incidents page - Incident management and regulatory reporting
 */
export const LazyIncidentsPage = lazy(() =>
  import('@/features/incidents').then((m) => ({ default: m.IncidentsPage }))
);

/**
 * Incident detail page - Single incident view
 */
export const LazyIncidentDetailPage = lazy(() =>
  import('@/features/incidents').then((m) => ({ default: m.IncidentDetailPage }))
);

/**
 * Oversight page - Human oversight dashboard (EU AI Act Art. 14)
 */
export const LazyOversightPage = lazy(() =>
  import('@/features/oversight').then((m) => ({ default: m.OversightPage }))
);

/**
 * Approvals page - Human approval workflows (GDPR Art. 22, AI Act Art. 14)
 */
export const LazyApprovalsPage = lazy(() =>
  import('@/features/approvals').then((m) => ({ default: m.ApprovalsPage }))
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
 * Models page - Model registry and version management
 */
export const LazyModelsPage = lazy(() =>
  import('@/features/training').then((m) => ({ default: m.ModelsPage }))
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
 * Skills page - Skill library management
 */
export const LazySkillsPage = lazy(() =>
  import('@/features/deployment').then((m) => ({ default: m.SkillsPage }))
);

/**
 * Contributions page - Data contribution portal
 */
export const LazyContributionsPage = lazy(() =>
  import('@/features/contributions').then((m) => ({ default: m.ContributionsPage }))
);

/**
 * New contribution page - Contribution wizard
 */
export const LazyNewContributionPage = lazy(() =>
  import('@/features/contributions').then((m) => ({ default: m.NewContributionPage }))
);

/**
 * Contribution detail page - Single contribution view
 */
export const LazyContributionDetailPage = lazy(() =>
  import('@/features/contributions').then((m) => ({ default: m.ContributionDetailPage }))
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
 * Evaluation dashboard page - VLA model evaluation metrics
 */
export const LazyEvaluationDashboardPage = lazy(() =>
  import('@/features/evaluation').then((m) => ({ default: m.EvaluationDashboardPage }))
);

/**
 * Updates page - Secure OTA update management (CRA Art. 13, MR Art. 10)
 */
export const LazyUpdatesPage = lazy(() =>
  import('@/features/updates').then((m) => ({ default: m.UpdatesPage }))
);

/**
 * Simulation page - MuJoCo/Isaac Lab policy testing (TASK-081)
 */
export const LazySimulationPage = lazy(() =>
  import('@/features/simulation').then((m) => ({ default: m.SimulationPage }))
);

/**
 * Pipeline page - unified training pipeline overview (TASK-134)
 */
export const LazyPipelinePage = lazy(() =>
  import('@/features/pipeline').then((m) => ({ default: m.PipelinePage }))
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
