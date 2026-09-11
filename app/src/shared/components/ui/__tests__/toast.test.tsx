/**
 * @file toast.test.tsx
 * @description Tests for the module-level toast store and the Toaster
 * @feature shared
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { dismissToast, getToasts, toast, useToast, TOAST_DURATION, TOAST_ERROR_DURATION } from '../toast';
import { Toaster } from '../Toaster';

describe('toast store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    dismissToast();
    vi.useRealTimers();
  });

  it('adds toasts with the right tone', () => {
    toast.success('Route created');
    toast.error("Couldn't delete route", { description: 'Server unreachable' });
    toast.info('Syncing');
    toast.warning('Battery low');
    toast('Plain');
    expect(getToasts().map((t) => [t.title, t.tone])).toEqual([
      ['Route created', 'success'],
      ["Couldn't delete route", 'error'],
      ['Syncing', 'info'],
      ['Battery low', 'warning'],
      ['Plain', 'neutral'],
    ]);
    expect(getToasts()[1].description).toBe('Server unreachable');
  });

  it('auto-dismisses after 5 s, errors after 8 s', () => {
    toast.success('Saved');
    toast.error('Failed');
    vi.advanceTimersByTime(TOAST_DURATION);
    expect(getToasts().map((t) => t.title)).toEqual(['Failed']);
    vi.advanceTimersByTime(TOAST_ERROR_DURATION - TOAST_DURATION);
    expect(getToasts()).toHaveLength(0);
  });

  it('keeps sticky toasts until dismissed', () => {
    const id = toast.info('Uploading', { duration: null });
    vi.advanceTimersByTime(60_000);
    expect(getToasts()).toHaveLength(1);
    dismissToast(id);
    expect(getToasts()).toHaveLength(0);
  });

  it('dismisses one toast by id, or all', () => {
    const a = toast('A');
    toast('B');
    toast.dismiss(a);
    expect(getToasts().map((t) => t.title)).toEqual(['B']);
    toast('C');
    toast.dismiss();
    expect(getToasts()).toHaveLength(0);
  });

  it('replaces a toast that reuses an id', () => {
    const id = toast.info('Uploading…', { duration: null });
    toast.success('Uploaded', { id });
    expect(getToasts()).toHaveLength(1);
    expect(getToasts()[0]).toMatchObject({ title: 'Uploaded', tone: 'success' });
  });

  it('keeps at most five toasts, dropping the oldest', () => {
    for (let i = 1; i <= 7; i += 1) toast(`T${i}`);
    expect(getToasts().map((t) => t.title)).toEqual(['T3', 'T4', 'T5', 'T6', 'T7']);
  });

  it('useToast returns the same API', () => {
    function Probe() {
      const api = useToast();
      return <button onClick={() => api.success('From hook')}>fire</button>;
    }
    render(<Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'fire' }));
    expect(getToasts()[0]).toMatchObject({ title: 'From hook', tone: 'success' });
  });
});

describe('Toaster', () => {
  afterEach(() => {
    act(() => dismissToast());
    vi.useRealTimers();
  });

  it('renders toasts in a polite live region and errors as alerts', () => {
    render(<Toaster />);
    act(() => {
      toast.success('Route created', { description: 'Dock A → Hall 3' });
      toast.error("Couldn't save");
    });
    const region = screen.getByRole('region', { name: 'Notifications' });
    expect(region.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(screen.getByText('Route created')).toBeInTheDocument();
    expect(screen.getByText('Dock A → Hall 3')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save");
  });

  it('closes a toast with its close button', () => {
    render(<Toaster />);
    act(() => {
      toast.info('Heads up');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByText('Heads up')).not.toBeInTheDocument();
  });

  it('removes the toast from the screen when it expires', () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => {
      toast.success('Saved');
    });
    expect(screen.getByText('Saved')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION);
    });
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('renders a single stack when mounted twice', () => {
    render(
      <>
        <Toaster />
        <Toaster />
      </>,
    );
    act(() => {
      toast('Once');
    });
    expect(screen.getAllByText('Once')).toHaveLength(1);
  });
});
