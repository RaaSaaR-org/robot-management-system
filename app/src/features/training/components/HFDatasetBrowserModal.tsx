/**
 * @file HFDatasetBrowserModal.tsx
 * @description Modal for browsing and importing datasets from HuggingFace Hub
 * @feature training
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Modal, Button, Input, ProgressBar, Spinner, Tabs } from '@/shared/components/ui';
import type { Tab } from '@/shared/components/ui';
import { getWebSocketUrl } from '@/shared/utils/websocket';
import { trainingApi } from '../api';
import type { Dataset, HFDataset, HFImportProgress } from '../types';

// ============================================================================
// FEATURED DATASETS
// ============================================================================

interface FeaturedDataset {
  repoId: string;
  displayName: string;
  description: string;
  robotType: string;
  episodeCount: number | null;
  tags: string[];
}

const FEATURED_DATASETS: FeaturedDataset[] = [
  {
    repoId: 'lerobot/svla_so101_pickplace',
    displayName: 'SO-101 Pick & Place',
    description: 'Pick & place task with SO-101 arm. 50 episodes, 6 DOF, 2 cameras.',
    robotType: 'SO-101',
    episodeCount: 50,
    tags: ['manipulation', 'pick-place', 'so-101'],
  },
  {
    repoId: 'unitreerobotics/g1_dex3_agilex_dual_arm_pick_place',
    displayName: 'G1 Dex3 — Dual Arm Pick & Place',
    description: 'Tabletop dual-arm pick & place with Unitree G1 + Dex3-1 hands.',
    robotType: 'G1 + Dex3',
    episodeCount: null,
    tags: ['manipulation', 'dual-arm', 'g1', 'dex3'],
  },
  {
    repoId: 'unitreerobotics/g1_dex3_bottle_cap',
    displayName: 'G1 Dex3 — Bottle Cap',
    description: 'Bottle cap manipulation task with Unitree G1 + Dex3-1 hands.',
    robotType: 'G1 + Dex3',
    episodeCount: null,
    tags: ['manipulation', 'dexterous', 'g1', 'dex3'],
  },
  {
    repoId: 'unitreerobotics/g1_dex3_cup_stacking',
    displayName: 'G1 Dex3 — Cup Stacking',
    description: 'Cup stacking with Unitree G1 + Dex3-1 hands.',
    robotType: 'G1 + Dex3',
    episodeCount: null,
    tags: ['manipulation', 'stacking', 'g1', 'dex3'],
  },
  {
    repoId: 'lerobot/aloha_static_coffee',
    displayName: 'ALOHA — Coffee',
    description: 'Classic coffee-making task with ALOHA robot.',
    robotType: 'ALOHA',
    episodeCount: 50,
    tags: ['manipulation', 'bimanual', 'aloha'],
  },
  {
    repoId: 'lerobot/pusht',
    displayName: 'PushT Benchmark',
    description: 'Classic 2D push-T benchmark — great for baseline comparisons.',
    robotType: 'PushT (sim)',
    episodeCount: 206,
    tags: ['benchmark', 'simulation', 'pusht'],
  },
];

// ============================================================================
// MODAL COMPONENT
// ============================================================================

export interface HFDatasetBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  existingDatasets?: Dataset[];
}

type ImportState = 'idle' | 'importing' | 'done' | 'error';

/**
 * Modal for searching and importing HuggingFace datasets
 */
