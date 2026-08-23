/**
 * @file HFDatasetBrowserModal.tsx
 * @description Modal for browsing, previewing and importing datasets from HuggingFace Hub
 * @feature training
 *
 * The import used to be one button and one hope. It fired a POST with only a
 * repo id, subscribed to the progress socket AFTER that POST had returned, and
 * never passed `includeVideos` at all — so a fast server-side failure arrived
 * while nothing was listening, and a "successful" import of
 * nvidia/GR00T-N1.7-AppleToPlate downloaded 73 MB of parquet and none of the
 * 929 MB of video the dataset is mostly made of. (TASK-220)
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Modal, Button, Input, ProgressBar, Spinner, Tabs, ToggleChip } from '@/shared/components/ui';
import type { Tab } from '@/shared/components/ui';
import { getWebSocketUrl } from '@/shared/utils/websocket';
import { trainingApi } from '../api';
import type {
  Dataset,
  HFDataset,
  HFDatasetPreview,
  HFImportProgress,
  RobotType,
} from '../types';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import { getErrorMessage } from '@/shared/utils';

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
    repoId: 'nvidia/GR00T-N1.7-AppleToPlate',
    displayName: 'GR00T N1.7 — Apple to Plate',
    description: 'Unitree G1, 43-wide state and action, 402 episodes, one ego-view camera.',
    robotType: 'Unitree G1',
    episodeCount: 402,
    tags: ['manipulation', 'g1', 'groot'],
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
    repoId: 'unitreerobotics/G1_Dex3_ObjectPlacement_Dataset',
    displayName: 'G1 Dex3 — Object Placement',
    description: 'LeRobot v3.0, 28-wide state and action, 210 episodes, 4 cameras.',
    robotType: 'G1 + Dex3',
    episodeCount: 210,
    tags: ['manipulation', 'g1', 'dex3'],
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

type ImportState = 'idle' | 'preview' | 'importing' | 'done' | 'error';

/** One frame off the import progress socket. Only these fields are read. */
interface ImportSocketMessage {
  type?: string;
  datasetId?: string;
  error?: string;
  importProgress?: {
    datasetId: string;
    status: HFImportProgress['status'];
    progress?: number;
    currentFile?: string;
    error?: string;
  };
}

