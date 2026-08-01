/**
 * @file planner-bench.ts
 * @description Measures how well a local model does the ONE job the Agent Mode
 *              planner has: turn a German operator sentence into blocks the
 *              executor will actually run. Drives the real `Planner` — the real
 *              prompt, the real Zod schema, the real one-shot repair pass — so
 *              the number it prints is the number the robot lives with.
 * @feature agentmode
 * @status tool
 *
 *   npx tsx scripts/planner-bench.ts                        # every model below
 *   npx tsx scripts/planner-bench.ts gemma4:e2b gpt-oss:20b # a subset
 *   REPEATS=5 npx tsx scripts/planner-bench.ts
 *
 * Models are benched one at a time on purpose: they are 6–13 GB each and
 * running them concurrently on one GPU measures the swapping, not the model.
 *
 * Scoring is mechanical and deliberately blunt — a case passes only when the
 * emitted blocks would DO the thing asked. "Plausible-looking JSON" is not a
 * pass; neither is an honest fallback, which is safe but still a robot that did
 * not move. Each case says what it wants in `want`, so a disagreement about the
 * grading is a disagreement you can read.
 */
import { Planner } from '../src/agent-mode/planner.js';
import { agentModelRef } from '../src/agent-mode/llm.js';
import { SceneMemoryStore } from '../src/agent-mode/scene-memory.js';
import type { AgentBlock } from '../src/agent-mode/types.js';

const DEFAULT_MODELS = ['gemma4:e2b', 'gemma4:latest', 'qwen2.5vl:7b', 'gpt-oss:20b'];
const REPEATS = Number(process.env.REPEATS ?? 3);

/**
 * The scene the planner is given, built through the real store so the text is
 * byte-for-byte what `plannerSceneSummary()` produces at runtime. Taken from the
 * room scene the 07 recording used, after a `scan_room`.
 */
function sceneSummary(): string {
  const scene = new SceneMemoryStore('g1-edu-01');
  scene.setYawDeg(0, 'odometry');
  scene.merge(
    {
      currentView: 'Ein Raum mit einem Tisch, einem Stuhl an der Wand und einer Tür.',
      personVisible: false,
      raw: '{}',
      degraded: false,
      entities: [
        { label: 'table', bearingDeg: 17, distanceEstM: 3.02, distanceSource: 'lidar', confidence: 0.9 },
        { label: 'chair', bearingDeg: -48, distanceEstM: 2.41, distanceSource: 'lidar', confidence: 0.7 },
        { label: 'door', bearingDeg: 96, distanceEstM: 4.4, distanceSource: 'lidar', confidence: 0.8 },
        { label: 'ladder', bearingDeg: -140, distanceEstM: 3.6, distanceSource: 'lidar', confidence: 0.6 },
      ],
    },
    undefined,
    { forwardClearanceM: 2.95 }
  );
  return scene.summary();
}

interface Case {
  id: string;
  command: string;
  /** What a correct plan must do, in words — printed next to every failure. */
  want: string;
  check: (blocks: AgentBlock[]) => boolean;
}

const kinds = (blocks: AgentBlock[]): string[] => blocks.map((b) => b.kind);
const first = (blocks: AgentBlock[], kind: string): AgentBlock | undefined =>
  blocks.find((b) => b.kind === kind);
const num = (b: AgentBlock | undefined, key: string): number =>
  b === undefined ? Number.NaN : Number(b.params[key]);

