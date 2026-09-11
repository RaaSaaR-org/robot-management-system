/**
 * @file SitesGalleryPage.tsx
 * @description Digital Twin gallery: the rooms a robot has scanned in 3D, as a
 *   card grid with search and a status filter. "New scan" opens a FormModal
 *   that creates the server `DigitalTwin` and opens its viewer; a card's
 *   RowActions delete a site after a confirm.
 * @feature digitaltwin
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ScanLine, Search } from 'lucide-react';
import {
  Button, EmptyState,
  ErrorState,
  PageHeader, Panel,
  SearchInput, Select,
  SkeletonRows, Toolbar,
  confirm, errorMessage,
  toast,
} from '@/shared/components/ui';
import { useScanCapableRobots } from '../hooks/useScanCapableRobots';
import { useTwinStore, selectTwins } from '../store/twinStore';
import { twinToSite, type Site } from '../types/twin.types';
import { useTwinEvents } from '../hooks/useTwinEvents';
import { SiteCard } from '../components/SiteCard';
import { NewScanModal } from '../components/NewScanModal';

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Empty' },
  { value: 'recording', label: 'Scanning' },
  { value: 'processing', label: 'Building' },
  { value: 'ready', label: 'Scanned' },
  { value: 'failed', label: 'Failed' },
];

export function SitesGalleryPage() {
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
  const [scanOpen, setScanOpen] = useState(false);
  // Live build progress per twin (from session:progress), for the card bars.
  const [progressByTwin, setProgressByTwin] = useState<Record<string, number>>({});
  const robotNames = useMemo(() => Object.fromEntries(robots.map((r) => [r.id, r.name])), [robots]);

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

  const openScan = () => setScanOpen(true);
  const hasFilters = Boolean(query || status);
  const newScanButton = (
    <Button leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />} onClick={openScan}>
      New scan
    </Button>
  );

  let body: React.ReactNode;
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
            action={newScanButton}
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
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Operate"
        title="Digital Twin"
        description="Rooms scanned in 3D by a robot — the ground truth for zones, routes and simulation."
        actions={newScanButton}
      />

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
        isOpen={scanOpen}
        onClose={() => setScanOpen(false)}
        robots={robots}
        nextIndex={sites.length + 1}
        onCreated={(twin) => {
          setScanOpen(false);
          navigate(`/sites/${twin.id}`);
        }}
      />
    </div>
  );
}
