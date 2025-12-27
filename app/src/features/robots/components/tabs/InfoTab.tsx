/**
 * @file InfoTab.tsx
 * @description Info tab showing robot capabilities, details, and A2A agent info
 * @feature robots
 */

import { Link } from 'react-router-dom';
import { Card, Button, Badge } from '@/shared/components/ui';
import type { InfoTabProps } from './types';

// ============================================================================
// COMPONENT
// ============================================================================

export function InfoTab({ robot }: InfoTabProps) {
  return (
    <div className="space-y-6">
      {/* Capabilities */}
      <Card>
        <Card.Header>
          <h2 className="text-lg font-semibold text-theme-primary">Capabilities</h2>
        </Card.Header>
        <Card.Body>
          <div className="flex flex-wrap gap-2">
            {robot.capabilities.length > 0 ? (
              robot.capabilities.map((cap) => (
                <Badge key={cap} variant="cobalt" size="md">
                  {cap}
                </Badge>
              ))
            ) : (
              <p className="text-theme-tertiary">No capabilities listed</p>
            )}
          </div>
        </Card.Body>
      </Card>

      {/* Robot Information */}
      <Card>
        <Card.Header>
          <h2 className="text-lg font-semibold text-theme-primary">Robot Details</h2>
        </Card.Header>
        <Card.Body>
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="glass-subtle p-3 rounded-xl">
              <dt className="card-label">Robot ID</dt>
              <dd className="font-mono text-sm text-theme-primary mt-1 truncate">{robot.id}</dd>
            </div>
            {robot.serialNumber && (
              <div className="glass-subtle p-3 rounded-xl">
                <dt className="card-label">Serial Number</dt>
                <dd className="font-mono text-sm text-theme-primary mt-1">{robot.serialNumber}</dd>
              </div>
            )}
            {robot.firmware && (
              <div className="glass-subtle p-3 rounded-xl">
                <dt className="card-label">Firmware</dt>
                <dd className="text-sm text-theme-primary mt-1">{robot.firmware}</dd>
              </div>
            )}
            {robot.ipAddress && (
              <div className="glass-subtle p-3 rounded-xl">
                <dt className="card-label">IP Address</dt>
                <dd className="font-mono text-sm text-theme-primary mt-1">{robot.ipAddress}</dd>
              </div>
            )}
            <div className="glass-subtle p-3 rounded-xl">
              <dt className="card-label">Created</dt>
              <dd className="text-sm text-theme-primary mt-1">{new Date(robot.createdAt).toLocaleDateString()}</dd>
            </div>
            <div className="glass-subtle p-3 rounded-xl">
              <dt className="card-label">Last Updated</dt>
              <dd className="text-sm text-theme-primary mt-1">{new Date(robot.updatedAt).toLocaleString()}</dd>
            </div>
          </dl>
        </Card.Body>
      </Card>

      {/* A2A Agent Section */}
      {(robot.a2aEnabled || robot.capabilities.includes('a2a')) && (
        <Card>
          <Card.Header>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-gradient-to-br from-purple-500/20 to-cobalt-500/20">
                  <svg className="h-5 w-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-theme-primary">A2A Agent</h2>
              </div>
              <Badge variant={robot.a2aEnabled ? 'success' : 'default'} size="sm">
                {robot.a2aEnabled ? 'Enabled' : 'Available'}
              </Badge>
            </div>
          </Card.Header>
          <Card.Body>
            <div className="space-y-4">
              <div className="glass-subtle p-4 rounded-xl">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 p-3 rounded-xl bg-gradient-to-br from-purple-500/10 to-cobalt-500/10">
                    <svg className="h-8 w-8 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-theme-primary">{robot.name} Agent</h3>
                    <p className="text-sm text-theme-secondary mt-1">
                      This robot can communicate with other A2A-compatible agents.
                    </p>
                    {robot.a2aAgentUrl && (
                      <p className="text-xs font-mono text-theme-tertiary mt-2 truncate">
                        {robot.a2aAgentUrl}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <Link to={`/a2a?robotId=${robot.id}`} className="flex-1">
                  <Button variant="secondary" fullWidth>
                    <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    Start A2A Conversation
                  </Button>
                </Link>
                <Link to="/a2a" className="flex-1">
                  <Button variant="outline" fullWidth>
                    View All Agents
                  </Button>
                </Link>
              </div>
            </div>
          </Card.Body>
        </Card>
      )}
    </div>
  );
}
