import { type ReactNode } from 'react';
import { useThemeStore, type ThemeMode } from '@/features/settings';

const themeOptions: { value: ThemeMode; label: string; description: string; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'Light',
    description: 'Always use light mode',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
  },
  {
    value: 'dark',
    label: 'Dark',
    description: 'Always use dark mode',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
      </svg>
    ),
  },
  {
    value: 'system',
    label: 'System',
    description: 'Follow system preference',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
  },
];

export function SettingsPage() {
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-theme-primary">Settings</h1>
        <p className="text-theme-secondary mt-1">Configure your RoboMindOS preferences</p>
      </header>

      {/* Appearance Section */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-theme-primary mb-4">Appearance</h2>
        <p className="text-theme-secondary text-sm mb-4">
          Choose how RoboMindOS looks to you. Select a theme preference below.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {themeOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => setTheme(option.value)}
              className={`flex flex-col items-center gap-2 p-4 rounded-brand border-2 transition-all ${
                theme === option.value
                  ? 'border-cobalt bg-cobalt/10 text-cobalt'
                  : 'border-theme hover:border-theme-strong text-theme-secondary hover:text-theme-primary'
              }`}
            >
              <div className={theme === option.value ? 'text-cobalt' : ''}>
                {option.icon}
              </div>
              <span className="font-medium">{option.label}</span>
              <span className="text-xs text-theme-muted text-center">{option.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
