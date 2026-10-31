/**
 * @file cameraDemoHandlers.test.ts
 * @description The demo build's Head + wrists session and the pinned camera
 *              list (TASK-441), through the real api modules: a pinned robot
 *              serves its cameras, an unpinned one is what it was, and the
 *              existing demo sessions stay head only.
 * @feature mocks
 */

import { afterEach, describe, expect, it } from 'vitest';
import { resetCameraDemo } from '@/mocks/cameraDemoHandlers';
import { resetDemoTakes } from '@/mocks/teleopTakesDemoHandlers';
import { resetLiveSessionDemo } from '@/mocks/liveSessionDemoHandlers';
import { fetchCameraTicket, fetchRobotCameras } from '@/features/robots/api/cameraApi';
import { datacollectionApi } from '@/features/datacollection/api/datacollectionApi';
import { apiClient } from '@/api/client';

// The global demo server from `src/test/setup.ts`, as the other stateful demo
// suites use it: a second server here would hold a second copy of the pinned
// list, and which one answers would depend on the transport.
const ROBOT = 'demo-g1-001';
const HEAD_AND_WRISTS = ['head_camera', 'left_wrist_camera', 'right_wrist_camera'];

afterEach(() => {
  resetCameraDemo();
  resetDemoTakes();
  resetLiveSessionDemo();
});

const pin = (body: unknown) => apiClient.post(`/__demo/robots/${ROBOT}/cameras`, body);
const still = (camera: string) =>
  apiClient.get<string>(`/robots/${ROBOT}/camera/${camera}`, { responseType: 'text' });

describe('demo-session-wrists', () => {
  it('records the head and both wrist cameras', async () => {
    const session = await datacollectionApi.getSession('demo-session-wrists');
    expect(session.cameras).toEqual(HEAD_AND_WRISTS);
    expect(session.robotId).toBe(ROBOT);
    expect(session.type).toBe('vr_quest');
  });

  it('leaves the existing demo sessions head only, with no cameras field', async () => {
    for (const id of ['demo-session-takes', 'demo-session-takes-vr']) {
      const session = await datacollectionApi.getSession(id);
      expect('cameras' in session, id).toBe(false);
    }
  });

  it('keeps a created session without cameras without the field, and one with them with them', async () => {
    const headOnly = await datacollectionApi.createSession({ operatorId: 'demo-user', robotId: ROBOT, type: 'vr_quest' });
    expect('cameras' in headOnly).toBe(false);
    const withWrists = await datacollectionApi.createSession({
      operatorId: 'demo-user', robotId: ROBOT, type: 'vr_quest', cameras: HEAD_AND_WRISTS,
    });
    expect(withWrists.cameras).toEqual(HEAD_AND_WRISTS);
  });
});

describe('the pinned camera list', () => {
  it('leaves an unpinned robot to the catch-all, as before', async () => {
    await expect(fetchRobotCameras(ROBOT)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('serves the pinned list, configured included, a ticket and a still per served camera', async () => {
    await pin({ cameras: ['head_camera', 'right_wrist_camera'], configured: HEAD_AND_WRISTS });
    expect(await fetchRobotCameras(ROBOT)).toEqual({
      cameras: ['head_camera', 'right_wrist_camera'],
      configured: HEAD_AND_WRISTS,
      source: 'pc2cam',
    });
    expect(await fetchCameraTicket(ROBOT, 'right_wrist_camera')).toEqual({
      ticket: 'demo-right_wrist_camera',
      expiresIn: 120,
    });
    const frame = await still('right_wrist_camera');
    expect(frame.status).toBe(200);
    expect(String(frame.headers['content-type'])).toBe('image/svg+xml');
    expect(frame.data).toContain('right_wrist_camera');

    // Configured but not served: refused like the sidecar would.
    await expect(fetchCameraTicket(ROBOT, 'left_wrist_camera')).rejects.toMatchObject({ statusCode: 404 });
    await expect(still('left_wrist_camera')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('lets the robot go again', async () => {
    await pin({ cameras: HEAD_AND_WRISTS });
    expect((await fetchRobotCameras(ROBOT)).cameras).toEqual(HEAD_AND_WRISTS);
    await pin({ cameras: null });
    await expect(fetchRobotCameras(ROBOT)).rejects.toMatchObject({ statusCode: 404 });
  });
});
