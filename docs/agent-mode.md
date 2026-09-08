# Agent Mode, patrol and host mode

Agent Mode is how a NeoDEM robot acts on plain language without a cloud model in the
loop. A local Ollama model turns a typed or spoken sentence into a short list of typed
**blocks** (`walk`, `turn`, `goto`, `look`, `speak`, ...), and the robot executes them over
the Unitree LocoClient. The same call path drives the MuJoCo simulator and a real G1.

Two complete use cases sit on top of it:

- **Patrol** — the robot alone. It walks an operator-defined route on a schedule, takes a
  control photo at every checkpoint, compares what it sees against a baseline of "normal",
  and raises findings as alerts.
- **Host mode** — the robot with a person in front of it. It greets a visitor, discloses
  that it is an AI, offers a guided tour, walks them from stop to stop, and answers
  questions from authored facts, place notes and camera observations.

This page is the operator's guide: what the feature does, how to switch it on, what it
refuses to do, and where its data lives. The developer detail is in
[`robot-agent/AGENTS.md`](../robot-agent/AGENTS.md) and the architecture summary in
[`architecture.md`](architecture.md#agent-mode). The HTTP surface is in
[`api.md`](api.md).

**Maturity:** everything on this page is proven in **simulation only**. The motion path on a
real G1 is gated; read [Safety](#safety) before pointing it at hardware.

---

## What Agent Mode is

```
chat / voice ──► planner (Ollama) ──► block list ──► block executor ──► LocoClient
                        ▲                                  │                 │
                 scene memory ◄──── vision model ◄── head camera      real G1 / sim
```

- **Two models, two roles.** The vision model sees pixels and returns text. The planner
  sees only that text plus the scene memory, never an image. Both run on a local Ollama.
- **Blocks are the contract.** The planner can only emit kinds from a fixed vocabulary, and
  the executor refuses anything else. Some kinds (`patrol`, `capture`, `inspect`, `tour`,
  `present`, `demo`) are owned by a runner and can never come from the planner.
- **Plans are re-entrant but blocks are not.** After every block the planner may rewrite
  the *remaining* plan. A block that has started is never interrupted by the planner;
  only the E-Stop, the stop word or a teleop takeover do that.
- **Everything is audited.** Every finished block is mirrored to the server, shown live in
  the cockpit, and written to the EU AI Act compliance log with the model id.

### The block vocabulary

| Block | What it does | Robot action |
|-------|--------------|--------------|
| `walk`, `turn` | Move a distance or an angle | `SetVelocity` with a duration |
| `goto` | Walk to a named place or a seen object; expands into visible walk/turn/look stages, planned on the occupancy map | `SetVelocity`, staged |
| `look`, `scan_room` | Capture a head-camera frame and ask the vision model what is there | none |
| `wave`, `greet` | Arm gesture | arm task |
| `posture` | Stand, sit, damp | `SetFsmId` |
| `speak` | Say a sentence through the voice service, text-only when it is down | none |
| `wait`, `remember` | Dwell; write a note into durable memory | none |
| `vla_skill` | Hand a named manipulation skill to the VLA runner and wait | VLA policy |
| `patrol`, `capture`, `inspect` | Runner-owned; see [Patrol](#patrol) | — |
| `tour`, `present`, `demo` | Runner-owned; see [Host mode](#host-mode) | — |

### What the robot knows

- **Scene memory** is in memory only. It holds a labelled entity list with world bearings
  and distance estimates, merged across looks so a `scan_room` produces a consistent map.
  It is wiped when someone else takes control, because the robot may have been moved.
- **Place belief** is metric pose plus a named place (STAGING, AISLE-1, DOCK-1) plus a
  confidence. The place graph comes from a file or from the digital twin's place index,
  cached on disk so a server outage means a stale map rather than no map.
- **Occupancy map** is a 2-D grid the robot builds from its own LiDAR clouds, persisted
  across boots. `goto` plans on it, and other robots' reported poses are overlaid as
  obstacles.
- **Durable memory** lives in files under `robot-agent/data/workspace-<robotId>/`, one
  workspace per robot: `MEMORY.md`, per-place notes, standing intents, a daily journal, and
  the runs of patrol and host mode. Text the robot merely overheard or was shown by the
  vision model is tagged `untrusted` and never promoted to fact on its own.
- **Identity** is `IDENTITY.md` in the same workspace, readable and editable from the
  cockpit.

### Turning it on

Agent Mode is off by default except in the dedicated Agent Mode profile for
the simulated G1 EDU:

```bash
# Terminal 1, from the repository root, with the simulator venv activated:
(cd robot-agent/hardware/sim_g1_dds && python sim_node.py --domain 1 --http-port 8777)

# Terminal 2, from the repository root: the models the profile pins
ollama pull gemma4:e2b       # planner
ollama pull qwen2.5vl:7b     # vision

# 3. the agent
cd robot-agent
cp .env.g1-edu-agent.example .env.g1-edu-agent
npm run dev:g1-edu-agent     # port 41246, forces AGENT_MODE_ENABLED=true
```

Start the server and frontend using the [README quick start](../README.md#quick-start).
Install the simulator dependencies from its [README](../robot-agent/hardware/sim_g1_dds/README.md) before running the simulator command.
Then open **Agent Mode** in the sidebar (`/agent`), toggle the mode on, and type or say a
command. German and English both work.

The keys you are most likely to touch, all in `.env.g1-edu-agent`:

| Key | Default | Meaning |
|-----|---------|---------|
| `AGENT_MODE_ENABLED` | `false` | The master switch |
| `AGENT_PLANNER_MODEL`, `AGENT_VISION_MODEL` | `gemma3:4b` in code; the profile pins `gemma4:e2b` and `qwen2.5vl:7b` | The two Ollama models |
| `AGENT_OLLAMA_BASE_URL` | `http://localhost:11434/v1` | Where Ollama listens |
| `AGENT_STOP_WORDS` | `stopp,stop,halt` | Spoken words that stop the robot without touching the model |
| `AGENT_RANGE_ENABLED` | `true` | Use the LiDAR cone query for distances instead of the vision model's guess |
| `AGENT_MAP_ENABLED`, `AGENT_NAV_PLANNER` | `true`, `grid` | Build the occupancy map and plan `goto` on it |
| `AGENT_WALK_SPEED_MPS`, `AGENT_TURN_SPEED_DPS` | `0.4`, `45` | Commanded speeds |
| `PLACE_GRAPH_PATH` | the sim room | Named places, or fetched from the twin when unset |
| `AGENT_HEARTBEAT_ENABLED` | `false` | Let the robot notice things while idle (see below) |
| `VOICE_SERVICE_URL` | `http://localhost:8768` | The voice service; `speak` is text-only when it is unreachable |

The example file documents every other key inline, with the measurements that chose the
defaults.

### The robot on its own

While Agent Mode is on and the robot is idle, an **idle watcher** takes one cheap vision
look every few seconds. A person who *newly* appears gets exactly one greeting. That is
the only thing the robot does unprompted by default, and it never involves locomotion.

With `AGENT_HEARTBEAT_ENABLED=true` the robot may also speak up about what it notices
between commands, rate-limited and inside configured hours. Even then the allowed kinds
are `look`, `speak`, `wait` and `remember`. The allowlist is enforced on the plan
structure, not by a rule in a prompt, so a model cannot talk its way past it.

Every self-started action goes through the **initiative gate**: no latched E-Stop or
unacknowledged crash, and no self-started `posture` or `vla_skill`. Battery must be known
and at least 20 %, except for `speak` and `wait`. Locomotion additionally requires a known,
fresh place and a base that is not damped. Operator commands bypass this initiative gate;
the controller and safety monitor still enforce their E-Stop checks. Scheduled patrols
pass the initiative gate as locomotion.

---

## Patrol

An operator defines a **route**: an ordered list of checkpoints, each a place from the
robot's place graph with an optional stored heading and actions (`capture`, `dwell`,
`scan`), plus an optional five-field cron schedule and time windows. The server fires the
schedule; the robot walks the route.

The first run is a **baseline** run: operator-supervised, it records a photo, a checklist
answer, the seen labels and the map state at every checkpoint. Every later run is a
**patrol** run and is compared against that baseline. An operator can promote any run to
become the new baseline, and marking a finding as "this is normal" teaches the baseline
too.

### What counts as a finding

| Type | How it is detected |
|------|--------------------|
| `person` | Checklist at a checkpoint, or the watch list on any look en route. The robot says one line and records the finding **without an image**. |
| `unexpected_object` | A watch-listed label the baseline leg never saw, or a cluster of map cells that were free on the baseline and are occupied now. Both sightings of the same object merge into one finding. |
| `missing_object`, `object_on_floor`, `door_open`, `lights_on`, `out_of_place` | Item-by-item checklist diff against the baseline at a checkpoint. Only changes toward "not normal" count. |
| `expectation_failed` | An operator-written expectation on the checkpoint did not hold. |

En-route findings need two of three consecutive observations to agree; checkpoint
checklist findings are confirmed immediately,
and there is one finding per type per place per run. Each carries evidence: baseline
photo, current photo, map pose, time, model and confidence. Severity is derived on the
server from type and time window. Findings land as **alerts**, are acknowledged, marked
normal or escalated into an incident from the patrol UI.

The comparison is deliberately cheap. At a checkpoint a perceptual hash against the
baseline photo decides whether a single vision-model call is even needed. Between
checkpoints the label diff and the map diff issue no model call at all.

### Leg semantics

Every leg is a `goto` through the same executor as an operator's command, so E-Stop,
geofence, control arbitration and the audit log apply unchanged. A leg that fails is
skipped and reported and the run continues. Two consecutive failures abort the run, and
the robot still goes home. An operator command during a patrol aborts the run and then
executes as a fresh plan.

A run that cannot start is refused **before the robot moves** and is still recorded, as a
`skipped` run with a reason (`estop`, `battery`, `place_unknown`, `window`, `damped`,
`crash_unacknowledged`, `route_unknown`, `busy`, ...) and an alert.

### Running one

```bash
# robot side: opt in
AGENT_PATROL_ENABLED=true             # in .env.g1-edu-agent
AGENT_PATROL_HOME_PLACE=STAGING       # optional: where to return to
```

In the app, **Patrol** in the sidebar (`/patrol`) lists routes, runs and findings. Create a
route in the editor, pick the checkpoints from the robot's places, run it once as a
baseline with "Patrol now", then either schedule it or run it by hand. A run page shows
every leg with its baseline and current photo pair and the findings it raised.

In the simulator the house scene is the reference: start the sim with
`--scene ../sim_evaluator/mjcf/g1_dex3_house_scene.xml`, point the agent at
`hardware/sim_evaluator/places/places.house.json`, and use `POST :8777/sim/reset-pose` to
move the crate or the mocap person between the baseline and the patrol. The scripted
check is `hardware/sim_g1_dds/e2e_patrol_check.py`; a filmed clip comes from
`demo_clip.py --layout patrol`.

Keys worth knowing: `AGENT_PATROL_WATCHLIST` (labels that count en route, default
`person,box,bag,crate,bottle,puddle,ladder,cable,open door`), `AGENT_PATROL_CONFIRM_N` /
`AGENT_PATROL_CONFIRM_M` (2 of 3), `AGENT_PATROL_HASH_GATE` (0.97),
`AGENT_PATROL_PHOTO_RETENTION_H` (72 h for plain control photos; finding and baseline
photos keep 30 days), `AGENT_PATROL_LANGUAGE` (`en` or `de` for what the robot says).

### Data and privacy

Photos are stored on the robot under `workspace-<robotId>/patrol/` and uploaded to the
server per run. A checkpoint photo is written **only when no person is in frame**. A
confirmed person is a finding without an image. Retention is swept at boot and hourly,
and a GDPR erasure wipes the workspace with everything else. The route model exports as
a VDA5050 order, the same shape as the digital twin's roadmap export.

---

## Host mode

Host mode is patrol's mirror image: patrol is the robot alone at night, host mode is the
robot with a member of the public in front of it. An operator authors a **tour route**:
where the robot waits, a greeting, an offer, a farewell, a site card of facts that are
true anywhere, and an ordered list of **stops**. Each stop has a headline, a talk track,
facts the robot may answer from, an optional demo, and a dwell time in which questions are
taken.

A visit runs like this:

1. A person walks up. The robot greets them **from where it stands** with the authored
   greeting, then the **AI disclosure** (what it is, that an AI processes the conversation,
   that it records no video or audio), then the offer. No model call is involved.
2. The visitor answers. "Ja", "yes", "no", "later", "danke, tschüss" are matched by
   keyword in both languages, with a 30 second window. A refusal ends the run as
   `declined`, which is the normal outcome of a good greeting, and silence as `abandoned`.
3. The robot leads. At each stop it walks there, says the talk track in two-sentence
   chunks so the microphone reopens between them, runs the demo if there is one, and waits
   for questions. "Shall we go on?" waits 30 seconds.
4. A question gets **one** model call against the stop's facts, the site card, the place
   note and what the camera sees, and nothing else. The answer is recorded as `grounded`,
   `from_camera` or `declined`. A decline is a first-class outcome, not an error. The UI
   lists declined questions as facts worth adding to the route.
5. Goodbye, or the last stop, walks the visitor back and speaks the farewell. An E-Stop
   aborts the walk but the farewell is still spoken, because it moves nothing.

A stop the robot cannot reach is skipped and the tour goes on. Walking a visitor back to
the door because one aisle was blocked is worse than missing a stop.

### What host mode will not do

- **No sentence a model wrote is spoken to a visitor** except the answer to an unscripted
  question, and that answer must name its source. Talk tracks are authored, never
  rephrased.
- **The disclosure cannot be removed.** It is in source, reviewed like code, and the site
  can only extend it through `TOUR_DISCLOSURE_EXTRA`.
- **No stored images, audio or visitor identity.** Host mode uses camera observations
  and voice transcripts while running, but stores neither images nor audio. It infers no age,
  gender or emotion. Runs persist under `workspace-<robotId>/tour/`. After
  `TOUR_TRANSCRIPT_RETENTION_DAYS` (30), the robot clears the turns from each expired run
  but retains its operational metadata. `TOUR_TRANSCRIPT_ENABLED=false` blanks question
  and answer text in stored and mirrored turns while retaining counts, outcomes and timing.
  Workspace erasure removes the robot’s stored runs.
- **Personal distance is checked at tour start.** A visible person with a known forward
  range below `TOUR_MIN_PERSON_M` (1.2 m) causes a start refusal. During a tour, the robot
  asks for room once per leg and waits two seconds, then continues; that courtesy pause
  does not enforce a 1.2 m separation. Motion uses the executor’s existing forward-clearance
  checks.
- **Barge-in is not solved and not pretended.** The voice service is half-duplex, so a
  visitor cannot interrupt a sentence in flight. The chunked talk track is the mitigation.
- A tour the robot **offered on its own** counts as self-initiative and needs the full
  initiative gate, battery included. A tour an operator starts does not.

### Running one

```bash
# server: seed the reference tour (4 stops, idempotent by name), once
cd server && npm run seed:tour

# robot: opt in and bind the route
AGENT_HOST_ENABLED=true
AGENT_TOUR_ROUTE_ID=<the seeded route's id>
```

**Tour** in the sidebar (`/tour`) lists routes and visits. The editor holds the greeting,
offer, farewell, site card and stops; the "offer this tour to a visitor it sees" toggle
(`autoGreet`) is off by default, so until you flip it a visitor gets the plain greeting and
no tour. A run page shows every stop, whether the disclosure was actually spoken, and every
question with where its answer came from.

The demo step at a stop calls the existing skill endpoint. In the simulator
`TOUR_DEMO_MODE=narrate` (the default) says what would happen instead, because the
manipulation scene is a fixed-base G1 that cannot walk a tour. `execute` runs the skill.

In the warehouse scene a visitor is staged by teleporting the mocap person in front of
the robot with `POST :8777/sim/reset-pose {"body":"person", ...}`. The person must have
been out of frame for ten seconds before reappearing to count as new. Without the voice
service everything still runs, and the run correctly records `disclosureSpoken: false`.

---

## Safety

Read this before any of the above runs on hardware.

- **Manual E-Stop only.** Three triggers, all manual: the button on `/agent`, a spoken stop
  word (which bypasses the model entirely), and SPACE or ESC in the terminal running the
  robot-agent. Agent Mode deliberately does not have the arming gate, dry-run default,
  watchdog or delta clamp of the real-G1 bridge. The first hardware run needs a spotter on
  the physical E-Stop and a hand-set velocity cap.
- **The E-Stop says what it knows.** If the stop command was never acknowledged, the
  banner says *unconfirmed* rather than claiming the robot stopped.
- **Exactly one owner.** Control is `idle | teleop | vla | agent`. Human teleop always wins
  and discards the running plan.
- **The geofence is enforced only while the pose is trusted.** Past the drift budget the
  place belief degrades to `stale` and the fence stops enforcing. The state reports
  `not-enforcing`, safety warnings explain the lapse, and the cockpit shows "fence off"
  ([TASK-201](../.mc/tasks/done/TASK-201-say-when-the-geofence-is-not-enforcing.md)).
  This advisory does not stop motion or restore enforcement; the live GPU-box recheck
  remains outstanding in the task.
- **Durable safety state.** A boot that follows a crash restores the E-Stop latch behind an
  acknowledge gate and drops pose, place and held-object as too old.

## Where to look when something is off

| Symptom | Look at |
|---------|---------|
| "I could not plan that" for a plain command | The planner model. `gemma3:4b` cannot plan a turn reliably; the profile pins `gemma4:e2b` for that reason. |
| Every distance comes back unknown | `AGENT_RANGE_ENABLED` and the LiDAR sensor name; a missing return is reported unknown, never clear. |
| Greeting or patrol refused with a battery message | The initiative gate. The sim battery drains fast; reset it in `robot-agent/data/state-<robotId>.json`. |
| Run recorded as `skipped` | Its `reason`. The robot refused before moving and recorded why. |
| `disclosureSpoken: false` on a visit | The voice service on `VOICE_SERVICE_URL` was unreachable. The visit ran text-only. |
| A patrol says "done, 0 findings" too quickly | The camera or checklist model. A dead one now fails the run and names itself. |
| A `goto` walks past its target | Scene memory. Two same-labelled objects collapse to the one nearest the frame centre. |
