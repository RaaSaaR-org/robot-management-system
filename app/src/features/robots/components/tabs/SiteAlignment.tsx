/**
 * @file SiteAlignment.tsx
 * @description Whether a robot's pose is aligned with its site (TASK-343), and
 *              the "Align" action that makes it so: the operator names the
 *              place the robot stands on and the way it faces, and the server
 *              registers the robot's odometry to the site twin (TASK-341).
 *              Without it the robot's keepout fence is not enforcing.
 * @feature robots
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  FormField,
  FormModal,
  Input,
  Select,
  StatusTag,
  confirm,
  errorMessage,
  toast,
} from '@/shared/components/ui';
import { formatTimeAgo } from '@/shared/utils';
import { robotsApi } from '../../api/robotsApi';
import type { FrameRegistration, RobotLocation, SitePlace } from '../../types/robots.types';

export interface SiteAlignmentProps {
  robotId: string;
  /** The robot's site; nothing is rendered without one */
  twinId?: string | null;
  location?: RobotLocation;
}

/** What the status says, derived from the robot's own claim first. */
export function alignmentStatus(
  location: RobotLocation | undefined,
  registration: FrameRegistration | null,
): { aligned: boolean; label: string; detail: string | null } {
  if (location?.siteAligned === true) {
    if (registration?.current) {
      const at = registration.anchorPlaceId ? `on ${registration.anchorPlaceId}` : 'by hand';
      return { aligned: true, label: 'Aligned', detail: `Aligned ${at}, ${formatTimeAgo(registration.createdAt)}` };
    }
    // A sim whose world IS the twin needs no registration.
    return { aligned: true, label: 'Aligned', detail: 'Its pose is in the site frame' };
  }
  const why = registration && !registration.current ? registration.staleReason : null;
  return { aligned: false, label: 'Not aligned — fence not enforcing', detail: why };
}

export function SiteAlignment({ robotId, twinId, location }: SiteAlignmentProps) {
  const [registration, setRegistration] = useState<FrameRegistration | null>(null);
  const [places, setPlaces] = useState<SitePlace[]>([]);
  const [open, setOpen] = useState(false);
  const [placeId, setPlaceId] = useState('');
  const [heading, setHeading] = useState('0');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setRegistration(await robotsApi.getFrameRegistration(robotId));
    } catch {
      setRegistration(null);
    }
  }, [robotId]);

  // Re-read when the robot's own claim flips: that is when the server's
  // `current` may have changed too (an odometry restart, a new alignment).
  const siteAligned = location?.siteAligned === true;
  useEffect(() => {
    if (!twinId) return;
    void reload();
  }, [twinId, siteAligned, reload]);

  if (!twinId) return null;

  const openDialog = async () => {
    setSaveError(null);
    setOpen(true);
    try {
      const list = (await robotsApi.getSitePlaces(robotId)).filter((p) => !p.keepout);
      setPlaces(list);
      if (!list.some((p) => p.id === placeId)) setPlaceId(list[0]?.id ?? '');
    } catch (e) {
      setSaveError(`Couldn't load the site's places: ${errorMessage(e)}`);
    }
  };

  const submit = async () => {
    const headingDeg = Number(heading);
    if (!placeId || !Number.isFinite(headingDeg)) {
      setSaveError('Pick a place and enter a heading in degrees.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      setRegistration(await robotsApi.putFrameRegistration(robotId, { method: 'place-anchor', placeId, headingDeg }));
      toast.success('Robot aligned', { description: 'The fence enforces once the robot picks it up (a few seconds).' });
      setOpen(false);
    } catch (e) {
      setSaveError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    const ok = await confirm({
      title: 'Clear the alignment?',
      description: 'Places and keepouts stop being enforced for this robot until it is aligned again.',
      confirmLabel: 'Clear',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await robotsApi.deleteFrameRegistration(robotId);
      setRegistration(null);
      toast.success('Alignment cleared');
    } catch (e) {
      toast.error("Couldn't clear the alignment", { description: errorMessage(e) });
    }
  };

  const status = alignmentStatus(location, registration);

  return (
    <div className="flex flex-col gap-2">
      <div data-testid="site-alignment-status" className="flex flex-col items-start gap-1">
        <StatusTag tone={status.aligned ? 'success' : 'warning'} size="sm">
          {status.label}
        </StatusTag>
        {status.detail && <span className="text-xs text-ink-tertiary">{status.detail}</span>}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => void openDialog()}>
          Align…
        </Button>
        {registration && (
          <Button size="sm" variant="ghost" onClick={() => void clear()}>
            Clear
          </Button>
        )}
      </div>

      <FormModal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Align robot to its site"
        description="Stand the robot on the centre of a place and say which way it faces. Its odometry is then registered to the site until it restarts."
        submitLabel="Align"
        submittingLabel="Aligning…"
        isSubmitting={saving}
        submitDisabled={places.length === 0}
        error={saveError}
        onSubmit={submit}
      >
        <FormField label="The robot stands on" hint="The centre of this place, in the site twin">
          <Select
            aria-label="Anchor place"
            options={places.map((p) => ({ value: p.id, label: p.name === p.id ? p.id : `${p.name} (${p.id})` }))}
            value={placeId}
            onChange={(e) => setPlaceId(e.target.value)}
          />
        </FormField>
        <FormField label="Facing (degrees)" hint="In the site frame: 0 = +x, counter-clockwise positive">
          <Input
            aria-label="Heading in degrees"
            type="number"
            step="any"
            value={heading}
            onChange={(e) => setHeading(e.target.value)}
          />
        </FormField>
      </FormModal>
    </div>
  );
}
