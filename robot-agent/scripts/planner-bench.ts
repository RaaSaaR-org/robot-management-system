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
 *   npm run bench:planner                                   # every model below
 *   npm run bench:planner -- gemma4:e2b gpt-oss:20b         # a subset
 *   REPEATS=5 npm run bench:planner
 *
 * Typechecked by `npx tsc -p tsconfig.scripts.json` — the package
 * `tsconfig.json` includes `src/` and nothing else, so this file went years
 * without a compiler looking at it and carried a stale `AgentBlock[]` signature
 * the whole time (TASK-221). `npm run typecheck` runs both.
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
// FIRST, and before `../src/config/config.js` is pulled in: `config` is read at
// module scope, and this script is not `src/index.ts`, which is the only other
// place that loads the env. Without this the bench silently benched
// `DEFAULT_AGENT_MODEL` ('gemma3:4b', not installed here) instead of
// `AGENT_PLANNER_MODEL`, and printed `AGENT_PLANNER_THINKING → off` as a fact
// about the robot when it was a fact about an unconfigured process.
import 'dotenv/config';

import { pathToFileURL } from 'node:url';
import { Planner } from '../src/agent-mode/planner.js';
import { agentModelRef } from '../src/agent-mode/llm.js';
import { SceneMemoryStore } from '../src/agent-mode/scene-memory.js';
import { normalizeDeg } from '../src/agent-mode/types.js';
import { config } from '../src/config/config.js';
// `Planner.plan` answers `PlannedBlock[]` — kind + params, no `id`/`status`
// yet, because nothing has executed them. The bench graded `AgentBlock[]`,
// which only ever worked because it reads `kind` and `params` and nothing else.
import type { PlannedBlock, PlannerSceneTarget } from '../src/agent-mode/planner.js';

/**
 * Benched when no model is named on the command line.
 *
 * This is the model the robot actually plans with — `AGENT_PLANNER_MODEL`, read
 * through `config` so it is the same string `Planner.plan` hands Ollama. It is
 * NOT a hand-written list: the previous one (`gemma4:e2b`, `gemma4:latest`,
 * `qwen2.5vl:7b`, `gpt-oss:20b`) named four models, and by 2026-08-27 not one of
 * them was installed on the box — TASK-221's review said so and it stayed. A
 * bench whose default invocation cannot run is a bench nobody runs, which is how
 * TASK-226 reached "the bench is the gate" with the gate never measured.
 *
 * Pass models explicitly to compare several: `npm run bench:planner -- a b c`.
 */
const DEFAULT_MODELS = [config.agentMode.plannerModel];
const REPEATS = Number(process.env.REPEATS ?? 3);

/**
 * The scene the planner is given, built through the real store so the text is
 * byte-for-byte what `plannerSceneSummary()` produces at runtime. Taken from the
 * room scene the 07 recording used, after a `scan_room`.
 */
function benchScene(): SceneMemoryStore {
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
  return scene;
}

/**
 * The same rows as numbers, exactly as `AgentModeController.plannerSceneTargets`
 * builds them. Without these the bench would measure a planner missing the
 * turn+walk fold (TASK-221) — i.e. not the one that runs on the robot.
 */
function sceneTargets(scene: SceneMemoryStore): PlannerSceneTarget[] {
  const yawDeg = scene.getYawDeg();
  return scene.listEntities().map((e) => ({
    label: e.label,
    relativeBearingDeg: normalizeDeg(e.bearingDeg - yawDeg),
    distanceM: e.distanceEstM,
  }));
}

export interface Case {
  id: string;
  command: string;
  /** What a correct plan must do, in words — printed next to every failure. */
  want: string;
  /**
   * The command asks the robot to APPROACH something, so `goto` is the only
   * correct answer and any forward `walk` is an open-loop dash — see
   * {@link openLoopDashes}, which is the only thing that reads this.
   */
  approach?: true;
  /**
   * `VLA_CASES` only: the catalogued skill id this case expects. Declared as a
   * field rather than left inside `check`, so `planner-bench.test.ts` can pin
   * it against `VLA_SKILL_IDS` — a renamed skill then fails as a rename
   * instead of scoring 0/9 and reading as a planner regression.
   */
  skill?: string;
  check: (blocks: PlannedBlock[]) => boolean;
}

const kinds = (blocks: PlannedBlock[]): string[] => blocks.map((b) => b.kind);
const first = (blocks: PlannedBlock[], kind: string): PlannedBlock | undefined =>
  blocks.find((b) => b.kind === kind);