const CASES: Case[] = [
  {
    id: 'turn-left',
    command: 'dreh dich nach links',
    want: 'one turn, positive angle (CCW = left)',
    check: (b) => kinds(b).includes('turn') && num(first(b, 'turn'), 'angleDeg') > 0,
  },
  {
    id: 'turn-right-90',
    command: 'dreh dich um 90 grad nach rechts',
    want: 'turn angleDeg ≈ -90',
    check: (b) => Math.abs(num(first(b, 'turn'), 'angleDeg') + 90) < 1,
  },
  {
    id: 'walk-2m',
    command: 'geh zwei meter vorwärts',
    want: 'walk distanceM ≈ 2, direction forward',
    check: (b) =>
      Math.abs(num(first(b, 'walk'), 'distanceM') - 2) < 0.01 &&
      first(b, 'walk')?.params.direction === 'forward',
  },
  {
    id: 'walk-back',
    command: 'geh einen halben meter zurück',
    want: 'walk distanceM ≈ 0.5, direction backward',
    check: (b) =>
      Math.abs(num(first(b, 'walk'), 'distanceM') - 0.5) < 0.01 &&
      first(b, 'walk')?.params.direction === 'backward',
  },
  {
    id: 'goto-table',
    command: 'geh zum Tisch mit dem Hut',
    // The entity string is matched against scene memory by substring, so
    // "Tisch mit dem Hut" resolves to "table" — but a walk+turn instead of a
    // goto throws away the whole measured-range loop, which is the failure the
    // 07 recording hit on its first take.
    want: 'a goto block (not raw turn+walk), entity naming the table',
    check: (b) => {
      const g = first(b, 'goto');
      return g !== undefined && /tisch|table/i.test(String(g.params.entity ?? ''));
    },
  },
  {
    id: 'goto-door',
    command: 'lauf zur Tür',
    want: 'goto with entity ≈ door/Tür',
    check: (b) => {
      const g = first(b, 'goto');
      return g !== undefined && /tür|tuer|door/i.test(String(g.params.entity ?? ''));
    },
  },
  {
    id: 'scan',
    command: 'schau dich im Raum um und sag mir was du siehst',
    want: 'scan_room, then speak',
    check: (b) => kinds(b).includes('scan_room') && kinds(b).includes('speak'),
  },
  {
    id: 'look',
    command: 'was siehst du gerade?',
    // The block result of `look` is what the operator reads back, so `look`
    // alone is a complete answer. What is NOT acceptable is answering out of
    // scene memory with a bare `speak`: that reports a view the robot did not
    // take, and scene memory can be minutes old.
    want: 'an actual look/scan_room — not a speak answered from memory',
    check: (b) => kinds(b).includes('look') || kinds(b).includes('scan_room'),
  },
  {
    id: 'stand',
    command: 'stell dich hin',
    want: 'posture pose=stand',
    check: (b) => first(b, 'posture')?.params.pose === 'stand',
  },
  {
    id: 'damp',
    command: 'geh in den gedämpften Zustand',
    want: 'posture pose=damp',
    check: (b) => first(b, 'posture')?.params.pose === 'damp',
  },
  {
    id: 'wave',
    command: 'winke mir zu',
    // `greet` is speak + wave (see BLOCK_REFERENCE), so it waves too.
    want: 'a wave (or greet, which contains one)',
    check: (b) => kinds(b).includes('wave') || kinds(b).includes('greet'),
  },
  {
    id: 'wait',
    command: 'warte fünf sekunden',
    want: 'wait seconds ≈ 5',
    check: (b) => Math.abs(num(first(b, 'wait'), 'seconds') - 5) < 0.01,
  },
  {
    id: 'compound',
    command: 'dreh dich nach rechts, geh einen meter und winke dann',
    want: 'turn (negative) → walk 1 m → wave, in that order',
    check: (b) => {
      const order = kinds(b).filter((k) => k === 'turn' || k === 'walk' || k === 'wave');
      return (
        order.join(',') === 'turn,walk,wave' &&
        num(first(b, 'turn'), 'angleDeg') < 0 &&
        Math.abs(num(first(b, 'walk'), 'distanceM') - 1) < 0.01
      );
    },
  },
  {
    id: 'refuse-unknown',
    command: 'geh zum Kühlschrank',
    // Nothing called a fridge is in the scene. Either honest speech or a goto
    // that will fail loudly are acceptable; silently walking somewhere is not.
    want: 'speak/look/goto — never a bare walk into the room',
    check: (b) => !kinds(b).includes('walk'),
  },
  {
    id: 'english',
    command: 'walk to the chair and wave',
    want: 'goto chair → wave (the operator may switch language mid-session)',
    check: (b) => {
      const g = first(b, 'goto');
      return (
        g !== undefined &&
        /chair|stuhl/i.test(String(g.params.entity ?? '')) &&
        kinds(b).includes('wave')
      );
    },
  },
];

/**
 * Every distance the scene summary hands the planner. A `walk` whose length is
 * one of these is the planner having read a remembered range off the scene and
 * turned it into one open-loop dash — see `openLoopDashes` below.
 */
