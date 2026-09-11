/**
 * @file A2ATabs.tsx
 * @description The A2A area's tab bar: Chat, Agents, Tasks, Events. The tabs are routes.
 * @feature a2a
 */

import { useLocation, useNavigate } from 'react-router-dom';
import { Tabs } from '@/shared/components/ui';
import { useA2AStore } from '../store';

const A2A_TABS = [
  { id: 'chat', label: 'Chat', path: '/a2a' },
  { id: 'agents', label: 'Agents', path: '/a2a/agents' },
  { id: 'tasks', label: 'Tasks', path: '/a2a/tasks' },
  { id: 'events', label: 'Events', path: '/a2a/events' },
] as const;

/** Which tab a pathname belongs to; /chat counts as Chat. */
function tabForPath(pathname: string): string {
  if (pathname.startsWith('/a2a/agents')) return 'agents';
  if (pathname.startsWith('/a2a/tasks')) return 'tasks';
  if (pathname.startsWith('/a2a/events')) return 'events';
  return 'chat';
}

/**
 * Bar-only tabs shared by every A2A list page. Sits directly under the PageHeader.
 */
export function A2ATabs() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const agentCount = useA2AStore((s) => s.registeredAgents.length);

  return (
    <Tabs
      label="Agent area"
      tabs={A2A_TABS.map((t) => ({
        id: t.id,
        label: t.label,
        count: t.id === 'agents' && agentCount > 0 ? agentCount : undefined,
      }))}
      activeTab={tabForPath(pathname)}
      onTabChange={(id) => {
        const tab = A2A_TABS.find((t) => t.id === id);
        if (tab && tab.path !== pathname) navigate(tab.path);
      }}
    />
  );
}
