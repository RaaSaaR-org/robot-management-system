# Adding a New Robot Embodiment to NeoDEM

This plan covers integrating a manufacturer's robot model into NeoDEM, from technical discovery to acceptance on physical hardware. Use it to agree the scope with the manufacturer and turn the work into implementation tasks.

An **embodiment** describes the robot's physical configuration: joints, sensors, action and observation formats, and operating limits. A **robot type** identifies a supported model in the platform. A **robot instance** is an individual unit with its own identity, connection settings, and calibration. Adding more units of an already supported configuration normally requires onboarding rather than another model integration.

## 1. Agree the supported configuration and acceptance criteria

- [ ] Identify the manufacturer, model, hardware revision, firmware, SDK version, hands/grippers, and sensor configuration.
- [ ] Define the intended use cases and operating environment.
- [ ] Select the capabilities to deliver using the scope table below.
- [ ] Define measurable acceptance criteria for telemetry freshness, command response, camera quality, stop behavior, and the selected use cases.
- [ ] Record unsupported capabilities and dependencies on the manufacturer's software.

| Scope | Deliverables |
|---|---|
| Core integration | Robot registration, connectivity, real telemetry, supported manual commands, stop handling, dashboard/3D model, deployment instructions, and hardware acceptance |
| Sensor extensions | Additional cameras, depth/LiDAR, point clouds, audio, or other sensors selected for the project |
| Advanced teleoperation | VR, inverse kinematics, hand retargeting, or bilateral control |
| Data collection | Synchronized recordings, dataset metadata, LeRobot export/import, and playback validation |
| Learned skills | Compatible VLA inference, explicit action contracts, model evaluation, and any agreed training work |
| Autonomous operation | Selected navigation, manipulation, or agent-driven workflows using the manufacturer's supported controllers |

**Output:** An agreed capability matrix and acceptance checklist. Optional capabilities are included only when selected.

## 2. Obtain the manufacturer's integration package

- [ ] Obtain SDK/API documentation, example programs, required licenses, and an engineering contact.
- [ ] Obtain a test robot or supervised access to one, plus the manufacturer's setup and recovery procedures.
- [ ] Obtain URDF or equivalent kinematic descriptions, meshes, joint names, joint limits, coordinate frames, and calibration procedures.
- [ ] Document communication protocols, network interfaces, authentication, onboard compute, supported operating systems, and deployment restrictions.
- [ ] Obtain sensor specifications and command/state examples, including units, timestamps, update rates, and error codes.
- [ ] Agree access and redistribution rights for drivers, models, meshes, and any collected data.

**Output:** A reproducible manufacturer setup and a list of missing inputs or technical blockers.

## 3. Define the robot's data and control contracts

- [ ] Choose stable identifiers for `ROBOT_TYPE`, `embodiment_tag`, and individual `ROBOT_ID` values.
- [ ] Define joint order, axes, units, zero offsets, limits, and conversions between the SDK, NeoDEM, URDF, and datasets.
- [ ] Define action and proprioception dimensions from the actual command and observation formats. These are not necessarily equal to the robot's joint count.
- [ ] Distinguish full-body state from controlled subsets, such as arms and hands while a vendor controller maintains balance.
- [ ] Define supported control modes, command ownership, acknowledgements, cancellation, and error handling.
- [ ] Define how unavailable, stale, disconnected, and simulated sensor values are represented.

**Output:** A versioned interface specification used by the bridge, agent, frontend, and optional training pipeline.

## 4. Register the embodiment throughout the platform

- [ ] Add the embodiment YAML with action normalization, proprioception, cameras, applicable depth sensors, and manufacturer-confirmed operating limits.
- [ ] Add the joint configuration and register it in the agent's joint configuration lookup.
- [ ] Extend robot type definitions, type normalization, footprint information, and type-to-embodiment mappings.
- [ ] Add the server's robot type catalog entry and the associated embodiment record where required by the selected workflows.
- [ ] Verify that server metadata and the agent's deployed YAML agree; the server record and local YAML are separate configuration surfaces.
- [ ] Add an environment example and launch profile with an explicit hardware sidecar address and simulation/hardware selection.
- [ ] Check that generated robot identity/body descriptions and advertised capabilities match the new hardware.

