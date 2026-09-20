/** @file ResearchPage.tsx @description Research publication history, outcomes and evidence. @feature research @status live */
import { memo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BookOpen, RefreshCw } from 'lucide-react';
import {
  Button, DataTable, EmptyState, ErrorState, FormField, Input,
  PageHeader, Panel, SearchInput, Select, Skeleton, StatusTag, focusRing, type DataTableColumn,
} from '@/shared/components/ui';
import { useResearch } from '../hooks/useResearch';
import { ResearchDetail } from '../components/ResearchDetail';
import { campaignLink, kindLabel, kinds, narrative, recordLink, recordStatus } from '../utils/presentation';
import type { ResearchRecord } from '../types/research.types';

function PublicationStatus({ record }: { record: ResearchRecord }) {
  const status = recordStatus(record);
  return status ? <StatusTag status={status} /> : <span className="text-xs text-ink-muted">Published</span>;
}

export const ResearchPage = memo(function ResearchPage() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [revision, setRevision] = useState(0);
  const query = params.toString();
  const apiParams = new URLSearchParams(params);
  apiParams.delete('q');
  const search = params.get('q') ?? '';
  const { list, record, loading, error } = useResearch(id, apiParams.toString(), revision);
  const retry = () => setRevision((value) => value + 1);
  const filter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = new URLSearchParams(params);
    next.delete('page');
    for (const key of ['kind', 'campaignId', 'datasetId']) {
      const value = String(data.get(key) ?? '').trim();
      if (value) next.set(key, value); else next.delete(key);
    }
    setParams(next);
  };
  const rows = (list?.records ?? []).filter((item) => [item.title, item.author.name, item.campaignId, item.id, narrative(item)].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase()));
  const columns: DataTableColumn<ResearchRecord>[] = [
    { key: 'title', header: 'Publication', cell: (row) => <div className="min-w-0 space-y-1.5">
      <p className="text-xs font-normal text-ink-muted">{kindLabel(row.kind)}</p>
      <Link className={`break-words text-ink-primary hover:text-primary hover:underline ${focusRing}`} to={recordLink(row.id, query)}>{row.title}</Link>
      {narrative(row) && <p className="line-clamp-2 max-w-[65ch] text-xs font-normal leading-relaxed text-ink-tertiary">{narrative(row)}</p>}
      <p className="text-xs font-normal text-ink-muted">{row.evidence.length} evidence {row.evidence.length === 1 ? 'file' : 'files'}</p>
      <div className="sm:hidden"><PublicationStatus record={row} /></div>
    </div> },
    { key: 'status', header: 'Recorded state', cell: (row) => <PublicationStatus record={row} />, hideBelow: 'sm' },
    { key: 'campaignId', header: 'Campaign', cell: (row) => <Link className={`break-all text-primary hover:underline ${focusRing}`} to={campaignLink(row.campaignId)}>{row.campaignId}</Link>, hideBelow: 'lg', className: 'max-w-56' },
    { key: 'author', header: 'Published by', cell: (row) => <div className="space-y-1"><p>{row.author.name}</p><time dateTime={row.createdAt} className="text-xs text-ink-muted">{new Date(row.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time></div>, hideBelow: 'md' },
  ];
  return <div className="min-w-0 space-y-6">
    <PageHeader eyebrow="Build" title={record?.title ?? (id ? 'Research publication' : 'Research')}
      description={id ? 'Follow the reasoning, inspect the outcome and trace its evidence.' : 'From hypothesis to evidence. Explore what your researchers proposed, tested and learned.'}
      meta={record ? <PublicationStatus record={record} /> : undefined}
      back={id ? { to: `/research${query ? `?${query}` : ''}`, label: 'Research' } : undefined}
      actions={<Button variant="secondary" onClick={retry} disabled={loading} leftIcon={<RefreshCw className="h-4 w-4" />}>Refresh</Button>} />
    {!id && <>
      <Panel><form key={apiParams.toString()} onSubmit={filter} className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_auto]">
        <FormField label="Publication type"><Select name="kind" defaultValue={params.get('kind') ?? ''} placeholder="All types" options={kinds} /></FormField>
        <FormField label="Campaign"><Input name="campaignId" defaultValue={params.get('campaignId') ?? ''} placeholder="Campaign ID" /></FormField>
        <FormField label="Dataset"><Input name="datasetId" defaultValue={params.get('datasetId') ?? ''} placeholder="Dataset ID" /></FormField>
        <div className="flex flex-wrap gap-2"><Button type="submit" variant="secondary">Apply filters</Button>{params.size > 0 && <Button variant="ghost" onClick={() => setParams({})}>Clear filters</Button>}</div>
      </form></Panel>
      <Panel padding="none">
        <Panel.Header title="Publications" description={list ? `${list.pagination.total} matching publications · newest first · immutable history` : 'Ideas, experiments, reports and dataset assessments.'}
          actions={<SearchInput value={search} placeholder="Search this page" className="sm:w-64" onChange={(value) => { const next = new URLSearchParams(params); if (value) next.set('q', value); else next.delete('q'); setParams(next, { replace: true }); }} />} />
        {search && list && <p role="status" className="px-5 pt-3 text-xs text-ink-tertiary">{rows.length} of {list.records.length} publications on this page match. Search applies to the current page only.</p>}
        <DataTable columns={columns} rows={rows} getRowId={(row) => row.id} isLoading={loading}
          caption="Research publications, newest first" error={error} onRetry={retry} onRowClick={(row) => navigate(recordLink(row.id, query))}
          empty={<EmptyState icon={<BookOpen />} title={params.size ? 'No research matches' : 'No research yet'} description={params.size ? 'Try another filter or clear the current search.' : 'Ideas, training results and reports will appear when a researcher publishes them.'} action={params.size ? <Button variant="secondary" onClick={() => setParams({})}>Clear filters</Button> : undefined} />}
          pagination={list ? { ...list.pagination, onPageChange: (page) => { const next = new URLSearchParams(params); next.set('page', String(page)); setParams(next); }, noun: 'publication', showSinglePage: true } : undefined} />
      </Panel>
    </>}
    {id && (error ? <ErrorState title="Couldn't load publication" message={error} onRetry={retry} /> : loading ? <Skeleton className="h-64" /> : record ? <ResearchDetail record={record} query={query} /> : null)}
  </div>;
});
