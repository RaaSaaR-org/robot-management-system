# NeoDEM — the platform

NeoDEM is an open platform for Physical AI that covers the whole lifecycle of a
robot policy: collect the data, train on it, deploy the model, evaluate it,
operate the fleet, and keep the record a regulator asks for. It is built for the
people who do that work — robotics and AI engineers who want the data in an open
format, and the CTOs and operations managers who have to answer for what the
fleet did. The landing page is the introduction; this page is the level of detail
underneath it: what each part does, how far it has actually been taken, and which
claims are measured rather than asserted.

## Readiness at a glance

Three words carry the maturity of everything here, and they are used the same way
on the landing page, in the product and in this document:

| Word | Means |
| ---- | ----- |
| `Live` | Runs today, against the real thing — real hardware, a real scan, a real registry, a real audit trail. |
| `Sim` | Works end to end, over the same controls a real robot uses, but every number behind it comes from a simulator. |
| `Gated` | The path is built and deliberately locked. It rehearses without moving, and it takes explicit arming steps to reach hardware. |

The six stages of the lifecycle stand where the loop on the landing page says they
stand:

| Stage | Verdict | What that verdict rests on |
| ----- | ------- | -------------------------- |
| Collect | `Live` | Versioned datasets in the open LeRobot format; a digital twin built from a real 240,000-point LiDAR capture of our own lab. |
| Train | `Live` | Six selectable base models, fine-tuned without leaving the LeRobot format, on whichever GPU machine you point at it. |
| Deploy | `Gated` | The registry, the staged rollout and the one-click rollback are all real, and an update package is Ed25519-signed and recorded — but nothing is delivered to a robot yet. The bridge to a physical G1 refuses to move until it is armed twice, and never drives the legs. |
| Evaluate | `Sim` | Scored attempt by attempt in simulation, including two traps a model is meant to fail. Nothing has been scored on physical hardware. |
| Operate | `Sim` | Reading a real, powered G1 works today. Anything that moves one is still simulation. |
| Comply | `Live` | A tamper-evident audit trail, records of processing, all seven data-subject request types, retention policies and legal holds. |

Training, model serving and twin reconstruction each run in their own sibling
repository, so a GPU box can carry the heavy work without carrying the fleet.
That split matters when you read a readiness word: what is claimed here is what
this platform carries end to end, not a promise about someone else's GPU.

## The data engine

Demonstrations, room scans, generated episodes and imported datasets all end up
in the same place: one open format, with a record of where each episode came
from.

### Five ways in

| Path | Maturity | Produces | Notes |
| ---- | -------- | -------- | ----- |
| Teleoperation and VR | `Sim` | G1 EDU + Dex3-1, 43 joints | Drive the robot by hand and the session records itself into a training-ready dataset — no export, no conversion script. Proven in simulation; the path to real hardware is still gated. |
| LiDAR room scan | `Live` | A digital twin, simulator-ready | Walk a scanner around the space and it comes back as a twin you can navigate and simulate in. Proven on a real 240,000-point capture of our lab. The rooms and zones you draw on the twin become the places a robot is sent to by name. |
| World-model synthesis | `Live` | Generated episodes, tagged synthetic | When the robots cannot make enough episodes, a world action model generates them — and every one is labelled synthetic, so nothing on the record passes a generated episode off as a recording. |
| Video to motion | `Sim` | Human footage retargeted to G1 motion | Ordinary video of a person working, turned into motion the G1 can perform and played back on the live 3D robot. |
| Hub and marketplace | `Live` | HuggingFace sync, contribution credits | Sync datasets with HuggingFace in both directions, or buy and sell them for contribution credits. The transfer either completes or it does not happen, and what you download is checksummed against what was sold. |

### The pipeline

Whichever door an episode came in through, it takes the same four steps. They are
numbered because this genuinely is a sequence — nothing reaches a revision
without passing validation first.

