/**
 * @file RoundDetailPage.tsx
 * @description One federated round: state, participants and configuration,
 *              with start and cancel acts
 * @feature fleetlearning
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Play } from 'lucide-react';
import {
  Button, ErrorState, KeyValueList, PageHeader, Panel, SkeletonText, StatRow, StatTile, StatusTag,
  confirm, toast,
} from '@/shared/components/ui';
import { formatDateTime, getErrorMessage } from '@/shared/utils';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import { ParticipantList } from '../components/ParticipantList';
import { shortRoundId } from '../components/RoundsSection';
import { useRobotNames } from '../components/useRobotNames';
import { useRoundDetail } from '../hooks/fleetlearning';
import {
  AGGREGATION_METHOD_LABELS, SELECTION_STRATEGY_LABELS, canStartRound, formatDuration, isRoundActive,
} from '../types/fleetlearning.types';

const BACK = { to: '/fleet-learning', label: 'Fleet learning' };

export function RoundDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { round, participants, isLoading, error, fetchRound, startRound } = useRoundDetail(id);
  const robotName = useRobotNames();
  const [pending, setPending] = useState(false);
  // The store keeps the last round opened; show it only when it is this one.
  const current = round?.id === id ? round : null;

  if (!current) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader eyebrow="Build" back={BACK} title={`Round ${shortRoundId(id)}`} />
        <Panel>
          {error && !isLoading ? (
            <ErrorState title="Couldn't load this round" message={error} onRetry={() => void fetchRound()} />
          ) : (
            <SkeletonText lines={4} />
          )}
        </Panel>
      </div>
    );
  }

  const r = current;
  const active = isRoundActive(r);
  const duration = r.startedAt
    ? Math.floor(((r.completedAt ? new Date(r.completedAt).getTime() : Date.now()) - new Date(r.startedAt).getTime()) / 1000)
    : undefined;

  // Start is the only act: the server has no route to cancel a round, so the page does not offer one.
  const start = async () => {
    const ok = await confirm({
      title: 'Start round?',
      description: `Up to ${r.config.maxParticipants} robots are selected and begin local training with ${r.config.localEpochs} epoch(s).`,
      confirmLabel: 'Start round',
    });
    if (!ok) return;
    setPending(true);
    try {
      await startRound();
      toast.success('Round started', { description: `Round ${shortRoundId(r.id)}` });
    } catch (err) {
      toast.error("Couldn't start the round", { description: getErrorMessage(err) });
    } finally {
      setPending(false);
      void fetchRound();
    }
  };

  const loss = r.metrics?.avgLocalLoss;
  const improvement = r.metrics?.lossImprovement;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Build"
        back={BACK}
        title={`Round ${shortRoundId(r.id)}`}
        description={`Model ${r.globalModelVersion} · ${AGGREGATION_METHOD_LABELS[r.config.aggregationMethod]}`}
        meta={<StatusTag status={r.status} dot pulse={active} />}
        actions={
          canStartRound(r) ? (
            <Button leftIcon={<Play className="h-4 w-4" />} isLoading={pending} onClick={() => void start()}>Start round</Button>
          ) : undefined
        }
      />

      {r.status === 'failed' && r.errorMessage && (
        <Panel variant="inset" className="text-sm text-signal-stopped">{r.errorMessage}</Panel>
      )}

      <StatRow columns={4}>
        <StatTile label="Participants" value={r.participantCount} unit={`/ ${r.config.maxParticipants}`}
          hint={`${r.failedParticipants} failed`} tone={active ? 'live' : undefined} />
        <StatTile label="Completed updates" value={r.completedParticipants} unit={`/ ${r.participantCount}`}
          hint={`${r.totalLocalSamples.toLocaleString(UI_DATE_LOCALE)} samples`} />
        <StatTile label="Avg local loss" value={loss !== undefined ? loss.toFixed(4) : '—'}
          hint={improvement !== undefined ? `${improvement >= 0 ? 'Improved' : 'Worse'} ${Math.abs(improvement * 100).toFixed(2)} %` : 'Reported after aggregation'} />
        <StatTile label="Duration" value={formatDuration(duration)} hint={r.completedAt ? 'Start to finish' : r.startedAt ? 'Running' : 'Not started'} />
      </StatRow>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel padding="none" className="xl:col-span-2">
          <Panel.Header title="Participants" />
          <ParticipantList participants={participants} isLoading={isLoading} robotName={robotName} />
        </Panel>
        <Panel>
          <Panel.Header title="Configuration" />
          <Panel.Body>
            <KeyValueList columns={1} items={[
              { label: 'Participants', value: `${r.config.minParticipants} – ${r.config.maxParticipants}` },
              { label: 'Local epochs', value: r.config.localEpochs },
              { label: 'Learning rate', value: r.config.localLearningRate },
              { label: 'Aggregation', value: AGGREGATION_METHOD_LABELS[r.config.aggregationMethod] },
              { label: 'Selection', value: SELECTION_STRATEGY_LABELS[r.config.selectionStrategy] },
              { label: 'Training timeout', value: formatDuration(r.config.trainingTimeout) },
              { label: 'Upload timeout', value: formatDuration(r.config.uploadTimeout) },
              { label: 'Secure aggregation', value: r.config.secureAggregation ? 'On' : 'Off' },
              { label: 'Privacy ε', value: r.config.privacyEpsilon ?? 'Off' },
              { label: 'New model version', value: r.newModelVersion, mono: true },
              { label: 'Created', value: formatDateTime(r.createdAt) },
              { label: 'Round ID', value: r.id, mono: true },
            ]} />
          </Panel.Body>
        </Panel>
      </div>
    </div>
  );
}
