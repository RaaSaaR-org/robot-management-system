/**
 * @file SiteAlignment.test.tsx
 * @description The Info tab's "Alignment" row (TASK-343): the status, the Align
 *              dialog that registers the robot's odometry to its site, and Clear.
 * @feature robots
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FrameRegistration } from '../../../types/robots.types';

const api = vi.hoisted(() => ({
  getFrameRegistration: vi.fn(),
  putFrameRegistration: vi.fn(),
  deleteFrameRegistration: vi.fn(),
  getSitePlaces: vi.fn(),
}));
vi.mock('../../../api/robotsApi', () => ({ robotsApi: api }));

vi.mock('@/shared/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/components/ui')>();
  return { ...actual, confirm: vi.fn(async () => true) };
});

import { SiteAlignment, alignmentStatus } from '../SiteAlignment';

const REGISTRATION: FrameRegistration = {
  robotId: 'robot-1',
  twinId: 'twin-1',
  odomFrameId: 'boot-1',
  x: 3,
  y: 2,
  yawDeg: 90,
  method: 'place-anchor',
  anchorPlaceId: 'AISLE-1',
  createdAt: new Date().toISOString(),
  current: true,
  staleReason: null,
};

describe('alignmentStatus', () => {
  it('trusts the robot: aligned only when it says siteAligned', () => {
    expect(alignmentStatus({ x: 0, y: 0, siteAligned: true }, REGISTRATION)).toMatchObject({
      aligned: true,
      label: 'Aligned',
    });
    expect(alignmentStatus({ x: 0, y: 0, siteAligned: true }, null).detail).toContain('site frame');
    expect(alignmentStatus({ x: 0, y: 0, siteAligned: false }, null)).toEqual({
      aligned: false,
      label: 'Not aligned — fence not enforcing',
      detail: null,
    });
  });

  it("says why a stored registration no longer applies", () => {
    const stale = { ...REGISTRATION, current: false, staleReason: 'odometry restarted since it was measured' };
    expect(alignmentStatus({ x: 0, y: 0, siteAligned: false }, stale).detail).toBe(
      'odometry restarted since it was measured',
    );
  });
});

describe('SiteAlignment (TASK-343)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getFrameRegistration.mockResolvedValue(null);
    api.getSitePlaces.mockResolvedValue([
      { id: 'AISLE-1', name: 'AISLE-1', keepout: false },
      { id: 'RACK-A', name: 'RACK-A', keepout: true },
      { id: 'STAGING', name: 'Staging', keepout: false },
    ]);
  });

  it('renders nothing for a robot without a site', () => {
    const { container } = render(<SiteAlignment robotId="robot-1" twinId={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(api.getFrameRegistration).not.toHaveBeenCalled();
  });

  it('shows an unaligned robot as not enforcing', async () => {
    render(<SiteAlignment robotId="robot-1" twinId="twin-1" location={{ x: 0, y: 0, siteAligned: false }} />);
    await waitFor(() => expect(api.getFrameRegistration).toHaveBeenCalledWith('robot-1'));
    expect(screen.getByTestId('site-alignment-status')).toHaveTextContent('Not aligned — fence not enforcing');
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  it('aligns on a standable place with a heading', async () => {
    api.putFrameRegistration.mockResolvedValue(REGISTRATION);
    render(<SiteAlignment robotId="robot-1" twinId="twin-1" location={{ x: 0, y: 0, siteAligned: false }} />);

    await userEvent.click(screen.getByRole('button', { name: 'Align…' }));
    const place = (await screen.findByLabelText('Anchor place')) as HTMLSelectElement;
    await waitFor(() => expect(place.value).toBe('AISLE-1'));
    // Keepouts are not places a robot stands on.
    expect(screen.queryByRole('option', { name: 'RACK-A' })).toBeNull();

    await userEvent.selectOptions(place, 'STAGING');
    const heading = screen.getByLabelText('Heading in degrees');
    await userEvent.clear(heading);
    await userEvent.type(heading, '90');
    await userEvent.click(screen.getByRole('button', { name: 'Align' }));

    await waitFor(() =>
      expect(api.putFrameRegistration).toHaveBeenCalledWith('robot-1', {
        method: 'place-anchor',
        placeId: 'STAGING',
        headingDeg: 90,
      }),
    );
    expect(await screen.findByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });

  it("shows the server's refusal in the dialog", async () => {
    api.putFrameRegistration.mockRejectedValue(new Error('robot is not connected — its odometry pose is unknown'));
    render(<SiteAlignment robotId="robot-1" twinId="twin-1" location={{ x: 0, y: 0 }} />);

    await userEvent.click(screen.getByRole('button', { name: 'Align…' }));
    await waitFor(() => expect((screen.getByLabelText('Anchor place') as HTMLSelectElement).value).toBe('AISLE-1'));
    await userEvent.click(screen.getByRole('button', { name: 'Align' }));

    expect(await screen.findByText(/not connected/)).toBeInTheDocument();
  });

  it('clears an alignment after a confirm', async () => {
    api.getFrameRegistration.mockResolvedValue(REGISTRATION);
    api.deleteFrameRegistration.mockResolvedValue(undefined);
    render(<SiteAlignment robotId="robot-1" twinId="twin-1" location={{ x: 0, y: 0, siteAligned: true }} />);

    expect(await screen.findByText(/Aligned on AISLE-1/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));

    await waitFor(() => expect(api.deleteFrameRegistration).toHaveBeenCalledWith('robot-1'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull());
  });
});