1. **Capture** — driven, scanned, generated or imported.
2. **Validate** — format, statistics and video checked.
3. **Curate** — trim the takes, drop the failures.
4. **Version** — a new revision, with the original intact.

### Curation keeps the original

Trim a shaky start or remove a failed grasp and you get a *new version*. The
original recording stays intact, statistics update and video is re-cut. Every
trained model can be traced back to the exact dataset version it learned from, so
you can experiment freely, compare revisions and return to the source whenever
you need to.

## Models

Two classes of model share one workspace: the policies that turn an instruction
into an action, and the world action models that generate experience to train
them on. The datasets and the weights stay yours in both cases.

### Vision-language-action policies

Six base models are selectable as the starting point for a training run —
`pi0`, `pi0.6`, `OpenVLA`, `GR00T`, `GR00T N1.7` and `SmolVLA`. How far each one
has been exercised differs, and the status column says which:

| Model | Origin | Status | What that means |
| ----- | ------ | ------ | --------------- |
| SmolVLA | HuggingFace / LeRobot | `Live` | Fine-tuned here, served here. Runs on a Mac, an NVIDIA GPU or an ordinary CPU — the whole train, serve and evaluate circle has been walked end to end on a Mac. |
| GR00T N1.7 | NVIDIA | `Ready` | Trains natively, straight from the training wizard. The pick-and-place environment mirrors the workflow NVIDIA ships for it. |
| GR00T N1 | NVIDIA | `Ready` | Served from your own NVIDIA box. The connection ships with the platform; you supply the GPU. |
| π0 · π0.6 | Physical Intelligence | `Registered` | Selectable as the starting point for a training run. |
| OpenVLA | Stanford | `Registered` | Selectable as the starting point for a training run. |

`π0.5` is scaffolded in the VLA server but is **not** one of the selectable base
models: there is a backend module for it with no real weights behind it. Serving,
which lives in the sibling `vla-server` repository, reports the same shape from
its own side — SmolVLA active, GR00T N1 ready, π0.5 a stub. See
[VLA integration guide](vla-integration-guide.md) for the serving detail.

`Registered` is a status of its own on purpose. Those models are selectable and
carried end to end by this platform; how far a given trainer has been exercised
is a question about the sibling `training-worker` repository and the hardware you
point at it.

### World action models

Every generated episode is written out as an ordinary dataset and tagged
synthetic, so it can never be mistaken for a recording.

| Generator | Origin | Status | What that means |
| --------- | ------ | ------ | --------------- |
| GR00T-Dreams | NVIDIA · Cosmos-Predict2-2B | `Live` | Describe a task in words and it generates neural trajectories for the Unitree G1 and its Dex3 hands, landing as a LeRobot dataset tagged synthetic. No account needed. |
| Cosmos 3 | NVIDIA | `Live` | Action-conditioned forward dynamics on the WidowX bridge embodiment: ask what happens next if the arm does this, and it rolls the episode forward. This one path does want a paid HuggingFace account. |
| Cosmos 3 as an evaluator | Tested, then dropped | `Ruled out` | We tried it as a policy-ranking simulator and it does not work as one. It is action-conditioned and visually plausible, and it still ranked the real policy first in only one of four sequences — chance — while the naive image-similarity metric always preferred a do-nothing policy. Published as a no-go rather than quietly deleted; MuJoCo evaluation stays the source of truth. |

### No vendor login, and its two exceptions

- **No account for the platform.** MIT, self-hosted, no licence server, no seat
  count, nothing phoning home. Clone it and it runs.
- **No account for the reasoning.** Point the platform at a model running in your
  own building and the language understanding, the planning and the data
  suggestions all run there too.
- **Open weights, open format.** Datasets stay in the open LeRobot format and
  sync with HuggingFace both ways. Take the data and the trained models and walk
  out; there is nothing proprietary to convert from.
- **Two honest exceptions.** The Cosmos 3 generator runs on HuggingFace and wants
  a paid account there, and if you pick a hosted AI provider instead of a local
  one you bring that vendor's key. Neither is required to run the platform.

