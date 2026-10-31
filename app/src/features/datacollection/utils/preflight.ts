/**
 * @file preflight.ts
 * @description The pre-flight checklist a created session shows before Start
 *              recording (TASK-392), as a pure function of what the page
 *              already knows: robot status, the agent's live stream, the
 *              robot's camera list, the input device and the control lease.
 *              Only an offline robot blocks; everything else warns, because
 *              recording without video or with a device NeoDEM cannot see is
 *              still a choice the operator may make. TASK-442: a session that
 *              records wrist cameras gets a "Wrist cameras" item, and a chosen
 *              wrist the robot does not serve blocks — the recorder would
 *              refuse the take anyway.
 * @feature datacollection
 */

import type { TeleoperationType } from '../types/datacollection.types';
import { TELEOPERATION_TYPE_LABELS } from '../types/datacollection.types';
import { wristCameraLabel } from './cameras';
import type { ReadinessRowModel, RowStatus } from '../../robots/components/readiness/readinessRows';

export type PreflightLevel = 'ok' | 'warning' | 'blocking' | 'checking' | 'unknown';
export type PreflightId = 'robot' | 'recorder' | 'camera' | 'wrist_cameras' | 'input' | 'control';

export interface PreflightItem {
  id: PreflightId;
  label: string;
  level: PreflightLevel;
  /** One line: what is true right now. */
  detail: string;
  /** What to do about it, when anything. */
  action?: string;
}

export interface PreflightInputs {
  robot: { name: string; online: boolean } | null;
  /** The robot agent's live telemetry stream is connected. */
  agentConnected: boolean;
  cameras: { loading: boolean; names: string[]; source?: string | null; detail?: string };
  /** The wrist cameras the session records (`sessionWristCameras`); absent or empty for head only. */
  wristCameras?: string[];
  sessionType: TeleoperationType;
  /** This page runs in a secure context (HTTPS or localhost). */
  secureContext: boolean;
  /** This browser can open an immersive VR session; null while asking. */
  vrSupported: boolean | null;
  gamepadConnected: boolean;
  /** Present only when the page's inputs need the control lease. */
  lease?: { enabled: boolean; bound: boolean };
}

export interface PreflightSummary {
  blocking: boolean;
  warnings: number;
  /** The single next thing to do. */
  next: string;
}

const VR_TYPES: TeleoperationType[] = ['vr_quest', 'vr_vision_pro'];

/** The session's wrist cameras against what the robot serves right now (TASK-442). */
function wristItem(wrists: string[], inp: PreflightInputs, online: boolean): PreflightItem {
  const label = 'Wrist cameras';
  if (!online) return { id: 'wrist_cameras', label, level: 'unknown', detail: 'Waits for the robot.' };
  if (inp.cameras.loading) return { id: 'wrist_cameras', label, level: 'checking', detail: 'Asking the robot which cameras it has…' };
  const down = wrists.filter((w) => !inp.cameras.names.includes(w));
  if (down.length === 0) {
    return { id: 'wrist_cameras', label, level: 'ok', detail: `${wrists.length} of ${wrists.length} live` };
  }
  const missing = down.map((w) => wristCameraLabel(w) ?? w);
  const first = `${missing[0]} camera${missing.length > 1 ? ` and ${missing.slice(1).map((m) => m.toLowerCase()).join(', ')} camera` : ''}`;
  return {
    id: 'wrist_cameras', label, level: 'blocking',
    detail: missing.length === wrists.length && wrists.length > 1 ? 'Both wrists offline' : `${missing.join(', ')} offline`,
    action: `${first} ${missing.length > 1 ? 'are' : 'is'} not being served. Start the robot's wrist camera service; the list refreshes on its own.`,
  };
}

