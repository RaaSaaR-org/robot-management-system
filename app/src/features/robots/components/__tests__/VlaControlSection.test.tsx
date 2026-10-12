/**
 * @file VlaControlSection.test.tsx
 * @description The Skill panel carries no baked-in server address, and on an
 *              offline robot it neither starts a skill nor polls (TASK-388).
 * @feature robots
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const get = vi.fn();
const post = vi.fn();

vi.mock('@/api/client', () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
  },
}));

import { VlaControlSection } from '../VlaControlSection';

beforeEach(() => {
  vi.useFakeTimers();
  get.mockReset();
  get.mockResolvedValue({ data: { active: false, status: null } });
  try {
    localStorage.clear();
  } catch {
    // no storage in this environment
  }
});

afterEach(() => {
  vi.useRealTimers();
});

describe('VlaControlSection', () => {
  it('prefills no private LAN address', () => {
    render(<VlaControlSection robotId="r1" />);
    const url = screen.getByPlaceholderText('http://vla-server:8000') as HTMLInputElement;
    expect(url.value).not.toMatch(/192\.168\./);
  });

  it('polls an online robot', async () => {
    render(<VlaControlSection robotId="r1" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_500);
    });
    expect(get.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('on an offline robot: Start disabled, a reason shown, no polling', async () => {
    render(<VlaControlSection robotId="r1" online={false} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(screen.getByRole('button', { name: /Start skill/ })).toBeDisabled();
    expect(screen.getByTestId('vla-offline-hint')).toHaveTextContent('Robot must be online');
    expect(screen.getByText('Robot offline')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
});