**Output:** The new type loads with validated configuration and can be registered without falling back to another robot's defaults.

## 5. Implement the hardware bridge

NeoDEM's existing integration pattern uses a Python hardware sidecar between the manufacturer's SDK and the TypeScript robot agent.

- [ ] Reuse an existing compatible driver or implement a sidecar for the manufacturer's protocol.
- [ ] Implement the health, state, action, and stop operations required by the agent's hardware client.
- [ ] Add camera discovery/snapshot/stream and other sensor endpoints for the selected capabilities.
- [ ] Translate commands, units, state, and errors according to the agreed interface specification.
- [ ] Handle connection loss, stale data, SDK failures, reconnects, and process shutdown explicitly.
- [ ] Ensure only one controller owns a motion resource at a time; define handover between manual control, learned skills, and vendor tools.
- [ ] Keep simulated operation identifiable and prevent hardware sessions from silently reporting synthetic success.

**Output:** The agent can read actual robot state and execute the agreed commands through a tested bridge.

## 6. Implement and verify motion limits and stop behavior

- [ ] Apply the manufacturer's joint, speed, acceleration, force/torque, and workspace constraints wherever the integration controls those quantities.
- [ ] Define behavior for malformed commands, out-of-range targets, stale state, command timeouts, and lost connectivity.
- [ ] Integrate protective stops, emergency-stop reporting, stop latching, and deliberate recovery with the existing safety monitor.
- [ ] Verify what each software stop actually does on the physical robot and how it relates to the manufacturer's hardware emergency stop.
- [ ] For legged robots, retain the manufacturer's supported balance/locomotion control and explicitly restrict which joints NeoDEM may command.
- [ ] Ensure reconnecting or restarting does not unexpectedly resume motion.

**Output:** Documented stop and recovery behavior, confirmed with the manufacturer on the target configuration.

## 7. Integrate telemetry, commands, and visualization

- [ ] Map actual battery/power, joints, operating mode, faults, and available sensor state into platform telemetry.
- [ ] Add appropriate simulation behavior for development, with clear separation from hardware data.
- [ ] Connect supported commands and manual controls; disable unsupported actions in both the interface and execution path.
- [ ] Add the URDF and meshes, model lookup, joint mapping, scale, orientation, and unit conversion for the 3D viewer.
- [ ] Verify dashboard status, joint movement, cameras, error messages, and stop state against the physical robot.
- [ ] Verify registration, permissions, tenant isolation, and multiple robot instances using the new type.

**Output:** An operator can identify, monitor, and control the robot through NeoDEM using the agreed capabilities.

## 8. Add advanced teleoperation and recording, if selected

- [ ] Implement embodiment-specific inverse kinematics, input mapping, hand retargeting, and coordinate transforms for the chosen controller or VR input.
- [ ] Validate reachability, joint limits, control handover, and behavior when operator tracking is lost.
- [ ] Record synchronized observations, actions, camera frames, timestamps, and task metadata.
- [ ] Preserve embodiment version, joint names/order, units, calibration, and real/simulated provenance in the recording metadata.
- [ ] Validate dataset export, import, visualization, and playback using a representative episode.

**Output:** A validated teleoperation and/or data collection workflow for this embodiment.

## 9. Add learned skills or autonomous workflows, if selected

- [ ] Select a model/controller compatible with the robot's actual observations, cameras, and action space.
- [ ] Define explicit policy action contracts, including joint order, controlled subsets, units, normalization, and absolute versus relative targets.
- [ ] Reject incompatible models or action dimensions before issuing hardware commands.
- [ ] Configure the inference service, skill executor, and model compatibility metadata.
- [ ] If training is included, agree datasets, task coverage, evaluation conditions, and success criteria separately.
- [ ] Validate the selected workflow in simulation and then under supervised hardware operation, including operator intervention and recovery.

