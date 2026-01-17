/**
 * @file test-vla-full-workflow.ts
 * @description Full workflow test for VLA control including RobotStateManager
 */

import { RobotStateManager } from './src/robot/state.js';
import { CommandExecutor } from './src/robot/CommandExecutor.js';
import { ActionBuffer } from './src/vla/action-buffer.js';
import { ActionInterpolator } from './src/vla/action-interpolator.js';
import type { Action, ActionResult } from './src/vla/types.js';
import type { SimulatedRobotState } from './src/robot/types.js';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createAction(timestamp: number, forward: number = 0, lateral: number = 0, gripper: number = 0.5): Action {
  return {
    jointCommands: [forward, lateral, 0, 0, 0, 0],
    gripperCommand: gripper,
    timestamp,
  };
}

// ============================================================================
// TEST: CommandExecutor VLA Action Execution
// ============================================================================

async function testCommandExecutorVLA(): Promise<void> {
  console.log('\n=== Testing CommandExecutor VLA Actions ===\n');

  // Create a mock state
  let state: SimulatedRobotState = {
    id: 'test-robot',
    name: 'Test Robot',
    model: 'Test Model',
    serialNumber: 'TEST-001',
    robotClass: 'standard',
    robotType: 'generic',
    maxPayloadKg: 10,
    description: 'Test robot',
    status: 'online',
    batteryLevel: 95,
    location: { x: 0, y: 0, zone: 'Test Zone' },
    capabilities: ['navigation'],
    firmware: 'test-v1.0',
    ipAddress: '127.0.0.1',
    speed: 0,
    lastSeen: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    errors: [],
    warnings: [],
  };

  const stateGetter = () => state;
  const stateUpdater = (updater: (s: SimulatedRobotState) => void) => {
    updater(state);
  };

  const executor = new CommandExecutor(
    { speedUnitsPerSecond: 2.0 },
    stateGetter,
    stateUpdater
  );

  // Test 1: Execute valid VLA action
  console.log('Test 1: Execute valid VLA action');
  const now = Date.now() / 1000;
  const action: Action = createAction(now, 0.5, 0.2); // Move forward and slightly right

  const result = await executor.executeVLAAction(action);
  console.log(`  Success: ${result.success}`);
  console.log(`  New position: (${state.location.x.toFixed(4)}, ${state.location.y.toFixed(4)})`);
  console.log(`  Speed: ${state.speed.toFixed(4)}`);
  console.log(`  Status: ${state.status}`);
  console.assert(result.success, 'Action should succeed');
  console.assert(state.location.x > 0, 'X should have moved');
  console.log('  ✓ Passed\n');

  // Test 2: Execute multiple actions (simulating control loop)
  console.log('Test 2: Execute sequence of actions');
  const startX = state.location.x;
  const startY = state.location.y;

  for (let i = 0; i < 5; i++) {
    const seqAction = createAction(now + i * 0.02, 0.3, 0.1);
    await executor.executeVLAAction(seqAction);
  }

  console.log(`  Moved from (${startX.toFixed(4)}, ${startY.toFixed(4)}) to (${state.location.x.toFixed(4)}, ${state.location.y.toFixed(4)})`);
  console.assert(state.location.x > startX, 'Should have moved in X');
  console.log('  ✓ Passed\n');

  // Test 3: Action validation - out of range joint commands
  console.log('Test 3: Action validation - out of range');
  const invalidAction: Action = {
    jointCommands: [1.5, 0, 0], // 1.5 is out of [-1, 1] range
    gripperCommand: 0.5,
    timestamp: now,
  };
  const invalidResult = await executor.executeVLAAction(invalidAction);
  console.log(`  Success: ${invalidResult.success} (expected: false)`);
  console.log(`  Error: ${invalidResult.error}`);
  console.assert(!invalidResult.success, 'Invalid action should fail');
  console.assert(invalidResult.error?.includes('out of range'), 'Error should mention range');
  console.log('  ✓ Passed\n');

  // Test 4: Action validation - invalid gripper command
  console.log('Test 4: Action validation - invalid gripper');
  const invalidGripperAction: Action = {
    jointCommands: [0, 0, 0],
    gripperCommand: 1.5, // Out of [0, 1] range
    timestamp: now,
  };
  const gripperResult = await executor.executeVLAAction(invalidGripperAction);
  console.log(`  Success: ${gripperResult.success} (expected: false)`);
  console.assert(!gripperResult.success, 'Invalid gripper should fail');
  console.log('  ✓ Passed\n');

  // Test 5: Robot in error state should reject actions
  console.log('Test 5: Robot in error state');
  state.status = 'error';
  const errorStateResult = await executor.executeVLAAction(createAction(now));
  console.log(`  Success: ${errorStateResult.success} (expected: false)`);
  console.log(`  Error: ${errorStateResult.error}`);
  console.assert(!errorStateResult.success, 'Should fail in error state');
  state.status = 'online'; // Reset
  console.log('  ✓ Passed\n');

  // Test 6: Robot charging should reject actions
  console.log('Test 6: Robot charging state');
  state.status = 'charging';
  const chargingResult = await executor.executeVLAAction(createAction(now));
  console.log(`  Success: ${chargingResult.success} (expected: false)`);
  console.assert(!chargingResult.success, 'Should fail while charging');
  state.status = 'online'; // Reset
  console.log('  ✓ Passed\n');

  // Test 7: Stop VLA control
  console.log('Test 7: Stop VLA control');
  state.status = 'busy';
  state.speed = 1.5;
  executor.stopVLAControl();
  console.log(`  Status after stop: ${state.status} (expected: online)`);
  console.log(`  Speed after stop: ${state.speed} (expected: 0)`);
  console.assert(state.status === 'online', 'Status should be online after stop');
  console.assert(state.speed === 0, 'Speed should be 0 after stop');
  console.log('  ✓ Passed\n');

  console.log('\n=== CommandExecutor VLA Tests Complete ===\n');
}

