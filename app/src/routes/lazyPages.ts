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

// Legacy aliases for backwards compatibility
export const LazyTasksPage = LazyProcessesPage;
export const LazyTaskDetailPage = LazyProcessDetailPage;

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

// ============================================================================
// STANDALONE PAGES
// ============================================================================

/**
 * Settings page - User preferences and app configuration
 */
export const LazySettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage }))
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
