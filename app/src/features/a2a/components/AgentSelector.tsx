/**
 * @file AgentSelector.tsx
 * @description Dropdown for selecting target agent in header
 * @feature a2a
 */

import { memo, useState, useRef, useEffect } from 'react';
import { cn } from '@/shared/utils';
import type { A2AAgentCard } from '../types';

interface AgentSelectorProps {
  agents: A2AAgentCard[];
  selected?: A2AAgentCard;
  onSelect: (agent: A2AAgentCard) => void;
  onRegister: () => void;
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );
}

/**
 * Dropdown for selecting which agent to communicate with
 */
export const AgentSelector = memo(function AgentSelector({
  agents,
  selected,
  onSelect,
  onRegister,
}: AgentSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg',
          'text-sm font-medium',
          'glass-subtle',
          'hover:bg-gray-100/50 dark:hover:bg-gray-700/50',
          'transition-all duration-200',
          'max-w-[200px]'
        )}
      >
        {selected ? (
          <>
            <span className="w-2 h-2 rounded-full bg-accent-500 flex-shrink-0" />
            <span className="truncate text-gray-900 dark:text-gray-100">{selected.name}</span>
          </>
        ) : (
          <span className="text-gray-500 dark:text-gray-400">Select Agent</span>
        )}
        <ChevronDownIcon className={cn('w-4 h-4 flex-shrink-0 text-gray-400 transition-transform duration-200', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div
          className={cn(
            'absolute top-full mt-1 left-0 min-w-[240px]',
            'glass-elevated rounded-xl shadow-lg',
            'py-1 z-50 pointer-events-auto',
            'animate-fade-in'
          )}
        >
          {agents.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
              No agents registered
            </div>
          ) : (
            <div className="max-h-60 overflow-y-auto">
              {agents.map((agent) => (
                <button
                  key={agent.name}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(agent);
                    setIsOpen(false);
                  }}
                  className={cn(
                    'w-full text-left px-3 py-2.5 text-sm',
                    'hover:bg-gray-100/50 dark:hover:bg-gray-700/50',
                    'transition-colors duration-150',
                    selected?.name === agent.name && 'bg-primary-50/50 dark:bg-primary-900/20'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-accent-500 flex-shrink-0" />
                    <span className="font-medium truncate text-gray-900 dark:text-gray-100">{agent.name}</span>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 truncate mt-0.5 pl-4">
                    {agent.description}
                  </p>
                </button>
              ))}
            </div>
          )}

          <div className="border-t border-glass-subtle mt-1 pt-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRegister();
                setIsOpen(false);
              }}
              className={cn(
                'w-full text-left px-3 py-2.5 text-sm',
                'text-primary-600 dark:text-primary-400',
                'hover:bg-gray-100/50 dark:hover:bg-gray-700/50',
                'transition-colors duration-150',
                'flex items-center gap-2'
              )}
            >
              <PlusIcon className="w-4 h-4" />
              Register new agent
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
