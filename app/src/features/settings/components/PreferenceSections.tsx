/**
 * @file PreferenceSections.tsx
 * @description Settings > Notifications (Switch rows) and Settings > Dashboard (default view, refresh)
 * @feature settings
 */

import { FormField, Panel, Select, Switch } from '@/shared/components/ui';
import type { DashboardView, UpdateSettingsDto, UserSettings } from '../types/settings.types';

type NotificationKey = 'emailNotifications' | 'alertsEnabled' | 'maintenanceReminders' | 'weeklyDigest';

const NOTIFICATIONS: { key: NotificationKey; label: string; description: string }[] = [
  { key: 'alertsEnabled', label: 'In-app alerts', description: 'Robot status changes and errors, shown in the app.' },
  { key: 'emailNotifications', label: 'Email for important events', description: 'Incidents, approvals waiting for you and failed runs.' },
  { key: 'maintenanceReminders', label: 'Maintenance reminders', description: 'Scheduled service for your robots.' },
  { key: 'weeklyDigest', label: 'Weekly digest', description: 'A summary of fleet activity every Monday, by email.' },
];

export function NotificationsSection({
  settings,
  onToggle,
}: {
  settings: UserSettings;
  onToggle: (key: NotificationKey, value: boolean) => void;
}) {
  return (
    <Panel>
      <Panel.Header title="Notifications" description="What NeoDEM tells you about, and where." />
      <ul className="divide-y divide-line-subtle">
        {NOTIFICATIONS.map((item) => (
          <li key={item.key} className="px-5 py-4">
            <Switch
              label={item.label}
              description={item.description}
              labelPosition="left"
              className="w-full justify-between"
              checked={Boolean(settings[item.key])}
              onCheckedChange={(v) => onToggle(item.key, v)}
            />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

const VIEWS: { value: DashboardView; label: string }[] = [
  { value: 'fleet', label: 'Fleet overview — map with every robot' },
  { value: 'robots', label: 'Robot list — table of robot states' },
  { value: 'training', label: 'Training — datasets and runs' },
];

const INTERVALS = [5, 10, 15, 30, 60, 120, 300].map((sec) => ({
  value: String(sec),
  label: sec < 60 ? `Every ${sec} seconds` : sec === 60 ? 'Every minute' : `Every ${sec / 60} minutes`,
}));

export function DashboardSection({
  settings,
  onChange,
}: {
  settings: UserSettings;
  onChange: <K extends keyof UpdateSettingsDto>(key: K, value: UpdateSettingsDto[K]) => void;
}) {
  return (
    <Panel>
      <Panel.Header title="Dashboard" description="What opens first, and how often live numbers refresh." />
      <Panel.Body className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField label="Default view">
          <Select
            options={VIEWS}
            value={settings.defaultDashboardView}
            onChange={(e) => onChange('defaultDashboardView', e.target.value as DashboardView)}
          />
        </FormField>
        <FormField label="Auto-refresh" hint="Shorter intervals cost more server load.">
          <Select
            options={INTERVALS}
            value={String(settings.refreshIntervalSec)}
            onChange={(e) => onChange('refreshIntervalSec', Number(e.target.value))}
          />
        </FormField>
      </Panel.Body>
    </Panel>
  );
}
