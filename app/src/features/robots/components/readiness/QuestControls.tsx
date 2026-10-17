/**
 * @file QuestControls.tsx
 * @description The Meta Quest buttons (TASK-412), shared by the readiness
 *              panel's Quest row and the VR launcher's "Connect Meta Quest":
 *              **Connect** forwards the page port to the headset (`adb reverse`
 *              on the robot PC, through the supervisor), **Open on headset**
 *              starts the Quest browser on `/data-collection/live?robot=<id>` —
 *              a stable URL that always lands on the robot's live session —
 *              connecting first when the port is not forwarded yet, and **Copy
 *              viewer link** copies the session page for a second person.
 *              "Enter VR" stays a press inside the headset (WebXR needs a user
 *              gesture there). Nothing here touches the robot.
 * @feature robots
 */

import { useCallback, useState } from 'react';
import { Cable, Glasses, Link2 } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { cn } from '@/shared/utils/cn';
import {
  questConnect as defaultConnect,
  questLivePath,
  questOpen as defaultOpen,
  questPagePort,
  type BringupResult,
  type QuestReport,
} from '../../api/readinessApi';
import { useReadinessStore } from '../../store/readinessStore';
import { questSummary } from './readinessRows';

export interface QuestControlsApi {
  questConnect(robotId: string, port?: number): Promise<BringupResult>;
  questOpen(robotId: string, path: string, port?: number): Promise<BringupResult>;
}

export interface QuestControlsProps {
  robotId: string;
  quest: QuestReport;
  /** The session this page shows; adds "Copy viewer link". */
  sessionId?: string | null;
  /** The page port the headset reaches (default: this page's). */
  port?: number;
  api?: QuestControlsApi;
  /** `window.location.origin`, injectable for tests. */
  origin?: string;
  className?: string;
}

const DEFAULT_API: QuestControlsApi = { questConnect: defaultConnect, questOpen: defaultOpen };

/** `<origin>/data-collection/<sessionId>` — the desktop page for the second person. */
export function viewerLink(origin: string, sessionId: string): string {
  return `${origin.replace(/\/$/, '')}/data-collection/${sessionId}`;
}

/** Put the Quest report an action answered with into the store, so the row updates at once. */
function adoptQuestReport(robotId: string, result: BringupResult): void {
  if (!result.ok) return;
  const quest = (result.body as { quest?: unknown }).quest;
  const entry = useReadinessStore.getState().byRobot[robotId];
  if (!entry || !quest || typeof quest !== 'object') return;
  useReadinessStore.getState().put({ ...entry.readiness, quest: quest as QuestReport });
}

export function QuestControls({
  robotId,
  quest,
  sessionId = null,
  port: portProp,
  api = DEFAULT_API,
  origin,
  className,
}: QuestControlsProps) {
  const port = portProp ?? questPagePort();
  const summary = questSummary(quest, port);
  const livePath = questLivePath(robotId);
  const [pending, setPending] = useState<'connect' | 'open' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const usable = summary.phase === 'connected' || summary.phase === 'forwarded';

  const connect = useCallback(async (): Promise<boolean> => {
    const r = await api.questConnect(robotId, port);
    adoptQuestReport(robotId, r);
    if (!r.ok) setMessage({ tone: 'error', text: `Connect failed: ${r.error}` });
    return r.ok;
  }, [api, robotId, port]);

  const onConnect = async () => {
    setPending('connect');
    setMessage(null);
    try {
      if (await connect()) setMessage({ tone: 'ok', text: `Port ${port} forwarded — localhost:${port} in the headset is this page.` });
    } finally {
      setPending(null);
    }
  };

  const onOpen = async () => {
    if (!livePath) return;
    setPending('open');
    setMessage(null);
    try {
      if (!summary.forwarded && !(await connect())) return;
      const r = await api.questOpen(robotId, livePath, port);
      adoptQuestReport(robotId, r);
      setMessage(
        r.ok
          ? { tone: 'ok', text: 'Opened in the Quest browser. Put on the headset and press Enter VR.' }
          : { tone: 'error', text: `Open failed: ${r.error}` },
      );
    } finally {
      setPending(null);
    }
  };

  const onCopy = () => {
    if (!sessionId) return;
    const link = viewerLink(origin ?? window.location.origin, sessionId);
    // No clipboard on a plain-http LAN origin (not a secure context): show the
    // link to copy by hand rather than doing nothing.
    if (!navigator.clipboard?.writeText) {
      setMessage({ tone: 'error', text: `Copy is not available on this page — the link is ${link}` });
      return;
    }
    navigator.clipboard
      .writeText(link)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => setMessage({ tone: 'error', text: `Copy failed — the link is ${link}` }));
  };

  return (
    <div className={cn('flex flex-col gap-1.5', className)} data-testid="quest-controls" data-phase={summary.phase}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<Cable className="h-4 w-4" strokeWidth={1.75} />}
          onClick={() => void onConnect()}
          disabled={!usable || pending !== null}
          isLoading={pending === 'connect'}
          loadingText="Connecting…"
          title={usable ? `adb reverse tcp:${port} tcp:${port} on the robot PC` : summary.text}
          data-testid="quest-connect"
        >
          {summary.forwarded ? 'Reconnect' : 'Connect'}
        </Button>
        <Button
          size="sm"
          leftIcon={<Glasses className="h-4 w-4" strokeWidth={1.75} />}
          onClick={() => void onOpen()}
          disabled={!usable || !livePath || pending !== null}
          isLoading={pending === 'open'}
          loadingText="Opening…"
          title={livePath ? `Opens http://localhost:${port}${livePath} in the Quest browser` : 'This robot id cannot be put in the headset URL'}
          data-testid="quest-open"
        >
          Open on headset
        </Button>
        {sessionId && (
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<Link2 className="h-4 w-4" strokeWidth={1.75} />}
            onClick={onCopy}
            data-testid="quest-copy-viewer-link"
          >
            {copied ? 'Copied' : 'Copy viewer link'}
          </Button>
        )}
      </div>
      {message && (
        <p
          className={cn('select-text break-all text-[12px]', message.tone === 'error' ? 'text-signal-stopped' : 'text-ink-secondary')}
          role={message.tone === 'error' ? 'alert' : 'status'}
          data-testid="quest-message"
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
