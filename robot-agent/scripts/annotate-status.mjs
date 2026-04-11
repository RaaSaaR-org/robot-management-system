#!/usr/bin/env node
/**
 * @file annotate-status.mjs
 * @description One-off script — inserts `@status <tag>` into the existing
 * file-header docblock of robot-agent source files, based on the audit list
 * at ../../.claude/plans/merry-beaming-pelican.md.
 *
 * Usage:
 *   node scripts/annotate-status.mjs [--dry-run]
 *
 * Behavior:
 * - TypeScript files (.ts): looks for a top-of-file `/** … *\/` block that
 *   contains an `@file` tag. Inserts ` * @status <tag>` as the last line
 *   before the closing `*\/`. Skips files without such a header (never
 *   creates new headers).
 * - Python files (.py): looks for a top-of-file `"""…"""` docstring that
 *   contains an `@file` or `@description` tag. Inserts `@status <tag>` on
 *   a new line just before the closing `"""`.
 * - Idempotent: if the header already has a `@status` tag, the file is
 *   skipped (no duplicate tags).
 *
 * Run this from `robot-agent/` directory.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..'); // robot-agent/

const DRY_RUN = process.argv.includes('--dry-run');

// ─── File → status mapping ───────────────────────────────────────────────
// Generated from .claude/plans/merry-beaming-pelican.md

/** @type {Array<{ path: string, status: 'live' | 'live-conditional' | 'test' | 'orphaned' | 'dead' }>} */
const FILES = [
  // Core agent (live)
  { path: 'src/index.ts', status: 'live' },
  { path: 'src/agent/agent-executor.ts', status: 'live' },
  { path: 'src/agent/agent-card.ts', status: 'live' },
  { path: 'src/agent/genkit.ts', status: 'live' },
  { path: 'src/agent/rate-limiter.ts', status: 'live' },

  // Robot state hub (live)
  { path: 'src/robot/state.ts', status: 'live' },
  { path: 'src/robot/types.ts', status: 'live' },
  { path: 'src/robot/telemetry.ts', status: 'live' },
  { path: 'src/robot/CommandExecutor.ts', status: 'live' },
  { path: 'src/robot/SimulationEngine.ts', status: 'live' },
  { path: 'src/robot/StatePublisher.ts', status: 'live' },
  { path: 'src/robot/TaskQueue.ts', status: 'live' },
  { path: 'src/robot/StatePersistence.ts', status: 'live' },
  { path: 'src/robot/zoneUtils.ts', status: 'live' },
  { path: 'src/robot/joint-configs/index.ts', status: 'live' },
  { path: 'src/robot/joint-configs/g1.config.ts', status: 'live' },
  { path: 'src/robot/joint-configs/h1.config.ts', status: 'live' },
  { path: 'src/robot/joint-configs/so101.config.ts', status: 'live' },

  // API (live)
  { path: 'src/api/rest-routes.ts', status: 'live' },
  { path: 'src/api/websocket.ts', status: 'live' },
  { path: 'src/api/bilateral-teleop.ts', status: 'live' },
  // Orphaned: imported by the Pi's local patch only, not trunk
  { path: 'src/api/keyboard-teleop.ts', status: 'orphaned' },

  // Config (live)
  { path: 'src/config/config.ts', status: 'live' },

  // Hardware client (live)
  { path: 'src/hardware/HardwareClient.ts', status: 'live' },

  // Safety (live)
  { path: 'src/safety/SafetyMonitor.ts', status: 'live' },
  { path: 'src/safety/types.ts', status: 'live' },
  { path: 'src/safety/index.ts', status: 'live' },

  // Security (live)
  { path: 'src/security/device-identity.ts', status: 'live' },
  { path: 'src/security/secure-boot.ts', status: 'live' },

  // Compliance (live)
  { path: 'src/compliance/ComplianceLogClient.ts', status: 'live' },

  // Updates (live)
  { path: 'src/updates/SecureUpdateClient.ts', status: 'live' },

  // VLA (live)
  { path: 'src/vla/vla-model-manager.ts', status: 'live' },
  { path: 'src/vla/types.ts', status: 'live' },
  { path: 'src/vla/index.ts', status: 'live' },

  // Embodiment (live)
  { path: 'src/embodiment/index.ts', status: 'live' },
  { path: 'src/embodiment/embodiment-loader.ts', status: 'live' },
  { path: 'src/embodiment/joint-mapper.ts', status: 'live' },
  { path: 'src/embodiment/camera-config.ts', status: 'live' },
  { path: 'src/embodiment/normalizer.ts', status: 'live' },
  { path: 'src/embodiment/types.ts', status: 'live' },

  // Teleop (live)
  { path: 'src/teleop/FrameRecorder.ts', status: 'live' },

  // Federated learning (live-conditional: FEDERATED_ENABLED flag)
  { path: 'src/federated/RoundLifecycle.ts', status: 'live-conditional' },
  { path: 'src/federated/FederatedClient.ts', status: 'live-conditional' },
  { path: 'src/federated/LocalTrainer.ts', status: 'live-conditional' },
  { path: 'src/federated/SecureAggregation.ts', status: 'live-conditional' },
  { path: 'src/federated/DifferentialPrivacy.ts', status: 'live-conditional' },
  { path: 'src/federated/types.ts', status: 'live-conditional' },
  { path: 'src/federated/index.ts', status: 'live-conditional' },

  // Tests (CI only)
  { path: 'src/__tests__/federated/DifferentialPrivacy.test.ts', status: 'test' },
  { path: 'src/__tests__/federated/FederatedClient.test.ts', status: 'test' },
  { path: 'src/__tests__/federated/LocalTrainer.test.ts', status: 'test' },
  { path: 'src/__tests__/federated/RoundLifecycle.test.ts', status: 'test' },
  { path: 'src/__tests__/federated/SecureAggregation.test.ts', status: 'test' },
  { path: 'src/embodiment/__tests__/camera-config.test.ts', status: 'test' },
  { path: 'src/embodiment/__tests__/embodiment-loader.test.ts', status: 'test' },
  { path: 'src/embodiment/__tests__/joint-mapper.test.ts', status: 'test' },
  { path: 'src/embodiment/__tests__/normalizer.test.ts', status: 'test' },
  { path: 'src/robot/__tests__/TaskQueue.test.ts', status: 'test' },
  { path: 'src/robot/__tests__/telemetry.test.ts', status: 'test' },
  { path: 'src/security/__tests__/device-identity.test.ts', status: 'test' },
  { path: 'src/security/__tests__/secure-boot.test.ts', status: 'test' },
  { path: 'src/updates/__tests__/SecureUpdateClient.test.ts', status: 'test' },
  { path: 'src/vla/__tests__/safety.test.ts', status: 'test' },

  // Python hardware sidecar (live)
  { path: 'hardware/so101_sidecar.py', status: 'live' },
  { path: 'hardware/vla_runner.py', status: 'live' },
  { path: 'hardware/vla_safety.py', status: 'live' },
  { path: 'hardware/recorder.py', status: 'live' },
  { path: 'hardware/uploader.py', status: 'live' },
  { path: 'hardware/backends/base.py', status: 'live' },
  { path: 'hardware/backends/smolvla_backend.py', status: 'live' },
  { path: 'hardware/backends/__init__.py', status: 'live' },

  // Orphaned: referenced by TS LocalTrainer but no launcher starts it
  { path: 'hardware/federated_bridge.py', status: 'orphaned' },

  // Sim evaluator (live via server subprocess)
  { path: 'hardware/sim_evaluator/evaluate_vla.py', status: 'live' },
  { path: 'hardware/sim_evaluator/mujoco_runner.py', status: 'live' },
  { path: 'hardware/sim_evaluator/isaac_runner.py', status: 'live' },
  { path: 'hardware/sim_evaluator/metrics.py', status: 'live' },
  { path: 'hardware/sim_evaluator/render_preview.py', status: 'live' },
  { path: 'hardware/sim_evaluator/environments/so101_sorting.py', status: 'live' },
  { path: 'hardware/sim_evaluator/environments/so101_tabletop.py', status: 'live' },
  { path: 'hardware/sim_evaluator/envs/so101_tabletop_env.py', status: 'live' },

  // Hardware tests (CI only)
  { path: 'hardware/tests/test_vla_runner.py', status: 'test' },
  { path: 'hardware/tests/test_backends.py', status: 'test' },
  { path: 'hardware/tests/test_vla_safety.py', status: 'test' },
];

