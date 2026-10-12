/**
 * @file SiteWriteControls.test.tsx
 * @description TASK-376: the twin viewer's side panels offer a viewer only what
 *              the server lets them do. Zone authoring (New zone, Edit, Delete)
 *              is hidden; the scan acts stay visible but disabled with the
 *              reason. A member gets all of them.
 * @feature digitaltwin
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { signInAs } from '@/test/utils';
import { useTwinZoneStore } from '../../store/twinZoneStore';
import { ZonePanel } from '../ZonePanel';
import { ScanSessionPanel } from '../ScanSessionPanel';
import { SITE_EDIT_FORBIDDEN_HINT } from '../../hooks/useCanEditSites';
import type { TwinZoneDTO } from '../../types/twin.types';

const ZONE = {
  id: 'z-1',
  twinId: 't-1',
  name: 'Loading bay',
  type: 'keepout',
  polygon: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
  ],
} as unknown as TwinZoneDTO;

beforeEach(() => {
  useTwinZoneStore.setState({ zones: [ZONE], mode: 'view', selectedZoneId: null });
});

describe('ZonePanel', () => {
  it('gives a viewer the zone list without New zone or row actions', () => {
    signInAs('viewer');
    render(<ZonePanel />);
    expect(screen.getByText('Loading bay')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New zone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions for Loading bay' })).not.toBeInTheDocument();
  });

  it('gives a member New zone and Edit / Delete on each zone', () => {
    signInAs('member');
    render(<ZonePanel />);
    expect(screen.getByRole('button', { name: 'New zone' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Loading bay' }));
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });
});

describe('ScanSessionPanel', () => {
  const panel = (props: Partial<Parameters<typeof ScanSessionPanel>[0]> = {}) => {
    const onStart = vi.fn();
    render(
      <ScanSessionPanel
        robotName="G1"
        status="idle"
        framesCaptured={0}
        coveragePct={0}
        pointCount={0}
        isConnected={false}
        onStart={onStart}
        onStop={vi.fn()}
        onImport={vi.fn()}
        {...props}
      />,
    );
    return { onStart };
  };

  it('disables Start sweep and Import scan with the reason when the role is refused', () => {
    const { onStart } = panel({ forbiddenHint: SITE_EDIT_FORBIDDEN_HINT });
    const start = screen.getByRole('button', { name: 'Start sweep' });
    expect(start).toBeDisabled();
    expect(start).toHaveAttribute('title', SITE_EDIT_FORBIDDEN_HINT);
    fireEvent.click(start);
    expect(onStart).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Import scan' })).toBeDisabled();
  });

  it('disables Stop and build for a refused role mid-sweep', () => {
    panel({ status: 'scanning', forbiddenHint: SITE_EDIT_FORBIDDEN_HINT });
    expect(screen.getByRole('button', { name: 'Stop and build' })).toBeDisabled();
  });

  it('keeps every act enabled without a hint', () => {
    panel();
    expect(screen.getByRole('button', { name: 'Start sweep' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Import scan' })).toBeEnabled();
  });
});
