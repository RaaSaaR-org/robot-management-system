/**
 * @file FleetPage.tsx
 * @description Fleet: the Map tab is a site map (TASK-331) — a scanned site
 *   top-down with its zones and the robots bound to it, zone E-stop by click;
 *   zones are authored on the site's twin, not here. The Robots tab embeds the
 *   robot list and the Sites tab the gallery of rooms a robot has scanned in 3D.
 * @feature fleet
 * @dependencies @/shared/components/ui, @/features/fleet/components, @/features/robots, @/features/digitaltwin
 */

import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button, PageHeader, Panel, Tabs } from '@/shared/components/ui';
import { SiteMap } from '../components/SiteMap';
import { RobotsPage } from '@/features/robots/pages/RobotsPage';
// By path, not through the feature barrel: that barrel re-exports the three.js
// twin viewer, which has no business in the fleet chunk.
import { SitesGallery } from '@/features/digitaltwin/components/SitesGallery';

const TABS = [
  { id: 'map', label: 'Map' },
  { id: 'list', label: 'Robots' },
  { id: 'sites', label: 'Sites' },
] as const;
type FleetTab = (typeof TABS)[number]['id'];

export interface FleetPageProps {
  /** Additional class names */
  className?: string;
}

/**
 * Fleet page. Tab state lives in ?tab= (default `map`), so the legacy
 * /robots → /fleet?tab=list and /sites → /fleet?tab=sites redirects land on the
 * Robots and Sites tabs.
 */
export function FleetPage({ className }: FleetPageProps) {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: FleetTab = TABS.some((t) => t.id === raw) ? (raw as FleetTab) : 'map';
  const setTab = (id: string) =>
    setParams(
      (p) => {
        if (id === 'map') p.delete('tab');
        else p.set('tab', id);
        return p;
      },
      { replace: true },
    );

  // The Sites tab's "New scan" button lives in this header, so the flag lives
  // here too and the gallery renders the modal from it.
  const [scanOpen, setScanOpen] = useState(false);

  // Every tab brings its own actions; the Robots tab has none in the header.
  let headerActions: ReactNode;
  if (tab === 'sites') {
    headerActions = (
      <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setScanOpen(true)}>
        New scan
      </Button>
    );
  }

  return (
    <div className={className ? `flex flex-col gap-6 ${className}` : 'flex flex-col gap-6'}>
      <PageHeader
        eyebrow="Operate"
        title="Fleet"
        description="Each site top-down with its zones and the robots working in it, and the rooms they have scanned."
        actions={headerActions}
      />

      <Tabs tabs={TABS.map(({ id, label }) => ({ id, label }))} activeTab={tab} onTabChange={setTab} />

      {tab === 'map' && (
        <Panel>
          <SiteMap />
        </Panel>
      )}

      {tab === 'list' && <RobotsPage />}

      {tab === 'sites' && <SitesGallery newScanOpen={scanOpen} onNewScanOpenChange={setScanOpen} />}
    </div>
  );
}
