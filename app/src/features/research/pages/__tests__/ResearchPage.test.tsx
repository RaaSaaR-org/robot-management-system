/** @file ResearchPage.test.tsx @description Publication visibility and navigation. @feature research */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ResearchPage } from '../ResearchPage';
import { researchApi } from '../../api/researchApi';
import type { ResearchRecord } from '../../types/research.types';

vi.mock('../../api/researchApi', () => ({ researchApi: { list: vi.fn(), get: vi.fn() } }));
const publication: ResearchRecord = {
  id: 'report-1', kind: 'dataset-assessment', version: 1, title: 'Apple data assessment', campaignId: 'apple',
  datasetId: 'dataset-1', datasetVersion: 'revision-1', supersedesId: 'report-0',
  author: { id: 'researcher', name: 'Apple researcher', kind: 'service' },
  createdAt: '2026-09-20T10:00:00Z', contentHash: 'c'.repeat(64),
  evidence: [{ uri: 's3://research/evidence.json', sha256: 'a'.repeat(64) }],
  body: { comment: 'Policy usefulness has not been measured.', task: 'Apple pick and place', model: 'GR00T',
    dimensions: { integrity: { score: 90, rationale: 'Files checked' }, usefulness: { score: null, rationale: 'Training not complete' } } },
};
function page(path = '/research') {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/research" element={<ResearchPage />} />
    <Route path="/research/:id" element={<ResearchPage />} />
  </Routes></MemoryRouter>);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(researchApi.list).mockResolvedValue({ records: [publication], pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 } });
  vi.mocked(researchApi.get).mockResolvedValue(publication);
});

describe('ResearchPage', () => {
  it('opens an attributed publication, shows unknown ratings and preserves correction links', async () => {
    page();
    fireEvent.click(await screen.findByRole('link', { name: 'Apple data assessment' }));
    expect(await screen.findByText('Policy usefulness has not been measured.')).toBeInTheDocument();
    expect(screen.getByText('Apple researcher · Agent')).toBeInTheDocument();
    expect(screen.getByText('usefulness: Unknown')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'report-0' })).toHaveAttribute('href', '/research/report-0');
    expect(screen.getByRole('link', { name: 'dataset-1' })).toHaveAttribute('href', '/datasets/dataset-1/episodes');
    expect(screen.getByText('s3://research/evidence.json')).toBeInTheDocument();
  });

  it('sends applied filters and exposes a retryable error instead of an empty result', async () => {
    page();
    await screen.findByRole('link', { name: 'Apple data assessment' });
    vi.mocked(researchApi.list).mockRejectedValueOnce(new Error('Research service unavailable'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'experiment' } });
    fireEvent.change(screen.getByPlaceholderText('Campaign ID'), { target: { value: 'new-campaign' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(await screen.findByText('Research service unavailable')).toBeInTheDocument();
    const calls = vi.mocked(researchApi.list).mock.calls;
    expect(calls[calls.length - 1]?.[0]).toBe('kind=experiment&campaignId=new-campaign');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText('Research service unavailable')).not.toBeInTheDocument());
  });

  it('renders report Markdown without executable links or raw HTML', async () => {
    vi.mocked(researchApi.get).mockResolvedValue({ ...publication, kind: 'report', body: { markdown: '# Findings\n\n[unsafe](javascript:alert(1))\n\n<script>alert(1)</script>' } });
    const { container } = page('/research/report-1');
    await screen.findByRole('heading', { name: 'Findings', level: 3 });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it('reads nested pilot predictions and preserves the filtered list on return', async () => {
    vi.mocked(researchApi.get).mockResolvedValue({ ...publication, kind: 'idea', body: {
      scope: 'training-integration-pilot', simulatorEvaluation: 'deferred', robotPerformance: 'unknown',
      proposal: { hypothesis: 'A frozen backbone produces finite loss.', prediction: { expectedCheckpointStep: 20, finalLossRange: { min: 0.1, max: 5 } } },
    } });
    page('/research/report-1?campaignId=apple&page=2&q=apple');
    expect(await screen.findByText('A frozen backbone produces finite loss.')).toBeInTheDocument();
    expect(screen.getByText('0.1–5')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Research' })).toHaveAttribute('href', '/research?campaignId=apple&page=2&q=apple');
    expect(screen.getByText('Robot performance unknown')).toBeInTheDocument();
  });

  it('shows the observed result without converting a failed prediction into success', async () => {
    vi.mocked(researchApi.get).mockResolvedValue({ ...publication, kind: 'external-job', body: {
      state: 'awaiting_evaluation', robotPerformance: 'unknown',
      prediction: { finalLossRange: { min: 0.1, max: 5 }, expectedCheckpointStep: 20 },
      observed: { finalTrainingLoss: 6, finalStep: 20, checkpointProduced: true },
      expectationCheck: { lossWithinPredictedRange: false, verdict: 'training-integration-expectation-refuted' },
    } });
    page('/research/report-1');
    expect(await screen.findByText('6', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('No', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('training integration expectation refuted')).toBeInTheDocument();
    expect(screen.getByText('Robot performance unknown')).toBeInTheDocument();
  });

  it('labels search as page-scoped and never sends the client search to the API', async () => {
    page('/research?campaignId=apple');
    await screen.findByRole('link', { name: 'Apple data assessment' });
    const before = vi.mocked(researchApi.list).mock.calls.length;
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'does not exist' } });
    expect(await screen.findByText('No research matches')).toBeInTheDocument();
    expect(screen.getByText(/Search applies to the current page only/)).toBeInTheDocument();
    expect(vi.mocked(researchApi.list).mock.calls).toHaveLength(before);
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(await screen.findByRole('link', { name: 'Apple data assessment' })).toBeInTheDocument();
  });

  it('does not present scientific predictions as missing training measurements', async () => {
    vi.mocked(researchApi.get).mockResolvedValue({ ...publication, kind: 'report', body: {
      reportType: 'scientific', prediction: { outcomes: [{ metric: 'successRate', expected: 0.8 }] }, markdown: 'Simulation findings.',
    } });
    page('/research/report-1');
    await screen.findByText('Simulation findings.');
    expect(screen.queryByText('Final training loss')).not.toBeInTheDocument();
  });

  it('links the selected dataset from a pilot experiment candidate', async () => {
    vi.mocked(researchApi.get).mockResolvedValue({ ...publication, datasetId: undefined, kind: 'experiment', body: {
      candidate: { datasetIds: ['pilot-dataset'], expected: { baseModel: 'GR00T', steps: 20 } },
    } });
    page('/research/report-1');
    expect(await screen.findByRole('link', { name: 'pilot-dataset' })).toHaveAttribute('href', '/datasets/pilot-dataset/episodes');
    expect(screen.getByText('GR00T', { exact: true })).toBeInTheDocument();
  });

  it('bounds chart size for long training histories and tolerates malformed points', async () => {
    vi.mocked(researchApi.get).mockResolvedValue({ ...publication, kind: 'external-job', body: {
      observed: { finalTrainingLoss: 1, finalStep: 150000, lossHistory: [null, 'bad', ...Array.from({ length: 150000 }, (_, index) => ({ step: index + 1, loss: 1 + index / 150000 }))] },
    } });
    const { container } = page('/research/report-1');
    await screen.findByText('Training loss · 150000 observations · 200 plotted');
    expect(container.querySelector('polyline')?.getAttribute('points')?.split(' ')).toHaveLength(200);
  });
});
