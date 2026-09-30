/**
 * @file SiteSelect.tsx
 * @description The robot's "Site" picker: which digital twin it works in
 *              (TASK-327). Lists the tenant's twins plus "No site" and binds
 *              through `PATCH /api/robots/:id`.
 * @feature robots
 */

import { useEffect, useState } from 'react';
import { Select, errorMessage, toast } from '@/shared/components/ui';
import { twinApi } from '@/features/digitaltwin';
import type { DigitalTwinDTO } from '@/features/digitaltwin/types/twin.types';
import { useRobotsStore } from '../../store/robotsStore';

export interface SiteSelectProps {
  robotId: string;
  /** Current binding off the robot DTO; null/undefined = no site */
  twinId?: string | null;
}

const NO_SITE = '';

export function SiteSelect({ robotId, twinId }: SiteSelectProps) {
  const updateRobotSite = useRobotsStore((s) => s.updateRobotSite);
  const [twins, setTwins] = useState<DigitalTwinDTO[] | null>(null);
  const [value, setValue] = useState<string>(twinId ?? NO_SITE);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(twinId ?? NO_SITE);
  }, [twinId]);

  useEffect(() => {
    let cancelled = false;
    twinApi
      .listTwins()
      .then((list) => {
        if (!cancelled) setTwins(list);
      })
      .catch(() => {
        if (!cancelled) setTwins([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onChange = async (next: string) => {
    const previous = value;
    setValue(next);
    setSaving(true);
    try {
      await updateRobotSite(robotId, next === NO_SITE ? null : next);
    } catch (e) {
      setValue(previous);
      toast.error("Couldn't change the site", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const options = [
    { value: NO_SITE, label: 'No site' },
    ...(twins ?? []).map((t) => ({ value: t.id, label: t.name })),
  ];
  // A bound twin not in the list yet (still loading) must not read as "No site".
  if (value !== NO_SITE && !options.some((o) => o.value === value)) {
    options.push({ value, label: twins === null ? 'Loading…' : 'Unknown site' });
  }

  return (
    <Select
      aria-label="Site"
      size="sm"
      options={options}
      value={value}
      disabled={saving}
      onChange={(e) => void onChange(e.target.value)}
    />
  );
}
