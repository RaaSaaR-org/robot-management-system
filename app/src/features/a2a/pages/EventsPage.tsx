/**
 * @file EventsPage.tsx
 * @description Agent events: the raw A2A event stream for debugging agents
 * @feature a2a
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw, Search } from 'lucide-react';
import { Button, EmptyState, PageHeader, Panel, SearchInput, Select, Toolbar } from '@/shared/components/ui';
import { A2ATabs } from '../components/A2ATabs';
import { EventDetailModal } from '../components/EventDetailModal';
import { EventList, eventSummary } from '../components/EventList';
import { useA2AStore } from '../store';
import type { A2AEvent } from '../types';

const TYPE_OPTIONS = [
  { value: 'user', label: 'User' },
  { value: 'agent', label: 'Agent' },
];

/**
 * Event table (recipe 1, dense) with a search, a type filter and a detail modal.
 */
export function EventsPage() {
  const events = useA2AStore((s) => s.events);
  const fetchEvents = useA2AStore((s) => s.fetchEvents);
  const fetchAgents = useA2AStore((s) => s.fetchAgents);
  const [loading, setLoading] = useState(events.length === 0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [selected, setSelected] = useState<A2AEvent | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    useA2AStore.setState({ error: null });
    await fetchEvents();
    setLoadError(useA2AStore.getState().error);
    setLoading(false);
  }, [fetchEvents]);

  useEffect(() => {
    void load();
    void fetchAgents();
  }, [load, fetchAgents]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((e) => {
      if (type && e.content.role !== type) return false;
      if (!q) return true;
      return [e.actor, e.id, eventSummary(e)].some((s) => s.toLowerCase().includes(q));
    });
  }, [events, query, type]);

  const hasFilters = Boolean(query || type);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Operate"
        title="Agent events"
        description="The A2A event stream: messages, status changes and artifacts."
        actions={
          <Button variant="ghost" leftIcon={<RefreshCw className="h-4 w-4" strokeWidth={1.75} />} onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        }
      />
      <A2ATabs />
      <Toolbar
        search={<SearchInput value={query} onChange={setQuery} placeholder="Search events" />}
        filters={
          <Select
            aria-label="Type"
            fullWidth={false}
            className="w-40"
            placeholder="All types"
            options={TYPE_OPTIONS}
            value={type}
            onChange={(e) => setType(e.target.value)}
          />
        }
      />
      <Panel padding="none">
        <EventList
          events={filtered}
          onEventClick={setSelected}
          isLoading={loading}
          error={events.length === 0 ? loadError : null}
          onRetry={() => void load()}
          empty={
            hasFilters ? (
              <EmptyState
                icon={<Search />}
                title="No events match"
                description="Try another search or type, or clear the filters."
                action={
                  <Button variant="secondary" onClick={() => { setQuery(''); setType(''); }}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<Activity />}
                title="No events yet"
                description="Events appear here when agents and people exchange messages."
              />
            )
          }
        />
      </Panel>
      <EventDetailModal event={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
