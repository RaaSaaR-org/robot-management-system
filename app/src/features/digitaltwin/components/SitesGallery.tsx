/**
 * @file SitesGallery.tsx
 * @description The Digital Twin gallery, embedded as the "Sites" tab of
 *   FleetPage (which owns the page header): search, the status filter, the card
 *   grid with live build progress, and the "New scan" modal. A card opens the
 *   twin viewer at /sites/:siteId — still a full route, because the viewer owns
 *   a point-cloud stream and a scan session that a tab click must not tear
 *   down. A card's RowActions delete a site after a confirm.
 * @feature digitaltwin
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ScanLine, Search } from 'lucide-react';
import {
  Button,
  EmptyState,
  ErrorState,
  Panel,
  SearchInput,
  Select,
  SkeletonRows,
  Toolbar,
  confirm,
  errorMessage,
  toast,
} from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { useScanCapableRobots } from '../hooks/useScanCapableRobots';
import { useTwinStore, selectTwins } from '../store/twinStore';
import { twinToSite, type Site } from '../types/twin.types';
import { useTwinEvents } from '../hooks/useTwinEvents';
import { SiteCard } from './SiteCard';
import { NewScanModal } from './NewScanModal';

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Empty' },
  { value: 'recording', label: 'Scanning' },
  { value: 'processing', label: 'Building' },
  { value: 'ready', label: 'Scanned' },
  { value: 'failed', label: 'Failed' },
];

export interface SitesGalleryProps {
  /** Additional class names */
  className?: string;
  /**
   * Whether the "New scan" modal is open. The parent owns the flag because the
   * button that opens it sits in FleetPage's header, above this component; the
   * gallery only offers it a second time from its own empty state.
   */
  newScanOpen: boolean;
  onNewScanOpenChange: (open: boolean) => void;
}

/** The scanned-rooms grid with its scan modal. No PageHeader: FleetPage renders it. */
export function SitesGallery({ className, newScanOpen, onNewScanOpenChange }: SitesGalleryProps) {
  const navigate = useNavigate();
  const { robots } = useScanCapableRobots();
  // Select the stable `twins` slice and map to the view model with useMemo —
  // mapping inside a Zustand selector returns a fresh array every render and
  // trips useSyncExternalStore's caching (infinite re-render loop).
  const twins = useTwinStore(selectTwins);
  const sites = useMemo(() => twins.map(twinToSite), [twins]);
  const fetchTwins = useTwinStore((s) => s.fetchTwins);
  const removeTwin = useTwinStore((s) => s.removeTwin);
  const upsertTwin = useTwinStore((s) => s.upsertTwin);
  const isLoading = useTwinStore((s) => s.isLoading);
  const error = useTwinStore((s) => s.error);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  // Live build progress per twin (from session:progress), for the card bars.
  const [progressByTwin, setProgressByTwin] = useState<Record<string, number>>({});
  const robotNames = useMemo(() => Object.fromEntries(robots.map((r) => [r.id, r.name])), [robots]);

  // Mounting is the refetch: leaving Fleet's Sites tab unmounts the gallery, so
  // it comes back with fresh twins rather than a snapshot from the last visit.
  useEffect(() => {
    void fetchTwins();
  }, [fetchTwins]);

  // Keep the gallery live: stream build progress, and refresh a card on ready.
  useTwinEvents({
    onSessionProgress: (e) => setProgressByTwin((m) => ({ ...m, [e.twinId]: e.progress })),
    onTwinReady: (e) => {
      upsertTwin(e.twin);
      setProgressByTwin((m) => {
        const next = { ...m };
        delete next[e.twinId];
        return next;
      });
    },
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sites.filter(
      (s) =>
        (!status || s.status === status) &&
        (!q || s.name.toLowerCase().includes(q) || (robotNames[s.robotId] ?? '').toLowerCase().includes(q)),
    );
  }, [sites, query, status, robotNames]);

  const askDelete = async (site: Site) => {
    const ok = await confirm({
      title: `Delete ${site.name}?`,
      description: 'The scan, its zones and exports are removed. This cannot be undone.',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await removeTwin(site.id);
      toast.success('Site deleted', { description: site.name });
    } catch (err) {
      toast.error("Couldn't delete site", { description: errorMessage(err) });
    }
  };

  const hasFilters = Boolean(query || status);

  let body: ReactNode;
  if (isLoading && sites.length === 0) {
    body = (
      <Panel>
        <SkeletonRows rows={3} columns={3} />
      </Panel>
    );
  } else if (error && sites.length === 0) {
    body = (
      <Panel>
        <ErrorState title="Couldn't load sites" message={error} onRetry={() => void fetchTwins()} />
      </Panel>
    );
  } else if (filtered.length === 0) {
    body = (
      <Panel>
        {hasFilters ? (
          <EmptyState
            icon={<Search />}
            title="No sites match"
            description="Try another name, or clear the filters."
            action={
              <Button variant="secondary" onClick={() => { setQuery(''); setStatus(''); }}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<ScanLine />}
            title="No sites yet"
            description="A site is a room a robot has scanned in 3D. Start with New scan."
            action={
              <Button
                leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />}
                onClick={() => onNewScanOpenChange(true)}
              >
                New scan
              </Button>
            }
          />
        )}
      </Panel>
    );
  } else {
    body = (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((site) => (
          <SiteCard
            key={site.id}
            site={site}
            robotName={robotNames[site.robotId]}
            buildProgress={progressByTwin[site.id]}
            onOpen={(id) => navigate(`/sites/${id}`)}
            onDelete={(s) => void askDelete(s)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <Toolbar
        search={<SearchInput value={query} onChange={setQuery} placeholder="Search sites" />}
        filters={
          <Select
            aria-label="Status"
            fullWidth={false}
            className="w-40"
            placeholder="All statuses"
            options={STATUS_OPTIONS}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          />
        }
      />

      {body}

      <NewScanModal
        isOpen={newScanOpen}
        onClose={() => onNewScanOpenChange(false)}
        robots={robots}
        nextIndex={sites.length + 1}
        onCreated={(twin) => {
          onNewScanOpenChange(false);
          navigate(`/sites/${twin.id}`);
        }}
      />
    </div>
  );
}
