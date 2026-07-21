/**
 * @file register-groot-model.ts
 * @description Registers an externally-trained GR00T checkpoint as a
 *              TrainingJob + ModelVersion pair so the deploy/eval pipeline can
 *              reference it (e.g. the n187_real_only_14k g1_dex3 checkpoint).
 * @feature vla
 *
 * Run (from server/):
 *   npx tsx scripts/register-groot-model.ts \
 *     --name n187_real_only_14k \
 *     --artifact-uri s3://models/groot/n187_real_only_14k.tar \
 *     [--checkpoint-uri s3://models/groot/n187_real_only_14k/checkpoint-14000] \
 *     [--base-model groot_n1_7] [--version v20260722]
 *
 * Uses the server's Prisma client, so DATABASE_URL is resolved exactly like
 * the server resolves it (env var, or server/.env via Prisma's own loader).
 * JSON columns (hyperparameters, metrics) go through the existing
 * repositories, which serialize them with JSON.stringify — the same
 * SQLite-compatible convention the rest of the codebase uses.
 *
 * Idempotent: if a ModelVersion with the same artifactUri already exists, its
 * id is printed and the script exits 0 without creating anything.
 *
 * The last stdout line is machine-readable: MODEL_VERSION_ID=<id>
 */

import { BaseModels, type BaseModel } from '../src/types/vla.types.js';

interface CliArgs {
  name?: string;
  artifactUri?: string;
  checkpointUri?: string;
  baseModel: string;
  version: string;
  help: boolean;
}

function defaultVersion(): string {
  // v<UTC timestamp>, e.g. v20260722T103015
  return `v${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`;
}

const USAGE = `Register an externally-trained checkpoint as TrainingJob + ModelVersion.

Usage: npx tsx scripts/register-groot-model.ts [options]

Options:
  --name <name>            Human-readable model name (required)
  --artifact-uri <uri>     Model artifact location, e.g. s3://... (required)
  --checkpoint-uri <uri>   Optional intermediate-checkpoint location
  --base-model <model>     Base model id (default: groot_n1_7)
                           One of: ${BaseModels.join(', ')}
  --version <version>      Version string (default: v<timestamp>)
  --help                   Show this help

The last stdout line on success is: MODEL_VERSION_ID=<id>`;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    baseModel: 'groot_n1_7',
    version: defaultVersion(),
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') {
      args.help = true;
      continue;
    }
    const value = argv[i + 1];
    const need = (): string => {
      if (value === undefined || value.startsWith('--')) {
        console.error(`Missing value for ${flag}`);
        process.exit(1);
      }
      i++;
      return value;
    };
    switch (flag) {
      case '--name':
        args.name = need();
        break;
      case '--artifact-uri':
        args.artifactUri = need();
        break;
      case '--checkpoint-uri':
        args.checkpointUri = need();
        break;
      case '--base-model':
        args.baseModel = need();
        break;
      case '--version':
        args.version = need();
        break;
      default:
        console.error(`Unknown flag: ${flag}\n\n${USAGE}`);
        process.exit(1);
    }
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(USAGE);
    return;
  }

  if (!args.name) {
    console.error(`--name is required\n\n${USAGE}`);
    process.exit(1);
  }
  if (!args.artifactUri) {
    console.error(`--artifact-uri is required\n\n${USAGE}`);
    process.exit(1);
  }
  if (!(BaseModels as readonly string[]).includes(args.baseModel)) {
    console.error(
      `--base-model must be one of: ${BaseModels.join(', ')} (got "${args.baseModel}")`
    );
    process.exit(1);
  }

  // Import DB modules only after arg validation so `--help` / bad-usage runs
  // never touch (or require) a database.
  const { prisma } = await import('../src/database/index.js');
  const { trainingJobRepository, modelVersionRepository } = await import(
    '../src/repositories/index.js'
  );

  try {
    // Idempotency: same artifactUri => already registered.
    const existing = await prisma.modelVersion.findFirst({
      where: { artifactUri: args.artifactUri },
      select: { id: true, version: true },
    });
    if (existing) {
      console.log(
        `ModelVersion for artifactUri "${args.artifactUri}" already exists ` +
          `(version ${existing.version}) — nothing to do.`
      );
      console.log(`MODEL_VERSION_ID=${existing.id}`);
      return;
    }

    // 1) TrainingJob shell for the external run (ModelVersion.trainingJobId is
    //    a required FK). Marked completed — the training happened elsewhere.
    const job = await trainingJobRepository.create({
      kind: 'supervised',
      baseModel: args.baseModel as BaseModel,
      fineTuneMethod: 'full',
    });
    await trainingJobRepository.update(job.id, {
      status: 'completed',
      progress: 100,
      startedAt: new Date(),
      completedAt: new Date(),
    });
    console.log(`Created TrainingJob ${job.id} (baseModel=${args.baseModel}, external)`);

    // 2) ModelVersion pointing at the externally-trained artifact.
    const modelVersion = await modelVersionRepository.create({
      skillId: null,
      trainingJobId: job.id,
      modelType: 'vla',
      version: args.version,
      artifactUri: args.artifactUri,
      checkpointUri: args.checkpointUri,
    });

    // Store the human-readable name on the registry's model-name column (the
    // repository create input has no name field).
    await prisma.modelVersion.update({
      where: { id: modelVersion.id },
      data: { mlflowModelName: args.name },
    });

    console.log(
      `Registered ModelVersion ${modelVersion.id} (name=${args.name}, version=${args.version})`
    );
    console.log(`MODEL_VERSION_ID=${modelVersion.id}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[register-groot-model] Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
