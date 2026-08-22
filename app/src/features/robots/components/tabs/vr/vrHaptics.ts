/**
 * @file vrHaptics.ts
 * @description Controller vibration for the VR teleop rig. The operator is
 *              looking at the robot, not at their own hands — every event that
 *              matters (clutch engaged, joint on a stop, link gone, E-Stop) has
 *              to be felt rather than read. No React, no three.js.
 * @feature robots
 */

/**
 * Anything the WebXR input source can hand us as a gamepad. Deliberately
 * `unknown`: a real `XRInputSource.gamepad` is `Gamepad | undefined`, and its
 * haptics are OPTIONAL on every real device, so the only honest static type is
 * "we will find out at runtime".
 *
 * VERIFIED AGAINST `app/node_modules/@types/webxr/index.d.ts` and
 * `node_modules/typescript/lib/lib.dom.d.ts`:
 *
 *  - `@types/webxr` (l.274-288) augments the global `Gamepad` with
 *    `readonly hapticActuators: readonly GamepadHapticActuator[]` and declares
 *    `pulse(value: number, duration: number): Promise<boolean>` on it. Its own
 *    comment says this "should be documented in the Gamepad API, but it is not
 *    yet implemented in any browser... However, it is commonly used in WebXR
 *    applications" — i.e. it is the WebXR-only path, and it is the one the Meta
 *    Quest browser actually implements.
 *  - `lib.dom.d.ts` (l.9360, l.9409) declares `Gamepad.vibrationActuator:
 *    GamepadHapticActuator` with `playEffect(type: GamepadHapticEffectType,
 *    params?: GamepadEffectParameters)`, where the type is
 *    `"dual-rumble" | "trigger-rumble"` (l.29483) and the params are all
 *    optional: `duration`, `startDelay`, `strongMagnitude`, `weakMagnitude`
 *    (l.684-691).
 *
 * Both are present in the type system and NEITHER is present on every device,
 * which is why this tries one then the other and swallows the outcome.
 */
export interface HapticSource {
  readonly handedness?: string;
  readonly gamepad?: unknown;
}

/** Intensity (0..1) and duration (ms) of one pulse. */
export interface HapticPreset {
  intensity: number;
  ms: number;
}

/**
 * The vocabulary. Distinct in BOTH intensity and length, because the hand can
 * only tell two buzzes apart if they differ in more than one dimension:
 *
 *  - `clutchEngage` / `clutchRelease` — short taps confirming the arm is now
 *    yours / no longer yours. The release is deliberately weaker and shorter
 *    than the engage: letting go is the safe direction, and a release that felt
 *    as emphatic as an engage read as an error.
 *  - `saturation` — a light, brief nudge, because it repeats for as long as the
 *    operator holds a pose the arm cannot reach. Anything stronger becomes an
 *    alarm the wearer wants to escape rather than information.
 *  - `estop` — the longest and hardest thing this file can produce. It is the
 *    only unambiguous confirmation that the stop was actually sent, at the one
 *    moment the operator will not trust a colour change.
 *  - `linkLost` — long and mid-strength, distinct from `estop` by being softer
 *    and from `saturation` by lasting ~7x as long.
 *  - `episodeMark` — the confirmation that the left stick click landed and one
 *    episode just became two. Mid-strength and ~4x the length of the clutch
 *    taps, so it cannot be mistaken for a grip; well short of `linkLost` and
 *    much softer than `estop`, because nothing is wrong. The operator gets no
 *    other feedback that the boundary was taken: the desktop episode list is
 *    behind the headset, and the HUD's frame counter only restarts a beat later.
 */
export const HAPTICS = {
  clutchEngage: { intensity: 0.6, ms: 40 },
  clutchRelease: { intensity: 0.25, ms: 25 },
  saturation: { intensity: 0.35, ms: 35 },
  estop: { intensity: 1, ms: 300 },
  linkLost: { intensity: 0.7, ms: 250 },
  episodeMark: { intensity: 0.5, ms: 150 },
} as const satisfies Record<string, HapticPreset>;