function inputItem(inp: PreflightInputs): PreflightItem {
  const label = 'Input';
  const name = TELEOPERATION_TYPE_LABELS[inp.sessionType];
  switch (inp.sessionType) {
    case 'vr_quest':
    case 'vr_vision_pro':
      if (inp.vrSupported) {
        return { id: 'input', label, level: 'ok', detail: 'This browser can enter VR.' };
      }
      if (!inp.secureContext) {
        return {
          id: 'input', label, level: 'warning',
          detail: 'This page is not secure, so the browser turns WebXR off.',
          action: 'Open the app over HTTPS, or on localhost through adb reverse, in the headset browser.',
        };
      }
      if (inp.vrSupported === null) {
        return { id: 'input', label, level: 'checking', detail: 'Asking the browser for VR support…' };
      }
      return {
        id: 'input', label, level: 'warning',
        detail: 'No headset on this browser.',
        action: `Open this session in the ${name} browser and press Enter VR, or use Simulate VR input.`,
      };
    case 'gamepad':
      return inp.gamepadConnected
        ? { id: 'input', label, level: 'ok', detail: 'Gamepad connected.' }
        : {
          id: 'input', label, level: 'warning',
          detail: 'No gamepad found.',
          action: 'Connect the gamepad and press any button on it.',
        };
    case 'keyboard_mouse':
      return { id: 'input', label, level: 'ok', detail: 'Keyboard is ready.' };
    default:
      return {
        id: 'input', label, level: 'unknown',
        detail: `NeoDEM cannot see the ${name} from here.`,
        action: `Make sure the ${name} is connected.`,
      };
  }
}

export function buildPreflight(inp: PreflightInputs): PreflightItem[] {
  const items: PreflightItem[] = [];
  const online = !!inp.robot?.online;

  items.push(
    online
      ? { id: 'robot', label: 'Robot', level: 'ok', detail: `${inp.robot!.name} is online.` }
      : {
        id: 'robot', label: 'Robot', level: 'blocking',
        detail: inp.robot ? `${inp.robot.name} is offline.` : 'The robot is not registered or not loaded yet.',
        action: 'Start the robot agent and wait until the robot shows as online.',
      },
  );

  items.push(
    !online
      ? { id: 'recorder', label: 'Recorder', level: 'unknown', detail: 'Waits for the robot.' }
      : inp.agentConnected
        ? { id: 'recorder', label: 'Recorder', level: 'ok', detail: "The robot agent's live stream is connected." }
        : {
          id: 'recorder', label: 'Recorder', level: 'warning',
          detail: "No live stream from the robot agent yet.",
          action: 'Check that the robot agent is running and reachable from the server.',
        },
  );

  if (!online) {
    items.push({ id: 'camera', label: 'Camera', level: 'unknown', detail: 'Waits for the robot.' });
  } else if (inp.cameras.loading) {
    items.push({ id: 'camera', label: 'Camera', level: 'checking', detail: 'Asking the robot which cameras it has…' });
  } else if (inp.cameras.names.length > 0) {
    const src = inp.cameras.source ? ` (${inp.cameras.source})` : '';
    items.push({ id: 'camera', label: 'Camera', level: 'ok', detail: `${inp.cameras.names.join(', ')}${src}` });
  } else {
    items.push({
      id: 'camera', label: 'Camera', level: 'warning',
      detail: `No camera, so episodes record without video${inp.cameras.detail ? `: ${inp.cameras.detail}` : '.'}`,
      action: "Start the robot's camera service or plug in a camera; the list refreshes on its own.",
    });
  }

  const wrists = inp.wristCameras ?? [];
  if (wrists.length > 0) items.push(wristItem(wrists, inp, online));

  items.push(inputItem(inp));

  if (inp.lease?.enabled && !VR_TYPES.includes(inp.sessionType)) {
    items.push(
      inp.lease.bound
        ? { id: 'control', label: 'Control', level: 'ok', detail: 'You hold control of the robot.' }
        : {
          id: 'control', label: 'Control', level: 'warning',
          detail: 'Your input does not move the robot until you take control.',
          action: 'Take control in the Control panel.',
        },
    );
  }

  return items;
}

export function summarizePreflight(items: PreflightItem[]): PreflightSummary {
  const blocker = items.find((i) => i.level === 'blocking');
  const warnings = items.filter((i) => i.level === 'warning');
  const firstWarning = warnings.find((i) => i.action);
  return {
    blocking: !!blocker,
    warnings: warnings.length,
    next: blocker?.action
      ?? firstWarning?.action
      ?? 'Ready. Press Start session (Space).',
  };
}

const ROW_STATUS: Record<PreflightLevel, RowStatus> = {
  ok: 'ok', warning: 'warn', blocking: 'fail', checking: 'pending', unknown: 'unknown',
};

/**
 * The "Wrist cameras" item as a readiness row (TASK-442), so the Set up step
 * and the Cameras cell show it like the robot's own camera row.
 */
export function wristCamerasRow(item: PreflightItem): ReadinessRowModel {
  return {
    id: 'wrist_cameras',
    label: item.label,
    status: ROW_STATUS[item.level],
    value: item.detail,
    detail: item.level === 'checking' ? null : item.action ?? null,
    bringup: false,
    step: null,
  };
}
