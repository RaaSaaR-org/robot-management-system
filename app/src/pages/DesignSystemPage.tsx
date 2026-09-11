/**
 * @file DesignSystemPage.tsx
 * @description Dev-only /design-system: every kit primitive in every variant
 *              and state, plus the full CRUD list pattern. Doubles as the
 *              visual-regression page reviewers screenshot in dark and light.
 * @feature shared
 */

import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  BatteryCharging,
  Bot,
  ChevronDown,
  Copy,
  Download,
  FileText,
  LayoutGrid,
  List,
  MapPin,
  Package,
  Pencil,
  Plus,
  Route,
  Search,
  Settings2,
  Trash2,
  Zap,
} from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  ConfirmHost,
  DataTable,
  Divider,
  DropdownMenu,
  EmptyState,
  ErrorState,
  Eyebrow,
  FormField,
  FormModal,
  InfoIcon,
  Input,
  KeyValueList,
  LinkButton,
  Modal,
  NextStepBanner,
  PageHeader,
  PageLoader,
  Panel,
  PipelineBreadcrumb,
  ProgressBar,
  RowActions,
  SearchInput,
  SegmentedControl,
  Select,
  Skeleton,
  SkeletonRows,
  SkeletonText,
  Spinner,
  StatRow,
  StatTile,
  StatusTag,
  Switch,
  Tabs,
  Textarea,
  ToggleChip,
  Toaster,
  Toolbar,
  Tooltip,
  chartColors,
  chartTheme,
  confirm,
  statusTone,
  toast,
  type DataTableColumn,
  type StatusTagTone,
} from '@/shared/components/ui';

// ============================================================================
// DEMO DATA
// ============================================================================

interface DemoRobot {
  id: string;
  name: string;
  model: string;
  status: string;
  battery: number;
  site: string;
  lastSeenMin: number;
}

const INITIAL_ROBOTS: DemoRobot[] = [
  { id: 'g1-01', name: 'Atlas', model: 'Unitree G1 EDU', status: 'online', battery: 86, site: 'Hall 3', lastSeenMin: 0 },
  { id: 'g1-02', name: 'Bruno', model: 'Unitree G1', status: 'charging', battery: 18, site: 'Dock A', lastSeenMin: 2 },
  { id: 'g1-03', name: 'Clara', model: 'Unitree G1 EDU', status: 'busy', battery: 64, site: 'Warehouse A', lastSeenMin: 0 },
  { id: 'h1-01', name: 'Dora', model: 'Unitree H1', status: 'offline', battery: 0, site: 'Lab', lastSeenMin: 1440 },
  { id: 'so-01', name: 'Emil', model: 'SO-101 arm', status: 'e-stop', battery: 100, site: 'Bench 2', lastSeenMin: 5 },
  { id: 'g1-04', name: 'Fritz', model: 'Unitree G1', status: 'degraded', battery: 41, site: 'Hall 3', lastSeenMin: 12 },
  { id: 'g1-05', name: 'Greta', model: 'Unitree G1 EDU', status: 'idle', battery: 97, site: 'Dock A', lastSeenMin: 1 },
];

const MODEL_OPTIONS = [
  { value: 'Unitree G1 EDU', label: 'Unitree G1 EDU' },
  { value: 'Unitree G1', label: 'Unitree G1' },
  { value: 'Unitree H1', label: 'Unitree H1' },
  { value: 'SO-101 arm', label: 'SO-101 arm' },
];

const STATUS_FILTERS = [
  { value: 'online', label: 'Online' },
  { value: 'busy', label: 'Busy' },
  { value: 'charging', label: 'Charging' },
  { value: 'degraded', label: 'Degraded' },
  { value: 'offline', label: 'Offline' },
  { value: 'e-stop', label: 'E-stop' },
];

const CHART_DATA = Array.from({ length: 12 }, (_, i) => ({
  t: `${String(8 + i).padStart(2, '0')}:00`,
  atlas: Math.round(90 - i * 4 + Math.sin(i) * 3),
  clara: Math.round(70 - i * 2.5 + Math.cos(i) * 4),
  bruno: Math.round(20 + i * 6),
}));

function formatLastSeen(min: number): string {
  if (min === 0) return 'Just now';
  if (min < 60) return `${min} min ago`;
  return `${Math.round(min / 60)} h ago`;
}

// ============================================================================
// LAYOUT HELPERS
// ============================================================================

function Section({
  id,
  title,
  description,
  actions,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Panel as="section" id={id} aria-labelledby={`${id}-title`}>
      <Panel.Header title={<span id={`${id}-title`}>{title}</span>} description={description} actions={actions} />
      <Panel.Body className="flex flex-col gap-6">{children}</Panel.Body>
    </Panel>
  );
}

