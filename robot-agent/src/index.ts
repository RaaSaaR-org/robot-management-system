/**
 * @file index.ts
 * @description Main entry point for the Simulated Robot A2A Agent
 * @status live
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { fileURLToPath } from 'url';
import type { TaskStore } from '@a2a-js/sdk/server';
import { InMemoryTaskStore, DefaultRequestHandler } from '@a2a-js/sdk/server';
import { A2AExpressApp } from '@a2a-js/sdk/server/express';

import { config, validateConfig } from './config/config.js';
import { createAgentRuntime } from './agent-runtime.js';
import { RobotStateManager } from './robot/state.js';
import {
  createRobotAgentCard,
  updateAgentCardIdentity,
  type AgentCardOptions,
} from './agent/agent-card.js';
import { hardwareClient } from './hardware/HardwareClient.js';
import { RobotAgentExecutor } from './agent/agent-executor.js';
import { createRestRoutes } from './api/rest-routes.js';
import { createTelemetryWebSocket } from './api/websocket.js';
import { createPointCloudWebSocket } from './api/pointcloud-websocket.js';
import { createAgentModeWebSocket } from './api/agent-mode-websocket.js';
import { agentModeController } from './agent-mode/agent-mode-controller.js';
import { IncarnationLog } from './agent-mode/incarnations.js';
import {
  EMBODIMENT_TAG_BY_ROBOT_TYPE,
  getIdentityStore,
  IdentityGarbledError,
} from './agent-mode/identity.js';
import { getWorkspace } from './agent-mode/workspace.js';
import { startJournalRetentionLoop } from './agent-mode/journal.js';
import { EmbodimentLoader } from './embodiment/embodiment-loader.js';
import type { EmbodimentEventData } from './embodiment/types.js';
import { startTerminalEstop } from './terminal-estop.js';
import { setRobotStateManager as setNavigationStateManager } from './tools/navigation.js';
import { setRobotStateManager as setManipulationStateManager } from './tools/manipulation.js';
import { setRobotStateManager as setStatusStateManager } from './tools/status.js';
import { complianceLogClient } from './compliance/ComplianceLogClient.js';
import { createBilateralTeleopWebSocket } from './api/bilateral-teleop.js';
import { createKeyboardTeleopWebSocket } from './api/keyboard-teleop.js';
import { FrameRecorder } from './teleop/FrameRecorder.js';
import { DeviceIdentityManager } from './security/device-identity.js';
import { SecureBootVerifier } from './security/secure-boot.js';
import { secureUpdateClient } from './updates/SecureUpdateClient.js';
import { RoundLifecycle } from './federated/RoundLifecycle.js';
import type { FederatedStatus, TrainingEpisode } from './federated/types.js';

async function main() {
  console.log('='.repeat(60));
  console.log(' Simulated Robot A2A Agent');
  console.log('='.repeat(60));

  // Validate configuration
  validateConfig();

  const PORT = config.port;
  const ROBOT_ID = config.robotId;
  const ROBOT_NAME = config.robotName;

  // Initialize device identity (CRA Annex I — unique device identity)
  const deviceIdentity = new DeviceIdentityManager(ROBOT_ID);
  await deviceIdentity.initialize();
  console.log(`[DeviceIdentity] Device fingerprint: ${deviceIdentity.getDeviceFingerprint().slice(0, 20)}...`);

  // Secure boot verification (CRA Annex I — software integrity)
  const packageDir = fileURLToPath(new URL('..', import.meta.url));
  const secureBoot = new SecureBootVerifier(packageDir);
  const attestation = secureBoot.verify(ROBOT_ID, deviceIdentity.getDeviceFingerprint());
  if (!attestation.versionCompliant) {
    console.warn('[SecureBoot] WARNING: Anti-rollback violation detected');
  }

  // Boot lineage (TASK-196). One JSONL line per process life; the previous line
  // having no `endedAt` is how a crash is detected. Opened here so it reuses the
  // attestation's boot time and integrity hash, and closed in `shutdown()`
  // BEFORE the network phase — `server.close()` can hang forever on an open
  // WebSocket, and a line that is never closed reads as a crash next boot.
  //
  // `open()` writes NOTHING. It reads the previous line and mints this boot's
  // id; the line itself is written by `incarnations.confirm()` in the
  // `server.listen()` callback ~300 lines below, and dropped by
  // `incarnations.abandon()` when this process loses the port. A process that
  // dies on EADDRINUSE never lived, and a line it left open would be read as a
  // crash by the boot that follows.
  // Durable memory (TASK-197). Created before the lineage, because the lineage
  // now lives inside it — both are "what this robot did", per robot id.
  const workspace = getWorkspace();
  workspace.ensure();
  console.log(`[Workspace] memory at ${workspace.root}`);

  const incarnations = new IncarnationLog({
    robotId: ROBOT_ID,
    filePath: workspace.incarnationsFile,
  });
  const incarnation = incarnations.open({
    startedAt: attestation.bootTime,
    integrityHash: attestation.integrityHash,
  });

  // Identity (TASK-198). Read the ID card BEFORE anything renders a name.
  //
  // Three outcomes, deliberately different: a card that loads is used; a
  // MISSING card re-runs the naming bootstrap (the robot asks and keeps the
  // configured fallback until someone answers); a GARBLED card fails loudly and
  // is never replaced by a generic self — a robot that silently forgets which
  // machine it is is the one failure this whole file split exists to prevent.
  const identityStore = getIdentityStore();
  let identityName = ROBOT_NAME;
  try {
    const loaded = identityStore.load();
    identityName = loaded.identity.name;
    if (loaded.bootstrapRequired) {
      console.warn(
        `[Identity] no IDENTITY.md in ${workspace.root} — this robot has not been named. ` +
          `Using "${identityName}" from configuration until someone says "your name is …" ` +
          `or POSTs /api/v1/robots/${ROBOT_ID}/identity.`,
      );
    } else {
      console.log(`[Identity] I am "${identityName}" (${identityStore.identityFile})`);
    }
  } catch (err) {
    if (err instanceof IdentityGarbledError) {
      console.error(`[Identity] IDENTITY FILE UNREADABLE — ${err.message}`);
    } else {
      console.error('[Identity] identity could not be loaded:', err);
    }
  }

  // BODY.md is generated, never hand-written: the embodiment YAML already
  // carries the DOF breakdown, joint names, cameras, depth sensors and safety
  // limits, so no model is asked what this robot can do. Regenerated on every
  // `embodiment:reloaded` — the loader is already a Zod-validated, chokidar
  // hot-reloading singleton, so this is a subscription, not a parser.
  const embodimentTag = EMBODIMENT_TAG_BY_ROBOT_TYPE[config.robotType] ?? 'generic';
  const embodimentLoader = EmbodimentLoader.getInstance({ defaultTag: embodimentTag });
  try {
    await embodimentLoader.initialize();
    agentModeController.applyEmbodiment(embodimentLoader.getEmbodiment(embodimentTag));
  } catch (err) {
    // A body we cannot describe is a body we say nothing about — never a boot
    // failure, and never an invented one.
    console.warn('[Identity] embodiment config unavailable, BODY.md will say so:', err);
    agentModeController.applyEmbodiment(undefined);
  }
  embodimentLoader.on('embodiment:reloaded', (data: EmbodimentEventData) => {
    if (data.tag !== embodimentTag) return;
    console.log(`[Identity] embodiment ${data.tag} reloaded — regenerating BODY.md`);
    agentModeController.applyEmbodiment(data.config);
  });

  // Initialize robot state manager
  const robotStateManager = new RobotStateManager({
    id: ROBOT_ID,
    // The name from IDENTITY.md, not the environment variable: this state is
    // what `GET /api/v1/robots/:id` serves, and that is what the fleet's
    // identity sync adopts.
    name: identityName,
    model: config.robotModel,
    robotClass: config.robotClass,
    robotType: config.robotType,
    maxPayloadKg: config.maxPayloadKg,
    description: config.robotDescription,
    initialLocation: config.initialLocation,
    capabilities: ['navigation', 'manipulation', 'lifting'],
  });

  // Set robot state manager for tools
  setNavigationStateManager(robotStateManager);
  setManipulationStateManager(robotStateManager);
  setStatusStateManager(robotStateManager);

  // Simulation, safety monitoring, `agentModeController.attach()`,
  // `recordBoot()`, `announceBootState()` and the idle watcher ALL used to
  // stand here. They now run from the `server.listen()` callback, through
  // `createAgentRuntime()` — see `agent-runtime.ts` for the rule and the order.
  // In short: this process is only a CANDIDATE until it owns the port, and a
  // candidate must not actuate (the idle watcher's greet path issues a real
  // `wave`), must not push to the fleet mirror (the server serves a dead
  // loser's snapshot as fresh), and must not answer a safety question — before
  // `recordBoot()` the controller reports the crash as acknowledged, so the
  // crash gate stood open for the whole pre-bind window.

  // Journal retention comes from the platform's own RetentionPolicy for
  // `command_execution` — the very records this journal duplicates — rather
  // than a second hardcoded regime running beside `retentionExpiresAt`. Async
  // and unawaited: a robot must boot with the server down, and an active legal
  // hold suppresses the prune entirely.
  //
  // PERIODIC, not once at boot. This stack's robots stay up for months; a
  // boundary applied only at startup lets every day-file past it accumulate as
  // plaintext operational text for the whole deployment. The timer is unref'd
  // inside the loop, so `shutdown()` below still exits.
  const retentionLoop = startJournalRetentionLoop({
    apply: (retention) => agentModeController.applyJournalRetention(retention),
  });
  // The third E-Stop trigger next to the UI button and the spoken stop word. Whoever
  // runs this from a terminal is usually the person standing next to the robot.
  // Armed only while Agent Mode is on (and follows the runtime toggle): raw-mode
  // stdin that latches an E-Stop on a stray SPACE is an observable behaviour
  // change every mode-off dev profile would otherwise inherit.
  let terminalEstop = config.agentMode.enabled ? startTerminalEstop() : null;
  agentModeController.subscribe((event) => {
    if (event.type !== 'agent:state:changed') return;
    const on = agentModeController.isEnabled();
    if (on && !terminalEstop) {
      terminalEstop = startTerminalEstop();
    } else if (!on && terminalEstop) {
      terminalEstop.dispose();
      terminalEstop = null;
    }
  });
  if (config.agentMode.enabled) {
    console.log('[AgentMode] Agent Mode is ON — A2A messages are planned into blocks');
  }

  // Start compliance logging session.
  //
  // Deliberately NOT in `PORT_OWNED_STEPS`, and the reason is a compliance one
  // rather than a convenience one. The gate in `agent-runtime.ts` protects three
  // things — actuation, the fleet mirror, and safety verdicts. Opening a
  // record-keeping channel is none of them: it moves nothing, tells the fleet
  // nothing, and decides nothing. What it does do is witness a process that is
  // ALREADY doing auditable work before it owns a port — the journal retention
  // loop above deletes plaintext operational memory (a GDPR Art. 30 processing
  // activity), and the terminal E-Stop is armed. A candidate that ran those
  // with no audit channel open would be the gap, not the phantom record.
  //
  // So yes: a process that loses the port leaves a `system_startup` entry for a
  // boot that never served. Under EU AI Act Art. 12 that is the safe direction
  // of error — the log's job is to let an investigator reconstruct what ran, and
  // a spurious "an agent started here" is recoverable where a missing one is
  // not. It is attributable rather than anonymous: `bootId` ties the entry to
  // the lineage, where the absence of a matching line is exactly what marks it
  // as a candidate that never took over.
  //
  // The await is bounded inside the client (COMPLIANCE_REQUEST_TIMEOUT_MS) and
  // `startSession()` never throws: an unreachable OR STALLED server degrades to
  // an offline session, and the boot walks on to `server.listen()`.
  try {
    const sessionId = await complianceLogClient.startSession();
    console.log(`[SimulatedRobot] Compliance logging session started: ${sessionId}`);

    // Log system startup event
    await complianceLogClient.logSystemEvent({
      payload: {
        description: 'Robot agent started',
        eventName: 'system_startup',
        component: 'robot-agent',
        version: '1.0.0',
        configuration: {
          robotId: ROBOT_ID,
          robotName: ROBOT_NAME,
          robotClass: config.robotClass,
          maxPayloadKg: config.maxPayloadKg,
          // Which process life this record belongs to — see the note above.
          bootId: incarnation.bootId,
        },
      },
      severity: 'info',
    });
  } catch (error) {
    console.warn('[SimulatedRobot] Failed to start compliance session:', error);
  }

  // Start federated learning lifecycle (if enabled)
  let federatedLifecycle: RoundLifecycle | null = null;

  if (process.env.FEDERATED_ENABLED === 'true') {
    federatedLifecycle = new RoundLifecycle({
      serverUrl: config.serverUrl,
      robotId: ROBOT_ID,
      pollIntervalMs: parseInt(process.env.FEDERATED_POLL_INTERVAL_MS || '30000', 10),
      trainingBridgePort: parseInt(process.env.FEDERATED_BRIDGE_PORT || '8766', 10),
      getLocalEpisodes: async (): Promise<TrainingEpisode[]> => {
        // Return empty array by default — real implementation would
        // pull from the robot's local data collection store
        return [];
      },
    });
    federatedLifecycle.start();
    console.log('[FederatedLearning] Federated learning lifecycle started');
  }

  // Create A2A components
  const agentCardOptions: AgentCardOptions = {
    robotId: ROBOT_ID,
    // The name the robot answers to, not the environment variable — the card is
    // what the fleet reads, so a robot the operator renamed must be discoverable
    // under that name (TASK-198).
    robotName: identityName,
    port: PORT,
    robotClass: config.robotClass,
    maxPayloadKg: config.maxPayloadKg,
    robotDescription: config.robotDescription,
    hardwareConnected: hardwareClient.isConnected(),
    embodiment: embodimentLoader.getEmbodiment(embodimentTag),
  };
  const agentCard = createRobotAgentCard(agentCardOptions);

  // A rename (the naming ritual, or an operator PUTting a new name) changes the
  // discovery document in place, the same way a sidecar attach does. The fleet
  // DB adopts it on its next 30 s identity sync — see the deliberate ownership
  // split recorded in `server/src/services/RobotManager.ts buildIdentityUpdate`.
  agentModeController.subscribe((event) => {
    if (event.type !== 'agent:state:changed') return;
    const name = event.state?.self?.name;
    if (!name || name === agentCardOptions.robotName) return;
    agentCardOptions.robotName = name;
    updateAgentCardIdentity(agentCard, agentCardOptions, hardwareClient.isConnected());
    // …and the REST state too: `GET /api/v1/robots/:id` is what the fleet's
    // identity sync reads, so a rename that stopped at the card would be a
    // robot answering to a name the fleet never learns.
    robotStateManager.setName(name);
    console.log(`[Identity] agent card renamed to "${agentCard.name}"`);
  });

  // Honest identity follows the sim↔hardware state: on every sidecar
  // attach/detach, update the served agent card in place (name/description)
  // and ask the server to re-pull /api/v1/register so its fleet record picks
  // up the changed serial/firmware/isSimulated values. Best-effort — the
  // agent keeps working when the server is unreachable. Read-only from the
  // robot's perspective: no motion or actuation is commanded.
  hardwareClient.onConnectionChange((connected) => {
    updateAgentCardIdentity(agentCard, agentCardOptions, connected);
    console.log(
      `[Identity] Hardware ${connected ? 'attached' : 'detached'} — agent card updated, re-reporting to server`
    );
    void (async () => {
      try {
        const robotUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
        await fetch(`${config.serverUrl}/api/robots/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ robotUrl }),
          signal: AbortSignal.timeout(5000),
        });
        console.log('[Identity] Server accepted identity re-report');
      } catch (err) {
        console.warn(
          '[Identity] Identity re-report failed (server unreachable?):',
          err instanceof Error ? err.message : err
        );
      }
    })();
  });
  const taskStore: TaskStore = new InMemoryTaskStore();
  const agentExecutor = new RobotAgentExecutor(robotStateManager);
  const requestHandler = new DefaultRequestHandler(agentCard, taskStore, agentExecutor);

  // Create Express app
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Top-level health check (used by Docker healthcheck and load balancers)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', robotId: ROBOT_ID, uptime: process.uptime() });
  });

  // Mount REST API routes (NeoDEM compatible)
  app.use('/api/v1', createRestRoutes(robotStateManager, deviceIdentity, secureBoot));

  // Federated learning status endpoint
  app.get('/api/v1/federated/status', (_req, res) => {
    if (!federatedLifecycle) {
      const status: FederatedStatus = {
        enabled: false,
        running: false,
        currentRoundId: null,
        phase: 'idle',
        lastError: null,
        roundsParticipated: 0,
        lastParticipation: null,
      };
      res.json(status);
      return;
    }
    res.json(federatedLifecycle.getStatus());
  });

  // Mount A2A routes
  const a2aApp = new A2AExpressApp(requestHandler);
  a2aApp.setupRoutes(app, '');

  // Create HTTP server
  const server = http.createServer(app);

  // Setup WebSocket servers (noServer mode — see the upgrade dispatcher below).
  // They must NOT each bind to `server`: ws aborts non-matching paths with 400,
  // so the first-attached server would reject every other endpoint's upgrades.
  const telemetryWss = createTelemetryWebSocket(robotStateManager);
  const pointCloudWss = createPointCloudWebSocket(robotStateManager);
  const frameRecorder = new FrameRecorder();
  const bilateralWss = createBilateralTeleopWebSocket(frameRecorder);
  const keyboardWss = createKeyboardTeleopWebSocket(robotStateManager);
  const agentModeWss = createAgentModeWebSocket();

  // Single upgrade dispatcher routes each WebSocket path to its server.
  server.on('upgrade', (req, socket, head) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;
    } catch {
      socket.destroy();
      return;
    }

    const route = (wss: import('ws').WebSocketServer) =>
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));

    if (pathname === `/ws/telemetry/${ROBOT_ID}`) {
      route(telemetryWss);
    } else if (pathname === `/ws/pointcloud/${ROBOT_ID}`) {
      route(pointCloudWss);
    } else if (pathname === '/ws/bilateral-teleop') {
      route(bilateralWss);
    } else if (pathname === '/ws/keyboard-teleop') {
      route(keyboardWss);
    } else if (pathname === '/ws/agent-mode') {
      route(agentModeWss);
    } else {
      socket.destroy();
    }
  });

  // Everything that actuates, pushes to the fleet mirror or decides a safety
  // question, bound to the one event that says this process IS the robot.
  // The order lives in `agent-runtime.ts`, where it is documented and tested.
  const runtime = createAgentRuntime({
    confirmIncarnation: () => incarnations.confirm(),
    attachController: () => agentModeController.attach(robotStateManager),
    reassertRestoredStop: () => {
      if (robotStateManager.reassertRestoredSafetyStop()) {
        console.log('[SimulatedRobot] restored E-Stop latch re-asserted on the hardware');
      }
    },
    recordBoot: () => agentModeController.recordBoot(incarnation),
    startSimulation: () => {
      robotStateManager.startSimulation();
      console.log('[SimulatedRobot] Robot simulation started');
    },
    startSafetyMonitoring: () => {
      robotStateManager.startSafetyMonitoring();
      console.log('[SimulatedRobot] Safety monitoring started');
    },
    announceBootState: () => agentModeController.announceBootState(),
    startIdleWatcher: () => {
      agentModeController.startIdleWatcher();
      // Patrol photo retention (TASK-212): sweep now, then hourly. Rides the
      // same "we ARE the robot" step — a loser on the port must not delete
      // the winner's photos.
      agentModeController.startPatrolRetentionSweep();
      // Host mode (TASK-213): close tours a restart left open, then sweep
      // visitor transcripts past retention. Same "we ARE the robot" gate — a
      // loser on the port must not close the winner's running tour.
      agentModeController.startTourRetentionSweep();
    },
    abandonIncarnation: (reason) => incarnations.abandon(reason),
  });

  // The port is the one thing that decides which of several processes IS this
  // robot. `npm run dev` (tsx watch) regularly has two alive at once, and the
  // loser lands here — three boots within 50 ms were observed on this box.
  // It must leave the lineage untouched (an unwritten line cannot read as a
  // crash) and must never have told the fleet it is the robot — which is now
  // true by construction: not one of the steps above has run yet.
  server.on('error', (err: NodeJS.ErrnoException) => {
    const why =
      err.code === 'EADDRINUSE'
        ? `port ${PORT} is already in use — another robot agent owns it`
        : err.message;
    runtime.onBindFailed(why);
    console.error(`[SimulatedRobot] HTTP server could not start: ${why}`);
    process.exit(1);
  });

  // Start server
  server.listen(PORT, () => {
    // This process owns its port, so it is a real incarnation of this robot:
    // NOW the lineage line is written, NOW the controller learns what it
    // inherited and how the last process ended, NOW the machine may move, and
    // only then does the fleet hear from us and the robot act on its own.
    runtime.onPortOwned();

    console.log('');
    console.log('='.repeat(60));
    console.log(' Server Started Successfully!');
    console.log('='.repeat(60));
    console.log('');
    console.log(`  Robot ID:     ${ROBOT_ID}`);
    console.log(`  Robot Name:   ${ROBOT_NAME}`);
    console.log(`  Robot Class:  ${config.robotClass}`);
    console.log(`  Max Payload:  ${config.maxPayloadKg}kg`);
    console.log(`  Port:         ${PORT}`);
    console.log('');
    console.log('  Endpoints:');
    console.log(`    Base URL:       http://localhost:${PORT}`);
    console.log(`    A2A Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`);
    console.log(`    REST API:       http://localhost:${PORT}/api/v1/robots/${ROBOT_ID}`);
    console.log(`    Registration:   http://localhost:${PORT}/api/v1/register`);
    console.log(`    Telemetry WS:   ws://localhost:${PORT}/ws/telemetry/${ROBOT_ID}`);
    console.log(`    PointCloud WS:  ws://localhost:${PORT}/ws/pointcloud/${ROBOT_ID}`);
    console.log(`    PointCloud:     http://localhost:${PORT}/api/v1/robots/${ROBOT_ID}/pointcloud`);
    console.log(`    Keyboard Teleop:ws://localhost:${PORT}/ws/keyboard-teleop`);
    console.log(`    Agent Mode:     http://localhost:${PORT}/api/v1/robots/${ROBOT_ID}/agent-mode`);
    console.log(`    Agent Mode WS:  ws://localhost:${PORT}/ws/agent-mode`);
    console.log(`    Health Check:   http://localhost:${PORT}/api/v1/health`);
    console.log('');
    console.log('  Press Ctrl+C to stop the server');
    console.log('='.repeat(60));

    // Start secure OTA update checks (CRA Art. 13)
    secureUpdateClient.startPeriodicChecks();
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log('\n[SimulatedRobot] Shutting down...');

    // Persist state synchronously before anything else (Task 39)
    robotStateManager.saveStateSync();
    console.log('[SimulatedRobot] State persisted to disk');

    // …and close the incarnation right next to it, still before the network
    // phase below: this line is what makes the next boot read as clean rather
    // than as a crash, and everything after this point can block.
    incarnations.close(signal, agentModeController.incarnationSnapshot());
    // The occupancy map (TASK-206) is the other thing worth more than the
    // network phase: sync, atomic, and honest-null (skipped without a session).
    if (agentModeController.persistMap()) console.log('[SimulatedRobot] Occupancy map persisted to disk');

    // Log shutdown and end compliance session
    try {
      await complianceLogClient.logSystemEvent({
        payload: {
          description: 'Robot agent shutting down',
          eventName: 'system_shutdown',
          component: 'robot-agent',
          version: '1.0.0',
        },
        severity: 'info',
      });
      await complianceLogClient.endSession();
      console.log('[SimulatedRobot] Compliance session ended');
    } catch (error) {
      console.error('[SimulatedRobot] Failed to end compliance session:', error);
    }

    if (federatedLifecycle) {
      federatedLifecycle.stop();
      console.log('[FederatedLearning] Federated learning lifecycle stopped');
    }
    secureUpdateClient.stopPeriodicChecks();
    retentionLoop.stop();
    terminalEstop?.dispose();
    agentModeController.dispose();
    robotStateManager.stopSafetyMonitoring();
    robotStateManager.stopSimulation();
    server.close(() => {
      console.log('[SimulatedRobot] Server closed');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[SimulatedRobot] Fatal error:', error);
  process.exit(1);
});
