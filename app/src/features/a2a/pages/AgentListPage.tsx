/**
 * @file AgentListPage.tsx
 * @description Agent list page showing all registered A2A agents
 * @feature a2a
 */

import { memo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/shared/utils';
import { Button } from '@/shared/components/ui/Button';
import { Badge } from '@/shared/components/ui/Badge';
import { Card } from '@/shared/components/ui/Card';
import { RegisterAgentDialog } from '../components/RegisterAgentDialog';
import { A2ALayout } from '../components/A2ALayout';
import { useA2A } from '../hooks/useA2A';
import type { A2AAgentCard } from '../types';

// ============================================================================
// ICONS
// ============================================================================

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );
}

function RobotIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
      />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

// ============================================================================
// AGENT CARD COMPONENT
// ============================================================================

interface AgentGridCardProps {
  agent: A2AAgentCard;
  onClick: () => void;
}

const AgentGridCard = memo(function AgentGridCard({ agent, onClick }: AgentGridCardProps) {
  const capabilities = agent.capabilities || {};
  const skillCount = agent.skills?.length || 0;

  return (
    <Card
      variant="glass"
      className={cn(
        'group cursor-pointer transition-all duration-200',
        'hover:shadow-lg hover:scale-[1.02]',
        'active:scale-[0.98]'
      )}
      onClick={onClick}
    >
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
              <RobotIcon className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                {agent.name}
              </h3>
              {agent.provider?.organization && (
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {agent.provider.organization}
                </p>
              )}
            </div>
          </div>
          <ChevronRightIcon className="w-5 h-5 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 flex-shrink-0 transition-colors" />
        </div>

        {/* Description */}
        <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mb-3 min-h-[2.5rem]">
          {agent.description}
        </p>

        {/* Capabilities & Skills */}
        <div className="flex flex-wrap gap-1.5">
          {capabilities.streaming && (
            <Badge variant="info" size="sm">Streaming</Badge>
          )}
          {capabilities.pushNotifications && (
            <Badge variant="info" size="sm">Push</Badge>
          )}
          {capabilities.stateTransitionHistory && (
            <Badge variant="info" size="sm">History</Badge>
          )}
          {skillCount > 0 && (
            <Badge variant="default" size="sm">
              {skillCount} {skillCount === 1 ? 'skill' : 'skills'}
            </Badge>
          )}
        </div>

        {/* Version */}
        {agent.version && (
          <p className="text-xs text-gray-400 mt-3">v{agent.version}</p>
        )}
      </div>
    </Card>
  );
});

// ============================================================================
// EMPTY STATE
// ============================================================================

const EmptyState = memo(function EmptyState({ onRegister }: { onRegister: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4">
      <div className="glass-subtle rounded-full p-6 mb-4">
        <RobotIcon className="h-10 w-10 text-gray-400" />
      </div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
        No agents registered
      </h3>
      <p className="text-gray-500 dark:text-gray-400 text-center max-w-sm mb-6">
        Register an A2A agent to start communicating. Agents can be hosted locally or remotely.
      </p>
      <Button variant="primary" onClick={onRegister} className="gap-2">
        <PlusIcon className="w-4 h-4" />
        Register Agent
      </Button>
    </div>
  );
});

// ============================================================================
// AGENT LIST PAGE
// ============================================================================

/**
 * Agent list page - shows all registered agents in a grid
 */
export const AgentListPage = memo(function AgentListPage() {
  const { registeredAgents, registerAgent } = useA2A();
  const navigate = useNavigate();
  const [showRegisterDialog, setShowRegisterDialog] = useState(false);

  const handleAgentClick = useCallback(
    (agent: A2AAgentCard) => {
      // Use URL-encoded name for the route
      navigate(`/a2a/agents/${encodeURIComponent(agent.name)}`);
    },
    [navigate]
  );

  const handleRegisterAgent = useCallback(
    async (url: string) => {
      await registerAgent(url);
    },
    [registerAgent]
  );

  return (
    <A2ALayout>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <header className="flex-shrink-0 flex items-center justify-between h-14 px-4 md:px-6 border-b border-glass-subtle glass-elevated">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Agents
            </h1>
            <Badge variant="default" size="sm">
              {registeredAgents.length}
            </Badge>
          </div>

          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowRegisterDialog(true)}
            className="gap-1.5"
          >
            <PlusIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Register Agent</span>
            <span className="sm:hidden">Add</span>
          </Button>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {registeredAgents.length === 0 ? (
            <EmptyState onRegister={() => setShowRegisterDialog(true)} />
          ) : (
            <div className="p-4 md:p-6">
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {registeredAgents.map((agent) => (
                  <AgentGridCard
                    key={agent.name}
                    agent={agent}
                    onClick={() => handleAgentClick(agent)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Register Dialog */}
        <RegisterAgentDialog
          isOpen={showRegisterDialog}
          onClose={() => setShowRegisterDialog(false)}
          onRegister={handleRegisterAgent}
        />
      </div>
    </A2ALayout>
  );
});