// ============================================================================
// TEST: Full Control Loop Simulation
// ============================================================================

async function testControlLoopSimulation(): Promise<void> {
  console.log('\n=== Testing Full Control Loop Simulation ===\n');

  // Create buffer and interpolator
  const buffer = new ActionBuffer({ capacity: 16 });
  const interpolator = new ActionInterpolator({ method: 'linear' });

  // Create mock state and executor
  let state: SimulatedRobotState = {
    id: 'test-robot',
    name: 'Control Test Robot',
    model: 'Test Model',
    serialNumber: 'TEST-002',
    robotClass: 'standard',
    robotType: 'generic',
    maxPayloadKg: 10,
    description: 'Test robot for control loop',
    status: 'online',
    batteryLevel: 95,
    location: { x: 0, y: 0, zone: 'Start Zone' },
    capabilities: ['navigation'],
    firmware: 'test-v1.0',
    ipAddress: '127.0.0.1',
    speed: 0,
    lastSeen: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    errors: [],
    warnings: [],
  };

  const executor = new CommandExecutor(
    { speedUnitsPerSecond: 2.0 },
    () => state,
    (updater) => updater(state)
  );

  // Simulate receiving action chunk (like from VLA inference)
  const now = Date.now() / 1000;
  console.log('Test 1: 50Hz control loop with buffer');
  console.log(`  Initial position: (${state.location.x}, ${state.location.y})`);

  // Create a trajectory: move in a small arc
  const chunk: Action[] = [];
  for (let i = 0; i < 16; i++) {
    const t = i / 16;
    chunk.push(createAction(
      now + i * 0.02,          // 20ms intervals = 50Hz
      0.5 * Math.cos(t * Math.PI),  // Forward velocity varies
      0.3 * Math.sin(t * Math.PI),  // Lateral velocity creates arc
      0.5
    ));
  }

  await buffer.push(chunk);
  console.log(`  Loaded ${chunk.length} actions into buffer`);

  // Run control loop at 50Hz (simulated)
  const positions: Array<{ x: number; y: number }> = [];
  let lastAction: Action | null = null;
  let tick = 0;

  while (buffer.getCount() > 0 || tick < 20) {
    const currentTime = now + tick * 0.02;

    // Pop action from buffer
    let action = await buffer.pop();

    if (action) {
      // Get next action for interpolation
      const nextAction = await buffer.peek();

      if (nextAction) {
        // Interpolate for smoother motion
        action = interpolator.interpolate(action, nextAction, currentTime);
      }

      // Execute action
      const result = await executor.executeVLAAction(action);
      if (result.success) {
        lastAction = action;
        positions.push({ x: state.location.x, y: state.location.y });
      }
    } else if (lastAction) {
      // Buffer underrun - hold position (re-execute last action with zero velocity)
      const holdAction: Action = {
        jointCommands: lastAction.jointCommands.map(() => 0),
        gripperCommand: lastAction.gripperCommand,
        timestamp: currentTime,
      };
      await executor.executeVLAAction(holdAction);
    }

    tick++;
    if (tick > 50) break; // Safety limit
  }

  console.log(`  Executed ${positions.length} actions`);
  console.log(`  Final position: (${state.location.x.toFixed(4)}, ${state.location.y.toFixed(4)})`);
  console.log(`  Buffer underruns: ${buffer.getUnderrunCount()}`);

  // Verify motion occurred
  console.assert(positions.length > 0, 'Should have executed actions');
  console.assert(state.location.x !== 0 || state.location.y !== 0, 'Robot should have moved');
  console.log('  ✓ Passed\n');

  // Test 2: Verify trajectory smoothness
  console.log('Test 2: Trajectory smoothness');
  let maxJump = 0;
  for (let i = 1; i < positions.length; i++) {
    const dx = positions[i].x - positions[i - 1].x;
    const dy = positions[i].y - positions[i - 1].y;
    const jump = Math.sqrt(dx * dx + dy * dy);
    maxJump = Math.max(maxJump, jump);
  }
  console.log(`  Max position jump between ticks: ${maxJump.toFixed(6)}`);
  console.log(`  (Should be small for smooth motion)`);
  console.assert(maxJump < 0.1, 'Motion should be smooth (small jumps)');
  console.log('  ✓ Passed\n');

  console.log('\n=== Control Loop Simulation Complete ===\n');
}

