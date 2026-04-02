/**
 * @file SettingsPage.tsx
 * @description User settings page with tabbed navigation
 * @feature settings
 */

import { useState, useEffect } from 'react';
import { cn } from '@/shared/utils/cn';
import { useBrand } from '@/brand';
import { useSettings } from '../hooks/useSettings';
import { useCurrentUser } from '@/features/auth';
import type { ThemeValue, LanguageValue, DashboardView, UpdateSettingsDto } from '../types/settings.types';

// ============================================================================
// TAB TYPES
// ============================================================================

type SettingsTab = 'appearance' | 'notifications' | 'dashboard' | 'security' | 'profile';

interface TabDef {
  id: SettingsTab;
  label: string;
  icon: React.ReactNode;
}

// ============================================================================
// TAB DEFINITIONS
// ============================================================================

const TABS: TabDef[] = [
  {
    id: 'appearance',
    label: 'Appearance',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
      </svg>
    ),
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
    ),
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
      </svg>
    ),
  },
  {
    id: 'security',
    label: 'Security',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
  },
  {
    id: 'profile',
    label: 'Profile',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
];

// ============================================================================
// SETTINGS PAGE
// ============================================================================

export function SettingsPage() {
  const brand = useBrand();
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const { settings, isLoading, error, fetchSettings, updateSetting, resetSettings } = useSettings();

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-theme-primary">Settings</h1>
          <p className="text-theme-secondary mt-1">Configure your {brand.name} preferences</p>
        </div>
        <button
          onClick={resetSettings}
          disabled={isLoading}
          className="text-sm px-4 py-2 rounded-brand border border-theme text-theme-secondary hover:text-theme-primary hover:border-theme-strong transition-colors disabled:opacity-50"
        >
          Reset to Defaults
        </button>
      </header>

      {/* Error banner */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-brand text-sm">
          {error}
        </div>
      )}

      {/* Tab Navigation */}
      <div className="border-b border-theme overflow-x-auto">
        <nav className="flex gap-0 min-w-0" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                activeTab === tab.id
                  ? 'border-cobalt text-cobalt'
                  : 'border-transparent text-theme-secondary hover:text-theme-primary hover:border-theme-strong'
              )}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {isLoading && !settings ? (
        <div className="card p-12 text-center text-theme-secondary">Loading settings...</div>
      ) : (
        <div role="tabpanel">
          {activeTab === 'appearance' && settings && (
            <AppearanceTab
              theme={settings.theme}
              language={settings.language}
              compactMode={settings.compactMode}
              onThemeChange={(v) => updateSetting('theme', v)}
              onLanguageChange={(v) => updateSetting('language', v)}
              onCompactModeChange={(v) => updateSetting('compactMode', v)}
            />
          )}
          {activeTab === 'notifications' && settings && (
            <NotificationsTab
              emailNotifications={settings.emailNotifications}
              alertsEnabled={settings.alertsEnabled}
              maintenanceReminders={settings.maintenanceReminders}
              weeklyDigest={settings.weeklyDigest}
              onToggle={(key, value) => updateSetting(key as keyof UpdateSettingsDto, value)}
            />
          )}
          {activeTab === 'dashboard' && settings && (
            <DashboardTab
              defaultView={settings.defaultDashboardView}
              refreshInterval={settings.refreshIntervalSec}
              onViewChange={(v) => updateSetting('defaultDashboardView', v)}
              onIntervalChange={(v) => updateSetting('refreshIntervalSec', v)}
            />
          )}
          {activeTab === 'security' && <SecurityTab />}
          {activeTab === 'profile' && <ProfileTab />}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// APPEARANCE TAB
// ============================================================================

function AppearanceTab({
  theme,
  language,
  compactMode,
  onThemeChange,
  onLanguageChange,
  onCompactModeChange,
}: {
  theme: ThemeValue;
  language: LanguageValue;
  compactMode: boolean;
  onThemeChange: (v: ThemeValue) => void;
  onLanguageChange: (v: LanguageValue) => void;
  onCompactModeChange: (v: boolean) => void;
}) {
  const brand = useBrand();
  const themeOptions: { value: ThemeValue; label: string; icon: React.ReactNode }[] = [
    {
      value: 'light',
      label: 'Light',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ),
    },
    {
      value: 'dark',
      label: 'Dark',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      ),
    },
    {
      value: 'system',
      label: 'System',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
    },
  ];

  const languages: { value: LanguageValue; label: string }[] = [
    { value: 'en', label: 'English' },
    { value: 'de', label: 'Deutsch' },
    { value: 'fr', label: 'Fran\u00e7ais' },
    { value: 'es', label: 'Espa\u00f1ol' },
    { value: 'ja', label: '\u65e5\u672c\u8a9e' },
  ];

  return (
    <div className="space-y-6">
      {/* Theme */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-theme-primary mb-2">Theme</h3>
        <p className="text-theme-secondary text-sm mb-4">Choose how {brand.name} looks to you.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {themeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onThemeChange(opt.value)}
              className={cn(
                'flex flex-col items-center gap-2 p-4 rounded-brand border-2 transition-all',
                theme === opt.value
                  ? 'border-cobalt bg-cobalt/10 text-cobalt'
                  : 'border-theme hover:border-theme-strong text-theme-secondary hover:text-theme-primary'
              )}
            >
              {opt.icon}
              <span className="font-medium text-sm">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Language */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-theme-primary mb-2">Language</h3>
        <p className="text-theme-secondary text-sm mb-4">Select your preferred language.</p>
        <select
          value={language}
          onChange={(e) => onLanguageChange(e.target.value as LanguageValue)}
          className="w-full sm:w-64 px-3 py-2 rounded-brand border border-theme section-secondary text-theme-primary focus:outline-none focus:border-cobalt"
        >
          {languages.map((lang) => (
            <option key={lang.value} value={lang.value}>
              {lang.label}
            </option>
          ))}
        </select>
      </div>

      {/* Compact Mode */}
      <div className="card p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-theme-primary">Compact Mode</h3>
            <p className="text-theme-secondary text-sm mt-1">Reduce spacing and padding for denser layouts.</p>
          </div>
          <ToggleSwitch checked={compactMode} onChange={onCompactModeChange} />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// NOTIFICATIONS TAB
// ============================================================================

function NotificationsTab({
  emailNotifications,
  alertsEnabled,
  maintenanceReminders,
  weeklyDigest,
  onToggle,
}: {
  emailNotifications: boolean;
  alertsEnabled: boolean;
  maintenanceReminders: boolean;
  weeklyDigest: boolean;
  onToggle: (key: string, value: boolean) => void;
}) {
  const items = [
    { key: 'emailNotifications', label: 'Email Notifications', description: 'Receive email notifications for important events.', checked: emailNotifications },
    { key: 'alertsEnabled', label: 'Alert Notifications', description: 'Show in-app alerts for robot status changes and errors.', checked: alertsEnabled },
    { key: 'maintenanceReminders', label: 'Maintenance Reminders', description: 'Get reminders for scheduled robot maintenance.', checked: maintenanceReminders },
    { key: 'weeklyDigest', label: 'Weekly Digest', description: 'Receive a weekly summary of fleet activity via email.', checked: weeklyDigest },
  ];

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.key} className="card p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-theme-primary">{item.label}</h3>
              <p className="text-theme-secondary text-sm mt-1">{item.description}</p>
            </div>
            <ToggleSwitch checked={item.checked} onChange={(v) => onToggle(item.key, v)} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// DASHBOARD TAB
// ============================================================================

function DashboardTab({
  defaultView,
  refreshInterval,
  onViewChange,
  onIntervalChange,
}: {
  defaultView: DashboardView;
  refreshInterval: number;
  onViewChange: (v: DashboardView) => void;
  onIntervalChange: (v: number) => void;
}) {
  const views: { value: DashboardView; label: string; description: string }[] = [
    { value: 'fleet', label: 'Fleet Overview', description: 'Map view with all robots' },
    { value: 'robots', label: 'Robot List', description: 'Table view of robot statuses' },
    { value: 'training', label: 'Training', description: 'VLA training dashboard' },
  ];

  const intervals = [5, 10, 15, 30, 60, 120, 300];

  return (
    <div className="space-y-6">
      {/* Default View */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-theme-primary mb-2">Default Dashboard View</h3>
        <p className="text-theme-secondary text-sm mb-4">Choose which view loads when you open the dashboard.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {views.map((v) => (
            <button
              key={v.value}
              onClick={() => onViewChange(v.value)}
              className={cn(
                'flex flex-col items-start p-4 rounded-brand border-2 transition-all text-left',
                defaultView === v.value
                  ? 'border-cobalt bg-cobalt/10'
                  : 'border-theme hover:border-theme-strong'
              )}
            >
              <span className={cn('font-medium text-sm', defaultView === v.value ? 'text-cobalt' : 'text-theme-primary')}>
                {v.label}
              </span>
              <span className="text-xs text-theme-muted mt-1">{v.description}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Refresh Interval */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-theme-primary mb-2">Auto-Refresh Interval</h3>
        <p className="text-theme-secondary text-sm mb-4">How often the dashboard data refreshes automatically.</p>
        <select
          value={refreshInterval}
          onChange={(e) => onIntervalChange(Number(e.target.value))}
          className="w-full sm:w-64 px-3 py-2 rounded-brand border border-theme section-secondary text-theme-primary focus:outline-none focus:border-cobalt"
        >
          {intervals.map((sec) => (
            <option key={sec} value={sec}>
              {sec < 60 ? `${sec} seconds` : `${sec / 60} minute${sec > 60 ? 's' : ''}`}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ============================================================================
// SECURITY TAB (placeholder)
// ============================================================================

function SecurityTab() {
  return (
    <div className="space-y-6">
      {/* Change Password */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-theme-primary mb-2">Change Password</h3>
        <p className="text-theme-secondary text-sm mb-4">Update your account password.</p>
        <div className="space-y-3 max-w-md">
          <input
            type="password"
            placeholder="Current password"
            className="w-full px-3 py-2 rounded-brand border border-theme section-secondary text-theme-primary placeholder:text-theme-muted focus:outline-none focus:border-cobalt"
            disabled
          />
          <input
            type="password"
            placeholder="New password"
            className="w-full px-3 py-2 rounded-brand border border-theme section-secondary text-theme-primary placeholder:text-theme-muted focus:outline-none focus:border-cobalt"
            disabled
          />
          <input
            type="password"
            placeholder="Confirm new password"
            className="w-full px-3 py-2 rounded-brand border border-theme section-secondary text-theme-primary placeholder:text-theme-muted focus:outline-none focus:border-cobalt"
            disabled
          />
          <button
            disabled
            className="px-4 py-2 rounded-brand bg-cobalt text-white text-sm font-medium opacity-50 cursor-not-allowed"
          >
            Update Password
          </button>
        </div>
        <p className="text-xs text-theme-muted mt-3">Password change is not yet available in this version.</p>
      </div>

      {/* 2FA Status */}
      <div className="card p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-theme-primary">Two-Factor Authentication</h3>
            <p className="text-theme-secondary text-sm mt-1">Add an extra layer of security to your account.</p>
          </div>
          <span className="text-xs px-3 py-1 rounded-full bg-cobalt/10 text-cobalt font-medium">
            Managed in Account
          </span>
        </div>
        <p className="text-xs text-theme-muted mt-3">
          Visit your <a href="/account" className="text-cobalt hover:underline">Account page</a> to manage 2FA settings.
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// PROFILE TAB
// ============================================================================

function ProfileTab() {
  const user = useCurrentUser();

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-theme-primary mb-4">Profile Information</h3>
        <div className="space-y-4 max-w-md">
          <div>
            <label className="block text-sm font-medium text-theme-secondary mb-1">Name</label>
            <div className="px-3 py-2 rounded-brand border border-theme section-tertiary text-theme-primary">
              {user?.name || 'N/A'}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-theme-secondary mb-1">Email</label>
            <div className="px-3 py-2 rounded-brand border border-theme section-tertiary text-theme-primary">
              {user?.email || 'N/A'}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-theme-secondary mb-1">Role</label>
            <div className="px-3 py-2 rounded-brand border border-theme section-tertiary text-theme-primary capitalize">
              {user?.role || 'N/A'}
            </div>
          </div>
        </div>
        <p className="text-xs text-theme-muted mt-4">
          Profile information is read-only. Contact an administrator to update your details.
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// TOGGLE SWITCH COMPONENT
// ============================================================================

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0',
        checked ? 'bg-cobalt' : 'bg-gray-600'
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 rounded-full bg-white transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1'
        )}
      />
    </button>
  );
}
