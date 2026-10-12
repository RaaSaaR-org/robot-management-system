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
 *
 * It then held the operator on a spinner until the download ended. Now it only
 * starts the import and closes; `useImportJobsStore` and the top-bar
 * `ImportActivity` panel follow it from there. (TASK-352)
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { AlertTriangle, Search, XCircle } from 'lucide-react';
import {
  Button, Checkbox, DataTable, EmptyState, FormField, Input, KeyValueList, Modal, Panel, Select,
  SkeletonRows, SkeletonText, StatusTag, Tabs, ToggleChip, toast,
} from '@/shared/components/ui';
import type { DataTableColumn, Tab } from '@/shared/components/ui';
import { trainingApi } from '../api';
import { importToastId, useImportJobsStore } from '../store/importJobsStore';
import { formatBytes } from './datasets/datasetFormat';
import { formatLerobotVersion, formatRepoAtRevision, parseHubReference, shortRevision } from './datasets/importFormat';
import type {
  Dataset,
  HFDataset,
  HFDatasetPreview,
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

type ImportState = 'idle' | 'preview' | 'error';

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

  // Import state. The import itself runs on the server and is followed by the
  // top-bar tracker (TASK-352); this modal only starts it and gets out of the way.
  const [importState, setImportState] = useState<ImportState>('idle');
  const [importError, setImportError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // An import started and then closed on keeps going; a refusal that arrives
  // after the modal is gone is said as a toast instead.
  const isOpenRef = useRef(isOpen);
  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);
  const track = useImportJobsStore((state) => state.track);
  const openPanel = useImportJobsStore((state) => state.openPanel);

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
    setImportState('idle');
    setImportError(null);
    setStarting(false);
  }, []);

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

  // Parse the pasted link. A `/tree/<rev>` or `/blob/<rev>/…` link names the
  // revision the operator was looking at on the Hub; it fills the Revision
  // field rather than being dropped, so the import pins what was seen (TASK-358).
  const onDirectUrlChange = (value: string) => {
    setDirectUrl(value);
    const ref = parseHubReference(value);
    setParsedRepoId(ref?.repoId ?? null);
    if (ref?.revision) setRevision(ref.revision);
  };

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

  // Start the import and hand it to the background tracker. The POST returns
  // as soon as the server has pinned the commit and created the row (a sink it
  // cannot write to is refused right here, 503); the download runs on.
  const handleImport = useCallback(async () => {
    const repoId = pendingRepoId;
    if (!repoId) return;

    setStarting(true);
    setImportError(null);
    try {
      const { datasetId } = await trainingApi.importFromHuggingFace(repoId, {
        revision: revision.trim() || undefined,
        robotTypeId: robotTypeId || undefined,
        includeVideos,
      });
      track(datasetId, repoId, { revision: preview?.resolvedRevision, lerobotVersion: preview?.lerobotVersion });
      toast.info('Import running in the background', {
        // The outcome replaces this toast in place when the import ends.
        id: importToastId(datasetId),
        description: formatRepoAtRevision(repoId, preview?.resolvedRevision ?? (revision.trim() || null)),
        action: { label: 'Show progress', onClick: () => openPanel(datasetId) },
      });
      onSuccess?.();
      if (isOpenRef.current) handleClose();
    } catch (err) {
      const message = getErrorMessage(err, 'Import failed');
      setStarting(false);
      setImportState('error');
      setImportError(message);
      if (!isOpenRef.current) toast.error("Couldn't start the import", { description: `${repoId}: ${message}` });
    }
  }, [pendingRepoId, preview, revision, robotTypeId, includeVideos, track, openPanel, onSuccess, handleClose]);


  const isDatasetImported = useCallback(
    (repoId: string) => existingDatasets.some((d) => d.huggingFaceRepoId === repoId),
    [existingDatasets],
  );

  const searchTab = (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); void handleSearch(); }}
      >
        <div className="min-w-48 flex-1">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder='Search Hub datasets (e.g. "AppleToPlate")'
            aria-label="Search the Hub"
            fullWidth
          />
        </div>
        <Button type="submit" variant="secondary" isLoading={isSearching}>Search</Button>
        <ToggleChip
          active={lerobotOnly}
          onClick={() => setLerobotOnly((v) => !v)}
          title="Restrict results to repos tagged lerobot on the Hub"
        >
          LeRobot-tagged only
        </ToggleChip>
      </form>

      {searchError && <p role="alert" className="text-sm text-signal-stopped">{searchError}</p>}
      {isSearching && <SkeletonRows rows={4} columns={2} dense />}
      {!isSearching && searchWidened && (
        <p data-testid="search-widened" className="text-sm text-ink-secondary">
          No repository carries the lerobot tag for this search, so these are unfiltered Hub
          results — check each one is a LeRobot dataset before importing.
        </p>
      )}
      {!isSearching && searchResults.length > 0 && (
        <HubTable
          caption="Search results"
          disabled={starting}
          onPreview={beginPreview}
          rows={searchResults.map((ds) => ({
            repoId: ds.id,
            title: ds.id,
            detail: [
              ds.downloads !== undefined ? `${ds.downloads.toLocaleString(UI_DATE_LOCALE)} downloads` : null,
              ds.tags?.slice(0, 3).join(', ') || null,
            ].filter(Boolean).join(' · ') || 'Hugging Face dataset',
            imported: isDatasetImported(ds.id),
          }))}
        />
      )}
      {!isSearching && searchQuery && searchResults.length === 0 && !searchError && (
        <EmptyState size="sm" icon={<Search />} title="No datasets found" description={`Nothing on the Hub matches "${searchQuery}".`} />
      )}
    </div>
  );

  const directLinkTab = (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => { e.preventDefault(); if (parsedRepoId) beginPreview(parsedRepoId); }}
    >
      <FormField
        label="Hugging Face URL or repo ID"
        error={directUrl.trim() && !parsedRepoId ? 'Enter a dataset URL or an owner/name repo ID.' : undefined}
        hint={parsedRepoId ? `Repo: ${formatRepoAtRevision(parsedRepoId, revision.trim() || null)}` : 'e.g. lerobot/svla_so101_pickplace'}
      >
        <Input
          value={directUrl}
          onChange={(e) => onDirectUrlChange(e.target.value)}
          placeholder="https://huggingface.co/datasets/nvidia/GR00T-N1.7-AppleToPlate"
        />
      </FormField>
      <ImportOptions
        revision={revision}
        onRevisionChange={setRevision}
        robotTypeId={robotTypeId}
        onRobotTypeChange={setRobotTypeId}
        robotTypes={robotTypes}
      />
      <div className="flex justify-end">
        <Button type="submit" disabled={!parsedRepoId || starting}>Preview</Button>
      </div>
    </form>
  );

  const featuredTab = (
    <HubTable
      caption="Featured datasets"
      disabled={starting}
      onPreview={beginPreview}
      rows={FEATURED_DATASETS.map((ds) => ({
        repoId: ds.repoId,
        title: ds.displayName,
        detail: ds.description,
        robotType: ds.robotType,
        imported: isDatasetImported(ds.repoId),
      }))}
    />
  );

  const tabs: Tab[] = [
    { id: 'featured', label: 'Featured', content: featuredTab },
    { id: 'search', label: 'Search', content: searchTab },
    { id: 'direct', label: 'Direct link', content: directLinkTab },
  ];

  const backToList = () => { setImportState('idle'); setPreview(null); setPreviewError(null); };

  const footer =
    importState === 'idle' ? (
      <Button variant="ghost" onClick={handleClose}>Cancel</Button>
    ) : importState === 'preview' ? (
      <>
        <Button variant="ghost" onClick={backToList}>Back</Button>
        <Button
          variant="secondary"
          onClick={() => pendingRepoId && void loadPreview(pendingRepoId, revision, videosTouched)}
          disabled={previewLoading || starting}
        >
          Re-check
        </Button>
        <Button onClick={handleImport} disabled={previewLoading} isLoading={starting}>
          {preview ? `Import ${formatBytes(preview.dataBytes + (includeVideos ? preview.videoBytes : 0))}` : 'Import anyway'}
        </Button>
      </>
    ) : importState === 'error' ? (
      <>
        <Button variant="ghost" onClick={handleClose}>Close</Button>
        <Button onClick={() => { setImportState('preview'); setImportError(null); }}>Try again</Button>
      </>
    ) : undefined;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Import from Hugging Face"
      description={importState === 'idle' ? 'Pick a LeRobot dataset on the Hub, check what it holds, then import it.' : undefined}
      size="lg"
      // Never trapped: the import runs on the server, and the top-bar
      // tracker follows it wherever the operator goes next (TASK-352).
      footer={footer}
    >
      {importState === 'idle' && <Tabs tabs={tabs} defaultTab="featured" />}

      {importState === 'preview' && (
        <div className="flex flex-col gap-4" data-testid="hf-preview-step">
          <div>
            <p className="text-xs text-ink-tertiary">About to import</p>
            <p className="break-all text-sm font-medium text-ink-primary" data-testid="hf-preview-target">
              {pendingRepoId && formatRepoAtRevision(pendingRepoId, preview?.resolvedRevision ?? (revision.trim() || null))}
              {preview && formatLerobotVersion(preview.lerobotVersion) && (
                <span className="font-normal text-ink-tertiary"> · {formatLerobotVersion(preview.lerobotVersion)}</span>
              )}
            </p>
          </div>
          {pendingRepoId && (
            <AlreadyImported
              existing={existingDatasets.filter((d) => d.huggingFaceRepoId === pendingRepoId && d.status !== 'failed')}
              resolvedRevision={preview?.resolvedRevision ?? null}
            />
          )}
          {previewLoading && (
            <div className="flex flex-col gap-2" aria-busy="true">
              <p className="text-sm text-ink-secondary">Reading the repository…</p>
              <SkeletonText lines={3} />
            </div>
          )}
          {previewError && (
            <p data-testid="hf-preview-error" role="alert" className="text-sm text-signal-stopped">{previewError}</p>
          )}
          {preview && <PreviewFacts preview={preview} />}
          <ImportOptions
            revision={revision}
            onRevisionChange={setRevision}
            robotTypeId={robotTypeId}
            onRobotTypeChange={setRobotTypeId}
            robotTypes={robotTypes}
          />
          <Checkbox
            data-testid="include-videos"
            label="Include videos"
            description={
              preview && preview.cameraKeys.length === 0
                ? 'This dataset has no camera features.'
                : preview && preview.videoBytes > 0
                  ? `Adds ${formatBytes(preview.videoBytes)}.`
                  : undefined
            }
            checked={includeVideos}
            onChange={(e) => { setVideosTouched(true); setIncludeVideos(e.target.checked); }}
          />
        </div>
      )}

      {importState === 'error' && (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <XCircle className="h-8 w-8 text-signal-stopped" strokeWidth={1.75} />
          <p className="text-base font-medium text-ink-primary">Import failed</p>
          {importError && (
            <p data-testid="hf-import-error" role="alert" className="text-sm text-ink-secondary">{importError}</p>
          )}
        </div>
      )}
    </Modal>
  );
}

