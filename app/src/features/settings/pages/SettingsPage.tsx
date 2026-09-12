/**
 * @file SettingsPage.tsx
 * @description Settings: appearance, notifications, dashboard and the signed
 *              update packages — tabs in ?tab=, every preference control saves
 *              on change. Settings is chrome, not a sidebar row: the user menu
 *              is what opens it (TASK-279).
 * @feature settings
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Plus, RotateCcw, UserRound } from 'lucide-react';
import {
  Button,
  ErrorState,
  LinkButton,
  PageHeader,
  Panel,
  SkeletonText,
  Tabs,
  confirm,
  toast,
} from '@/shared/components/ui';
import { UpdatesSection } from '@/features/updates';
import { AppearanceSection } from '../components/AppearanceSection';
import { DashboardSection, NotificationsSection } from '../components/PreferenceSections';
import { useSettings } from '../hooks/useSettings';
import { useSettingsStore } from '../store/settingsStore';
import { useThemeStore, type ThemeMode } from '../store/themeStore';
import type { UpdateSettingsDto } from '../types/settings.types';

const TABS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'dashboard', label: 'Dashboard' },
  // Secure OTA updates were a sidebar row of their own until TASK-279.
  { id: 'updates', label: 'Updates' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** The store keeps failures in `error` instead of throwing; turn a new one into a toast. */
function toastIfFailed(title: string) {
  const { error, clearError } = useSettingsStore.getState();
  if (!error) return false;
  toast.error(title, { description: error });
  clearError();
  return true;
}

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const { settings, isLoading, error, fetchSettings, updateSetting, resetSettings } = useSettings();
  const setTheme = useThemeStore((s) => s.setTheme);
  // The Updates tab's "New package" button lives in this header, so the flag
  // lives here too and the section renders the modal from it.
  const [newPackageOpen, setNewPackageOpen] = useState(false);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  const requested = params.get('tab');
  if (requested === 'security' || requested === 'profile') return <Navigate to="/account" replace />;
  const tab: TabId = TABS.some((t) => t.id === requested) ? (requested as TabId) : 'appearance';
  const setTab = (id: string) =>
    setParams(
      (p) => {
        if (id === 'appearance') p.delete('tab');
        else p.set('tab', id);
        return p;
      },
      { replace: true },
    );

  const save = async <K extends keyof UpdateSettingsDto>(key: K, value: UpdateSettingsDto[K]) => {
    await updateSetting(key, value);
    // One toast id, so flipping several switches in a row updates one toast instead of stacking.
    if (!toastIfFailed("Couldn't save the setting")) toast.success('Settings saved', { id: 'settings-saved' });
  };

  const changeTheme = (theme: ThemeMode) => {
    setTheme(theme); // instant, and kept on this device even if the server is unreachable
    void save('theme', theme);
  };

  const askReset = async () => {
    const ok = await confirm({
      title: 'Reset all settings?',
      description: 'Theme, language, notifications and dashboard go back to their defaults.',
      confirmLabel: 'Reset',
    });
    if (!ok) return;
    await resetSettings();
    if (!toastIfFailed("Couldn't reset settings")) toast.success('Settings reset');
  };

  // Each tab brings its own actions: the three preference tabs share the two
  // that act on the preferences, the Updates tab offers the one act that
  // creates something.
  const headerActions: ReactNode =
    tab === 'updates' ? (
      <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setNewPackageOpen(true)}>
        New package
      </Button>
    ) : (
      <>
        <LinkButton to="/account" variant="ghost" leftIcon={<UserRound className="h-4 w-4" strokeWidth={1.75} />}>
          Account and security
        </LinkButton>
        <Button
          variant="ghost"
          leftIcon={<RotateCcw className="h-4 w-4" strokeWidth={1.75} />}
          disabled={!settings}
          onClick={() => void askReset()}
        >
          Reset to defaults
        </Button>
      </>
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="How NeoDEM looks and behaves for you, and the signed packages your robots run."
        actions={headerActions}
      />

      <Tabs tabs={TABS.map(({ id, label }) => ({ id, label }))} activeTab={tab} onTabChange={setTab} label="Settings sections" />

      {/* Update packages are not a user setting — they come from their own
          store, so a failed settings fetch must not hide them. */}
      {tab === 'updates' ? (
        <UpdatesSection newPackageOpen={newPackageOpen} onNewPackageOpenChange={setNewPackageOpen} />
      ) : !settings ? (
        error && !isLoading ? (
          <Panel>
            <ErrorState title="Couldn't load your settings" message={error} onRetry={() => void fetchSettings()} />
          </Panel>
        ) : (
          <Panel>
            <SkeletonText lines={4} />
          </Panel>
        )
      ) : (
        <>
          {tab === 'appearance' && (
            <AppearanceSection
              language={settings.language}
              compactMode={settings.compactMode}
              onThemeChange={changeTheme}
              onLanguageChange={(v) => void save('language', v)}
              onCompactModeChange={(v) => void save('compactMode', v)}
            />
          )}
          {tab === 'notifications' && (
            <NotificationsSection settings={settings} onToggle={(key, v) => void save(key, v)} />
          )}
          {tab === 'dashboard' && (
            <DashboardSection settings={settings} onChange={(key, v) => void save(key, v)} />
          )}
        </>
      )}
    </div>
  );
}