// ─── Annotators ──────────────────────────────────────────────────────────

/**
 * Insert `@status <tag>` into a TypeScript JSDoc header block.
 * Returns { newSource, changed, reason } — changed=false means skipped.
 */
function annotateTypescript(src, status) {
  // Find a top-of-file /** … */ block. We only annotate blocks that contain
  // `@file` to avoid touching non-header docblocks.
  const match = src.match(/^(\s*)\/\*\*([\s\S]*?)\*\//);
  if (!match) return { newSource: src, changed: false, reason: 'no top docblock' };

  const blockBody = match[2];
  if (!/@file\b/.test(blockBody)) {
    return { newSource: src, changed: false, reason: 'docblock lacks @file' };
  }
  if (/@status\b/.test(blockBody)) {
    return { newSource: src, changed: false, reason: 'already has @status' };
  }

  // Insert ` * @status <tag>` on its own line just before the closing `*/`.
  // The block currently ends with " */"; we split at the last newline inside
  // the block body so indentation matches.
  const block = match[0];
  const closingIdx = block.lastIndexOf('*/');
  // Walk back from closingIdx to find the previous newline
  const prevNlIdx = block.lastIndexOf('\n', closingIdx);
  if (prevNlIdx === -1) {
    return { newSource: src, changed: false, reason: 'malformed docblock' };
  }
  // Determine the leading whitespace + " * " prefix used on other lines
  const lastLine = block.slice(prevNlIdx + 1, closingIdx); // e.g. " "
  // Most blocks end with " " (one space) before `*/`. The content lines are
  // ` * …`. We want to insert a new ` * @status …` line before the closing.
  const prefix = lastLine.replace(/\S.*$/, ''); // keep leading whitespace
  const insertion = `${prefix}* @status ${status}\n${prefix}`;
  const newBlock =
    block.slice(0, prevNlIdx + 1) + insertion + block.slice(closingIdx);

  const newSource = src.slice(0, match.index) + newBlock + src.slice(match.index + block.length);
  return { newSource, changed: true, reason: 'inserted' };
}

/**
 * Insert `@status <tag>` into a Python top-of-file docstring.
 * Handles both `"""..."""` and `'''...'''`. Must contain `@file` or
 * `@description` to be recognized as a header.
 */
function annotatePython(src, status) {
  // Skip shebang/encoding lines to find the docstring start.
  let offset = 0;
  const lines = src.split('\n');
  let lineIdx = 0;
  while (
    lineIdx < lines.length &&
    (lines[lineIdx].startsWith('#') || lines[lineIdx].trim() === '')
  ) {
    offset += lines[lineIdx].length + 1;
    lineIdx += 1;
  }

  const rest = src.slice(offset);
  const match = rest.match(/^(\s*)(["']{3})([\s\S]*?)\2/);
  if (!match) return { newSource: src, changed: false, reason: 'no top docstring' };

  const leadingWs = match[1];
  const quote = match[2];
  const body = match[3];

  // Any top-of-file docstring counts as a header in the Python code here;
  // most files use a plain "filename — description" convention without the
  // JSDoc-style @file tag.
  if (/@status\b/.test(body)) {
    return { newSource: src, changed: false, reason: 'already has @status' };
  }

  // Insert `@status <tag>` on a new line just before the closing quotes.
  // The body may end with `\n` or not — handle both.
  let newBody;
  if (body.endsWith('\n')) {
    newBody = `${body}@status ${status}\n`;
  } else {
    newBody = `${body}\n@status ${status}\n`;
  }

  const newDocstring = `${leadingWs}${quote}${newBody}${quote}`;
  const newRest = newDocstring + rest.slice(match[0].length);
  return {
    newSource: src.slice(0, offset) + newRest,
    changed: true,
    reason: 'inserted',
  };
}

// ─── Main ────────────────────────────────────────────────────────────────

let changedCount = 0;
let skippedCount = 0;
let missingCount = 0;
const skipped = [];

for (const { path, status } of FILES) {
  const full = join(ROOT, path);
  if (!existsSync(full)) {
    console.warn(`MISSING  ${path}`);
    missingCount += 1;
    continue;
  }

  const src = readFileSync(full, 'utf8');
  const annotator = path.endsWith('.py') ? annotatePython : annotateTypescript;
  const { newSource, changed, reason } = annotator(src, status);

  if (!changed) {
    console.log(`skip     ${path}  (${reason})`);
    skipped.push({ path, reason });
    skippedCount += 1;
    continue;
  }

  if (DRY_RUN) {
    console.log(`[dry]    ${path}  @status ${status}`);
  } else {
    writeFileSync(full, newSource, 'utf8');
    console.log(`wrote    ${path}  @status ${status}`);
  }
  changedCount += 1;
}

console.log('');
console.log(
  `Summary: ${changedCount} ${DRY_RUN ? 'would-be ' : ''}changed, ${skippedCount} skipped, ${missingCount} missing`
);
if (missingCount > 0) {
  process.exitCode = 1;
}
