/**
 * @file RobotControlCenter.tsx
 * @description Main layout orchestrator for robot detail page — control center with view switcher and chat sidebar
 * @feature robots
 */

import { memo, useState, type ReactNode } from 'react';
import { cn } from '@/shared/utils';
import { RobotChatPanel } from './RobotChatPanel';
import { RobotOfflineBanner } from './RobotOfflineBanner';
import { RobotErrorBanner } from './RobotErrorBanner';
import { VlaControlSection } from './VlaControlSection';
import { RobotHeroSection } from './RobotHeroSection';
import {
  TelemetryTab,
  CommandsTab,
  TasksTab,
  InfoTab,
  Model3DTab,
  TeleopTab,
} from './tabs';
import type { Robot, RobotTelemetry, RobotCommand } from '../types/robots.types';
import type { Process } from '@/features/processes/types';

// ============================================================================
// TYPES
// ============================================================================

type ViewId = 'telemetry' | 'commands' | 'tasks' | 'info' | '3d-model' | 'teleop';

export interface RobotControlCenterProps {
  robot: Robot;
  robotId: string;
  telemetry: RobotTelemetry | null;
  isTelemetryConnected: boolean;
  telemetryLastUpdate: Date | null;
  commandHistory: RobotCommand[];
  isCommandLoading: boolean;
  canExecuteCommands: boolean;
  tasks: Process[];
  onSendToCharge: () => Promise<void>;
  onReturnHome: () => Promise<void>;
  className?: string;
}

// ============================================================================
// VIEW CONFIG
// ============================================================================

interface ViewConfig {
  id: ViewId;
  label: string;
  icon: ReactNode;
}

const VIEWS: ViewConfig[] = [
  {
    id: 'telemetry',
    label: 'Telemetry',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
  },
  {
    id: 'commands',
    label: 'Commands',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
      </svg>
    ),
  },
  {
    id: 'tasks',
    label: 'Tasks',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    id: 'info',
    label: 'Info',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
      </svg>
    ),
  },
  {
    id: '3d-model',
    label: '3D',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
      </svg>
    ),
  },
  {
    id: 'teleop',
    label: 'Teleop',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" />
      </svg>
    ),
  },
];

const ChatIcon = (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
);

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Robot control center layout with view switcher and persistent chat sidebar.
 * Desktop: two-column grid (main view + chat sidebar).
 * Mobile: single column with floating action button for chat.
 */
