/**
 * @file AgentDetailPage.tsx
 * @description Detailed view of an A2A agent with all capabilities and skills
 * @feature a2a
 */

import { memo, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { cn } from '@/shared/utils';
import { Button } from '@/shared/components/ui/Button';
import { Badge } from '@/shared/components/ui/Badge';
import { Card } from '@/shared/components/ui/Card';
import { A2ALayout } from '../components/A2ALayout';
import { useA2AStore } from '../store';
import type { A2ASkill } from '../types';

// ============================================================================
// ICONS
// ============================================================================

function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
    </svg>
  );
}

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
      />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
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

function BoltIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

// ============================================================================
// SKILL CARD COMPONENT
// ============================================================================

interface SkillCardProps {
  skill: A2ASkill;
}

const SkillCard = memo(function SkillCard({ skill }: SkillCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="glass-subtle rounded-lg p-4">
      <div
        className="flex items-start justify-between gap-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-accent-100 dark:bg-accent-900/30 flex items-center justify-center mt-0.5">
            <BoltIcon className="w-4 h-4 text-accent-600 dark:text-accent-400" />
          </div>
          <div className="min-w-0">
            <h4 className="font-medium text-gray-900 dark:text-gray-100">
              {skill.name}
            </h4>
            <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
              {skill.description || 'No description available'}
            </p>
          </div>
        </div>
        <svg
          className={cn(
            'w-5 h-5 text-gray-400 flex-shrink-0 transition-transform',
            expanded && 'rotate-180'
          )}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {expanded && (
        <div className="mt-4 pl-11 space-y-3">
          {skill.tags && skill.tags.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                Tags
              </p>
              <div className="flex flex-wrap gap-1.5">
                {skill.tags.map((tag) => (
                  <Badge key={tag} variant="default" size="sm">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {skill.examples && skill.examples.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                Examples
              </p>
              <ul className="space-y-1">
                {skill.examples.map((example, i) => (
                  <li
                    key={i}
                    className="text-sm text-gray-600 dark:text-gray-400 pl-3 border-l-2 border-gray-200 dark:border-gray-700"
                  >
                    "{example}"
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(skill.inputModes || skill.outputModes) && (
            <div className="flex gap-6">
              {skill.inputModes && skill.inputModes.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                    Input
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {skill.inputModes.join(', ')}
                  </p>
                </div>
              )}
              {skill.outputModes && skill.outputModes.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                    Output
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {skill.outputModes.join(', ')}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ============================================================================
// NOT FOUND STATE
// ============================================================================

const NotFoundState = memo(function NotFoundState() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-20 px-4">
      <div className="glass-subtle rounded-full p-6 mb-4">
        <RobotIcon className="h-10 w-10 text-gray-400" />
      </div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
        Agent not found
      </h3>
      <p className="text-gray-500 dark:text-gray-400 text-center max-w-sm mb-6">
        This agent may have been unregistered or the URL is incorrect.
      </p>
      <Link to="/a2a/agents">
        <Button variant="primary" className="gap-2">
          <ArrowLeftIcon className="w-4 h-4" />
          Back to Agents
        </Button>
      </Link>
    </div>
  );
});

// ============================================================================
// AGENT DETAIL PAGE
// ============================================================================

/**
 * Agent detail page - shows full information about an agent
 */
export const AgentDetailPage = memo(function AgentDetailPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  // Get agent from store
  const decodedName = name ? decodeURIComponent(name) : '';
  const agent = useA2AStore((state) =>
    state.registeredAgents.find((a) => a.name === decodedName)
  );
  const unregisterAgent = useA2AStore((state) => state.unregisterAgent);

  const handleCopyUrl = useCallback(async () => {
    if (!agent?.url) return;
    try {
      await navigator.clipboard.writeText(agent.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = agent.url;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [agent?.url]);

  const handleStartChat = useCallback(() => {
    navigate('/a2a');
  }, [navigate]);

  const handleUnregister = useCallback(() => {
    if (!agent) return;
    if (window.confirm(`Are you sure you want to unregister "${agent.name}"?`)) {
      unregisterAgent(agent.name);
      navigate('/a2a/agents');
    }
  }, [agent, unregisterAgent, navigate]);

  if (!agent) {
    return (
      <A2ALayout>
        <NotFoundState />
      </A2ALayout>
    );
  }

  const capabilities = agent.capabilities || {};
  const skills = agent.skills || [];

  return (
    <A2ALayout>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <header className="flex-shrink-0 flex items-center justify-between h-14 px-4 md:px-6 border-b border-glass-subtle glass-elevated">
          <div className="flex items-center gap-3">
            <Link
              to="/a2a/agents"
              className="p-2 -ml-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <ArrowLeftIcon className="w-5 h-5 text-gray-500" />
            </Link>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">
              {agent.name}
            </h1>
          </div>

          <Button
            variant="primary"
            size="sm"
            onClick={handleStartChat}
            className="gap-1.5"
          >
            <ChatIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Start Chat</span>
            <span className="sm:hidden">Chat</span>
          </Button>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 space-y-6">
            {/* Agent Info Card */}
            <Card variant="glass" className="p-6">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                  <RobotIcon className="w-7 h-7 text-primary-600 dark:text-primary-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                      {agent.name}
                    </h2>
                    {agent.version && (
                      <Badge variant="default" size="sm">v{agent.version}</Badge>
                    )}
                  </div>
                  {agent.provider?.organization && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                      by {agent.provider.organization}
                    </p>
                  )}
                  <p className="text-gray-600 dark:text-gray-400 mt-3">
                    {agent.description}
                  </p>
                </div>
              </div>

              {/* URL */}
              <div className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-700/50">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                  Agent URL
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm font-mono text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 px-3 py-2 rounded-lg truncate">
                    {agent.url}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopyUrl}
                    className="flex-shrink-0"
                  >
                    {copied ? (
                      <CheckIcon className="w-4 h-4 text-green-500" />
                    ) : (
                      <CopyIcon className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
            </Card>

            {/* Capabilities */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide mb-3">
                Capabilities
              </h3>
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant={capabilities.streaming ? 'success' : 'default'}
                  size="md"
                >
                  {capabilities.streaming ? '✓' : '✗'} Streaming
                </Badge>
                <Badge
                  variant={capabilities.pushNotifications ? 'success' : 'default'}
                  size="md"
                >
                  {capabilities.pushNotifications ? '✓' : '✗'} Push Notifications
                </Badge>
                <Badge
                  variant={capabilities.stateTransitionHistory ? 'success' : 'default'}
                  size="md"
                >
                  {capabilities.stateTransitionHistory ? '✓' : '✗'} State History
                </Badge>
              </div>
            </div>

            {/* Input/Output Modes */}
            {(agent.defaultInputModes?.length || agent.defaultOutputModes?.length) && (
              <div className="grid gap-4 sm:grid-cols-2">
                {agent.defaultInputModes && agent.defaultInputModes.length > 0 && (
                  <Card variant="glass" className="p-4">
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                      Input Modes
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {agent.defaultInputModes.map((mode) => (
                        <Badge key={mode} variant="info" size="sm">
                          {mode}
                        </Badge>
                      ))}
                    </div>
                  </Card>
                )}
                {agent.defaultOutputModes && agent.defaultOutputModes.length > 0 && (
                  <Card variant="glass" className="p-4">
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                      Output Modes
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {agent.defaultOutputModes.map((mode) => (
                        <Badge key={mode} variant="info" size="sm">
                          {mode}
                        </Badge>
                      ))}
                    </div>
                  </Card>
                )}
              </div>
            )}

            {/* Skills */}
            {skills.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide mb-3">
                  Skills ({skills.length})
                </h3>
                <div className="space-y-3">
                  {skills.map((skill) => (
                    <SkillCard key={skill.id} skill={skill} />
                  ))}
                </div>
              </div>
            )}

            {/* Documentation Link */}
            {agent.documentationUrl && (
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide mb-3">
                  Documentation
                </h3>
                <a
                  href={agent.documentationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-600 dark:text-primary-400 hover:underline text-sm"
                >
                  {agent.documentationUrl}
                </a>
              </div>
            )}

            {/* Actions */}
            <div className="pt-4 border-t border-gray-100 dark:border-gray-700/50 flex flex-col sm:flex-row gap-3">
              <Button
                variant="primary"
                onClick={handleStartChat}
                className="flex-1 gap-2"
              >
                <ChatIcon className="w-4 h-4" />
                Start Chat
              </Button>
              <Button
                variant="ghost"
                onClick={handleUnregister}
                className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 gap-2"
              >
                <TrashIcon className="w-4 h-4" />
                Unregister
              </Button>
            </div>
          </div>
        </div>
      </div>
    </A2ALayout>
  );
});