/**
 * Modal for searching, previewing and importing HuggingFace datasets
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
  const [lerobotOnly, setLerobotOnly] = useState(true);
  const [searchWidened, setSearchWidened] = useState(false);

  // Direct link state
  const [directUrl, setDirectUrl] = useState('');
  const [parsedRepoId, setParsedRepoId] = useState<string | null>(null);

  // Preview state
  const [pendingRepoId, setPendingRepoId] = useState<string | null>(null);
  const [revision, setRevision] = useState('');
  const [robotTypeId, setRobotTypeId] = useState('');
  const [robotTypes, setRobotTypes] = useState<RobotType[]>([]);
  const [preview, setPreview] = useState<HFDatasetPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [includeVideos, setIncludeVideos] = useState(true);
  const [videosTouched, setVideosTouched] = useState(false);

  // Import state
  const [importState, setImportState] = useState<ImportState>('idle');
  const [importProgress, setImportProgress] = useState<HFImportProgress | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  // The progress socket went away while an import was still running. Not an
  // import failure — the import runs detached on the server and carries on —
  // just the end of our ability to watch it.
  const [feedLost, setFeedLost] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  // Null until the POST comes back with an id. Everything the socket says
  // before that is held in `bufferRef` rather than thrown away.
  const datasetIdRef = useRef<string | null>(null);
  const bufferRef = useRef<ImportSocketMessage[]>([]);

  const closeSocket = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  const resetState = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setIsSearching(false);
    setSearchError(null);
    setSearchWidened(false);
    setDirectUrl('');
    setParsedRepoId(null);
    setPendingRepoId(null);
    setRevision('');
    setRobotTypeId('');
    setPreview(null);
    setPreviewLoading(false);
    setPreviewError(null);
    setIncludeVideos(true);
    setVideosTouched(false);
    setFeedLost(false);
    setImportState('idle');
    setImportProgress(null);
    setImportError(null);
    datasetIdRef.current = null;
    bufferRef.current = [];
    closeSocket();
  }, [closeSocket]);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  // Robot types for the override select. A failure here costs the override,
  // not the import: leaving it on "Auto-detect" is the normal path.
  useEffect(() => {
    if (!isOpen || robotTypes.length > 0) return;
    let cancelled = false;
    void trainingApi
      .listRobotTypes()
      .then((types) => { if (!cancelled) setRobotTypes(types); })
      .catch(() => { /* the select stays on Auto-detect */ });
    return () => { cancelled = true; };
  }, [isOpen, robotTypes.length]);

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
    setSearchWidened(false);

    try {
      const query = searchQuery.trim();
      let results = await trainingApi.searchHuggingFace(query, lerobotOnly);

      // The `lerobot` tag is applied by whoever uploaded the repo, so a filtered
      // search can report "nothing found" for a dataset that is right there.
      // Widening is announced rather than silent: an unfiltered Hub search
      // returns plenty that is not a LeRobot dataset at all.
      if (results.length === 0 && lerobotOnly) {
        results = await trainingApi.searchHuggingFace(query, false);
        setSearchWidened(true);
      }

      setSearchResults(results);
    } catch (err) {
      setSearchError(getErrorMessage(err, 'Search failed'));
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, lerobotOnly]);

  const loadPreview = useCallback(async (repoId: string, rev: string, keepChoice: boolean) => {
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    try {
      const result = await trainingApi.previewHuggingFace(repoId, rev.trim() || undefined);
      setPreview(result);
      // Videos are what the size number is about, so the default follows the
      // repo: on when there is video to fetch. `keepChoice` is what stops a
      // re-check from undoing a decision the user has already made here.
      setIncludeVideos((current) => (keepChoice ? current : result.cameraKeys.length > 0));
    } catch (err) {
      setPreviewError(getErrorMessage(err, 'Could not read this repository'));
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const beginPreview = useCallback((repoId: string) => {
    setPendingRepoId(repoId);
    setVideosTouched(false);
    setImportState('preview');
    void loadPreview(repoId, revision, false);
  }, [loadPreview, revision]);

  const applyMessage = useCallback((data: ImportSocketMessage) => {
    if (data.type === 'dataset:import:progress' && data.importProgress) {
      const ip = data.importProgress;
      setImportProgress({
        datasetId: ip.datasetId,
        status: ip.status,
        progress: ip.progress ?? 0,
        currentFile: ip.currentFile,
        error: ip.error,
      });

      if (ip.status === 'failed') {
        setImportState('error');
        setImportError(ip.error ?? 'Import failed');
        closeSocket();
      }
    } else if (data.type === 'dataset:import:completed') {
      setImportState('done');
      closeSocket();
    } else if (data.type === 'dataset:import:failed') {
      setImportState('error');
      setImportError(data.error ?? 'Import failed');
      closeSocket();
    }
  }, [closeSocket]);

  const handleSocketData = useCallback((data: ImportSocketMessage) => {
    if (datasetIdRef.current === null) {
      bufferRef.current.push(data);
      return;
    }
    if (data.datasetId !== datasetIdRef.current) return;
    applyMessage(data);
  }, [applyMessage]);

  const openSocket = useCallback(() => {
    if (import.meta.env.VITE_DEMO_MODE === 'true') return;

    try {
      const ws = new WebSocket(getWebSocketUrl());
      wsRef.current = ws;
      ws.onmessage = (event: MessageEvent) => {
        try {
          handleSocketData(JSON.parse(event.data as string) as ImportSocketMessage);
        } catch {
          // Non-JSON frames are not ours.
        }
      };
      ws.onerror = () => {
        console.error('[HFImport] WebSocket error');
      };
      // A socket that closes mid-import used to leave the modal on the spinner
      // for ever: no further frames, no error, and the modal refuses backdrop
      // and Escape while importing — so the operator was trapped watching a
      // progress bar that would never move again. The import itself is
      // unaffected (it runs detached on the server), so the honest thing is to
      // say the feed is gone and let them out to the dataset list.
      ws.onclose = () => {
        // Every deliberate close goes through `closeSocket`, which nulls the
        // ref first — on success, on failure, on cancel, on unmount. So a close
        // arriving while the ref still points at THIS socket is one nobody
        // asked for, and the import it was reporting on is still in flight.
        if (wsRef.current !== ws) return;
        wsRef.current = null;
        setFeedLost(true);
      };
    } catch {
      console.error('[HFImport] Failed to create WebSocket');
      setFeedLost(true);
    }
  }, [handleSocketData]);

  const handleImport = useCallback(async () => {
    const repoId = pendingRepoId;
    if (!repoId) return;

    setImportState('importing');
    setImportError(null);
    setImportProgress({ datasetId: '', status: 'importing', progress: 0 });
    datasetIdRef.current = null;
    bufferRef.current = [];

    // BEFORE the POST. An import that fails in its first second — a repo the
    // server cannot reach, an object store that is down — publishes its failure
    // frame before this promise resolves, and subscribing afterwards missed it
    // entirely: the modal sat on "Importing…" forever.
    openSocket();

    try {
      const { datasetId } = await trainingApi.importFromHuggingFace(repoId, {
        revision: revision.trim() || undefined,
        robotTypeId: robotTypeId || undefined,
        includeVideos,
      });

      setImportProgress((prev) => (prev ? { ...prev, datasetId } : {
        datasetId,
        status: 'importing',
        progress: 0,
      }));

      datasetIdRef.current = datasetId;
      const buffered = bufferRef.current;
      bufferRef.current = [];
      for (const message of buffered) {
        if (message.datasetId === datasetId) applyMessage(message);
      }
    } catch (err) {
      setImportState('error');
      setImportError(getErrorMessage(err, 'Import failed'));
      closeSocket();
    }
  }, [pendingRepoId, revision, robotTypeId, includeVideos, openSocket, applyMessage, closeSocket]);

  const handleDone = useCallback(() => {
    onSuccess?.();
    handleClose();
  }, [onSuccess, handleClose]);

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const isImporting = importState === 'importing';

  const searchTab = (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder='Search Hub datasets (e.g. "AppleToPlate")'
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

      <ToggleChip
        active={lerobotOnly}
        onClick={() => setLerobotOnly((v) => !v)}
        title="Restrict results to repos tagged `lerobot` on the Hub"
      >
        LeRobot-tagged only
      </ToggleChip>

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

      {!isSearching && searchWidened && (
        <p data-testid="search-widened" className="text-sm text-theme-secondary">
          No repository carries the <span className="font-mono">lerobot</span> tag for this
          search, so these are unfiltered Hub results — check each one is a LeRobot dataset
          before importing.
        </p>
      )}

      {!isSearching && searchResults.length > 0 && (
        <div className="grid gap-3 max-h-80 overflow-y-auto">
          {searchResults.map((ds) => (
            <HFDatasetCard
              key={ds.id}
              dataset={ds}
              onImport={() => beginPreview(ds.id)}
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
        placeholder="https://huggingface.co/datasets/nvidia/GR00T-N1.7-AppleToPlate"
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

      <ImportOptions
        revision={revision}
        onRevisionChange={setRevision}
        robotTypeId={robotTypeId}
        onRobotTypeChange={setRobotTypeId}
        robotTypes={robotTypes}
      />

      <div className="flex justify-end">
        <Button
          onClick={() => parsedRepoId && beginPreview(parsedRepoId)}
          disabled={!parsedRepoId || isImporting}
        >
          Preview
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
            onImport={() => beginPreview(ds.repoId)}
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
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Import from HuggingFace Hub"
      size="lg"
      // An import is a download of up to a gigabyte with no resume. A stray
      // click on the backdrop must not be able to abandon it.
      closeOnBackdrop={!isImporting || feedLost}
      closeOnEscape={!isImporting || feedLost}
    >
      <div className="space-y-6">
        {importState === 'idle' && (
          <Tabs tabs={tabs} defaultTab="featured" />
        )}

        {importState === 'preview' && (
          <div className="space-y-4" data-testid="hf-preview-step">
            <div>
              <p className="text-sm text-theme-tertiary">About to import</p>
              <p className="font-mono font-medium text-theme-primary break-all">{pendingRepoId}</p>
            </div>

            {previewLoading && (
              <div className="flex items-center gap-3 py-6">
                <Spinner size="sm" />
                <span className="text-sm text-theme-secondary">Reading the repository…</span>
              </div>
            )}

            {previewError && (
              <div
                data-testid="hf-preview-error"
                className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400"
              >
                {previewError}
              </div>
            )}

            {preview && <PreviewFacts preview={preview} />}

            <ImportOptions
              revision={revision}
              onRevisionChange={setRevision}
              robotTypeId={robotTypeId}
              onRobotTypeChange={setRobotTypeId}
              robotTypes={robotTypes}
            />

            <label className="flex items-start gap-2 text-sm text-theme-secondary">
              <input
                type="checkbox"
                checked={includeVideos}
                onChange={(e) => { setVideosTouched(true); setIncludeVideos(e.target.checked); }}
                className="mt-0.5"
                data-testid="include-videos"
              />
              <span>
                Include videos
                {preview && preview.videoBytes > 0 && (
                  <span className="text-theme-tertiary"> — adds {formatBytes(preview.videoBytes)}</span>
                )}
                {preview && preview.cameraKeys.length === 0 && (
                  <span className="text-theme-tertiary"> — this dataset has no camera features</span>
                )}
              </span>
            </label>

            <div className="flex justify-between gap-3">
              <Button variant="ghost" onClick={() => { setImportState('idle'); setPreview(null); setPreviewError(null); }}>
                Back
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={() => pendingRepoId && void loadPreview(pendingRepoId, revision, videosTouched)}
                  disabled={previewLoading}
                >
                  Re-check
                </Button>
                <Button onClick={handleImport} disabled={previewLoading}>
                  {preview
                    ? `Import ${formatBytes(preview.dataBytes + (includeVideos ? preview.videoBytes : 0))}`
                    : 'Import anyway'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {importState === 'importing' && feedLost && (
          <div className="py-8 space-y-4 text-center" data-testid="hf-import-feed-lost">
            <p className="text-theme-primary font-medium">
              Lost the live connection to the server
            </p>
            <p className="text-sm text-theme-secondary max-w-md mx-auto">
              The import itself is still running — it does not depend on this window. Close this
              and the dataset will show how it ended, with the reason if it failed.
            </p>
            <Button variant="secondary" onClick={handleClose}>Close</Button>
          </div>
        )}

        {importState === 'importing' && !feedLost && (
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
              <div
                data-testid="hf-import-error"
                className="p-3 bg-red-100 text-red-700 rounded-lg text-sm"
              >
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
              <Button onClick={() => { setImportState('preview'); setImportError(null); }}>
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

interface ImportOptionsProps {
  revision: string;
  onRevisionChange: (value: string) => void;
  robotTypeId: string;
  onRobotTypeChange: (value: string) => void;
  robotTypes: RobotType[];
}

/**
 * The two things a person overrides about an import: which commit, and what the
 * robot is called here. Both default to whatever the Hub says.
 */
function ImportOptions({
  revision,
  onRevisionChange,
  robotTypeId,
  onRobotTypeChange,
  robotTypes,
}: ImportOptionsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Input
        value={revision}
        onChange={(e) => onRevisionChange(e.target.value)}
        label="Revision"
        placeholder="main"
        helperText="Branch, tag or commit SHA"
        fullWidth
      />
      <div>
        <label
          htmlFor="hf-robot-type"
          className="block text-sm font-medium text-theme-secondary mb-1.5"
        >
          Robot type
        </label>
        <select
          id="hf-robot-type"
          value={robotTypeId}
          onChange={(e) => onRobotTypeChange(e.target.value)}
          className="w-full px-3 py-2.5 rounded-brand border border-theme-secondary/30 bg-theme-primary text-theme-primary text-sm focus:outline-none focus:ring-2 focus:ring-cobalt-500"
        >
          <option value="">Auto-detect from info.json</option>
          {robotTypes.map((type) => (
            <option key={type.id} value={type.id}>{type.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

/**
 * What the repo holds, read before a byte of it is fetched.
 *
 * The two size numbers are separate and both shown: for GR00T AppleToPlate they
 * are 73 MB and 929 MB, and nothing else on this screen changes the download by
 * an order of magnitude.
 */
function PreviewFacts({ preview }: { preview: HFDatasetPreview }) {
  return (
    <div data-testid="hf-preview-facts" className="space-y-3 rounded-lg bg-theme-secondary/10 p-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
        <Fact label="LeRobot version" value={preview.lerobotVersion} />
        <Fact label="Robot type" value={preview.robotType} />
        <Fact label="FPS" value={String(preview.fps)} />
        <Fact label="Episodes" value={preview.totalEpisodes.toLocaleString(UI_DATE_LOCALE)} />
        <Fact label="Frames" value={preview.totalFrames.toLocaleString(UI_DATE_LOCALE)} />
        <Fact label="Files" value={preview.fileCount.toLocaleString(UI_DATE_LOCALE)} />
        <Fact label="State width" value={preview.stateWidth?.toString() ?? 'unknown'} />
        <Fact label="Action width" value={preview.actionWidth?.toString() ?? 'unknown'} />
        <Fact label="License" value={preview.license ?? 'Not stated'} />
      </div>

      <div className="text-sm">
        <span className="text-theme-tertiary">Cameras</span>
        <p className="font-mono text-xs text-theme-primary break-all">
          {preview.cameraKeys.length > 0 ? preview.cameraKeys.join(', ') : 'None'}
        </p>
      </div>

      <div className="flex flex-wrap gap-4 border-t border-theme-secondary/20 pt-3 text-sm">
        <div>
          <span className="text-theme-tertiary">Data</span>
          <p className="font-medium text-theme-primary" data-testid="preview-data-bytes">
            {formatBytes(preview.dataBytes)}
          </p>
        </div>
        <div>
          <span className="text-theme-tertiary">Video</span>
          <p className="font-medium text-theme-primary" data-testid="preview-video-bytes">
            {formatBytes(preview.videoBytes)}
          </p>
        </div>
        <div>
          <span className="text-theme-tertiary">Pinned commit</span>
          <p className="font-mono text-xs text-theme-primary">
            {preview.resolvedRevision.slice(0, 12)}
          </p>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-theme-tertiary">{label}</span>
      <p className="font-medium text-theme-primary break-words">{value}</p>
    </div>
  );
}

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
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-cobalt-500/15 text-cobalt-400">
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
        {imported ? 'Imported' : 'Preview'}
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
            <span>{dataset.downloads.toLocaleString(UI_DATE_LOCALE)} downloads</span>
          )}
          {dataset.tags && dataset.tags.length > 0 && (
            <span className="truncate">
              {dataset.tags.slice(0, 3).join(', ')}
            </span>
          )}
        </div>
      </div>
      <Button size="sm" onClick={onImport} disabled={disabled} className="shrink-0">
        Preview
      </Button>
    </div>
  );
}

/** Sizes in the units the Hub itself quotes, so they can be compared by eye. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 100 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