const num = (b: PlannedBlock | undefined, key: string): number =>
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
    approach: true,
    check: (b) => {
      const g = first(b, 'goto');
      return g !== undefined && /tisch|table/i.test(String(g.params.entity ?? ''));
    },
  },
  {
    id: 'goto-door',
    command: 'lauf zur Tür',
    want: 'goto with entity ≈ door/Tür',
    approach: true,
    check: (b) => {
      const g = first(b, 'goto');
      return g !== undefined && /tür|tuer|door/i.test(String(g.params.entity ?? ''));
    },
  },
  // Three more approach cases, on purpose. `goto` vs turn+walk is the single
  // failure every model shares, so one or two samples of it cannot tell a real
  // prompt improvement from noise. These vary the language, the bearing sign
  // and the confidence of the target while asking for exactly the same block.
  {
    id: 'goto-chair',
    command: 'geh zum Stuhl',
    want: 'goto with entity ≈ chair (target is at -48°, so a walk with no turn is doubly wrong)',
    approach: true,
    check: (b) => {
      const g = first(b, 'goto');
      return g !== undefined && /stuhl|chair/i.test(String(g.params.entity ?? ''));
    },
  },
  {
    id: 'goto-ladder-en',
    command: 'go to the ladder',
    want: 'goto with entity ≈ ladder (lowest-confidence entity, behind the robot)',
    approach: true,
    check: (b) => {
      const g = first(b, 'goto');
      return g !== undefined && /ladder|leiter/i.test(String(g.params.entity ?? ''));
    },
  },
  {
    id: 'goto-table-en',
    command: 'walk over to the table and stop in front of it',
    want: 'goto with entity ≈ table — "walk over to" must not become a raw walk',
    approach: true,
    check: (b) => {
      const g = first(b, 'goto');
      return g !== undefined && /tisch|table/i.test(String(g.params.entity ?? ''));
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
    approach: true,
    check: (b) => !kinds(b).includes('walk'),
  },
  {
    id: 'english',
    command: 'walk to the chair and wave',
    want: 'goto chair → wave (the operator may switch language mid-session)',
    approach: true,
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
 * The `vla_skill` cases, graded SEPARATELY and never folded into `CASES`.
 *
 * TASK-226 added the block kind and named this bench as its gate, because a
 * longer prompt is a measured regression risk for a small planner. The gate is
 * read off the 18 cases in `CASES`, whose score has a history — 51/54 on
 * `gemma4:e4b`, 2026-08-27 (TASK-221), reproduced at `fef77f4e` on 2026-09-06.
 * Appending three cases to that array would have changed the denominator to 63
 * and quietly made every past number incomparable, which is the one thing a
 * regression gate must not do.
 */
export const VLA_CASES: Case[] = [
  {
    id: 'vla-apple',
    command: 'leg den Apfel auf den Teller',
    // The planner writes a NAME, never an instruction: the prompt the policy
    // gets is the catalogue's trained string. So the only thing gradeable here
    // is whether it picked the right skill out of the catalogue.
    want: 'vla_skill with skill=g1_apple_pnp',
    skill: 'g1_apple_pnp',
    check: (b) => first(b, 'vla_skill')?.params.skill === 'g1_apple_pnp',
  },
  {
    id: 'vla-bottle',
    command: 'stell die Flasche in den Teller',
    // Two skills in the catalogue differ only by the object. Picking the apple
    // policy for a bottle is the failure this case exists to catch — it would
    // run a real rollout with the wrong trained prompt and look busy doing it.
    want: 'vla_skill with skill=g1_dex3 (not the apple policy)',
    skill: 'g1_dex3',
    check: (b) => first(b, 'vla_skill')?.params.skill === 'g1_dex3',
  },
  {
    id: 'vla-needs-approach',
    command: 'geh zum Tisch und leg den Apfel auf den Teller',
    // The block does not walk — the prompt says so in as many words. A plan
    // that opens with the rollout leaves the robot grasping at air from across
    // the room, which is the whole reason `goto` has to come first.
    want: 'goto the table FIRST, then vla_skill — the rollout does not walk',
    approach: true,
    skill: 'g1_apple_pnp',
    check: (b) => {
      const order = kinds(b);
      const g = order.indexOf('goto');
      const v = order.indexOf('vla_skill');
      return (
        g !== -1 &&
        v !== -1 &&
        g < v &&
        /tisch|table/i.test(String(first(b, 'goto')?.params.entity ?? ''))
      );
    },
  },
];

/** Every id in the 18-case gate — pinned by `planner-bench.test.ts`. */
export const BENCH_CASE_IDS: readonly string[] = CASES.map((c) => c.id);

/** The ids of the cases that ask the robot to approach something. */
export const APPROACH_CASE_IDS: readonly string[] = CASES.filter((c) => c.approach).map(
  (c) => c.id
);

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
 *
 * The rule used to be "a walk within 0.06 m of a distance the scene summary
 * printed", which measured the wrong thing (TASK-221): a model that answers
 * "lauf zur Tür" with `walk 4 m` at a door 4.4 m away has done exactly the
 * thing this counts, and 0.4 m of rounding hid it. Nothing about the failure
 * depends on the number being copied accurately — it depends on the COMMAND
 * having asked for an approach, which the case knows and the distance does not.
 * So the count is now per case: in an `approach` case every forward `walk` is a
 * dash, whatever its length. A backward walk is not: retreating is not an
 * approach, and `goto` would not have produced it either.
 *
 * Consequence for an A/B: dash counts either side of this change are NOT
 * comparable, which is why the header prints the rule with the number.
 */
export function openLoopDashes(testCase: Case, blocks: PlannedBlock[]): number {
  if (!testCase.approach) return 0;
  return blocks.filter(
    (b) => b.kind === 'walk' && (b.params.direction ?? 'forward') === 'forward'
  ).length;
}

/**
 * The lines printed before the first model runs.
 *
 * Everything that changes what the numbers below mean belongs here: which
 * models were asked, whether the planner was allowed to think, and how a dash
 * was counted. A bench result pasted into a task without them is two numbers
 * nobody can reproduce.
 */
export function benchHeaderLines(models: readonly string[], sceneSummary: string): string[] {
  return [
    `Planner bench — ${CASES.length} cases × ${REPEATS} repeats, real prompt and schema.`,
    `Models: ${models.join(', ')}`,
    // Read back off `config`, not off `process.env`: `config` is what
    // `Planner.plan` hands the model, and `AGENT_PLANNER_THINKING` is only true
    // for the exact string "true". The setting is worth ~500 tokens of thinking
    // per call, so a pair of runs recorded without it is not a pair.
    `AGENT_PLANNER_THINKING=${process.env.AGENT_PLANNER_THINKING ?? '(unset)'} → planner thinking is ` +
      `${config.agentMode.plannerThinking ? 'ON' : 'off'}`,
    `Open-loop dashes counted as: every forward \`walk\` in the ${APPROACH_CASE_IDS.length} cases that ` +
      `asked for an approach (${APPROACH_CASE_IDS.join(', ')}).`,
    '',
    `Scene handed to the planner:\n${sceneSummary}`,
    '',
  ];
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

async function benchModel(
  model: string,
  summary: string,
  targets: PlannerSceneTarget[],
  cases: readonly Case[] = CASES
): Promise<Row> {
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

  for (const testCase of cases) {
    for (let i = 0; i < REPEATS; i++) {
      const startedAt = Date.now();
      let result;
      try {
        result = await planner.plan({
          command: testCase.command,
          sceneSummary: summary,
          sceneTargets: targets,
        });
      } catch (err) {
        // A transport failure is a failed case, not a crashed bench.
        result = { blocks: [], fallback: true, attempts: 1, error: String(err) };
      }
      latencies.push(Date.now() - startedAt);
      row.total++;
      if (result.fallback) row.fallbacks++;
      if (result.attempts > 1) row.repairs++;
      row.dashes += openLoopDashes(testCase, result.blocks);
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
  const scene = benchScene();
  const summary = scene.summary();
  const targets = sceneTargets(scene);
  for (const line of benchHeaderLines(models, summary)) console.log(line);

  const rows: Row[] = [];
  // The `vla_skill` set is run and reported apart from the 18-case gate — see
  // VLA_CASES for why the denominators must not merge.
  const vlaRows: Row[] = [];
  for (const model of models) {
    process.stdout.write(`${model} … `);
    const row = await benchModel(model, summary, targets);
    rows.push(row);
    console.log(`${row.pass}/${row.total}`);
    process.stdout.write(`${model} (vla_skill) … `);
    const vlaRow = await benchModel(model, summary, targets, VLA_CASES);
    vlaRows.push(vlaRow);
    console.log(`${vlaRow.pass}/${vlaRow.total}`);
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

  console.log(
    `\n| model | vla_skill: picked the right catalogued skill, in the right order |`
  );
  console.log('|---|---|');
  for (const r of vlaRows) {
    console.log(`| ${r.model} | ${r.pass}/${r.total} |`);
  }

  console.log('\nPer-case failures (case: how many of the runs got it wrong)');
  for (const r of [...rows, ...vlaRows]) {
    const worst = [...r.failures.entries()].sort((a, b) => b[1] - a[1]);
    if (worst.length === 0 && rows.includes(r) === false) continue;
    console.log(
      `  ${r.model}: ${worst.length === 0 ? '(none)' : worst.map(([id, n]) => `${id} ${n}/${REPEATS}`).join(', ')}`
    );
  }
}

// Guarded so the module can be imported — `scripts/planner-bench.test.ts` grades
// the grader, and an unguarded `main()` would have every such import try to
// reach Ollama.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
