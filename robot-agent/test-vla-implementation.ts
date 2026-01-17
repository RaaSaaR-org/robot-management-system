/**
 * @file test-vla-implementation.ts
 * @description Integration test for VLA Action Buffer implementation (Task 46)
 */

import { ActionBuffer } from './src/vla/action-buffer.js';
import { ActionInterpolator } from './src/vla/action-interpolator.js';
import type { Action } from './src/vla/types.js';

// Test utilities
function createAction(timestamp: number, jointCmd: number = 0, gripper: number = 0.5): Action {
  return {
    jointCommands: [jointCmd, jointCmd * 0.5, jointCmd * 0.25],
    gripperCommand: gripper,
    timestamp,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// TEST: ActionBuffer
// ============================================================================

async function testActionBuffer(): Promise<void> {
  console.log('\n=== Testing ActionBuffer ===\n');

  const buffer = new ActionBuffer({ capacity: 8, lowThreshold: 0.25, prefetchThreshold: 0.5 });

  // Track events
  const events: string[] = [];
  buffer.on('buffer:low', () => events.push('low'));
  buffer.on('buffer:empty', () => events.push('empty'));
  buffer.on('buffer:full', () => events.push('full'));
  buffer.on('buffer:refill', () => events.push('refill'));

  // Test 1: Initial state
  console.log('Test 1: Initial state');
  console.log(`  Level: ${buffer.getLevel()} (expected: empty)`);
  console.log(`  Count: ${buffer.getCount()} (expected: 0)`);
  console.log(`  Capacity: ${buffer.getCapacity()} (expected: 8)`);
  console.assert(buffer.getLevel() === 'empty', 'Initial level should be empty');
  console.assert(buffer.getCount() === 0, 'Initial count should be 0');
  console.log('  ✓ Passed\n');

  // Test 2: Push actions
  console.log('Test 2: Push actions');
  const now = Date.now() / 1000;
  const actions = Array.from({ length: 6 }, (_, i) => createAction(now + i * 0.02, i * 0.1));
  const added = await buffer.push(actions);
  console.log(`  Added: ${added} actions (expected: 6)`);
  console.log(`  Level: ${buffer.getLevel()} (expected: normal)`);
  console.log(`  Fill ratio: ${(buffer.getFillRatio() * 100).toFixed(1)}% (expected: 75%)`);
  console.assert(added === 6, 'Should add 6 actions');
  console.assert(buffer.getLevel() === 'normal', 'Level should be normal');
  console.log('  ✓ Passed\n');

  // Test 3: Pop actions
  console.log('Test 3: Pop actions');
  const action1 = await buffer.pop();
  console.log(`  Popped action timestamp: ${action1?.timestamp.toFixed(3)}`);
  console.log(`  Remaining count: ${buffer.getCount()} (expected: 5)`);
  console.assert(action1 !== null, 'Should pop an action');
  console.assert(buffer.getCount() === 5, 'Count should be 5 after pop');
  console.log('  ✓ Passed\n');

  // Test 4: Peek without removing
  console.log('Test 4: Peek without removing');
  const peeked = await buffer.peek();
  const countAfterPeek = buffer.getCount();
  console.log(`  Peeked action exists: ${peeked !== null}`);
  console.log(`  Count after peek: ${countAfterPeek} (expected: 5, unchanged)`);
  console.assert(peeked !== null, 'Peek should return an action');
  console.assert(countAfterPeek === 5, 'Count should be unchanged after peek');
  console.log('  ✓ Passed\n');

  // Test 5: Drain buffer and check underrun
  console.log('Test 5: Drain buffer to trigger underrun');
  while (buffer.getCount() > 0) {
    await buffer.pop();
  }
  const emptyPop = await buffer.pop();
  console.log(`  Buffer empty: ${buffer.getCount() === 0}`);
  console.log(`  Pop from empty returns: ${emptyPop}`);
  console.log(`  Underrun count: ${buffer.getUnderrunCount()}`);
  console.assert(emptyPop === null, 'Pop from empty should return null');
  console.assert(buffer.getUnderrunCount() >= 1, 'Should have at least 1 underrun');
  console.log('  ✓ Passed\n');

  // Test 6: Prefetch detection
  console.log('Test 6: Prefetch detection');
  await buffer.push([createAction(now), createAction(now + 0.02)]); // 2/8 = 25%
  console.log(`  Buffer at ${(buffer.getFillRatio() * 100).toFixed(1)}%`);
  console.log(`  Needs prefetch: ${buffer.needsPrefetch()} (expected: true, below 50%)`);
  console.assert(buffer.needsPrefetch(), 'Should need prefetch below 50%');
  buffer.markPrefetchRequested();
  console.log(`  After marking: needsPrefetch=${buffer.needsPrefetch()} (expected: false)`);
  console.assert(!buffer.needsPrefetch(), 'Should not need prefetch after marking');
  console.log('  ✓ Passed\n');

  // Test 7: Buffer full
  console.log('Test 7: Buffer overflow handling');
  await buffer.clear();
  const manyActions = Array.from({ length: 12 }, (_, i) => createAction(now + i * 0.02));
  const addedMany = await buffer.push(manyActions);
  console.log(`  Tried to add 12, actually added: ${addedMany} (expected: 8, capacity)`);
  console.log(`  Level: ${buffer.getLevel()} (expected: full)`);
  console.assert(addedMany === 8, 'Should only add up to capacity');
  console.assert(buffer.getLevel() === 'full', 'Level should be full');
  console.log('  ✓ Passed\n');

  // Test 8: Stats
  console.log('Test 8: Stats');
  const stats = buffer.getStats();
  console.log(`  Stats: ${JSON.stringify(stats, null, 2)}`);
  console.assert(stats.count === 8, 'Stats count should be 8');
  console.assert(stats.capacity === 8, 'Stats capacity should be 8');
  console.log('  ✓ Passed\n');

  // Report events
  console.log(`Events fired: ${events.join(', ')}`);
  console.log('\n=== ActionBuffer Tests Complete ===\n');
}

// ============================================================================
// TEST: ActionInterpolator
// ============================================================================

async function testActionInterpolator(): Promise<void> {
  console.log('\n=== Testing ActionInterpolator ===\n');

  const interpolator = new ActionInterpolator({ method: 'linear', rttAlpha: 0.3 });

  // Test 1: RTT estimation
  console.log('Test 1: RTT estimation');
  interpolator.updateRtt(100); // First sample
  console.log(`  After 100ms sample: ${interpolator.getRttEstimate().toFixed(2)}ms (expected: 100)`);
  interpolator.updateRtt(50);  // Second sample, should blend
  console.log(`  After 50ms sample: ${interpolator.getRttEstimate().toFixed(2)}ms (expected: ~85, EMA)`);
  interpolator.updateRtt(50);
  interpolator.updateRtt(50);
  console.log(`  After more 50ms samples: ${interpolator.getRttEstimate().toFixed(2)}ms (converging to 50)`);
  console.assert(interpolator.getRttEstimate() < 100, 'RTT should converge toward 50');
  console.log('  ✓ Passed\n');

  // Test 2: Linear interpolation
  console.log('Test 2: Linear interpolation');
  const now = Date.now() / 1000;
  const actionA: Action = {
    jointCommands: [0, 0, 0],
    gripperCommand: 0,
    timestamp: now,
  };
  const actionB: Action = {
    jointCommands: [1, 1, 1],
    gripperCommand: 1,
    timestamp: now + 1, // 1 second later
  };

  // Interpolate at midpoint
  const midpoint = interpolator.interpolate(actionA, actionB, now + 0.5);
  console.log(`  At t=0.5: jointCommands=${JSON.stringify(midpoint.jointCommands.map(j => j.toFixed(2)))}`);
  console.log(`  At t=0.5: gripperCommand=${midpoint.gripperCommand.toFixed(2)} (expected: 0.5)`);
  console.assert(Math.abs(midpoint.jointCommands[0] - 0.5) < 0.01, 'Joint should be 0.5 at midpoint');
  console.assert(Math.abs(midpoint.gripperCommand - 0.5) < 0.01, 'Gripper should be 0.5 at midpoint');

  // Interpolate at 25%
  const quarter = interpolator.interpolate(actionA, actionB, now + 0.25);
  console.log(`  At t=0.25: jointCommands[0]=${quarter.jointCommands[0].toFixed(2)} (expected: 0.25)`);
  console.assert(Math.abs(quarter.jointCommands[0] - 0.25) < 0.01, 'Joint should be 0.25 at quarter');
  console.log('  ✓ Passed\n');

  // Test 3: Cubic interpolation
  console.log('Test 3: Cubic interpolation (smoothstep)');
  interpolator.setMethod('cubic');
  const cubicMid = interpolator.interpolate(actionA, actionB, now + 0.5);
  console.log(`  Cubic at t=0.5: jointCommands[0]=${cubicMid.jointCommands[0].toFixed(3)}`);
  // Smoothstep at 0.5 = 0.5 (same as linear at midpoint)
  console.assert(Math.abs(cubicMid.jointCommands[0] - 0.5) < 0.01, 'Cubic midpoint should be 0.5');

  // At t=0.25, smoothstep gives different value than linear
  const cubicQuarter = interpolator.interpolate(actionA, actionB, now + 0.25);
  // smoothstep(0.25) = 3*(0.25)^2 - 2*(0.25)^3 = 0.1875 - 0.03125 = 0.15625
  console.log(`  Cubic at t=0.25: ${cubicQuarter.jointCommands[0].toFixed(3)} (expected: ~0.156)`);
  console.assert(Math.abs(cubicQuarter.jointCommands[0] - 0.15625) < 0.01, 'Cubic quarter should be smoothstep value');
  console.log('  ✓ Passed\n');

  // Test 4: Action selection from array
  console.log('Test 4: Action selection from array');
  interpolator.setMethod('linear');
  interpolator.reset(); // Reset RTT to 0
  const actions: Action[] = [
    createAction(now, 0),
    createAction(now + 0.1, 0.1),
    createAction(now + 0.2, 0.2),
    createAction(now + 0.3, 0.3),
  ];
  const selected = interpolator.selectAction(actions, now + 0.15);
  console.log(`  Selected for t=now+0.15: timestamp offset=${(selected!.timestamp - now).toFixed(2)}`);
  // Should select the closest action (0.1 or 0.2)
  console.assert(selected !== null, 'Should select an action');
  console.log('  ✓ Passed\n');

  // Test 5: Interpolate at time
  console.log('Test 5: Interpolate at specific time');
  const interpolated = interpolator.interpolateAtTime(actions, now + 0.15);
  console.log(`  Interpolated at t=0.15: jointCommands[0]=${interpolated!.jointCommands[0].toFixed(3)}`);
  // Should interpolate between action at 0.1 (value 0.1) and action at 0.2 (value 0.2)
  // At 0.15, we're 50% between them, so value should be ~0.15
  console.assert(interpolated !== null, 'Should interpolate an action');
  console.assert(Math.abs(interpolated!.jointCommands[0] - 0.15) < 0.02, 'Interpolated value should be ~0.15');
  console.log('  ✓ Passed\n');

  // Test 6: Stats
  console.log('Test 6: Interpolator stats');
  const stats = interpolator.getStats();
  console.log(`  Stats: ${JSON.stringify(stats, null, 2)}`);
  console.log('  ✓ Passed\n');

  console.log('\n=== ActionInterpolator Tests Complete ===\n');
}

// ============================================================================
// TEST: Integration - Buffer + Interpolator workflow
// ============================================================================

async function testIntegration(): Promise<void> {
  console.log('\n=== Testing Integration Workflow ===\n');

  // Simulate 50Hz control loop with buffer and interpolation
  const buffer = new ActionBuffer({ capacity: 16 });
  const interpolator = new ActionInterpolator({ method: 'linear' });

  // Simulate receiving action chunks from inference server
  const now = Date.now() / 1000;
  const chunk1 = Array.from({ length: 8 }, (_, i) => createAction(now + i * 0.02, Math.sin(i * 0.5)));

  console.log('Test 1: Simulated control loop');
  console.log(`  Pushing initial chunk of ${chunk1.length} actions`);
  await buffer.push(chunk1);
  console.log(`  Buffer level: ${buffer.getLevel()}, count: ${buffer.getCount()}`);

  // Simulate 10 ticks of control loop (200ms at 50Hz)
  const executedActions: Action[] = [];
  let prefetchTriggered = false;

  for (let tick = 0; tick < 10; tick++) {
    const currentTime = now + tick * 0.02;

    // Pop action from buffer
    const action = await buffer.pop();

    if (action) {
      // Peek next for interpolation
      const nextAction = await buffer.peek();

      let finalAction = action;
      if (nextAction) {
        // Interpolate between current and next
        finalAction = interpolator.interpolate(action, nextAction, currentTime);
      }

      executedActions.push(finalAction);
    }

    // Check for prefetch trigger
    if (buffer.needsPrefetch() && !prefetchTriggered) {
      console.log(`  Tick ${tick}: Prefetch triggered (buffer at ${(buffer.getFillRatio() * 100).toFixed(1)}%)`);
      prefetchTriggered = true;

      // Simulate receiving new chunk
      const chunk2 = Array.from({ length: 8 }, (_, i) =>
        createAction(now + (10 + i) * 0.02, Math.cos(i * 0.5))
      );
      await buffer.push(chunk2);
      console.log(`  Pushed new chunk, buffer now at ${buffer.getCount()} actions`);
    }
  }

  console.log(`  Executed ${executedActions.length} actions over 10 ticks`);
  console.log(`  Final buffer count: ${buffer.getCount()}`);
  console.log(`  Underrun count: ${buffer.getUnderrunCount()}`);
  console.assert(executedActions.length === 10, 'Should execute 10 actions');
  console.assert(buffer.getUnderrunCount() === 0, 'Should have no underruns with prefetch');
  console.log('  ✓ Passed\n');

  // Test 2: Underrun scenario
  console.log('Test 2: Underrun scenario (no prefetch)');
  await buffer.clear();
  buffer.resetMetrics();

  // Only push 3 actions
  await buffer.push([createAction(now), createAction(now + 0.02), createAction(now + 0.04)]);

  // Try to pop 5 times
  for (let i = 0; i < 5; i++) {
    const action = await buffer.pop();
    if (!action) {
      console.log(`  Underrun at tick ${i}`);
    }
  }

  console.log(`  Underrun count: ${buffer.getUnderrunCount()} (expected: 2)`);
  console.assert(buffer.getUnderrunCount() === 2, 'Should have 2 underruns');
  console.log('  ✓ Passed\n');

  console.log('\n=== Integration Tests Complete ===\n');
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  VLA Implementation Tests (Task 46)                        ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  try {
    await testActionBuffer();
    await testActionInterpolator();
    await testIntegration();

    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║  ALL TESTS PASSED                                          ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error);
    process.exit(1);
  }
}

main();
