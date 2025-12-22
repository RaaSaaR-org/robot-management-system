/**
 * @file SidebarDrawer.tsx
 * @description Slide-in sidebar overlay for conversations and agents
 * @feature a2a
 */

import { memo, useEffect, type ReactNode } from 'react';
import { cn } from '@/shared/utils';
import { Button } from '@/shared/components/ui/Button';

interface SidebarDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  tab: 'conversations' | 'agents';
  onTabChange: (tab: 'conversations' | 'agents') => void;
  agentCount: number;
  children: ReactNode;
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

/**
 * Slide-in drawer for conversations and agents selection
 * Positioned within parent container (not full-screen portal)
 */
export const SidebarDrawer = memo(function SidebarDrawer({
  isOpen,
  onClose,
  tab,
  onTabChange,
  agentCount,
  children,
}: SidebarDrawerProps) {
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

  // Render inline (no portal) - positioned within parent's relative container
  return (
    <div className="absolute inset-0 z-40">
      {/* Backdrop - only covers the content area, not main nav */}
      <div
        className="absolute inset-0 bg-black/30 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        className={cn(
          'absolute inset-y-0 left-0 w-80 max-w-[85vw]',
          'glass-elevated shadow-xl',
          'flex flex-col',
          'animate-slide-in-left'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-glass-subtle">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">
            A2A Communications
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close sidebar">
            <CloseIcon className="w-5 h-5" />
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-glass-subtle">
          <button
            className={cn(
              'flex-1 px-4 py-2.5 text-sm font-medium transition-all duration-200',
              tab === 'conversations'
                ? 'text-primary-600 dark:text-primary-400 border-b-2 border-primary-500 bg-primary-50/50 dark:bg-primary-900/20'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50'
            )}
            onClick={() => onTabChange('conversations')}
          >
            Conversations
          </button>
          <button
            className={cn(
              'flex-1 px-4 py-2.5 text-sm font-medium transition-all duration-200',
              tab === 'agents'
                ? 'text-primary-600 dark:text-primary-400 border-b-2 border-primary-500 bg-primary-50/50 dark:bg-primary-900/20'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50'
            )}
            onClick={() => onTabChange('agents')}
          >
            Agents ({agentCount})
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">{children}</div>
      </aside>
    </div>
  );
});