export const RobotControlCenter = memo(function RobotControlCenter({
  robot,
  robotId,
  telemetry,
  isTelemetryConnected,
  telemetryLastUpdate,
  commandHistory,
  isCommandLoading,
  canExecuteCommands,
  tasks,
  onSendToCharge,
  onReturnHome,
  className,
}: RobotControlCenterProps) {
  const [activeView, setActiveView] = useState<ViewId>('telemetry');
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false);

  const renderView = () => {
    switch (activeView) {
      case 'telemetry':
        return (
          <TelemetryTab
            robot={robot}
            robotId={robotId}
            telemetry={telemetry}
            isTelemetryConnected={isTelemetryConnected}
            telemetryLastUpdate={telemetryLastUpdate}
          />
        );
      case 'commands':
        return (
          <CommandsTab
            robot={robot}
            robotId={robotId}
            commandHistory={commandHistory}
            isCommandLoading={isCommandLoading}
            canExecuteCommands={canExecuteCommands}
            onSendToCharge={onSendToCharge}
            onReturnHome={onReturnHome}
          />
        );
      case 'tasks':
        return <TasksTab robot={robot} robotId={robotId} tasks={tasks} />;
      case 'info':
        return <InfoTab robot={robot} robotId={robotId} />;
      case '3d-model':
        return (
          <Model3DTab
            robot={robot}
            robotId={robotId}
            telemetry={telemetry}
            isTelemetryConnected={isTelemetryConnected}
          />
        );
      case 'teleop':
        return (
          <TeleopTab
            robot={robot}
            robotId={robotId}
          />
        );
    }
  };

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* Offline / Error banners */}
      {robot.status === 'offline' && (
        <RobotOfflineBanner robotName={robot.name} lastSeen={robot.lastSeen} />
      )}
      <RobotErrorBanner robot={robot} telemetry={telemetry} />

      {/* Hero — 3D viewer + Hex HUD + Chat */}
      <RobotHeroSection
        robot={robot}
        telemetry={telemetry}
        isLive={isTelemetryConnected}
      >
        <RobotChatPanel
          robotId={robotId}
          robotName={robot.name}
          agentUrl={robot.a2aAgentUrl}
          className="h-full w-full"
        />
      </RobotHeroSection>

      {/* VLA section */}
      <VlaControlSection robotId={robotId} />

      {/* View switcher + full-width content */}
      <div className="flex flex-col gap-3">
        {/* View switcher */}
        <div
          className="flex gap-1 p-1 rounded-xl glass-subtle"
          role="tablist"
          aria-label="Robot views"
        >
          {VIEWS.map((view) => {
            const isActive = activeView === view.id;
            return (
              <button
                key={view.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveView(view.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium',
                  'transition-all duration-150 flex-1 justify-center',
                  isActive
                    ? 'text-[#FF6700] bg-[rgba(255,103,0,0.12)] border border-[rgba(255,103,0,0.25)]'
                    : 'text-theme-tertiary hover:text-theme-secondary hover:bg-[rgba(255,255,255,0.04)]'
                )}
              >
                {view.icon}
                <span className="hidden sm:inline">{view.label}</span>
              </button>
            );
          })}
        </div>

        {/* Active view content — full width */}
        <div
          className="glass-card p-4 min-h-[400px]"
          style={{ animation: 'materialize 0.35s ease-out' }}
          key={activeView}
        >
          {renderView()}
        </div>
      </div>

      {/* ── Mobile bottom nav ── */}
      <nav
        className={cn(
          'lg:hidden fixed bottom-0 left-0 right-0 z-20',
          'flex items-center justify-around px-4 py-2',
          'glass-elevated border-t border-[rgba(255,255,255,0.06)]'
        )}
        aria-label="Mobile view navigation"
      >
        {VIEWS.map((view) => {
          const isActive = activeView === view.id;
          return (
            <button
              key={view.id}
              onClick={() => setActiveView(view.id)}
              className={cn(
                'flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg',
                'text-[10px] font-medium transition-colors duration-150',
                isActive ? 'text-[#FF6700]' : 'text-theme-tertiary'
              )}
            >
              {view.icon}
              {view.label}
            </button>
          );
        })}
      </nav>

      {/* ── Mobile FAB (chat) ── */}
      <button
        className={cn(
          'lg:hidden fixed bottom-20 right-5 z-30',
          'w-14 h-14 rounded-full',
          'flex items-center justify-center',
          'text-white shadow-lg transition-transform duration-150 active:scale-95'
        )}
        style={{
          background: 'linear-gradient(135deg, #FF6700, #e55900)',
          boxShadow: '0 4px 20px rgba(255,103,0,0.4)',
          animation: 'floatUp 3s ease-in-out infinite alternate',
        }}
        onClick={() => setIsMobileChatOpen(true)}
        aria-label="Open chat"
      >
        {ChatIcon}
      </button>

      {/* ── Mobile chat overlay ── */}
      {isMobileChatOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex flex-col" style={{ background: '#141414' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(255,255,255,0.06)]">
            <span className="text-sm font-medium text-theme-primary">Chat with {robot.name}</span>
            <button
              onClick={() => setIsMobileChatOpen(false)}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-theme-secondary hover:text-theme-primary hover:bg-[rgba(255,255,255,0.06)]"
              aria-label="Close chat"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <RobotChatPanel
              robotId={robotId}
              robotName={robot.name}
              agentUrl={robot.a2aAgentUrl}
              className="h-full"
            />
          </div>
        </div>
      )}
    </div>
  );
});
