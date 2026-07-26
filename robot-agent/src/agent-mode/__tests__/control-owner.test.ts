/**
 * @file control-owner.test.ts
 * @description Exclusive control arbitration: teleop preempts everything, VLA
 *              and Agent Mode refuse to take a lock somebody else holds.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, vi } from 'vitest';
import { ControlOwnerLock, type OwnerChange } from '../control-owner.js';

describe('ControlOwnerLock', () => {
  it('starts idle', () => {
    expect(new ControlOwnerLock().get()).toBe('idle');
  });

  it('grants the lock from idle', () => {
    const lock = new ControlOwnerLock();
    expect(lock.claim('agent')).toEqual({ ok: true });
    expect(lock.get()).toBe('agent');
  });

  it('is idempotent for the current owner', () => {
    const lock = new ControlOwnerLock();
    lock.claim('agent');
    expect(lock.claim('agent')).toEqual({ ok: true });
    expect(lock.get()).toBe('agent');
  });

  it('refuses VLA while Agent Mode owns control', () => {
    const lock = new ControlOwnerLock();
    lock.claim('agent');

    const claim = lock.claim('vla');

    expect(claim.ok).toBe(false);
    expect(claim.reason).toMatch(/Agent Mode/);
    expect(lock.get()).toBe('agent');
  });

  it('refuses Agent Mode while a VLA rollout owns control', () => {
    const lock = new ControlOwnerLock();
    lock.claim('vla');

    const claim = lock.claim('agent');

    expect(claim.ok).toBe(false);
    expect(claim.reason).toMatch(/VLA skill rollout/);
    expect(lock.get()).toBe('vla');
  });

  it('lets human teleop preempt Agent Mode', () => {
    const lock = new ControlOwnerLock();
    lock.claim('agent');

    const claim = lock.claim('teleop');

    expect(claim.ok).toBe(true);
    expect(claim.preempted).toBe('agent');
    expect(lock.get()).toBe('teleop');
  });

  it('lets human teleop preempt a VLA rollout too', () => {
    const lock = new ControlOwnerLock();
    lock.claim('vla');

    expect(lock.claim('teleop')).toEqual({ ok: true, preempted: 'vla' });
  });

  it('reports no preemption when teleop takes an idle lock', () => {
    const lock = new ControlOwnerLock();
    expect(lock.claim('teleop')).toEqual({ ok: true });
  });

  it('notifies subscribers with the preemption flag', () => {
    const lock = new ControlOwnerLock();
    const changes: OwnerChange[] = [];
    lock.subscribe((c) => changes.push(c));

    lock.claim('agent');
    lock.claim('teleop');
    lock.release('teleop');

    expect(changes).toEqual([
      { previous: 'idle', next: 'agent', preempted: false },
      { previous: 'agent', next: 'teleop', preempted: true },
      { previous: 'teleop', next: 'idle', preempted: false },
    ]);
  });

  it('does NOT free the lock when only one of two holders releases', () => {
    const lock = new ControlOwnerLock();
    // Two teleop sockets — an ordinary state, not a race: four frontend views
    // open /ws/keyboard-teleop and each one claims.
    lock.claim('teleop');
    lock.claim('teleop');
    expect(lock.holderCount()).toBe(2);

    lock.release('teleop');

    // A human is still at the controls on the other socket.
    expect(lock.get()).toBe('teleop');
    expect(lock.holderCount()).toBe(1);

    lock.release('teleop');

    expect(lock.get()).toBe('idle');
    expect(lock.holderCount()).toBe(0);
  });

  it('emits no owner-change events for nested claims and releases', () => {
    const lock = new ControlOwnerLock();
    const changes: OwnerChange[] = [];
    lock.subscribe((c) => changes.push(c));

    lock.claim('teleop');
    lock.claim('teleop');
    lock.release('teleop');
    lock.release('teleop');

    expect(changes).toEqual([
      { previous: 'idle', next: 'teleop', preempted: false },
      { previous: 'teleop', next: 'idle', preempted: false },
    ]);
  });

  it('a preempting teleop claim replaces the previous owner’s holders', () => {
    const lock = new ControlOwnerLock();
    lock.claim('agent');

    lock.claim('teleop');
    expect(lock.holderCount()).toBe(1);

    // The displaced owner's late release must not touch the human's lock.
    lock.release('agent');
    expect(lock.get()).toBe('teleop');

    lock.release('teleop');
    expect(lock.get()).toBe('idle');
  });

  it('reset() drops every holder', () => {
    const lock = new ControlOwnerLock();
    lock.claim('teleop');
    lock.claim('teleop');

    lock.reset();

    expect(lock.get()).toBe('idle');
    expect(lock.holderCount()).toBe(0);
  });

  it('never counts holders below zero on an over-release', () => {
    const lock = new ControlOwnerLock();
    lock.claim('agent');
    lock.release('agent');
    lock.release('agent'); // owner is already idle — no-op

    expect(lock.get()).toBe('idle');
    expect(lock.holderCount()).toBe(0);
    expect(lock.claim('agent')).toEqual({ ok: true });
    expect(lock.get()).toBe('agent');
  });

  it('ignores a release from a non-owner', () => {
    const lock = new ControlOwnerLock();
    lock.claim('agent');

    lock.release('vla');

    expect(lock.get()).toBe('agent');
  });

  it('keeps working when a listener throws', () => {
    const lock = new ControlOwnerLock();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    lock.subscribe(() => {
      throw new Error('boom');
    });

    expect(() => lock.claim('agent')).not.toThrow();
    expect(lock.get()).toBe('agent');
    spy.mockRestore();
  });
});
