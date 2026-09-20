/** @file ResearchOutcome.tsx @description Predictions and observations with explicit evaluation boundaries. @feature research */
import { memo } from 'react';
import { KeyValueList, Panel, StatRow, StatTile, StatusTag } from '@/shared/components/ui';
import { number, object, readable, text } from '../utils/presentation';

export const ResearchOutcome = memo(function ResearchOutcome({ body }: { body: Record<string, unknown> }) {
  const prediction = object(body.prediction ?? object(body.proposal).prediction);
  const observed = object(body.observed);
  const range = object(prediction.finalLossRange);
  const expectation = object(body.expectationCheck);
  const history = Array.isArray(observed.lossHistory) ? observed.lossHistory.flatMap((item) => {
    const point = object(item);
    return number(point.step) !== undefined && number(point.loss) !== undefined ? [{ step: point.step as number, loss: point.loss as number }] : [];
  }) : [];
  const loss = number(observed.finalTrainingLoss);
  const min = number(range.min);
  const max = number(range.max);
  const hasPrediction = min !== undefined || max !== undefined || number(prediction.expectedCheckpointStep) !== undefined;
  const hasObservation = loss !== undefined || number(observed.finalStep) !== undefined;
  if (!hasPrediction && !hasObservation) return null;
  const { low, high } = history.reduce((bounds, point) => ({ low: Math.min(bounds.low, point.loss), high: Math.max(bounds.high, point.loss) }), { low: Infinity, high: -Infinity });
  const plotted = history.length <= 200 ? history : Array.from({ length: 200 }, (_, index) => history[Math.round(index * (history.length - 1) / 199)]);
  const firstStep = history[0]?.step ?? 0;
  const lastStep = history[history.length - 1]?.step ?? 1;
  const points = plotted.map((point) => `${12 + (point.step - firstStep) / (lastStep - firstStep || 1) * 576},${104 - (point.loss - low) / (high - low || 1) * 88}`).join(' ');
  return <Panel>
    <Panel.Header title="Prediction & outcome" description="Compare the recorded expectation with the published training observations." />
    <Panel.Body className="space-y-5">
      <StatRow columns={3}>
        <StatTile label="Final training loss" value={loss ?? 'Not recorded'} />
        <StatTile label="Expected loss range" value={min !== undefined && max !== undefined ? `${min}–${max}` : 'Not recorded'} />
        <StatTile label="Checkpoint step" value={number(observed.finalStep) ?? 'Not recorded'} hint={number(prediction.expectedCheckpointStep) !== undefined ? `Expected step ${prediction.expectedCheckpointStep}` : undefined} />
      </StatRow>
      {text(expectation.verdict) && <p className="text-sm text-ink-primary">Published conclusion: <span className="font-medium">{readable(text(expectation.verdict)!)}</span></p>}
      {history.length > 1 && <figure className="rounded-control border border-line-subtle bg-inset p-4">
        <figcaption className="mb-3 flex flex-wrap justify-between gap-2 text-xs text-ink-tertiary"><span>Training loss · {history.length} observations{history.length > 200 ? ' · 200 plotted' : ''}</span><span>Observed range {low.toFixed(4)}–{high.toFixed(4)}</span></figcaption>
        <svg viewBox="0 0 600 120" role="img" aria-label={`Training loss from step ${firstStep} to ${lastStep}; final loss ${history[history.length - 1]?.loss}`} className="h-28 w-full text-primary" preserveAspectRatio="none">
          <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="flex justify-between text-xs text-ink-muted"><span>Step {firstStep}</span><span>Step {lastStep}</span></div>
      </figure>}
      <KeyValueList items={[
        { label: 'Loss within expected range', value: typeof expectation.lossWithinPredictedRange === 'boolean' ? (expectation.lossWithinPredictedRange ? 'Yes' : 'No') : 'Not assessed' },
        { label: 'Checkpoint produced', value: typeof observed.checkpointProduced === 'boolean' ? (observed.checkpointProduced ? 'Yes' : 'No') : 'Not recorded' },
      ]} />
      {body.robotPerformance === 'unknown' && <div className="flex flex-wrap items-center gap-3 border-t border-line-subtle pt-4"><StatusTag tone="warning">Robot performance unknown</StatusTag><p className="text-sm text-ink-secondary">Training loss does not establish pick-and-place success.</p></div>}
    </Panel.Body>
  </Panel>;
});