function Demo({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Eyebrow>{label}</Eyebrow>
      <div className={className ?? 'flex flex-wrap items-center gap-3'}>{children}</div>
    </div>
  );
}

function Swatch({ name, token, utility, border }: { name: string; token: string; utility: string; border?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        className="h-9 w-9 shrink-0 rounded-control border border-line"
        style={{ background: `var(${token})`, borderColor: border ? `var(${token})` : undefined }}
      />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-ink-primary">{name}</span>
        <code className="block truncate font-mono text-xs text-ink-tertiary">{utility}</code>
      </span>
    </div>
  );
}

const ALL_TONES: StatusTagTone[] = ['success', 'info', 'warning', 'danger', 'neutral', 'accent', 'live', 'sim', 'gated', 'stopped'];
const SAMPLE_STATUSES = ['online', 'in_progress', 'pending_review', 'failed', 'E-Stop', 'archived', 'something-new'];

// ============================================================================
// PAGE
// ============================================================================

export function DesignSystemPage() {
  // List pattern state
  const [robots, setRobots] = useState<DemoRobot[]>(INITIAL_ROBOTS);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [view, setView] = useState<'table' | 'grid'>('table');

  // Form modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DemoRobot | null>(null);
  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [notes, setNotes] = useState('');
  const [autoDock, setAutoDock] = useState(true);
  const [nameError, setNameError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  // Other overlays
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DemoRobot | null>(null);

  // Controls
  const [tab, setTab] = useState('overview');
  const [range, setRange] = useState<'1h' | '24h' | '7d'>('24h');
  const [chips, setChips] = useState({ model: true, clip: false, lidar: true });
  const [checked, setChecked] = useState(true);
  const [switchOn, setSwitchOn] = useState(true);
  const [search, setSearch] = useState('hall');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return robots.filter(
      (r) =>
        (!statusFilter || r.status === statusFilter) &&
        (!q || [r.name, r.model, r.site].some((v) => v.toLowerCase().includes(q))),
    );
  }, [robots, query, statusFilter]);

  const openCreate = () => {
    setEditing(null);
    setName('');
    setModel('');
    setNotes('');
    setNameError(undefined);
    setFormError(undefined);
    setFormOpen(true);
  };

  const openEdit = (robot: DemoRobot) => {
    setEditing(robot);
    setName(robot.name);
    setModel(robot.model);
    setNotes('');
    setNameError(undefined);
    setFormError(undefined);
    setFormOpen(true);
  };

  const handleSubmit = async (_event: FormEvent<HTMLFormElement>) => {
    setFormError(undefined);
    if (!name.trim()) {
      setNameError('Give the robot a name.');
      return;
    }
    setNameError(undefined);
    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 700));
    setSubmitting(false);
    if (name.trim().toLowerCase() === 'fail') {
      setFormError("Couldn't save the robot: the server said the name is taken.");
      return;
    }
    if (editing) {
      setRobots((rs) => rs.map((r) => (r.id === editing.id ? { ...r, name: name.trim(), model: model || r.model } : r)));
      toast.success('Robot updated', { description: name.trim() });
    } else {
      setRobots((rs) => [
        ...rs,
        {
          id: `new-${Date.now()}`,
          name: name.trim(),
          model: model || 'Unitree G1',
          status: 'idle',
          battery: 100,
          site: 'Dock A',
          lastSeenMin: 0,
        },
      ]);
      toast.success('Robot created', { description: `${name.trim()} is idle at Dock A.` });
    }
    setFormOpen(false);
  };

  const askDelete = async (robot: DemoRobot) => {
    const ok = await confirm({
      title: `Delete ${robot.name}?`,
      description: 'The robot leaves the fleet and its schedules stop. Recorded episodes are kept.',
      tone: 'danger',
    });
    if (!ok) return;
    setRobots((rs) => rs.filter((r) => r.id !== robot.id));
    toast.success('Robot deleted', { description: robot.name });
  };

  const rowActions = (robot: DemoRobot) => [
    { label: 'Edit', icon: <Pencil />, onSelect: () => openEdit(robot) },
    { label: 'Duplicate', icon: <Copy />, onSelect: () => toast.info(`Duplicated ${robot.name}`) },
    { label: 'Delete', icon: <Trash2 />, tone: 'danger' as const, separatorBefore: true, onSelect: () => void askDelete(robot) },
  ];

  const columns: DataTableColumn<DemoRobot>[] = [
    { key: 'name', header: 'Name', sortable: true },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      cell: (r) => <StatusTag status={r.status} dot pulse={r.status === 'busy'} />,
    },
    { key: 'model', header: 'Model', sortable: true, hideBelow: 'md' },
    { key: 'site', header: 'Site', sortable: true, hideBelow: 'sm' },
    {
      key: 'battery',
      header: 'Battery',
      align: 'right',
      sortable: true,
      cell: (r) => (
        <span className="inline-flex items-center justify-end gap-2">
          <span className="w-9 text-right">{r.battery}%</span>
          <ProgressBar
            value={r.battery}
            showValue={false}
            size="sm"
            variant={r.battery < 20 ? 'warning' : 'default'}
            className="hidden w-14 lg:block"
          />
        </span>
      ),
    },
    {
      key: 'lastSeenMin',
      header: 'Last seen',
      align: 'right',
      sortable: true,
      hideBelow: 'lg',
      cell: (r) => formatLastSeen(r.lastSeenMin),
    },
  ];

  const clearFilters = () => {
    setQuery('');
    setStatusFilter('');
  };

  return (
    <div className="flex flex-col gap-6">
      {/* The shell mounts these too; extra instances render nothing. */}
      <Toaster />
      <ConfirmHost />

      <PageHeader
        eyebrow="System"
        title="Design system"
        description="Every primitive of the NeoDEM kit in every variant and state — the reference pages are built from, and the page reviewers screenshot in dark and light."
        meta={<StatusTag tone="accent">Dev only</StatusTag>}
        actions={
          <>
            <LinkButton to="/" variant="ghost">
              View landing
            </LinkButton>
            <Button variant="secondary" leftIcon={<Download className="h-4 w-4" />} onClick={() => toast('Nothing to export here')}>
              Export
            </Button>
            <Button leftIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>
              New robot
            </Button>
          </>
        }
      >
        <PipelineBreadcrumb stage="train" />
      </PageHeader>

      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'robots', label: 'Robots', count: robots.length },
          { id: 'activity', label: 'Activity', count: 3 },
          { id: 'settings', label: 'Settings' },
          { id: 'archived', label: 'Archived', disabled: true },
        ]}
        activeTab={tab}
        onTabChange={setTab}
        label="Page sections"
      />

      <StatRow>
        <StatTile label="Robots online" value={robots.filter((r) => statusTone(r.status) === 'success').length} unit={`/ ${robots.length}`} hint="Measured 2 s ago" tone="live" icon={<Bot />} />
        <StatTile label="Fleet battery" value={71} unit="%" progress={71} icon={<BatteryCharging />} hint="2 charging" />
        <StatTile label="Open incidents" value={3} tone="warning" trend={{ value: '+1 today', direction: 'up', sentiment: 'negative' }} icon={<Activity />} />
        <StatTile label="Success rate" value="94.2" unit="%" trend={{ value: '+2.1 pts', direction: 'up', sentiment: 'positive' }} icon={<Zap />} />
        <StatTile label="Episodes" value="—" isLoading hint="Loading…" />
      </StatRow>

      {/* ── List pattern ─────────────────────────────────────────────── */}
      <section aria-labelledby="list-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <Eyebrow dash>CRUD pattern</Eyebrow>
            <h2 id="list-title" className="mt-2 font-display text-base font-semibold tracking-[-0.01em] text-ink-primary">
              Robots
            </h2>
          </div>
          <p className="text-[13px] text-ink-tertiary">Row click → toast · kebab → Edit / Duplicate / Delete · name “fail” → form error</p>
        </div>
        <Toolbar
          search={<SearchInput value={query} onChange={setQuery} placeholder="Search robots" />}
          filters={
            <Select
              aria-label="Status"
              fullWidth={false}
              className="w-40"
              placeholder="All statuses"
              options={STATUS_FILTERS}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            />
          }
          actions={
            <SegmentedControl
              label="View"
              value={view}
              onChange={setView}
              options={[
                { value: 'table', label: <><List aria-hidden="true" /> Table</> },
                { value: 'grid', label: <><LayoutGrid aria-hidden="true" /> Grid</> },
              ]}
            />
          }
        />
        {view === 'table' ? (
          <Panel padding="none">
            <DataTable
              caption="Robots"
              columns={columns}
              rows={filtered}
              getRowId={(r) => r.id}
              defaultSort={{ key: 'name', direction: 'asc' }}
              onRowClick={(r) => toast(`Open ${r.name}`, { description: 'A detail page would open here.' })}
              rowActions={rowActions}
              rowActionsLabel={(r) => `Actions for ${r.name}`}
              empty={
                robots.length === 0 ? (
                  <EmptyState
                    icon={<Bot />}
                    title="No robots yet"
                    description="Robots appear here once they register with the server."
                    action={<Button leftIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>New robot</Button>}
                  />
                ) : (
                  <EmptyState
                    icon={<Search />}
                    title="No robots match"
                    description="Try another name, or clear the filters."
                    action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>}
                  />
                )
              }
            />
          </Panel>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((r) => (
              <Panel key={r.id} interactive onClick={() => toast(`Open ${r.name}`)} padding="sm" className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-ink-primary">{r.name}</div>
                    <div className="truncate text-[13px] text-ink-tertiary">{r.model}</div>
                  </div>
                  <RowActions items={rowActions(r)} label={`Actions for ${r.name}`} />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <StatusTag status={r.status} dot />
                  <span className="inline-flex items-center gap-1 text-xs text-ink-tertiary">
                    <MapPin className="h-3.5 w-3.5" aria-hidden="true" /> {r.site}
                  </span>
                </div>
                <ProgressBar value={r.battery} label="Battery" size="sm" variant={r.battery < 20 ? 'warning' : 'default'} />
              </Panel>
            ))}
          </div>
        )}
      </section>

      <Section id="table-states" title="Table states" description="Loading shows skeleton rows, errors replace the table with Retry, empty shows the page's empty state.">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel padding="none">
            <DataTable caption="Loading example" columns={columns.slice(0, 3)} rows={[]} getRowId={(r) => r.id} isLoading skeletonRows={4} dense />
          </Panel>
          <Panel padding="none">
            <DataTable
              caption="Error example"
              columns={columns.slice(0, 3)}
              rows={[]}
              getRowId={(r) => r.id}
              error="The server did not answer within 10 s."
              errorTitle="Couldn't load robots"
              onRetry={() => toast.info('Retrying…')}
            />
          </Panel>
          <Panel padding="none">
            <DataTable
              caption="Empty example"
              columns={columns.slice(0, 3)}
              rows={[]}
              getRowId={(r) => r.id}
              empty={<EmptyState icon={<Route />} title="No routes yet" description="A route is the path a robot walks on patrol." action={<Button size="sm" leftIcon={<Plus className="h-4 w-4" />}>New route</Button>} />}
            />
          </Panel>
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* ── Buttons ─────────────────────────────────────────────── */}
        <Section id="buttons" title="Buttons" description="One primary per view, right-most. Everything else secondary or ghost; danger only for destructive acts.">
          <Demo label="Variants">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
          </Demo>
          <Demo label="Sizes — sm 32 · md 38 · lg 44">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
            <Button size="sm" variant="secondary">Small</Button>
            <Button size="lg" variant="secondary">Large</Button>
          </Demo>
          <Demo label="Icons, icon-only, loading, disabled">
            <Button leftIcon={<Plus className="h-4 w-4" />}>New route</Button>
            <Button variant="secondary" rightIcon={<ChevronDown className="h-4 w-4" />}>Export</Button>
            <Button variant="ghost" iconOnly aria-label="Settings"><Settings2 className="h-4 w-4" /></Button>
            <Button variant="secondary" iconOnly size="sm" aria-label="Edit"><Pencil className="h-4 w-4" /></Button>
            <Button isLoading loadingText="Saving…">Save</Button>
            <Button variant="secondary" isLoading>Sync</Button>
            <Button disabled>Disabled</Button>
            <Button variant="secondary" disabled>Disabled</Button>
          </Demo>
          <Demo label="Legacy names and LinkButton">
            <Button variant="outline">Outline</Button>
            <Button variant="destructive">Destructive</Button>
            <LinkButton to="/fleet" variant="secondary">Open fleet</LinkButton>
            <LinkButton to="/docs" variant="ghost" size="sm">Read the docs</LinkButton>
          </Demo>
          <Demo label="Full width" className="flex flex-col gap-2">
            <Button fullWidth>Start recording</Button>
          </Demo>
        </Section>

        {/* ── Status ─────────────────────────────────────────────── */}
        <Section id="status" title="Status" description="StatusTag is the only way to show a state. Amber means unknown, never a fault; red means stopped.">
          <Demo label="Tones">
            {ALL_TONES.map((tone) => (
              <StatusTag key={tone} tone={tone}>{tone}</StatusTag>
            ))}
          </Demo>
          <Demo label="Dot, pulse, small">
            <StatusTag tone="live" dot pulse>Live</StatusTag>
            <StatusTag tone="sim" dot>Sim</StatusTag>
            <StatusTag tone="gated" dot>Gated</StatusTag>
            <StatusTag tone="stopped" dot>Stopped</StatusTag>
            <StatusTag tone="live" size="sm">Live</StatusTag>
            <StatusTag tone="sim" size="sm">Sim</StatusTag>
          </Demo>
          <Demo label="From a status string — statusTone()">
            {SAMPLE_STATUSES.map((s) => (
              <StatusTag key={s} status={s} dot />
            ))}
          </Demo>
          <Demo label="Badge (counts and labels)">
            <Badge>Default</Badge>
            <Badge variant="success">Success</Badge>
            <Badge variant="warning">Warning</Badge>
            <Badge variant="error">Error</Badge>
            <Badge variant="info">Info</Badge>
            <Badge variant="accent">Accent</Badge>
            <Badge variant="cobalt" pill>12</Badge>
            <Badge variant="purple" dot>Beta</Badge>
            <Badge variant="success" dot dotPulse size="sm">Streaming</Badge>
            <Badge variant="default" size="lg">Large</Badge>
          </Demo>
        </Section>
      </div>

      {/* ── Surfaces ─────────────────────────────────────────────── */}
      <Section id="surfaces" title="Surfaces" description="Content sits in panels on the canvas. A panel inside a panel is inset. Highlight is the landing's gradient panel, for the one thing that matters most.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Panel>
            <Eyebrow>Default</Eyebrow>
            <p className="mt-2 text-sm text-ink-secondary">bg-panel, hairline border, 14px radius.</p>
            <Panel variant="inset" padding="sm" className="mt-4">
              <Eyebrow>Inset</Eyebrow>
              <p className="mt-1.5 text-[13px] text-ink-tertiary">A well inside a panel.</p>
            </Panel>
          </Panel>
          <Panel variant="highlight">
            <Eyebrow dash>Highlight</Eyebrow>
            <p className="mt-2 font-display text-[26px] font-semibold tracking-[-0.02em] text-ink-primary">G1 policy v7</p>
            <p className="mt-1 text-sm text-ink-secondary">Deployed to 12 robots · 94% success.</p>
          </Panel>
          <Panel interactive onClick={() => toast('Panel clicked')} aria-label="Interactive panel example">
            <Eyebrow>Interactive</Eyebrow>
            <p className="mt-2 text-sm text-ink-secondary">Hover border, pointer, focusable, Enter activates.</p>
          </Panel>
        </div>

        <Panel>
          <Panel.Header
            eyebrow="Panel sections"
            title="Atlas"
            description="Panel.Header with eyebrow, description and actions; Panel.Body; Panel.Footer."
            actions={
              <>
                <Button size="sm" variant="secondary" leftIcon={<Pencil className="h-3.5 w-3.5" />}>Edit</Button>
                <RowActions items={rowActions(INITIAL_ROBOTS[0])} />
              </>
            }
          />
          <Panel.Body>
            <KeyValueList
              columns={3}
              items={[
                { label: 'Model', value: 'Unitree G1 EDU + Dex3-1' },
                { label: 'Status', value: <StatusTag status="online" dot /> },
                { label: 'Serial', value: 'G1E-2026-00417', mono: true },
                { label: 'Site', value: 'Hall 3' },
                { label: 'Firmware', value: '1.4.2' },
                { label: 'Operator', value: null },
              ]}
            />
          </Panel.Body>
          <Panel.Footer>
            <Button variant="ghost" size="sm">Cancel</Button>
            <Button size="sm">Save changes</Button>
          </Panel.Footer>
        </Panel>

        <Demo label="Legacy Card variants (render as panels)" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card><p className="text-sm text-ink-secondary">default / glass / elevated</p></Card>
          <Card variant="subtle" className="p-4"><p className="text-sm text-ink-secondary">subtle → inset</p></Card>
          <Card variant="outlined"><p className="text-sm text-ink-secondary">outlined</p></Card>
          <Card>
            <Card.Header>Card.Header</Card.Header>
            <Card.Body><p className="text-sm text-ink-secondary">Card.Body</p></Card.Body>
          </Card>
        </Demo>
      </Section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* ── Forms ─────────────────────────────────────────────── */}
        <Section id="forms" title="Forms" description="FormField lays out label, control, hint and error. Controls share one field look.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Name" required hint="Shown on the fleet map.">
              <Input placeholder="e.g. Atlas" />
            </FormField>
            <FormField label="Site" error="Choose a site the robot can reach.">
              <Select placeholder="Choose a site…" options={[{ value: 'hall3', label: 'Hall 3' }, { value: 'dock', label: 'Dock A' }]} defaultValue="" />
            </FormField>
            <FormField label="Serial" aside="Optional">
              <Input leftIcon={<Package />} placeholder="G1E-…" />
            </FormField>
            <FormField label="Disabled">
              <Input value="Read only" disabled readOnly />
            </FormField>
            <FormField label="Notes" className="sm:col-span-2" hint="Markdown is not rendered.">
              <Textarea rows={3} placeholder="Anything the operator should know" />
            </FormField>
          </div>
          <Demo label="Search and sizes" className="flex flex-col gap-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Search sites" />
            <div className="flex flex-wrap items-center gap-2">
              <Input size="sm" placeholder="Small 32" />
              <Input size="md" placeholder="Medium 38" />
              <Input size="lg" placeholder="Large 44" />
            </div>
          </Demo>
          <Demo label="Checkbox and switch" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-3">
              <Checkbox label="Notify me when it finishes" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              <Checkbox label="Keep raw episodes" description="Uses about 2 GB per hour." />
              <Checkbox label="Disabled option" disabled />
              <Checkbox label="Invalid" invalid />
            </div>
            <div className="flex flex-col gap-3">
              <Switch label="Auto-dock when idle" checked={switchOn} onCheckedChange={setSwitchOn} />
              <Switch label="Record video" description="Front camera, 12 fps." checked={!switchOn} onCheckedChange={(v) => setSwitchOn(!v)} />
              <Switch label="Small switch" size="sm" checked={switchOn} onCheckedChange={setSwitchOn} />
              <Switch label="Disabled" checked={false} onCheckedChange={() => {}} disabled />
            </div>
          </Demo>
        </Section>

        {/* ── Navigation & controls ─────────────────────────────────── */}
        <Section id="navigation" title="Navigation and controls">
          <Demo label="Tabs — underline, with icons and counts" className="block">
            <Tabs
              tabs={[
                { id: 't', label: 'Telemetry', icon: <Activity />, content: <p className="text-sm text-ink-secondary">Telemetry panel content.</p> },
                { id: 'c', label: 'Commands', count: 4, content: <p className="text-sm text-ink-secondary">Commands panel content.</p> },
                { id: 'i', label: 'Info', content: <p className="text-sm text-ink-secondary">Info panel content.</p> },
              ]}
            />
          </Demo>
          <Demo label="Tabs — pills">
            <Tabs
              variant="pills"
              tabs={[
                { id: 'day', label: 'Day', content: null },
                { id: 'week', label: 'Week', content: null },
                { id: 'month', label: 'Month', content: null },
              ]}
            />
          </Demo>
          <Demo label="Segmented control">
            <SegmentedControl
              label="Range"
              value={range}
              onChange={setRange}
              options={[{ value: '1h', label: '1 h' }, { value: '24h', label: '24 h' }, { value: '7d', label: '7 days' }]}
            />
            <SegmentedControl
              label="Range (small)"
              size="sm"
              value={range}
              onChange={setRange}
              options={[{ value: '1h', label: '1 h' }, { value: '24h', label: '24 h' }, { value: '7d', label: '7 days' }]}
            />
          </Demo>
          <Demo label="Toggle chips">
            <ToggleChip active={chips.model} onClick={() => setChips((c) => ({ ...c, model: !c.model }))}>
              <Bot /> Robot model
            </ToggleChip>
            <ToggleChip active={chips.clip} onClick={() => setChips((c) => ({ ...c, clip: !c.clip }))}>Clip room</ToggleChip>
            <ToggleChip active={chips.lidar} size="md" onClick={() => setChips((c) => ({ ...c, lidar: !c.lidar }))}>LiDAR</ToggleChip>
            <ToggleChip active={false} onClick={() => {}} disabled>Disabled</ToggleChip>
          </Demo>
          <Demo label="Eyebrow and divider" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-6">
              <Eyebrow dash>Operate</Eyebrow>
              <Eyebrow>Plain eyebrow</Eyebrow>
              <div className="flex h-6 items-center gap-3 text-[13px] text-ink-tertiary">
                Left <Divider orientation="vertical" /> Right
              </div>
            </div>
            <Divider />
            <Divider label="Advanced" />
          </Demo>
          <Demo label="Next step banner" className="flex flex-col gap-3">
            <NextStepBanner icon={<FileText />} title="Done collecting demos?" description="Turn the episodes into a dataset for training." ctaLabel="Open datasets" ctaHref="/datasets" />
            <NextStepBanner variant="subtle" title="Ready to deploy?" description="Roll the policy out to a canary robot first." ctaLabel="Deployments" ctaHref="/deployments" />
          </Demo>
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* ── Overlays ─────────────────────────────────────────────── */}
        <Section id="overlays" title="Overlays" description="Dialogs trap focus, close on Esc and return focus. Below 640px they become bottom sheets.">
          <Demo label="Dialogs">
            <Button variant="secondary" onClick={() => setModalOpen(true)}>Open modal</Button>
            <Button variant="secondary" onClick={openCreate}>Open form modal</Button>
            <Button variant="secondary" onClick={() => setPendingDelete(INITIAL_ROBOTS[3])}>Open confirm dialog</Button>
            <Button
              variant="secondary"
              onClick={async () => {
                const ok = await confirm({ title: 'Start the patrol now?', description: 'Atlas leaves Dock A and walks route “Night round”.', confirmLabel: 'Start patrol' });
                toast(ok ? 'Patrol started' : 'Cancelled', { tone: ok ? 'success' : 'neutral' });
              }}
            >
              await confirm()
            </Button>
          </Demo>
          <Demo label="Menus">
            <DropdownMenu
              align="start"
              label="Export"
              trigger={<Button variant="secondary" rightIcon={<ChevronDown className="h-4 w-4" />}>Export</Button>}
              items={[
                { label: 'CSV', icon: <FileText />, onSelect: () => toast('Exported CSV') },
                { label: 'LeRobot dataset', icon: <Package />, onSelect: () => toast('Exported dataset') },
                { label: 'Unavailable format', icon: <Copy />, disabled: true, onSelect: () => {} },
              ]}
            />
            <RowActions items={rowActions(INITIAL_ROBOTS[1])} label="Actions for Bruno" />
          </Demo>
          <Demo label="Tooltip and info icon">
            <Tooltip content="Measured at the robot, 2 s ago.">
              <StatusTag tone="live" dot>Live</StatusTag>
            </Tooltip>
            <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-secondary">
              Success rate <InfoIcon content="Share of the last 50 episodes that reached the goal without an intervention." />
            </span>
            <Tooltip content="Bottom tooltip" side="bottom">
              <Button variant="ghost" size="sm">Hover me</Button>
            </Tooltip>
          </Demo>
        </Section>

        {/* ── Toasts ─────────────────────────────────────────────── */}
        <Section id="toasts" title="Toasts" description="toast.success / error / info / warning from anywhere. 5 s, errors 8 s; hover pauses.">
          <Demo label="Tones">
            <Button variant="secondary" onClick={() => toast.success('Route created', { description: 'Night round · 6 stops' })}>Success</Button>
            <Button variant="secondary" onClick={() => toast.error("Couldn't delete route", { description: 'The server did not answer within 10 s.' })}>Error</Button>
            <Button variant="secondary" onClick={() => toast.warning('Battery below 20%', { description: 'Bruno heads back to Dock A.' })}>Warning</Button>
            <Button variant="secondary" onClick={() => toast.info('Sync started', { description: '1,204 episodes to upload.' })}>Info</Button>
            <Button variant="secondary" onClick={() => toast('Plain notification')}>Neutral</Button>
          </Demo>
          <Demo label="Action and sticky">
            <Button
              variant="secondary"
              onClick={() => toast.success('Robot archived', { action: { label: 'Undo', onClick: () => toast.info('Restored') } })}
            >
              With action
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                const id = toast.info('Uploading dataset…', { duration: null });
                setTimeout(() => toast.success('Dataset uploaded', { id }), 2000);
              }}
            >
              Progress → done
            </Button>
            <Button variant="ghost" onClick={() => toast.dismiss()}>Dismiss all</Button>
          </Demo>
        </Section>
      </div>

      {/* ── Feedback states ─────────────────────────────────────── */}
      <Section id="states" title="Empty, error, loading" description="Every list and panel has all three. Never a blank area.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Panel variant="inset" padding="none">
            <EmptyState
              icon={<Route />}
              title="No routes yet"
              description="A route is the path a robot walks on patrol."
              action={<Button size="sm" leftIcon={<Plus className="h-4 w-4" />}>New route</Button>}
              secondaryAction={<Button size="sm" variant="ghost">Import</Button>}
            />
          </Panel>
          <Panel variant="inset" padding="none">
            <ErrorState title="Couldn't load routes" message="Request failed with status 502." onRetry={() => toast.info('Retrying…')} />
          </Panel>
          <Panel variant="inset" className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-control" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3.5 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
            <SkeletonText lines={3} />
          </Panel>
        </div>
        <Panel variant="inset" padding="none">
          <SkeletonRows rows={3} columns={4} />
        </Panel>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Demo label="Progress" className="flex flex-col gap-4">
            <ProgressBar value={72} label="Upload" />
            <ProgressBar value={94} label="Success" variant="success" />
            <ProgressBar value={35} label="Estimate" variant="info" />
            <ProgressBar value={18} label="Battery" variant="warning" />
            <ProgressBar value={100} label="Failed checks" variant="error" size="sm" />
          </Demo>
          <Demo label="Spinner and page loader" className="flex flex-col gap-4">
            <div className="flex items-center gap-4 text-ink-secondary">
              <Spinner size="xs" />
              <Spinner size="sm" />
              <Spinner size="md" color="primary" />
              <Spinner size="lg" color="primary" />
              <span className="inline-flex items-center gap-2 text-[13px]"><Spinner size="sm" /> Connecting…</span>
            </div>
            <Panel variant="inset" padding="none">
              <PageLoader message="Loading page…" className="min-h-0 py-8" />
            </Panel>
          </Demo>
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* ── Charts ─────────────────────────────────────────────── */}
        <Section id="charts" title="Charts" description="Series colours and axis styling come from chartColors / chartTheme — no hex in feature code.">
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={CHART_DATA} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid {...chartTheme.grid} />
                <XAxis dataKey="t" {...chartTheme.xAxis} />
                <YAxis {...chartTheme.yAxis} />
                <ChartTooltip {...chartTheme.tooltip} />
                <Line type="monotone" dataKey="atlas" name="Atlas" stroke={chartColors.series[0]} strokeWidth={1.75} dot={false} />
                <Line type="monotone" dataKey="clara" name="Clara" stroke={chartColors.series[1]} strokeWidth={1.75} dot={false} />
                <Line type="monotone" dataKey="bruno" name="Bruno" stroke={chartColors.series[2]} strokeWidth={1.75} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-4">
            {chartColors.series.map((color, i) => (
              <span key={color} className="inline-flex items-center gap-2 text-[13px] text-ink-secondary">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} /> Series {i + 1}
              </span>
            ))}
          </div>
        </Section>

        {/* ── Tokens & type ─────────────────────────────────────────── */}
        <Section id="tokens" title="Tokens and type" description="Utilities, not hex. Archivo for titles and values, Inter for text, mono only for code.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Swatch name="Canvas" token="--bg-primary" utility="bg-canvas" />
            <Swatch name="Panel" token="--bg-secondary" utility="bg-panel" />
            <Swatch name="Inset" token="--bg-tertiary" utility="bg-inset" />
            <Swatch name="Raised" token="--bg-elevated" utility="bg-raised" />
            <Swatch name="Primary" token="--color-primary" utility="bg-primary / text-primary" border />
            <Swatch name="Accent" token="--color-accent" utility="text-accent" border />
            <Swatch name="Measured" token="--signal-measured" utility="text-signal-measured" border />
            <Swatch name="Estimated" token="--signal-estimated" utility="text-signal-estimated" border />
            <Swatch name="Unknown" token="--signal-unknown" utility="text-signal-unknown" border />
            <Swatch name="Stopped" token="--signal-stopped" utility="text-signal-stopped" border />
            <Swatch name="STOP fill" token="--signal-stopped-fill" utility="bg-stop" border />
            <Swatch name="Line strong" token="--border-color-strong" utility="border-line-strong" border />
          </div>
          <Divider />
          <div className="flex flex-col gap-3">
            <div className="font-display text-[28px] font-semibold leading-tight tracking-[-0.03em] text-ink-primary">Page title · Archivo 28</div>
            <div className="font-display text-base font-semibold tracking-[-0.01em] text-ink-primary">Panel title · Archivo 16</div>
            <div className="font-display text-[26px] font-semibold tabular-nums tracking-[-0.02em] text-ink-primary">1,204.5</div>
            <div className="text-sm font-semibold text-ink-primary">Sub-heading · Inter 14 / 600</div>
            <p className="max-w-[70ch] text-sm leading-relaxed text-ink-secondary">
              Body · Inter 14 / 1.55. Robots report what they measure; anything estimated says so, and anything unknown is amber, not red.
            </p>
            <p className="text-[13px] text-ink-tertiary">Small · 13 — meta, table cells</p>
            <p className="text-xs text-ink-muted">Caption · 12 — hints</p>
            <Eyebrow>Eyebrow · 11 uppercase</Eyebrow>
            <code className="w-fit rounded-tag bg-inset px-1.5 py-0.5 font-mono text-[13px] text-ink-secondary">roboctl move "Warehouse A"</code>
          </div>
        </Section>
      </div>

      {/* ── Overlay instances ─────────────────────────────────────── */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Run details"
        description="Night round · started 22:04 by schedule."
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Close</Button>
            <Button onClick={() => setModalOpen(false)}>Open run</Button>
          </>
        }
      >
        <KeyValueList
          columns={2}
          items={[
            { label: 'Robot', value: 'Atlas' },
            { label: 'Status', value: <StatusTag status="completed" dot /> },
            { label: 'Stops', value: '6 of 6' },
            { label: 'Findings', value: '2' },
            { label: 'Run ID', value: 'run_8f3a2c', mono: true },
          ]}
        />
      </Modal>

      <FormModal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'New robot'}
        description={editing ? undefined : 'Register a robot so it appears in the fleet.'}
        submitLabel={editing ? 'Save changes' : 'Create robot'}
        submittingLabel={editing ? 'Saving…' : 'Creating…'}
        isSubmitting={submitting}
        error={formError}
        onSubmit={handleSubmit}
        noValidate
      >
        <FormField label="Name" required error={nameError} hint="Type “fail” to see a form-level error.">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Atlas" />
        </FormField>
        <FormField label="Model">
          <Select placeholder="Choose a model…" options={MODEL_OPTIONS} value={model} onChange={(e) => setModel(e.target.value)} />
        </FormField>
        <FormField label="Notes" aside="Optional">
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
        <Switch label="Auto-dock when idle" checked={autoDock} onCheckedChange={setAutoDock} />
      </FormModal>

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          await new Promise((r) => setTimeout(r, 600));
          toast.success('Robot deleted', { description: pendingDelete?.name });
          setPendingDelete(null);
        }}
        title={`Delete ${pendingDelete?.name ?? ''}?`}
        description="The robot leaves the fleet and its schedules stop. Recorded episodes are kept."
        tone="danger"
      />
    </div>
  );
}
