/**
 * @file TaskDrawer.tsx
 * @description Bottom slide-up drawer for task details
 * @feature a2a
 */

import { memo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/shared/utils';
import { Button } from '@/shared/components/ui/Button';
import { TaskStatusCard } from './TaskStatusCard';
import type { A2ATask } from '../types';

interface TaskDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: A2ATask[];
}

/**
 * Slide-up drawer for viewing task details
 */
export const TaskDrawer = memo(function TaskDrawer({
  isOpen,
  onClose,
  tasks,
}: TaskDrawerProps) {
  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const activeTasks = tasks.filter(
    (t) => !['completed', 'failed', 'canceled'].includes(t.status.state)
  );

  return createPortal(
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        className={cn(
          'absolute bottom-0 left-0 right-0',
          'max-h-[70vh] glass-elevated',
          'rounded-t-2xl shadow-xl',
          'flex flex-col',
          'animate-slide-up'
        )}
      >
        {/* Handle */}
        <div className="flex justify-center py-3">
          <div className="w-12 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-glass-subtle">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">
              Tasks
            </h3>
            {activeTasks.length > 0 && (
              <span className="px-2.5 py-1 text-xs font-medium bg-primary-100/50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 rounded-full">
                {activeTasks.length} active
              </span>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        {/* Tasks list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-500">
              <div className="glass-subtle rounded-full p-4 mb-4">
                <svg
                  className="w-8 h-8"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">No tasks yet</p>
              <p className="text-xs mt-1">Tasks will appear when you send messages</p>
            </div>
          ) : (
            tasks.slice(0, 20).map((task) => (
              <TaskStatusCard key={task.id} task={task} />
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  );
});