// ============================================================================
// SUBCOMPONENTS
// ============================================================================

/**
 * A second import of a repo is allowed — another revision is a real need — but
 * never by accident: say which commits are already here, and whether the one
 * about to come down is one of them (TASK-358).
 */
function AlreadyImported({ existing, resolvedRevision }: { existing: Dataset[]; resolvedRevision: string | null }) {
  if (existing.length === 0) return null;
  const revisions = [...new Set(existing.map((d) => shortRevision(d.sourceRevision) ?? 'an unknown revision'))];
  const same = resolvedRevision !== null && existing.some((d) => d.sourceRevision === resolvedRevision);
  return (
    <p
      role="status"
      data-testid="hf-already-imported"
      className="flex items-start gap-2 rounded-control border border-signal-estimated/40 bg-signal-estimated/10 px-3 py-2 text-sm text-ink-primary"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-signal-estimated" strokeWidth={1.75} aria-hidden />
      <span>
        Already imported at {revisions.join(', ')}.{' '}
        {same
          ? 'This is the same commit, so importing again makes a second copy.'
          : resolvedRevision
            ? `This would add ${shortRevision(resolvedRevision)} as a separate dataset.`
            : 'Importing again makes a separate dataset.'}
      </span>
    </p>
  );
}

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
function ImportOptions({ revision, onRevisionChange, robotTypeId, onRobotTypeChange, robotTypes }: ImportOptionsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField label="Revision" hint="Branch, tag or commit SHA">
        <Input value={revision} onChange={(e) => onRevisionChange(e.target.value)} placeholder="main" />
      </FormField>
      <FormField label="Robot type">
        <Select
          placeholder="Auto-detect from info.json"
          value={robotTypeId}
          onChange={(e) => onRobotTypeChange(e.target.value)}
          options={robotTypes.map((t) => ({ value: t.id, label: t.name }))}
        />
      </FormField>
    </div>
  );
}