**Output:** Evidence for the specific skills or autonomous workflows accepted for this robot. Loading an embodiment configuration alone does not establish model compatibility or task performance.

## 10. Validate the integration in stages

- [ ] Test configuration loading, mappings, conversions, dimensions, command rejection, and bridge contracts without hardware.
- [ ] Run the complete UI → server → agent → bridge flow in simulation or with a controlled test double.
- [ ] Bring up physical hardware read-only and compare reported values with the manufacturer's tools.
- [ ] Enable supervised motion using the manufacturer's bring-up procedure and validate the selected controls.
- [ ] Exercise disconnects, stale sensors, stop/recovery, restarts, and competing control requests.
- [ ] Run the agreed end-to-end scenarios and relevant regression checks for existing robot types.
- [ ] Record the tested hardware/firmware/software versions, results, limitations, and unresolved defects.

**Output:** Acceptance evidence from the actual target hardware; simulation results are recorded separately.

## 11. Package, deploy, and hand over

- [ ] Package the driver, sidecar, agent configuration, model assets, and required service/container definitions.
- [ ] Pin dependencies and document installation, calibration, connection setup, startup, logs, updates, and rollback.
- [ ] Verify a clean installation and recovery after reboot on the target host.
- [ ] Document onboarding another unit of the same type, including identity, credentials, connection settings, and per-unit calibration.
- [ ] Hand over operator and troubleshooting instructions, the supported capability matrix, and acceptance results.
- [ ] Agree responsibility for SDK/firmware compatibility, future hardware variants, defect fixes, and ongoing support.

**Output:** A reproducible integration package and manufacturer acceptance of the delivered scope.

## Implementation map

Use existing integrations as structural references; revalidate their assumptions for the new robot. Some existing configs contain placeholders or differ from catalog metadata.

| Area | Main code locations |
|---|---|
| Embodiment config and validation | [`robot-agent/src/embodiment/`](../robot-agent/src/embodiment/) |
| Agent types, footprint, joints, state, telemetry | [`robot-agent/src/robot/`](../robot-agent/src/robot/) |
| Agent startup and environment configuration | [`robot-agent/src/index.ts`](../robot-agent/src/index.ts), [`robot-agent/src/config/config.ts`](../robot-agent/src/config/config.ts), [`robot-agent/package.json`](../robot-agent/package.json) |
| Hardware bridge and client contract | [`robot-agent/hardware/`](../robot-agent/hardware/), [`HardwareClient.ts`](../robot-agent/src/hardware/HardwareClient.ts) |
| Safety integration | [`robot-agent/src/safety/`](../robot-agent/src/safety/), [`vla_safety.py`](../robot-agent/hardware/vla_safety.py) |
| Server catalog and stored embodiments | [`seed-robot-types.ts`](../server/src/scripts/seed-robot-types.ts), [`EmbodimentService.ts`](../server/src/services/EmbodimentService.ts), [`embodiments.routes.ts`](../server/src/routes/embodiments.routes.ts), [`schema.prisma`](../server/prisma/schema.prisma) |
| Frontend types, units, and model rendering | [`robots.types.ts`](../app/src/features/robots/types/robots.types.ts), [`RobotModel.tsx`](../app/src/features/robots/components/visualization/RobotModel.tsx), [`robot assets`](../app/public/assets/robots/) |
| Teleoperation and recording | [`robot-agent/src/teleop/`](../robot-agent/src/teleop/), [`robot-agent/src/recording/`](../robot-agent/src/recording/) |
| Policy action mapping and execution | [`action-contracts.ts`](../robot-agent/src/vla/action-contracts.ts), [`skill-executor.ts`](../robot-agent/src/vla/skill-executor.ts) |

Search for existing type-specific branches as part of implementation; extending the YAML alone does not update every consumer.

Related guides: [Robot Integration](robot-integration-guide.md), [VLA Integration](vla-integration-guide.md), [VR Teleoperation and Data Collection](vr-teleop-data-collection.md), [Deployment](deployment.md).
