# Demo fleet

Three robots a demo instance should show even when none of them is running:

| Robot | Id | Model shown | Robot type (state / action) | Listed as |
| ----- | -- | ----------- | --------------------------- | --------- |
| Unitree G1 with Dex3 hands | `demo-g1-dex3` | Unitree G1 EDU (Dex3-1) | `Unitree G1 EDU (Dex3-1)` (43 / 43) | Not connected |
| SO-101 | `demo-so101` | SO-101 Follower | `SO-101 Follower` (6 / 6) | Not connected |
| MicroDuck | `demo-microduck` | Pollen Robotics Microduck | `Microduck` (15 / 15) | Arriving |

The robot types are seeded by the server at start (`server/src/database/seedStandardRobotTypes.ts`). The robots are put on an instance with one command.

## Put the robots on an instance

From `server/`, against any running instance:

```bash
npm ci   # once
npm run seed:demo-fleet -- --base-url https://neodem.example.org
```

The script talks to the public API only; it needs no database access and no shell on the server.

| Option | Effect |
| ------ | ------ |
| `--base-url <url>` | The instance. Default `http://localhost:3001`. `https://host` and `https://host/api` are the same thing. |
| `--dry-run` | Print what would change and write nothing. |
| `--remove` | Take the script's own robots off again. |
| `--without-microduck` | Leave the MicroDuck out. |
| `--token <jwt>` | Bearer token for an instance with auth on (or `NEODEM_TOKEN`). The account needs `member` or above. |

Each line of the output is one robot and what happened to it: `created`, `updated`, `unchanged`, `removed`, `absent` or `skipped`.

It is safe to run again, at any time:

- **No duplicates.** The ids are fixed, and each robot is one `PUT /api/robots/:id/expected`.
- **A second run writes nothing.** Rows that already match are reported `unchanged`.
- **It never touches a robot it did not create.** A row is the script's own when it carries `metadata.seededBy = "demo-fleet"` and no agent has registered it. Anything else under one of the three ids — most likely the real robot, once its agent registers under that id — is reported `skipped` and is neither modified nor removed. The server refuses such a write on its own with a 409.

The instance needs a server build that has the `expected` route; an older one answers 404 and the script says so.

## What an expected robot is

A robot normally joins the fleet when its agent registers (`POST /api/robots/register`). An *expected robot* is on the fleet before that: a row with no agent, no endpoints and nothing to health-check, in one of two states.

| State | Means | Status tag | Card and page |
| ----- | ----- | ---------- | ------------- |
| `awaiting_agent` | The hardware exists; its agent has never connected to this instance. | Not connected | "Never connected"; the page says it goes live when its agent registers. |
| `arriving` | The hardware has not been delivered. | Arriving | The note, e.g. where it is on order from; the page says there is nothing to connect yet. |

Nothing is invented for it: no battery level, no "last seen", no place. It cannot be commanded, because it is offline.

```bash
curl -X PUT https://neodem.example.org/api/robots/lab-g1-02/expected \
  -H 'Content-Type: application/json' \
  -d '{"name":"G1 #2","model":"Unitree G1 EDU (Dex3-1)","provisioning":"awaiting_agent","metadata":{"robotType":"g1_edu"}}'
```

`metadata.robotType` picks the 3D model on the robot's page (`g1_edu`, `g1`, `h1`, `so101`); without one the page says there is no model yet.

**When the real robot connects.** Give its agent the same robot id (`ROBOT_ID=demo-g1-dex3`) and it takes the row over on registration: name, model and capabilities become what the agent reports, the provisioning state is dropped, and the robot is health-checked like any other. Its site binding and anything recorded against the id stay. From then on it is not an expected robot, and neither the route nor the script will change it.

Remove an expected robot with **Unregister** in the app, or `DELETE /api/robots/:id`.

## The MicroDuck

"MicroDuck" is taken to be the [Microduck](https://pollen-robotics.com/microduck) from Pollen Robotics (part of Hugging Face): a biped about 25 cm tall and under 800 g, fifteen servos driven at 50 Hz by reinforcement-learning policies on a Rockchip RK3566, with a camera, an 8×8 time-of-flight depth sensor and two IMUs. Pre-orders opened in August 2026 with first deliveries targeted before Christmas 2026. The robot software is open source ([pollen-robotics/microduck](https://github.com/pollen-robotics/microduck), [microduck_rl](https://github.com/pollen-robotics/microduck_rl)); the hardware design is not.

The name matches exactly, so this identification is treated as safe; it is not the older community Open Duck Mini. What is *not* known is how one would be recorded: there is no LeRobot dataset of a Microduck yet, so the robot type's 15 / 15 is one value per servo, the only width the maker states. If a real recording turns out to use a different layout, define a new robot type for it rather than editing this one — datasets are validated against the type they were imported on.

## Datasets to go with them

**Import from Hugging Face → Featured** offers a small public dataset for each robot that has one:

| Dataset | Robot | Layout |
| ------- | ----- | ------ |
| `nvidia/GR00T-N1.7-AppleToPlate` | Unitree G1 | LeRobot v2.1, 43 / 43, 402 episodes, one AV1 ego-view camera |
| `ycchen0106/g1-apple-to-plate` | Unitree G1 | Our own recording. LeRobot v2.1, 43 / 43, 260 episodes at 15 fps, one AV1 ego-view camera, 310 MB |
| `Thytu/so101-object-in-box_v0.4-fixed` | SO-101 | LeRobot v2.1, `so101_follower`, 6 / 6, 101 episodes at 30 fps, one H.264 front camera, 51 MB, apache-2.0 |
| `lerobot/svla_so101_pickplace` | SO-101 | LeRobot v3.0, 6 / 6, 50 episodes, two AV1 cameras, 86 MB |
