/**
 * @file VrPanel.tsx
 * @description A world-space text panel for the headset (TASK-407): a plane
 *              textured by `useTextPlate`, recomposed a few times a second from
 *              a callback. Lines carry their own colour; the panel takes an
 *              optional title and background. No font fetch — see `VrTextPlate`.
 *              TASK-418: every piece of VR UI draws OVER the robot model
 *              (`VR_UI_MATERIAL`, `VR_UI_RENDER_ORDER`) — the raised arms used to
 *              hide the REC line and the Stop button.
 * @feature robots
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useTextPlate, type TextPlateDrawOptions, type TextPlateLine } from './VrTextPlate';

/** What a panel shows, recomposed by its `compose` callback. */
export interface VrPanelContent {
  /** Drawn first, dimmer and bold. */
  title?: string;
  titleColor?: string;
  lines: readonly TextPlateLine[];
  /** Backdrop for this draw (the robot panel turns red when latched). */
  background?: string;
  /** A border, for a panel that wants attention. */
  highlight?: string;
}

export interface VrPanelProps {
  /** Plane size, metres. */
  width: number;
  height: number;
  /** Texture size, px. Keep the aspect the plane's. */
  pxWidth: number;
  pxHeight: number;
  linePx?: number;
  position?: [number, number, number];
  /**
   * Called from `useFrame` at `hz`, never per render: the content comes from
   * refs the rig writes 72-120 times a second, and routing it through React
   * state would re-render the whole canvas at that rate.
   */
  compose: () => VrPanelContent;
  hz?: number;
}

const DEFAULT_TITLE_COLOR = 'darkgray';

/**
 * Draw order of the VR UI (TASK-418, D1). The robot model renders at the default
 * 0 with a depth test; every UI layer renders after it with NO depth test, so
 * an arm raised in front of a panel never hides it. Within the UI the order is
 * fixed: the wrist HUD lowest (a raised wrist never covers a button), a button
 * over its plate, the camera strip over the screen, the ray and its hit marker
 * over everything they point at.
 */
export const VR_UI_RENDER_ORDER = {
  hud: 18,
  panel: 20,
  button: 21,
  strip: 22,
  ray: 30,
} as const;

/**
 * Material flags every VR UI surface takes (D1): no depth test, so geometry in
 * front (the robot's arms) never occludes it, and no depth write, so it never
 * punches a hole in what draws after it.
 */
export const VR_UI_MATERIAL = { depthTest: false, depthWrite: false, transparent: true, toneMapped: false } as const;

export function VrPanel({
  width,
  height,
  pxWidth,
  pxHeight,
  linePx = 56,
  position = [0, 0, 0],
  compose,
  hz = 8,
}: VrPanelProps) {
  const plate = useTextPlate({ pxWidth, pxHeight, linePx });
  const lastCompose = useRef(-Infinity);

  useFrame((state) => {
    const now = state.clock.elapsedTime;
    if (now - lastCompose.current < 1 / hz) return;
    lastCompose.current = now;
    const content = compose();
    const lines: TextPlateLine[] = content.title
      ? [{ id: '__title', text: content.title, color: content.titleColor ?? DEFAULT_TITLE_COLOR, bold: true },
        ...content.lines]
      : [...content.lines];
    const options: TextPlateDrawOptions = {};
    if (content.background) options.background = content.background;
    if (content.highlight) options.highlight = content.highlight;
    plate.draw(lines, options);
  });

  if (!plate.texture) return null;
  return (
    <mesh position={position} renderOrder={VR_UI_RENDER_ORDER.panel}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={plate.texture} {...VR_UI_MATERIAL} />
    </mesh>
  );
}