export function HFDatasetBrowserModal({
  isOpen,
  onClose,
  onSuccess,
  existingDatasets = [],
}: HFDatasetBrowserModalProps) {
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<HFDataset[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Direct link state
  const [directUrl, setDirectUrl] = useState('');
  const [parsedRepoId, setParsedRepoId] = useState<string | null>(null);

  // Import state
  const [importState, setImportState] = useState<ImportState>('idle');
  const [importProgress, setImportProgress] = useState<HFImportProgress | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // WebSocket ref for import progress
  const wsRef = useRef<WebSocket | null>(null);

  const resetState = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setIsSearching(false);
    setSearchError(null);
    setDirectUrl('');
    setParsedRepoId(null);
    setImportState('idle');
    setImportProgress(null);
    setImportError(null);
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  // Parse HF URL into repo ID
  useEffect(() => {
    if (!directUrl.trim()) {
      setParsedRepoId(null);
      return;
    }

    // Match patterns:
    // https://huggingface.co/datasets/lerobot/svla_so101_pickplace
    // huggingface.co/datasets/lerobot/svla_so101_pickplace
    // lerobot/svla_so101_pickplace
    const urlMatch = directUrl.match(
      /(?:https?:\/\/)?(?:huggingface\.co\/)?datasets\/([^/\s]+\/[^/\s]+)/
    );
    if (urlMatch) {
      setParsedRepoId(urlMatch[1]);
      return;
    }

    // Direct repo ID format: org/name
    const repoMatch = directUrl.trim().match(/^([^/\s]+\/[^/\s]+)$/);
    if (repoMatch) {
      setParsedRepoId(repoMatch[1]);
      return;
    }

    setParsedRepoId(null);
  }, [directUrl]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setSearchError(null);
    setSearchResults([]);

    try {
      const results = await trainingApi.searchHuggingFace(searchQuery.trim());
      setSearchResults(results);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

  const connectImportWebSocket = useCallback((datasetId: string) => {
    if (import.meta.env.VITE_DEMO_MODE === 'true') return;

    try {
      const ws = new WebSocket(getWebSocketUrl());
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (
            data.type === 'dataset:import:progress' &&
            data.datasetId === datasetId
          ) {
            const progress: HFImportProgress = {
              datasetId: data.datasetId,
              status: data.status,
              progress: data.progress ?? 0,
              currentFile: data.currentFile,
              error: data.error,
            };
            setImportProgress(progress);

            if (data.status === 'ready') {
              setImportState('done');
              ws.close();
            } else if (data.status === 'failed') {
              setImportState('error');
              setImportError(data.error ?? 'Import failed');
              ws.close();
            }
          }
        } catch {
          // Ignore parse errors for non-JSON messages
        }
      };

      ws.onerror = () => {
        console.error('[HFImport] WebSocket error');
      };
    } catch {
      console.error('[HFImport] Failed to create WebSocket');
    }
  }, []);

  const handleImport = useCallback(async (repoId: string) => {
    setImportState('importing');
    setImportError(null);
    setImportProgress({
      datasetId: '',
      status: 'importing',
      progress: 0,
    });

    try {
      const { datasetId } = await trainingApi.importFromHuggingFace(repoId);

      setImportProgress((prev) => prev ? { ...prev, datasetId } : {
        datasetId,
        status: 'importing',
        progress: 0,
      });

      connectImportWebSocket(datasetId);
    } catch (err) {
      setImportState('error');
      setImportError(err instanceof Error ? err.message : 'Import failed');
    }
  }, [connectImportWebSocket]);

  const handleDone = useCallback(() => {
    onSuccess?.();
    handleClose();
  }, [onSuccess, handleClose]);

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const isImporting = importState === 'importing';

  const searchTab = (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder='Search LeRobot datasets (e.g. "so101")'
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          fullWidth
        />
        <Button
          onClick={handleSearch}
          isLoading={isSearching}
          className="shrink-0"
        >
          Search
        </Button>
      </div>

      {searchError && (
        <div className="p-3 bg-red-100 text-red-700 rounded-lg text-sm">
          {searchError}
        </div>
      )}

      {isSearching && (
        <div className="flex justify-center py-8">
          <Spinner size="lg" />
        </div>
      )}

      {!isSearching && searchResults.length > 0 && (
        <div className="grid gap-3 max-h-80 overflow-y-auto">
          {searchResults.map((ds) => (
            <HFDatasetCard
              key={ds.id}
              dataset={ds}
              onImport={() => handleImport(ds.id)}
              disabled={isImporting}
            />
          ))}
        </div>
      )}

      {!isSearching && searchQuery && searchResults.length === 0 && !searchError && (
        <p className="text-center py-8 text-theme-secondary">
          No datasets found for &quot;{searchQuery}&quot;
        </p>
      )}
    </div>
  );

  const directLinkTab = (
    <div className="space-y-4">
      <Input
        value={directUrl}
        onChange={(e) => setDirectUrl(e.target.value)}
        placeholder="https://huggingface.co/datasets/lerobot/svla_so101_pickplace"
        label="HuggingFace Dataset URL or Repo ID"
        fullWidth
      />

      {directUrl.trim() && (
        <div className="text-sm">
          {parsedRepoId ? (
            <p className="text-green-600">
              Parsed repo: <span className="font-mono font-medium">{parsedRepoId}</span>
            </p>
          ) : (
            <p className="text-theme-tertiary">
              Enter a valid HuggingFace dataset URL or repo ID (e.g. lerobot/svla_so101_pickplace)
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          onClick={() => parsedRepoId && handleImport(parsedRepoId)}
          disabled={!parsedRepoId || isImporting}
        >
          Import
        </Button>
      </div>
    </div>
  );

  const isDatasetImported = useCallback(
    (repoId: string) =>
      existingDatasets.some((d) => d.huggingFaceRepoId === repoId),
    [existingDatasets]
  );

  const featuredTab = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto">
      {FEATURED_DATASETS.map((ds) => {
        const imported = isDatasetImported(ds.repoId);
        return (
          <FeaturedDatasetCard
            key={ds.repoId}
            dataset={ds}
            imported={imported}
            onImport={() => handleImport(ds.repoId)}
            disabled={isImporting || imported}
          />
        );
      })}
    </div>
  );

  const tabs: Tab[] = [
    { id: 'featured', label: 'Featured', content: featuredTab },
    { id: 'search', label: 'Search', content: searchTab },
    { id: 'direct', label: 'Direct Link', content: directLinkTab },
  ];

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Import from HuggingFace Hub" size="lg">
      <div className="space-y-6">
        {importState === 'idle' && (
          <Tabs tabs={tabs} defaultTab="featured" />
        )}

        {importState === 'importing' && (
          <div className="text-center py-8 space-y-4">
            <Spinner size="lg" />
            <p className="text-theme-primary font-medium">Importing dataset...</p>
            {importProgress && (
              <>
                <ProgressBar value={importProgress.progress} showValue />
                {importProgress.currentFile && (
                  <p className="text-sm text-theme-secondary font-mono truncate">
                    {importProgress.currentFile}
                  </p>
                )}
                <p className="text-xs text-theme-tertiary capitalize">
                  {importProgress.status}
                </p>
              </>
            )}
          </div>
        )}

        {importState === 'done' && (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <svg
                className="w-8 h-8 text-green-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <p className="mt-4 text-lg font-medium text-theme-primary">
              Dataset imported successfully!
            </p>
            <p className="text-sm text-theme-secondary mt-1">
              The dataset is ready for training.
            </p>
          </div>
        )}

        {importState === 'error' && (
          <div className="text-center py-8 space-y-4">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
              <svg
                className="w-8 h-8 text-red-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <p className="text-lg font-medium text-theme-primary">Import failed</p>
            {importError && (
              <div className="p-3 bg-red-100 text-red-700 rounded-lg text-sm">
                {importError}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3">
          {importState === 'idle' && (
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
          )}
          {importState === 'done' && (
            <Button onClick={handleDone}>Done</Button>
          )}
          {importState === 'error' && (
            <>
              <Button variant="ghost" onClick={handleClose}>
                Close
              </Button>
              <Button onClick={() => { setImportState('idle'); setImportError(null); }}>
                Try Again
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// SUBCOMPONENTS
// ============================================================================

interface HFDatasetCardProps {
  dataset: HFDataset;
  onImport: () => void;
  disabled?: boolean;
}

interface FeaturedDatasetCardProps {
  dataset: FeaturedDataset;
  imported: boolean;
  onImport: () => void;
  disabled?: boolean;
}

function FeaturedDatasetCard({ dataset, imported, onImport, disabled }: FeaturedDatasetCardProps) {
  return (
    <div
      className={`flex items-start justify-between p-4 rounded-lg border transition-colors ${
        imported
          ? 'border-green-500/30 bg-theme-secondary/5 opacity-75'
          : 'border-theme-secondary/20 bg-theme-secondary/5 hover:bg-theme-secondary/10'
      }`}
    >
      <div className="min-w-0 flex-1 mr-3">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-theme-primary text-sm">
            {dataset.displayName}
          </p>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-700">
            {dataset.robotType}
          </span>
          {imported && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
              Imported
            </span>
          )}
        </div>
        <p className="text-xs text-theme-secondary mt-1">
          {dataset.description}
        </p>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {dataset.episodeCount !== null && (
            <span className="text-xs text-theme-tertiary">
              {dataset.episodeCount} episodes
            </span>
          )}
          {dataset.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-theme-secondary/10 text-theme-tertiary"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
      <Button
        size="sm"
        onClick={onImport}
        disabled={disabled}
        className="shrink-0 mt-0.5"
      >
        {imported ? 'Imported' : 'Import'}
      </Button>
    </div>
  );
}

function HFDatasetCard({ dataset, onImport, disabled }: HFDatasetCardProps) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg border border-theme-secondary/20 bg-theme-secondary/5 hover:bg-theme-secondary/10 transition-colors">
      <div className="min-w-0 flex-1 mr-3">
        <p className="font-medium text-theme-primary font-mono text-sm truncate">
          {dataset.id}
        </p>
        <div className="flex items-center gap-3 mt-1 text-xs text-theme-secondary">
          {dataset.downloads !== undefined && (
            <span>{dataset.downloads.toLocaleString()} downloads</span>
          )}
          {dataset.tags && dataset.tags.length > 0 && (
            <span className="truncate">
              {dataset.tags.slice(0, 3).join(', ')}
            </span>
          )}
        </div>
      </div>
      <Button size="sm" onClick={onImport} disabled={disabled} className="shrink-0">
        Import
      </Button>
    </div>
  );
}
