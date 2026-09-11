/**
 * @file AppearanceSection.tsx
 * @description Settings > Appearance: theme radio cards (source of truth: themeStore), language, compact mode
 * @feature settings
 */

import { Monitor, Moon, Sun } from 'lucide-react';
import { FormField, Panel, Select, Switch } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { useThemeStore, type ThemeMode } from '../store/themeStore';
import type { LanguageValue } from '../types/settings.types';

const THEMES: { value: ThemeMode; label: string; hint: string; icon: typeof Moon }[] = [
  { value: 'dark', label: 'Dark', hint: 'The default: matte and calm on long shifts.', icon: Moon },
  { value: 'light', label: 'Light', hint: 'Bright rooms and printouts.', icon: Sun },
  { value: 'system', label: 'System', hint: 'Follows your operating system.', icon: Monitor },
];

const LANGUAGES: { value: LanguageValue; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
  { value: 'ja', label: '日本語' },
];

export interface AppearanceSectionProps {
  language: LanguageValue;
  compactMode: boolean;
  onThemeChange: (theme: ThemeMode) => void;
  onLanguageChange: (language: LanguageValue) => void;
  onCompactModeChange: (compact: boolean) => void;
}

export function AppearanceSection({
  language,
  compactMode,
  onThemeChange,
  onLanguageChange,
  onCompactModeChange,
}: AppearanceSectionProps) {
  const theme = useThemeStore((s) => s.theme);

  return (
    <div className="flex flex-col gap-6">
      <Panel>
        <Panel.Header title="Theme" description="How the app looks on this device." />
        <Panel.Body>
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {THEMES.map(({ value, label, hint, icon: Icon }) => {
              const selected = theme === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onThemeChange(value)}
                  className={cn(
                    'flex items-start gap-3 rounded-control border p-4 text-left transition-colors duration-150',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                    selected
                      ? 'border-primary bg-primary/10'
                      : 'border-line hover:border-line-strong hover:bg-ink-primary/[0.035]',
                  )}
                >
                  <Icon
                    className={cn('mt-0.5 h-4 w-4 shrink-0', selected ? 'text-primary' : 'text-ink-tertiary')}
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-ink-primary">{label}</span>
                    <span className="text-xs text-ink-tertiary">{hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Panel.Body>
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel>
          <Panel.Header title="Language" description="Used for dates, numbers and interface text where translated." />
          <Panel.Body>
            <FormField label="Interface language">
              <Select
                options={LANGUAGES}
                value={language}
                onChange={(e) => onLanguageChange(e.target.value as LanguageValue)}
              />
            </FormField>
          </Panel.Body>
        </Panel>

        <Panel>
          <Panel.Header title="Density" description="How much fits on one screen." />
          <Panel.Body>
            <Switch
              label="Compact mode"
              description="Less spacing and padding, for dense tables and small screens."
              checked={compactMode}
              onCheckedChange={onCompactModeChange}
            />
          </Panel.Body>
        </Panel>
      </div>
    </div>
  );
}