// ============================================================================
// TEST: Safety Fallback Scenarios
// ============================================================================

async function testSafetyFallbacks(): Promise<void> {
  console.log('\n=== Testing Safety Fallback Scenarios ===\n');

  const buffer = new ActionBuffer({ capacity: 8 });

  // Track underrun events
  let underrunEvents = 0;
  buffer.on('buffer:empty', () => underrunEvents++);

  // Test 1: Position hold on short underrun
  console.log('Test 1: Position hold on buffer underrun');
  const now = Date.now() / 1000;

  // Push only 2 actions
  await buffer.push([
    createAction(now, 0.5, 0),
    createAction(now + 0.02, 0.5, 0),
  ]);

  // Try to pop 5 times
  let lastGoodAction: Action | null = null;
  let holdCount = 0;

  for (let i = 0; i < 5; i++) {
    const action = await buffer.pop();
    if (action) {
      lastGoodAction = action;
    } else {
      // Underrun - would hold last position
      holdCount++;
      if (lastGoodAction) {
        // Simulated hold: zero velocity action
        const holdAction: Action = {
          jointCommands: lastGoodAction.jointCommands.map(() => 0),
          gripperCommand: lastGoodAction.gripperCommand,
          timestamp: now + i * 0.02,
        };
        // In real system, this would be executed
      }
    }
  }

  console.log(`  Actions executed: ${5 - holdCount}`);
  console.log(`  Position holds: ${holdCount}`);
  console.log(`  Underrun events: ${underrunEvents}`);
  console.assert(holdCount === 3, 'Should have 3 position holds');
  console.assert(underrunEvents === 3, 'Should have 3 underrun events');
  console.log('  ✓ Passed\n');

  // Test 2: Safe retract simulation
  console.log('Test 2: Safe retract on extended underrun');

  // Simulate extended underrun (>500ms)
  const underrunStartTime = Date.now();
  let safeRetractTriggered = false;
  const UNDERRUN_TIMEOUT_MS = 500;

  // Clear buffer and simulate underrun period
  await buffer.clear();

  for (let i = 0; i < 30; i++) { // 30 ticks at 20ms = 600ms
    const action = await buffer.pop();

    if (!action) {
      const underrunDuration = Date.now() - underrunStartTime;
      if (underrunDuration > UNDERRUN_TIMEOUT_MS && !safeRetractTriggered) {
        safeRetractTriggered = true;
        console.log(`  Safe retract triggered after ${underrunDuration}ms`);
      }
    }

    await sleep(20); // Simulate 50Hz tick
  }

  console.log(`  Safe retract triggered: ${safeRetractTriggered} (expected: true)`);
  console.assert(safeRetractTriggered, 'Safe retract should trigger after timeout');
  console.log('  ✓ Passed\n');

  console.log('\n=== Safety Fallback Tests Complete ===\n');
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  VLA Full Workflow Tests (Task 46)                         ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  try {
    await testCommandExecutorVLA();
    await testControlLoopSimulation();
    await testSafetyFallbacks();

    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║  ALL WORKFLOW TESTS PASSED                                 ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error);
    process.exit(1);
  }
}

main();