## Safety

Each of the states below costs something — a stopped plan, a blank field, a
caveat on a number you would rather just trust. The platform pays it and shows
the evidence instead. The stop, the distance and the sense of place are proven in
simulation today, over the same controls a real G1 uses.

### Four states it refuses to fake

| Subsystem | State | What it means |
| --------- | ----- | ------------- |
| E-Stop | `UNCONFIRMED` | The stop fires instantly on the platform's side, but if the robot never acknowledged it the banner reads *unconfirmed*, in red, rather than *stopped*. The last commands stay on screen as evidence that the robot may still be moving. |
| LiDAR range | `UNKNOWN` | "How far to the rack?" is measured with the LiDAR, not estimated by a language model. When the beam finds nothing, the answer is `UNKNOWN`. It is never rounded up to "clear". |
| Place | `NULL` | The robot knows where it is twice over: coordinates, and the name you gave the spot — STAGING, AISLE-1, DOCK-1. It holds that name steady at a boundary instead of flickering between two. Walk it onto floor nobody ever mapped and the answer becomes `NULL`, rather than the last place it happened to be sure about. The names come from the digital twin. |
| Provenance | `SIM` | Simulated *robot telemetry* is badged reading by reading, not once per screen: IMU, joint states, motor temperatures, battery health, odometry, the sensor block and the hand touch pads each carry their own `SIM` pill, because the robot declares which of its readings are simulated. The badge travels with the number. It stops at robot telemetry — the seeded fleet figures in the demo build carry no badge, because nothing there claims to be a sensor reading. |

### Four scopes for an emergency stop

An emergency stop exists at four scopes: the whole fleet, one zone, one robot,
and human approval — where anything flagged high-risk waits in a queue until a
person signs it off.

### The keep-out fence

Underneath the stop sits an enforced keep-out zone. Cross into one while the
robot *trusts* where it is and it stops itself, abandons the plan it was running,
and refuses the next command until someone clears it.

That word *trusts* is load-bearing. A pose carries a drift budget — 15 m of
walking without a fresh position fix, by default, which is less than the length
of a 20 m hall. Once the budget is spent the robot stops trusting its own
position, the fence answers *unknown*, and the safety layer is deliberately built
to do nothing on unknown: a pose that may be tens of metres wrong is not evidence
about where the robot is. The fence is therefore not a guarantee of containment,
it is a guarantee about what it knows — and because a lapse that nobody can see
is the dangerous part, the enforcement state is reported alongside the verdict,
so the console can say when the fence has stopped enforcing.

### Measured distance, not a guessed one

Distance comes from the LiDAR cone query rather than from the vision model.
Scored in a simulated room where the true answer is known exactly, the LiDAR came
in at 0.017 m average error over 24 measurements, against 0.94 m for the vision
model's guess in the same room — which mostly declined to answer at all. Both are
simulator figures; nothing from a physical sensor has been scored yet.

### Crash recovery

A log entry that was never closed means the last run crashed. The next start-up
says so, keeps the emergency stop held until somebody acknowledges it, and throws
away where the robot thought it was and what it thought it was holding. There is
never a clean slate by accident.

### Where the stop numbers come from

The `0.48 m` clearance quoted on the landing page is one logged warehouse
simulation, recorded on 2 August 2026 using the same controls as a real G1. A
command to walk two metres, aimed at rack RACK-A, stopped 0.48 m clear of it, the
plan was abandoned and the next command refused. A second approach stopped at
0.49 m. These are simulation results, not physical hardware measurements.

## Ownership and the record

### Where the AI runs

The platform's own reasoning has one setting with three values, and one of them
is your own hardware:

| Provider | Where it runs |
| -------- | ------------- |
| Gemini | Cloud |
| OpenRouter | Cloud |
| Ollama | Your hardware |

