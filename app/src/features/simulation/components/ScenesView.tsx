/**
 * @file ScenesView.tsx
 * @description Registered simulation scenes as a card grid; a card opens New sim run prefilled
 * @feature simulation
 */

import { Boxes, MapPin, Search } from 'lucide-react';
import { Button, EmptyState, ErrorState, Panel, SkeletonRows, StatusTag } from '@/shared/components/ui';
import { simulationApi } from '../api/simulationApi';
import type { SimScene } from '../types';
import { backendLabel } from './simFormat';

export interface ScenesViewProps {
  scenes: SimScene[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onPick: (scene: SimScene) => void;
  query: string;
  onClearQuery: () => void;
}

export function ScenesView({ scenes, loading, error, onRetry, onPick, query, onClearQuery }: ScenesViewProps) {
  if (loading && scenes.length === 0) {
    return (
      <Panel>
        <SkeletonRows rows={3} columns={3} />
      </Panel>
    );
  }
  if (error && scenes.length === 0) {
    return (
      <Panel>
        <ErrorState title="Couldn't load scenes" message={error} onRetry={onRetry} />
      </Panel>
    );
  }
  if (scenes.length === 0) {
    return (
      <Panel>
        {query ? (
          <EmptyState icon={<Search />} title="No scenes match" description="Try another name." action={<Button variant="secondary" onClick={onClearQuery}>Clear search</Button>} />
        ) : (
          <EmptyState icon={<Boxes />} title="No scenes yet" description="Scan a room with the digital twin, or add a built-in scene on the server." />
        )}
      </Panel>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {scenes.map((scene) => (
        <SceneCard key={scene.id} scene={scene} onPick={() => onPick(scene)} />
      ))}
    </div>
  );
}

function SceneCard({ scene, onPick }: { scene: SimScene; onPick: () => void }) {
  const preview = scene.builtinEnvId ? simulationApi.getPreviewUrl(scene.builtinEnvId) : null;
  const twin = scene.source === 'twin';
  return (
    <Panel interactive onClick={onPick} padding="none" className="flex flex-col" aria-label={`New sim run in ${scene.name}`}>
      <div className="flex h-32 items-center justify-center border-b border-line-subtle bg-inset">
        {preview ? (
          <img
            src={preview}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <Boxes className="h-8 w-8 text-ink-muted" strokeWidth={1.5} />
        )}
      </div>
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-semibold text-ink-primary">{scene.name}</span>
          <StatusTag status={scene.status} size="sm" />
        </div>
        {scene.description && <p className="line-clamp-2 text-[13px] text-ink-tertiary">{scene.description}</p>}
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
          <StatusTag tone="sim" size="sm">{backendLabel(scene.backend)}</StatusTag>
          {twin && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" strokeWidth={1.75} /> Scanned room
            </span>
          )}
          <span>{scene.embodimentTag}</span>
        </div>
      </div>
    </Panel>
  );
}