const SCENE_DISTANCES_M = [3.02, 2.41, 4.4, 3.6, 2.95];

/**
 * Count the walks that are really a `goto` in disguise.
 *
 * `goto` is the only block that navigates: it re-bears, sizes each stage from
 * the LiDAR range, clamps it to the measured clearance ahead and re-looks after
 * every metre. A `walk` is open loop — a velocity for a duration, no sensor in
 * the loop. So a plan that answers "walk to the door" with `walk 4.4 m` has
 * quietly opted out of every safety rule the range sensor bought us, and it
 * only became tempting once scene memory started carrying MEASURED distances
 * worth copying.
 */
function openLoopDashes(blocks: AgentBlock[]): number {
  return blocks.filter(
    (b) =>
      b.kind === 'walk' &&
      SCENE_DISTANCES_M.some((d) => Math.abs(Number(b.params.distanceM) - d) < 0.06)
  ).length;
}

interface Row {
  model: string;
  pass: number;
  total: number;
  fallbacks: number;
  repairs: number;
  dashes: number;
  msP50: number;
  failures: Map<string, number>;
}

function median(xs: number[]): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function benchModel(model: string, summary: string): Promise<Row> {
  const modelRef = await agentModelRef(model);
  const planner = new Planner({ modelRef });
  const row: Row = {
    model,
    pass: 0,
    total: 0,
    fallbacks: 0,
    repairs: 0,
    dashes: 0,
    msP50: 0,
    failures: new Map(),
  };
  const latencies: number[] = [];

  for (const testCase of CASES) {
    for (let i = 0; i < REPEATS; i++) {
      const startedAt = Date.now();
      let result;
      try {
        result = await planner.plan({ command: testCase.command, sceneSummary: summary });
      } catch (err) {
        // A transport failure is a failed case, not a crashed bench.
        result = { blocks: [], fallback: true, attempts: 1, error: String(err) };
      }
      latencies.push(Date.now() - startedAt);
      row.total++;
      if (result.fallback) row.fallbacks++;
      if (result.attempts > 1) row.repairs++;
      row.dashes += openLoopDashes(result.blocks);
      const ok = !result.fallback && testCase.check(result.blocks);
      if (ok) row.pass++;
      else {
        row.failures.set(testCase.id, (row.failures.get(testCase.id) ?? 0) + 1);
        if (process.env.VERBOSE) {
          console.log(
            `    ✗ ${testCase.id}: want ${testCase.want}; got ` +
              (result.fallback
                ? `fallback (${result.error})`
                : JSON.stringify(result.blocks.map((b) => ({ kind: b.kind, ...b.params }))))
          );
        }
      }
    }
  }
  row.msP50 = median(latencies);
  return row;
}

async function main(): Promise<void> {
  const models = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_MODELS;
  const summary = sceneSummary();
  console.log(`Planner bench — ${CASES.length} cases × ${REPEATS} repeats, real prompt and schema.`);
  console.log(`Scene handed to the planner:\n${summary}\n`);

  const rows: Row[] = [];
  for (const model of models) {
    process.stdout.write(`${model} … `);
    const row = await benchModel(model, summary);
    rows.push(row);
    console.log(`${row.pass}/${row.total}`);
  }

  console.log(
    '\n| model | plans that would do the right thing | open-loop dashes | honest fallbacks | needed the repair pass | median latency |'
  );
  console.log('|---|---|---|---|---|---|');
  for (const r of rows) {
    const pct = ((100 * r.pass) / r.total).toFixed(0);
    console.log(
      `| ${r.model} | ${r.pass}/${r.total} (${pct}%) | ${r.dashes} | ${r.fallbacks} | ${r.repairs} | ${(r.msP50 / 1000).toFixed(1)} s |`
    );
  }

  console.log('\nPer-case failures (case: how many of the runs got it wrong)');
  for (const r of rows) {
    const worst = [...r.failures.entries()].sort((a, b) => b[1] - a[1]);
    console.log(
      `  ${r.model}: ${worst.length === 0 ? '(none)' : worst.map(([id, n]) => `${id} ${n}/${REPEATS}`).join(', ')}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
