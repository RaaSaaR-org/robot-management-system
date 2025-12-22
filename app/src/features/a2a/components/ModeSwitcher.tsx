/**
 * @file ModeSwitcher.tsx
 * @description Toggle component for switching between Direct and Orchestration modes
 * @feature a2a
 */

import { memo } from 'react';
import { cn } from '@/shared/utils';
import type { A2AChatMode } from '../types';

interface ModeSwitcherProps {
  mode: A2AChatMode;
  onChange: (mode: A2AChatMode) => void;
  disabled?: boolean;
}

/**
 * Toggle button for switching between chat modes
 * - Direct: User selects and chats with ONE specific agent
 * - Orchestration: AI host agent routes messages to appropriate agents
 */
export const ModeSwitcher = memo(function ModeSwitcher({
  mode,
  onChange,
  disabled = false,
}: ModeSwitcherProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-0.5 p-0.5 rounded-lg glass-subtle',
        disabled && 'opacity-50 pointer-events-none'
      )}
    >
      <button
        onClick={() => onChange('direct')}
        disabled={disabled}
        className={cn(
          'px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200',
          mode === 'direct'
            ? 'bg-primary-500 text-white shadow-sm'
            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100/50 dark:hover:bg-gray-700/50'
        )}
        title="Direct mode: Chat with one selected agent"
      >
        Direct
      </button>
      <button
        onClick={() => onChange('orchestration')}
        disabled={disabled}
        className={cn(
          'px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200',
          mode === 'orchestration'
            ? 'bg-accent-500 text-white shadow-sm'
            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100/50 dark:hover:bg-gray-700/50'
        )}
        title="Orchestration mode: AI routes to all registered agents"
      >
        Orchestrate
      </button>
    </div>
  );
});
