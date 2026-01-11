/**
 * @file BiasPreventionBanner.tsx
 * @description Banner warning about automation bias per EU AI Act Art. 14(3)
 * @feature oversight
 */

import { useState } from 'react';
import { AlertTriangle, X, Info } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';

// ============================================================================
// TYPES
// ============================================================================

export interface BiasPreventionBannerProps {
  variant?: 'reminder' | 'warning' | 'critical';
  message?: string;
  dismissable?: boolean;
  onDismiss?: () => void;
  className?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_MESSAGES: Record<string, string> = {
  reminder:
    'Remember to independently verify AI recommendations. Critical decisions require human judgment.',
  warning:
    'AI confidence is lower than usual. Exercise additional caution when reviewing AI-generated suggestions.',
  critical:
    'Multiple anomalies detected. Carefully evaluate all AI outputs before taking action.',
};

const VARIANT_STYLES = {
  reminder: {
    bg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
    text: 'text-blue-800 dark:text-blue-200',
    icon: Info,
  },
  warning: {
    bg: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
    text: 'text-yellow-800 dark:text-yellow-200',
    icon: AlertTriangle,
  },
  critical: {
    bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
    text: 'text-red-800 dark:text-red-200',
    icon: AlertTriangle,
  },
};

// ============================================================================
// COMPONENT
// ============================================================================

export function BiasPreventionBanner({
  variant = 'reminder',
  message,
  dismissable = true,
  onDismiss,
  className,
}: BiasPreventionBannerProps) {
  const [isDismissed, setIsDismissed] = useState(false);

  if (isDismissed) return null;

  const styles = VARIANT_STYLES[variant];
  const Icon = styles.icon;
  const displayMessage = message ?? DEFAULT_MESSAGES[variant];

  const handleDismiss = () => {
    setIsDismissed(true);
    onDismiss?.();
  };

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-4 rounded-lg border',
        styles.bg,
        styles.text,
        className
      )}
      role="alert"
    >
      <Icon className="h-5 w-5 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">Automation Bias Prevention</p>
        <p className="text-sm mt-1 opacity-90">{displayMessage}</p>
        <p className="text-xs mt-2 opacity-75">
          EU AI Act Art. 14(3) - Measures to prevent over-reliance on AI outputs
        </p>
      </div>
      {dismissable && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDismiss}
          className="flex-shrink-0 -mt-1 -mr-1"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
