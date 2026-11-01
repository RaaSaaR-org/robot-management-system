/**
 * @file cameraDemoHandlers.ts
 * @description A demo-only camera list for one robot (TASK-441), so the demo
 *              build can show a Head + wrists session. `POST /api/__demo/
 *              robots/:id/cameras` with `{cameras, configured?, source?}` pins
 *              what the robot serves, `{cameras: null}` lets it go. A pinned
 *              robot answers its camera list, a ticket and a still frame per
 *              served camera, and refuses a configured camera that is not
 *              served, as the sidecar would. An unpinned robot falls through to
 *              the other handlers, so every existing demo robot and session is
 *              exactly what it was. Mirrors the readiness override
 *              (`/api/__demo/robots/:id/readiness`). State is in memory per
 *              page load.
 * @feature mocks
 */

import { http, HttpResponse } from 'msw';
import type { RobotCameraList } from '@/features/robots/api/cameraApi';

/** The camera set of `demo-session-wrists`: head first, then the wrists. */
export const DEMO_HEAD_AND_WRISTS = ['head_camera', 'left_wrist_camera', 'right_wrist_camera'];

const pinned = new Map<string, RobotCameraList>();

/** Test hook: let every pinned robot go. */
export function resetCameraDemo(): void {
  pinned.clear();
}

const names = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((v) => typeof v === 'string') ? (value as string[]) : null;

/** A 640x480 still, labelled with the camera it stands in for. */
function frameSvg(camera: string): string {
  const wrist = camera.includes('wrist');
  const hue = camera.startsWith('left') ? 200 : camera.startsWith('right') ? 30 : 140;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
<rect width="640" height="480" fill="hsl(${hue} 25% 14%)"/>
<rect x="0" y="300" width="640" height="180" fill="hsl(30 20% 22%)"/>
${wrist
    ? `<path d="M220 480 L280 250 L360 250 L420 480 Z" fill="hsl(210 8% 58%)"/>
<rect x="300" y="190" width="56" height="56" rx="4" fill="hsl(0 70% 50%)"/>`
    : `<rect x="250" y="250" width="56" height="56" rx="4" fill="hsl(0 70% 50%)"/>
<rect x="420" y="262" width="140" height="80" rx="6" fill="hsl(210 10% 35%)"/>`}
<text x="20" y="40" font-family="sans-serif" font-size="24" fill="hsl(0 0% 88%)">${camera}</text>
</svg>`;
}

/** The pinned list, or `undefined` for "not this handler's robot". */
function listOf(id: unknown): RobotCameraList | undefined {
  return pinned.get(String(id));
}

const notServed = (camera: string) =>
  HttpResponse.json({ error: `${camera} is not being served` }, { status: 404 });

export const cameraDemoHandlers = [
  // Demo-only: pin a robot's camera list, or `{cameras: null}` to let it go.
  http.post('/api/__demo/robots/:id/cameras', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown> | null;
    const id = String(params.id);
    const cameras = names(body?.cameras);
    if (!cameras) {
      pinned.delete(id);
      return HttpResponse.json(null);
    }
    const configured = names(body?.configured);
    const list: RobotCameraList = {
      cameras,
      source: typeof body?.source === 'string' ? body.source : 'pc2cam',
      ...(configured ? { configured } : {}),
    };
    pinned.set(id, list);
    return HttpResponse.json(list);
  }),

  http.get('/api/robots/:id/cameras', ({ params }) => {
    const list = listOf(params.id);
    return list ? HttpResponse.json(list) : undefined;
  }),

  http.post('/api/robots/:id/camera/:name/ticket', ({ params }) => {
    const list = listOf(params.id);
    if (!list) return undefined;
    const camera = String(params.name);
    if (!list.cameras.includes(camera)) return notServed(camera);
    return HttpResponse.json({ ticket: `demo-${camera}`, expiresIn: 120 });
  }),

  // A still, not an MJPEG stream: an <img> shows either, and the demo has no
  // robot to film.
  http.get('/api/robots/:id/camera/:name', ({ params }) => {
    const list = listOf(params.id);
    if (!list) return undefined;
    const camera = String(params.name);
    if (!list.cameras.includes(camera)) return notServed(camera);
    return new HttpResponse(frameSvg(camera), {
      headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' },
    });
  }),
];