/**
 * Minimum gap between pulses on ONE hand, in milliseconds.
 *
 * Saturation is evaluated every rendered frame — 72 to 120 times a second — so
 * without this a single held out-of-range pose would issue a hundred overlapping
 * pulse() calls per second. The Quest's actuator restarts on each call
 * (`@types/webxr`: "Repeated calls to pulse() override the previous calls if
 * they are still ongoing"), so that reads as a continuous, featureless hum
 * rather than a signal. 120 ms is long enough that each pulse is felt as an
 * event and short enough that a genuine sequence of different events is not
 * swallowed.
 */
export const HAPTIC_MIN_GAP_MS = 120;

/**
 * Last pulse time per hand. Module-level and mutable on purpose: the rate limit
 * has to survive across React renders and across the two controllers being
 * handled by different code paths, and threading a clock object through every
 * call site would put the one guard that keeps this usable in the hands of
 * whoever remembers to pass it.
 */
const lastPulseAt = new Map<string, number>();

/** Drop the rate-limit history. Tests only. */
export function resetHaptics(): void {
  lastPulseAt.clear();
}

interface ActuatorLike {
  pulse?: unknown;
  playEffect?: unknown;
}

function actuators(gamepad: unknown): { haptic?: ActuatorLike; vibration?: ActuatorLike } {
  if (typeof gamepad !== 'object' || gamepad === null) return {};
  const g = gamepad as { hapticActuators?: unknown; vibrationActuator?: unknown };
  const list = Array.isArray(g.hapticActuators) ? (g.hapticActuators as ActuatorLike[]) : undefined;
  const haptic = list && list.length > 0 ? list[0] : undefined;
  const vibration =
    typeof g.vibrationActuator === 'object' && g.vibrationActuator !== null
      ? (g.vibrationActuator as ActuatorLike)
      : undefined;
  return { haptic, vibration };
}

/**
 * Buzz one controller. Returns true when a pulse was actually attempted.
 *
 * Every failure path is swallowed. `pulse()` and `playEffect()` both return
 * promises that reject on a device that has no actuator, on a session that has
 * just ended, and on a controller that went to sleep — none of which are
 * reasons to break the render loop, and all of which happen routinely. An
 * unhandled rejection inside `useFrame` is; that is why the `.catch()` is not
 * optional.
 *
 * `now` is injectable so the rate limit can be tested without wall time.
 */
export function pulse(
  source: HapticSource | null | undefined,
  intensity: number,
  ms: number,
  now: number = Date.now(),
): boolean {
  if (!source) return false;
  const value = Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 0;
  const duration = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  if (value <= 0 || duration <= 0) return false;

  const hand = source.handedness ?? 'none';
  const last = lastPulseAt.get(hand);
  if (last !== undefined && Number.isFinite(now) && now - last < HAPTIC_MIN_GAP_MS) return false;

  const { haptic, vibration } = actuators(source.gamepad);

  // hapticActuators[0].pulse() FIRST: it is the WebXR-specific path and the one
  // the Quest browser implements. vibrationActuator/playEffect is the desktop
  // Gamepad API's shape and exists on some runtimes as the only option.
  if (haptic && typeof haptic.pulse === 'function') {
    try {
      const p = (haptic.pulse as (v: number, d: number) => unknown)(value, duration);
      void Promise.resolve(p).catch(() => {});
      lastPulseAt.set(hand, now);
      return true;
    } catch {
      /* fall through to the other actuator */
    }
  }

  if (vibration && typeof vibration.playEffect === 'function') {
    try {
      const p = (
        vibration.playEffect as (type: string, params: Record<string, number>) => unknown
      )('dual-rumble', {
        duration,
        // Both motors: a Quest controller has one, and a desktop pad that has
        // two should not buzz asymmetrically for what is a single event.
        strongMagnitude: value,
        weakMagnitude: value,
      });
      void Promise.resolve(p).catch(() => {});
      lastPulseAt.set(hand, now);
      return true;
    } catch {
      /* no haptics on this device */
    }
  }

  return false;
}

/** Convenience: fire one of the named presets. */
export function pulsePreset(
  source: HapticSource | null | undefined,
  preset: HapticPreset,
  now?: number,
): boolean {
  return pulse(source, preset.intensity, preset.ms, now);
}
