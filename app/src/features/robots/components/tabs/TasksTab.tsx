/**
 * @file TasksTab.tsx
 * @description Tasks tab showing processes assigned to the robot
 * @feature robots
 */

import { useNavigate } from 'react-router-dom';
import { Card, Button } from '@/shared/components/ui';
import { TaskStatusBadge } from '@/features/processes/components/TaskStatusBadge';
import type { TasksTabProps } from './types';

// ============================================================================
// COMPONENT
// ============================================================================

export function TasksTab({ robotId, tasks }: TasksTabProps) {
  const navigate = useNavigate();

  return (
    <Card>
      <Card.Header>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-theme-primary">Assigned Tasks</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/processes?robotId=${robotId}`)}
          >
            View All
            <svg className="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Button>
        </div>
      </Card.Header>
      <Card.Body>
        {tasks.length > 0 ? (
          <div className="space-y-2">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between p-4 rounded-xl glass-subtle cursor-pointer hover:border-glass-highlight transition-all duration-200"
                onClick={() => navigate(`/processes/${task.id}`)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/processes/${task.id}`)}
                role="button"
                tabIndex={0}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-theme-primary truncate">{task.name}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <div className="flex-1 max-w-[120px]">
                      <div className="h-1.5 glass-subtle rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-cobalt-400 to-turquoise-400 rounded-full"
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>
                    </div>
                    <span className="card-meta">{task.progress.toFixed(0)}%</span>
                  </div>
                </div>
                <TaskStatusBadge status={task.status} size="sm" />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="glass-subtle rounded-2xl p-4 mb-3">
              <svg className="h-8 w-8 text-theme-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-theme-secondary mb-4">No tasks assigned to this robot</p>
            <Button
              variant="primary"
              size="sm"
              onClick={() => navigate(`/processes?robotId=${robotId}`)}
            >
              Create Task
            </Button>
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
