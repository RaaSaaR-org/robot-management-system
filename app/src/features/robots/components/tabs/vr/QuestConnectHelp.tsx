/**
 * @file QuestConnectHelp.tsx
 * @description "Connect Meta Quest" — the exact steps to get a Quest 3 onto
 *              this page over USB, with the one command that does the
 *              workstation half (`scripts/quest-connect.sh`) and the URL to
 *              open in the headset. Collapsed by default; open on its own when
 *              the page cannot do WebXR as it is.
 * @feature robots
 */

import { useCallback, useMemo, useState } from 'react';
import { Badge, Button } from '@/shared/components/ui';
import { questConnectCommand, QUEST_DEFAULT_PORT, type LocationLike } from './vrAvailability';

export interface QuestConnectHelpProps {
  /** The page's own location — the URL the headset has to open is derived from it. */
  location: LocationLike;
  /** `window.isSecureContext`; injectable for tests. */
  isSecureContext?: boolean;
  /** Whether this browser exposes WebXR at all; injectable for tests. */
  hasXr?: boolean;
}

interface Step {
  id: string;
  title: string;
  detail: string;
  copy?: { label: string; text: string };
}

/** The steps, in order. Pure, so the copy can be tested without a DOM. */
export function questConnectSteps(location: LocationLike): Step[] {
  const port = location.port || QUEST_DEFAULT_PORT;
  const url = `http://localhost:${port}${location.pathname ?? ''}${location.search ?? ''}`;
  return [
    {
      id: 'dev-mode',
      title: 'Developer Mode on',
      detail: 'Meta Horizon app on your phone → Devices → this headset → Headset settings → Developer mode. Once per headset.',
    },
    {
      id: 'usb',
      title: 'Plug the Quest into this computer',
      detail: 'USB-C into the machine that runs the NeoDEM dev server (the one serving this page), not into a laptop next to it.',
    },
    {
      id: 'allow',
      title: 'Allow USB debugging — inside the headset',
      detail: 'Put the headset on: a dialog asks to allow USB debugging. Tick "Always allow from this computer" and accept. '
        + 'Until you do, adb lists the Quest as "unauthorized" and nothing below works.',
    },
    {
      id: 'script',
      title: 'Run the connect script on this computer',
      detail: 'From the repository root. It finds adb, checks the headset is authorised and forwards the page port — '
        + 'the only port the headset needs: the teleop socket, the camera and the event stream all ride on it.',
      copy: { label: 'Copy command', text: questConnectCommand(port) },
    },
    {
      id: 'open',
      title: 'Open this page in the Quest browser',
      detail: 'localhost is a secure context, so WebXR is available there without a certificate.',
      copy: { label: 'Copy URL', text: url },
    },
    {
      id: 'drive',
      title: 'Take control, then Enter VR',
      detail: 'Grip a controller to hand that arm to the robot; let go and it holds. B or Y stops the robot.',
    },
  ];
}

/**
 * The walkthrough. Rendered collapsed in the VR panel; it opens itself when the
 * page as it stands cannot reach a headset (not a secure context, or no WebXR),
 * because that is exactly when somebody needs it.
 */
export function QuestConnectHelp({ location, isSecureContext, hasXr }: QuestConnectHelpProps) {
  const secure = isSecureContext ?? (typeof window !== 'undefined' && window.isSecureContext === true);
  const xr = hasXr ?? (typeof navigator !== 'undefined' && 'xr' in navigator);
  const steps = useMemo(() => questConnectSteps(location), [location]);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback((id: string, text: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(id);
        setTimeout(() => setCopied(null), 1500);
      })
      .catch(() => { /* clipboard unavailable */ });
  }, []);

  const ready = secure && xr;

  return (
    <details
      className="group rounded-control border border-line bg-inset"
      open={!ready}
      data-testid="quest-connect-help"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2">
        <span className="text-sm font-semibold text-ink-primary">Connect Meta Quest</span>
        <span className="flex items-center gap-2">
          {ready ? (
            <Badge variant="success" size="sm">secure context · WebXR</Badge>
          ) : secure ? (
            <Badge variant="warning" size="sm">no WebXR in this browser</Badge>
          ) : (
            <Badge variant="warning" size="sm">not a secure context</Badge>
          )}
          <span className="text-xs text-ink-tertiary group-open:hidden">Show steps</span>
          <span className="hidden text-xs text-ink-tertiary group-open:inline">Hide</span>
        </span>
      </summary>
      <ol className="flex flex-col gap-2 px-3 pb-3">
        {steps.map((step, i) => (
          <li key={step.id} className="flex gap-2.5" data-testid={`quest-step-${step.id}`}>
            <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-[11px] font-medium tabular-nums text-ink-secondary">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-ink-primary">{step.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-secondary">{step.detail}</p>
              {step.copy && (
                <div className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-tag bg-panel px-2 py-1 font-mono text-xs text-ink-secondary">
                    {step.copy.text}
                  </code>
                  <Button variant="ghost" size="sm" onClick={() => copy(step.id, step.copy!.text)}>
                    {copied === step.id ? 'Copied' : step.copy.label}
                  </Button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}
