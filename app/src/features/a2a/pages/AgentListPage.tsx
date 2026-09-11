/**
 * @file AgentListPage.tsx
 * @description Agents: the A2A agents this server knows, register and unregister them
 * @feature a2a
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, ExternalLink, MessageSquare, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  SearchInput,
  SkeletonRows,
  Toolbar,
  confirm,
  toast,
} from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils/error';
import { A2ATabs } from '../components/A2ATabs';
import { AgentCard } from '../components/AgentCard';
import { RegisterAgentDialog } from '../components/RegisterAgentDialog';
import { useA2AStore } from '../store';
import type { A2AAgentCard } from '../types';

const icon = 'h-4 w-4';

/**
 * Card grid of registered agents (recipe 1, visual-entity variant).
 */
export function AgentListPage() {
  const navigate = useNavigate();
  const agents = useA2AStore((s) => s.registeredAgents);
  const fetchAgents = useA2AStore((s) => s.fetchAgents);
  const registerAgent = useA2AStore((s) => s.registerAgent);
  const unregisterAgent = useA2AStore((s) => s.unregisterAgent);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(agents.length ? 'ready' : 'loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [registerOpen, setRegisterOpen] = useState(false);

  const load = useCallback(async () => {
    useA2AStore.setState({ error: null });
    await fetchAgents();
    const err = useA2AStore.getState().error;
    setLoadError(err);
    setStatus(err ? 'error' : 'ready');
  }, [fetchAgents]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((a) => a.name.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q));
  }, [agents, query]);

  const open = (a: A2AAgentCard) => navigate(`/a2a/agents/${encodeURIComponent(a.name)}`);

  const askUnregister = async (a: A2AAgentCard) => {
    const ok = await confirm({
      title: `Unregister ${a.name}?`,
      description: 'The server stops routing tasks to it. The robot itself keeps running.',
      confirmLabel: 'Unregister',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await unregisterAgent(a.name);
      toast.success('Agent unregistered', { description: a.name });
    } catch (err) {
      toast.error("Couldn't unregister agent", { description: getErrorMessage(err) });
    }
  };

  const registerButton = (
    <Button leftIcon={<Plus className={icon} strokeWidth={1.75} />} onClick={() => setRegisterOpen(true)}>
      Register agent
    </Button>
  );

  let body;
  if (status === 'loading' && agents.length === 0) {
    body = (
      <Panel>
        <SkeletonRows rows={3} columns={3} />
      </Panel>
    );
  } else if (status === 'error' && agents.length === 0) {
    body = (
      <Panel>
        <ErrorState title="Couldn't load agents" message={loadError ?? undefined} onRetry={() => void load()} />
      </Panel>
    );
  } else if (agents.length === 0) {
    body = (
      <Panel>
        <EmptyState
          icon={<Bot />}
          title="No agents registered"
          description="Register a robot agent by its URL to chat with it and hand it tasks."
          action={registerButton}
        />
      </Panel>
    );
  } else if (filtered.length === 0) {
    body = (
      <Panel>
        <EmptyState
          icon={<Search />}
          title="No agents match"
          description="Try another name, or clear the search."
          action={<Button variant="secondary" onClick={() => setQuery('')}>Clear filters</Button>}
        />
      </Panel>
    );
  } else {
    body = (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((a) => (
          <AgentCard
            key={a.name}
            agent={a}
            onOpen={() => open(a)}
            actions={[
              { label: 'Open', icon: <ExternalLink />, onSelect: () => open(a) },
              {
                label: 'Start chat',
                icon: <MessageSquare />,
                onSelect: () => navigate(`/a2a?agent=${encodeURIComponent(a.name)}`),
              },
              {
                label: 'Unregister',
                icon: <Trash2 />,
                tone: 'danger',
                separatorBefore: true,
                onSelect: () => void askUnregister(a),
              },
            ]}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Operate"
        title="Agents"
        description="Robot agents this server can talk to over A2A."
        actions={registerButton}
      />
      <A2ATabs />
      <Toolbar
        search={<SearchInput value={query} onChange={setQuery} placeholder="Search agents" />}
        actions={
          <Button
            variant="ghost"
            iconOnly
            aria-label="Refresh agents"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            <RefreshCw className={refreshing ? `${icon} animate-spin` : icon} strokeWidth={1.75} />
          </Button>
        }
      />
      {body}
      <RegisterAgentDialog isOpen={registerOpen} onClose={() => setRegisterOpen(false)} onRegister={registerAgent} />
    </div>
  );
}
