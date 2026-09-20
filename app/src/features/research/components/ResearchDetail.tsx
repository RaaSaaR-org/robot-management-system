/** @file ResearchDetail.tsx @description Readable research narrative, lineage and artifact disclosures. @feature research */
import { memo } from 'react';
import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { KeyValueList, Panel, StatusTag, focusRing } from '@/shared/components/ui';
import { ResearchOutcome } from './ResearchOutcome';
import { campaignLink, kindLabel, narrative, number, object, readable, recordLink, strings, text } from '../utils/presentation';
import type { ResearchRecord } from '../types/research.types';

export const ResearchDetail = memo(function ResearchDetail({ record, query }: { record: ResearchRecord; query: string }) {
  const body = record.body;
  const proposal = object(body.proposal);
  const candidate = object(body.candidate);
  const datasetIds = record.datasetId ? [record.datasetId] : [...new Set(strings(candidate.datasetIds))];
  const expected = object(candidate.expected);
  const settings = object(expected.hyperparameters);
  const markdown = text(body.markdown) ?? text(body.reportMarkdown);
  const summary = narrative(record);
  const limitations = [...new Set([...strings(body.limitations), ...strings(proposal.limitations)])];
  const dimensions = Object.entries(object(body.dimensions));
  const linkClass = `break-all text-primary hover:underline ${focusRing}`;
  const sections = [
    ['Why this could work', text(body.mechanism) ?? text(proposal.mechanism)],
    ['Rationale', text(body.rationale) ?? text(proposal.rationale)],
    ['What would disprove it', text(body.falsification) ?? text(proposal.falsification)],
  ].filter((entry) => entry[1]);
  return <>
    {body.scope === 'training-integration-pilot' && <div className="flex flex-wrap items-center gap-3 rounded-control border border-line bg-inset px-4 py-3">
      <StatusTag tone="neutral">Training integration pilot</StatusTag>
      <p className="text-sm text-ink-secondary">{body.simulatorEvaluation === 'deferred' ? 'Simulation deferred. Robot performance remains unknown.' : 'Training integration evidence; see evaluation records for robot performance.'}</p>
    </div>}
    <ResearchOutcome body={body} />
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-6">
        {(markdown || summary || sections.length > 0) && <Panel as="article">
          <Panel.Header title={record.kind === 'idea' ? 'Research hypothesis' : 'Findings'} />
          <Panel.Body className="space-y-5">
            {markdown ? <div className="prose prose-sm max-w-none break-words text-ink-primary"><ReactMarkdown skipHtml components={{ h1: ({ children }) => <h3>{children}</h3>, h2: ({ children }) => <h3>{children}</h3> }}>{markdown}</ReactMarkdown></div>
              : summary && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-primary">{summary}</p>}
            {sections.map(([title, content]) => <section key={title}><h3 className="mb-2 text-sm font-semibold text-ink-primary">{title}</h3><p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-secondary">{content}</p></section>)}
          </Panel.Body>
        </Panel>}
        {Object.keys(expected).length > 0 && <Panel>
          <Panel.Header title="Training setup" description={text(candidate.title)} />
          <Panel.Body className="space-y-5">
            <KeyValueList items={[
              { label: 'Base model', value: text(expected.baseModel) }, { label: 'Training steps', value: number(expected.steps) },
              { label: 'GPUs', value: number(expected.gpuCount) }, { label: 'Candidate', value: text(candidate.id), mono: true },
            ]} />
            {Object.keys(settings).length > 0 && <details><summary className={`cursor-pointer text-sm text-primary ${focusRing}`}>Hyperparameters</summary><KeyValueList className="mt-4" items={Object.entries(settings).map(([key, value]) => ({ label: readable(key), value: typeof value === 'boolean' ? (value ? 'Enabled' : 'Disabled') : typeof value === 'number' || typeof value === 'string' ? String(value) : 'See full record' }))} /></details>}
          </Panel.Body>
        </Panel>}
        {dimensions.length > 0 && <Panel>
          <Panel.Header title="Dataset assessment" description={`Task: ${text(body.task) ?? 'Unknown'} · Model: ${text(body.model) ?? 'Unknown'}`} />
          <Panel.Body className="space-y-4">{dimensions.map(([name, value]) => {
            const dimension = object(value);
            return <div key={name}><p className="text-sm font-medium text-ink-primary">{name}: {number(dimension.score) !== undefined ? `${dimension.score}/100` : 'Unknown'}</p><p className="mt-1 text-sm text-ink-secondary">{text(dimension.rationale)}</p></div>;
          })}</Panel.Body>
        </Panel>}
        {limitations.length > 0 && <Panel>
          <Panel.Header title="Limitations" description="Boundaries recorded by the researcher." />
          <Panel.Body><ul className="list-disc space-y-2 pl-4 text-sm leading-relaxed text-ink-secondary">{limitations.map((item) => <li key={item}>{item}</li>)}</ul></Panel.Body>
        </Panel>}
        <Panel>
          <Panel.Header title={`Evidence · ${record.evidence.length}`} description="Locations and checksums supplied by the publisher; not independently verified by this page." />
          <Panel.Body className="space-y-2">{record.evidence.length === 0 ? <p className="text-sm text-ink-muted">No artifacts attached.</p> : record.evidence.map((item, index) => <details key={`${item.uri}-${index}`} className="rounded-control border border-line-subtle bg-inset px-3 py-2">
            <summary className={`cursor-pointer break-all text-sm text-ink-secondary ${focusRing}`}><FileText className="mr-2 inline h-4 w-4" aria-hidden="true" />{item.uri.split('/').filter(Boolean).slice(-1)[0] ?? item.uri}</summary>
            <div className="mt-3 space-y-2 break-all text-xs">
              {/^(https?):\/\//i.test(item.uri) ? <a href={item.uri} target="_blank" rel="noreferrer" className={linkClass}>{item.uri}</a> : <p className="text-ink-secondary">{item.uri}</p>}
              <p className="font-mono text-ink-muted">SHA-256: {item.sha256}</p>
            </div>
          </details>)}</Panel.Body>
        </Panel>
      </div>
      <Panel as="aside">
        <Panel.Header title="Publication details" />
        <Panel.Body><KeyValueList columns={1} items={[
          { label: 'Type', value: kindLabel(record.kind) },
          { label: 'Author', value: `${record.author.name} · ${record.author.kind === 'service' ? 'Agent' : 'Human'}` },
          { label: 'Published', value: <time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString()}</time> },
          { label: 'Campaign', value: <Link className={linkClass} to={campaignLink(record.campaignId)}>{record.campaignId}</Link> },
          ...(record.parentId ? [{ label: 'Parent publication', value: <Link className={linkClass} to={recordLink(record.parentId, query)}>{record.parentId}</Link> }] : []),
          ...(record.supersedesId ? [{ label: 'Corrects', value: <Link className={linkClass} to={recordLink(record.supersedesId, query)}>{record.supersedesId}</Link> }] : []),
          ...datasetIds.map((datasetId, index) => ({ label: datasetIds.length > 1 ? `Dataset ${index + 1}` : 'Dataset', value: <Link className={linkClass} to={`/datasets/${encodeURIComponent(datasetId)}/episodes`}>{datasetId}</Link> })),
          ...(record.datasetVersion ? [{ label: 'Dataset version', value: record.datasetVersion, mono: true }] : []),
          ...(record.sourceRunId ? [{ label: 'Source run', value: record.sourceRunId, mono: true }] : []),
          ...(strings(body.jobIds).length ? [{ label: 'Cluster jobs', value: strings(body.jobIds).join(', '), mono: true }] : []),
          ...(text(body.modelVersionId) ? [{ label: 'Model version', value: <Link className={linkClass} to="/models">{text(body.modelVersionId)}</Link> }] : []),
        ]} /></Panel.Body>
      </Panel>
    </div>
    <Panel><details><summary className={`cursor-pointer text-sm font-medium text-ink-secondary ${focusRing}`}>Full research record</summary><pre className="mt-4 overflow-auto whitespace-pre-wrap break-all text-xs text-ink-tertiary">{JSON.stringify(record, null, 2)}</pre></details></Panel>
  </>;
});
