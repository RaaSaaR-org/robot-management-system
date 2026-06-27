/**
 * @file SitesGalleryPage.tsx
 * @description Digital Twin landing: pick a scan-capable robot to sweep a new
 *   room, and browse previously scanned sites. Sites are now server-of-record
 *   `DigitalTwin` rows (fetched on mount, created via POST /api/digital-twins).
 * @feature digitaltwin
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button } from '@/shared/components/ui';
import { useScanCapableRobots } from '../hooks/useScanCapableRobots';
import { useTwinStore, selectTwins } from '../store/twinStore';
import { twinToSite } from '../types/twin.types';
import { useTwinEvents } from '../hooks/useTwinEvents';
import { SiteCard } from '../components/SiteCard';

export function SitesGalleryPage() {
  const navigate = useNavigate();
  const { robots, isLoading: robotsLoading } = useScanCapableRobots();
  // Select the stable `twins` slice and map to the view model with useMemo —
  // mapping inside a Zustand selector returns a fresh array every render and
  // trips useSyncExternalStore's caching (infinite re-render loop).
  const twins = useTwinStore(selectTwins);
  const sites = useMemo(() => twins.map(twinToSite), [twins]);
  const fetchTwins = useTwinStore((s) => s.fetchTwins);
  const createTwin = useTwinStore((s) => s.createTwin);
  const removeTwin = useTwinStore((s) => s.removeTwin);
  const upsertTwin = useTwinStore((s) => s.upsertTwin);
  const isLoading = useTwinStore((s) => s.isLoading);
  const error = useTwinStore((s) => s.error);

  // Live build progress per twin (from session:progress), for the card bars.
  const [progressByTwin, setProgressByTwin] = useState<Record<string, number>>({});
  // Map robotId → display name from the scan-capable roster.
  const robotNames = useMemo(
    () => Object.fromEntries(robots.map((r) => [r.id, r.name])),
    [robots],
  );

  useEffect(() => {
    void fetchTwins();
  }, [fetchTwins]);

  // Keep the gallery live: stream build progress, and refresh a card on ready.
  useTwinEvents({
    onSessionProgress: (e) =>
      setProgressByTwin((m) => ({ ...m, [e.twinId]: e.progress })),
    onTwinReady: (e) => {
      upsertTwin(e.twin);
      setProgressByTwin((m) => {
        const next = { ...m };
        delete next[e.twinId];
        return next;
      });
    },
  });

  const newScan = useCallback(
    async (robotId: string, robotName: string) => {
      const n = sites.length + 1;
      try {
        const twin = await createTwin({ name: `${robotName} room ${n}`, robotId });
        navigate(`/sites/${twin.id}`);
      } catch {
        // Error is surfaced via the store; stay on the gallery.
      }
    },
    [sites.length, createTwin, navigate],
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-theme-primary">Digital Twin</h1>
        <p className="text-sm text-theme-tertiary mt-1">
          Scan a room with a robot to build a 3D digital twin of your workzone.
        </p>
      </div>

      {/* Robots ready to scan */}
      <Card>
        <Card.Header>
          <h2 className="text-lg font-semibold text-theme-primary">Scan a new room</h2>
        </Card.Header>
        <Card.Body>
          {robotsLoading ? (
            <p className="text-sm text-theme-tertiary">Loading robots…</p>
          ) : robots.length === 0 ? (
            <p className="text-sm text-theme-tertiary">
              No scan-capable robot online. A <span className="text-theme-secondary">G1</span> (Livox MID-360)
              is required to sweep a room.
            </p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {robots.map((r) => (
                <div key={r.id} className="rounded-lg border border-surface-700 bg-surface-900/60 px-4 py-3 flex items-center gap-3">
                  <div>
                    <div className="text-sm font-medium text-theme-primary">{r.name}</div>
                    <div className="text-xs text-theme-tertiary">{r.status}</div>
                  </div>
                  <Button variant="primary" size="sm" onClick={() => void newScan(r.id, r.name)}>New scan</Button>
                </div>
              ))}
            </div>
          )}
        </Card.Body>
      </Card>

      {/* Saved sites */}
      <div>
        <h2 className="text-lg font-semibold text-theme-primary mb-3">Sites</h2>
        {error && <p className="text-sm text-red-400 mb-2">{error}</p>}
        {isLoading && sites.length === 0 ? (
          <p className="text-sm text-theme-tertiary">Loading sites…</p>
        ) : sites.length === 0 ? (
          <p className="text-sm text-theme-tertiary">No sites yet. Start a scan above.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sites.map((site) => (
              <SiteCard
                key={site.id}
                site={site}
                robotName={robotNames[site.robotId]}
                buildProgress={progressByTwin[site.id]}
                onOpen={(id) => navigate(`/sites/${id}`)}
                onDelete={(id) => void removeTwin(id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