Choose the local one and the whole server runs its AI on a model in your own
building: no cloud key, no data leaving the site. Understanding a spoken command,
planning a job and suggesting what to cut from a dataset all move together — it
is one switch, not three. Local is not off the record either: whichever you pick,
the model that made a decision is named in the audit trail.

### A record you can verify

Implemented controls, mapped to the requirements they support:

| Requirement | Control |
| ----------- | ------- |
| AI Act Art. 12 | A tamper-evident audit trail. Run the check and it re-walks every entry and names any one that no longer matches. |
| AI Act Annex IV | Technical documentation, generated in the Annex IV structure. |
| AI Act Art. 14 | Human oversight: multi-step approvals, escalation, and a route to contest or intervene in a decision. |
| GDPR Art. 30 | Records of processing — the RoPA, kept in the system that does the processing. |
| GDPR Art. 15–22 | A self-service portal covering all seven data-subject request types: access, rectification, erasure, restriction, portability, objection, and review of an automated decision. |
| Retention | Retention policies delete on a schedule. A legal hold takes those records out of the cleanup job's reach until you lift it — the hold wins, and the cleanup run reports how many records it skipped for that reason. |

[Regulatory compliance](regulatory-compliance.md) covers the wider requirements
matrix; the table above is what is implemented here.

### Erasure that reaches the fleet

Deletion requests reach beyond the central database. The platform clears personal
information from reachable robots' memory and removes the operator and site
labels from their identity cards, recording the result of both steps. Offline
robots are reported as unreachable rather than counted as done, so an incomplete
erasure stays visible until it can be resolved.

## Install

One repository, three ways to start it. Every command below has been checked
against the repository it installs, because a command that fails on the first
paste is worse than no command at all.

### Local

```bash
git clone https://github.com/RaaSaaR-org/robot-management-system
cd robot-management-system

cp server/.env.example server/.env
cd server && npm install && npx prisma db push && npm run dev

cd ../robot-agent && npm install
cp .env.example .env.g1
printf 'ROBOT_TYPE=g1\nROBOT_ID=sim-robot-g1\nPORT=41244\n' >> .env.g1
npm run dev:g1

cd ../app && npm install && npm run dev     # http://localhost:1420
```

Three terminals, no Docker and no database to install — about five minutes from
clone to a G1 reporting live telemetry.

Two details in that block are deliberate. It is `prisma db push`, not
`prisma migrate dev`: the schema ships as `sqlite` for local development while
the migration lock records `postgresql`, so a migrate run aborts with P3019. And
do not skip the two lines that write the robot's settings file — `.env.g1` is
deliberately not in the repository, dotenv no-ops on a missing file, and without
it `npm run dev:g1` quietly falls through to its defaults and starts an H1 on
port 41243 instead.

### Docker

```bash
docker compose up -d
```

The whole stack in one command: the server, the app and the robot agent, with the
database, messaging and object storage brought up alongside them.

### Kubernetes

```bash
helm install neodem ./helm/neodem
```

The chart in `helm/neodem` covers the server, app and robot agent plus ingress,
autoscaling, a pod disruption budget, a network policy and optional in-cluster
PostgreSQL, NATS and RustFS. It ships in the repository.

### What you need

| What | Number | Note |
| ---- | ------ | ---- |
| Clone to running | ~5 minutes | Three terminals, no Docker required |
| Licence | MIT | Yours to fork, ship and sell |
| Accounts needed | None | No key, no seat count, nothing phones home |

Under the hood it is Node and npm, a file-based database locally and PostgreSQL
in production, with messaging and object storage optional — leave them out and
the features that need them switch themselves off and say so. Exact versions are
in the README.

### Sibling repositories

Training, model serving and twin reconstruction each live in their own
repository. Clone this one and you can collect data and operate robots;
fine-tuning, serving and building a twin want their neighbours cloned alongside
it. The README's "Next door" table names each one and how it talks to this
server, and container images for the three services in this repository publish
to the GitHub registry.