/**
 * What the repo holds, read before a byte of it is fetched. Data and video
 * sizes are both shown: for GR00T AppleToPlate they are 73 MB and 929 MB.
 */
function PreviewFacts({ preview }: { preview: HFDatasetPreview }) {
  return (
    <Panel variant="inset" padding="sm" data-testid="hf-preview-facts" className="flex flex-col gap-4">
      <KeyValueList
        columns={3}
        items={[
          { label: 'LeRobot version', value: preview.lerobotVersion },
          { label: 'Robot type', value: preview.robotType },
          { label: 'FPS', value: String(preview.fps) },
          { label: 'Episodes', value: preview.totalEpisodes.toLocaleString(UI_DATE_LOCALE) },
          { label: 'Frames', value: preview.totalFrames.toLocaleString(UI_DATE_LOCALE) },
          { label: 'Files', value: preview.fileCount.toLocaleString(UI_DATE_LOCALE) },
          { label: 'State width', value: preview.stateWidth?.toString() ?? 'unknown' },
          { label: 'Action width', value: preview.actionWidth?.toString() ?? 'unknown' },
          { label: 'License', value: preview.license ?? 'Not stated' },
          { label: 'Cameras', value: preview.cameraKeys.length > 0 ? preview.cameraKeys.join(', ') : 'None', mono: preview.cameraKeys.length > 0 },
        ]}
      />
      <div className="flex flex-wrap gap-6 border-t border-line pt-3 text-sm">
        <div>
          <span className="text-xs text-ink-tertiary">Data</span>
          <p className="font-medium text-ink-primary" data-testid="preview-data-bytes">{formatBytes(preview.dataBytes)}</p>
        </div>
        <div>
          <span className="text-xs text-ink-tertiary">Video</span>
          <p className="font-medium text-ink-primary" data-testid="preview-video-bytes">{formatBytes(preview.videoBytes)}</p>
        </div>
        <div>
          <span className="text-xs text-ink-tertiary">Pinned commit</span>
          <p className="font-mono text-xs text-ink-secondary" title={preview.resolvedRevision}>{preview.resolvedRevision.slice(0, 8)}</p>
        </div>
      </div>
    </Panel>
  );
}

