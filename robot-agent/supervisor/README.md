# Robot supervisor

Starts, stops and reports the G1's robot-side processes — read-only state bridge,
`g1_sidecar.py`, robot agent — in a fixed, gated order on the robot PC, so nobody
has to copy env-var commands into a terminal (TASK-403).

- **Run, install, use:** `docs/g1-edu-lab-bringup.md`, "Start the robot side from NeoDEM".
- **Profiles:** `robot-agent/hardware/profiles/*.yaml` (`g1-edu-4` = the real robot,
  `sim-g1-edu-dev` = the same chain against the MuJoCo DDS sim on domain 42 / `lo`).
- **systemd:** `systemd/neodem-robot-supervisor@.service` (user unit, `%i` = robot id,
  `KillMode=process` so a supervisor restart leaves the children running).

No `node_modules` of its own: every dependency resolves from `robot-agent/node_modules`
(`npm ci` in `robot-agent/` first).

```bash
npm run typecheck
npm test            # needs a python with pyzmq for the stub children (SUPERVISOR_TEST_PYTHON, default python3)
```

| File | Owns |
| --- | --- |
| `src/profile.ts` | profile loading/validation, child env allowlist, child command lines |
| `src/procs.ts` | setsid spawn, PID files, `/proc` identity, port owners, conflict scan |
| `src/steps.ts` | the start/stop sequences, mode switch, status, the only `kill` |
| `src/sidecarClient.ts` | `/health`, `/disarm`, `/estop` — nothing else (statically tested) |
| `src/logs.ts` | per-process log files followed into a 2000-line ring |
| `src/api.ts` | the HTTP API on 127.0.0.1 (bearer token) |
| `src/quest.ts` | the Meta Quest on this PC's USB: `GET /quest`, `POST /quest/connect {port?}` (`adb reverse`), `POST /quest/open {path}` (Quest browser, allowlisted paths only) — TASK-412 |
