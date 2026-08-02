/**
 * @file IdentityDialog.tsx
 * @description The naming ritual's non-conversational door (TASK-198): a small
 *              form that writes Name / Emoji / Operator / Site into the robot's
 *              `IDENTITY.md`, so an un-bootstrapped robot can be named without
 *              having to talk to it.
 * @feature agentmode
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Button, Input, Modal } from '@/shared/components/ui';
import { useAgentModeStore, selectIsSavingIdentity } from '../store/agentmodeStore';
import type { AgentIdentityPatch, AgentSelfState } from '../types/agentmode.types';

export interface IdentityDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Robot to name; the dialog refuses to submit without one. */
  robotId: string | null;
}

/** Trim, and treat an emptied field as "clear this" rather than as the string ''. */
function patchValue(next: string, previous: string | null): string | null | undefined {
  const value = next.trim();
  if (value === (previous ?? '')) return undefined; // Untouched — do not send it.
  return value === '' ? null : value;
}

/**
 * Name the robot.
 *
 * Only the four fields the robot will accept: `Robot-Id`, `Serial` and `Unit`
 * are regenerated from its configuration at every boot and it refuses to take
 * them from a client. Fields the operator did not touch are not sent at all, so
 * opening this dialog and pressing Save cannot blank a site nobody edited.
 */
export function IdentityDialog({ isOpen, onClose, robotId }: IdentityDialogProps) {
  const isSaving = useAgentModeStore(selectIsSavingIdentity);

  /**
   * The card as it stood when the dialog opened — captured, not subscribed.
   * The robot pushes a state snapshot on every plan, block and mode change; a
   * subscription here would re-seed the inputs under the operator's fingers
   * mid-sentence, and would silently move the baseline the diff is taken
   * against.
   */
  const [baseline, setBaseline] = useState<AgentSelfState | null>(null);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [operator, setOperator] = useState('');
  const [site, setSite] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  // Seed from the robot every time the dialog opens: the self it reports is the
  // card on its disk, and an operator editing it must start from that, not from
  // whatever they typed and abandoned last time.
  useEffect(() => {
    if (!isOpen) return;
    const current = useAgentModeStore.getState().self;
    setBaseline(current);
    setName(current?.bootstrapRequired ? '' : (current?.name ?? ''));
    setEmoji(current?.emoji ?? '');
    setOperator(current?.operator ?? '');
    setSite(current?.site ?? '');
    setProblem(null);
  }, [isOpen]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!robotId || isSaving) return;

    const patch: AgentIdentityPatch = {};
    const nextName = patchValue(
      name,
      baseline?.bootstrapRequired ? null : (baseline?.name ?? null)
    );
    // A robot with no card needs a name — that is the whole ritual. Clearing
    // the name of a robot that has one is not something this form offers.
    if (nextName === null || (baseline?.bootstrapRequired && !name.trim())) {
      setProblem('Give the robot a name — that is the one field it cannot make up.');
      return;
    }
    if (nextName !== undefined) patch.Name = nextName;

    const nextEmoji = patchValue(emoji, baseline?.emoji ?? null);
    if (nextEmoji !== undefined) patch.Emoji = nextEmoji;
    const nextOperator = patchValue(operator, baseline?.operator ?? null);
    if (nextOperator !== undefined) patch.Operator = nextOperator;
    const nextSite = patchValue(site, baseline?.site ?? null);
    if (nextSite !== undefined) patch.Site = nextSite;

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    setProblem(null);
    const ok = await useAgentModeStore.getState().submitIdentity(robotId, patch);
    if (ok) onClose();
    else setProblem('The robot refused the write — see the error above the timeline.');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Name this robot"
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="agent-identity-cancel">
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            form="agent-identity-form"
            isLoading={isSaving}
            loadingText="Writing…"
            disabled={!robotId}
            data-testid="agent-identity-save"
          >
            Write IDENTITY.md
          </Button>
        </>
      }
    >
      <form id="agent-identity-form" onSubmit={handleSubmit} className="space-y-3">
        <p className="card-meta">
          Written to <span className="text-theme-secondary">IDENTITY.md</span> on the robot
          itself — it keeps the file, the fleet adopts what it reports. Operator and site are
          personal data and are blanked by a GDPR erasure.
        </p>

        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nova"
          fullWidth
          autoFocus
          data-testid="agent-identity-name"
        />
        <Input
          label="Emoji (optional)"
          value={emoji}
          onChange={(e) => setEmoji(e.target.value)}
          placeholder="🤖"
          fullWidth
          data-testid="agent-identity-emoji"
        />
        <Input
          label="Operator (optional)"
          value={operator}
          onChange={(e) => setOperator(e.target.value)}
          placeholder="Who is responsible for it"
          fullWidth
          data-testid="agent-identity-operator"
        />
        <Input
          label="Site (optional)"
          value={site}
          onChange={(e) => setSite(e.target.value)}
          placeholder="Where it works"
          fullWidth
          data-testid="agent-identity-site"
        />

        {problem && (
          <p data-testid="agent-identity-problem" className="text-sm text-red-600 dark:text-red-400">
            {problem}
          </p>
        )}
      </form>
    </Modal>
  );
}