/** Featured and search results share one dense table shape. */
interface HubRow {
  repoId: string;
  title: string;
  detail: string;
  robotType?: string;
  imported: boolean;
}

function HubTable({ rows, onPreview, disabled, caption }: {
  rows: HubRow[];
  onPreview: (repoId: string) => void;
  disabled: boolean;
  caption: string;
}) {
  const columns: DataTableColumn<HubRow>[] = [
    {
      key: 'title',
      header: 'Dataset',
      cell: (r) => (
        <div className="flex min-w-0 max-w-[22rem] flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-medium text-ink-primary">{r.title}</span>
            {r.imported && <StatusTag tone="success" size="sm">Imported</StatusTag>}
          </span>
          <span className="truncate text-[13px] text-ink-tertiary" title={r.detail}>{r.detail}</span>
        </div>
      ),
    },
    { key: 'robotType', header: 'Robot', hideBelow: 'sm', cell: (r) => r.robotType ?? '—' },
    {
      key: 'action',
      header: <span className="sr-only">Action</span>,
      align: 'right',
      cell: (r) => (
        <Button size="sm" variant="secondary" disabled={disabled || r.imported} onClick={() => onPreview(r.repoId)}>
          {r.imported ? 'Imported' : 'Preview'}
        </Button>
      ),
    },
  ];
  return (
    <Panel padding="none" className="max-h-96 overflow-y-auto">
      <DataTable caption={caption} dense columns={columns} rows={rows} getRowId={(r) => r.repoId} />
    </Panel>
  );
}

