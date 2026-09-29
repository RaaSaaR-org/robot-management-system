# NeoDEM — Voice and terminology

## Tone

Write with calm confidence. Be technically precise and easy to understand. Start with what the user can do or what the system knows, then add the detail needed to act.

The brand is grounded and professional. Use science-fiction references sparingly in storytelling; keep them out of operational alerts and safety controls.

## Writing rules

- Use sentence case for headings, labels, and buttons.
- Prefer concrete verbs: “Record a demonstration,” “Compare models,” “Stop robot.”
- Name the robot, task, or model when it helps the reader act.
- Explain specialized terms when addressing a nontechnical audience.
- State uncertainty directly and distinguish simulated data from measurements.
- Explain an error's consequence and the available next action.
- Use evidence for claims about compatibility, performance, and readiness.

## Examples

| Context | Example |
|---|---|
| Product introduction | “Connect your data, models and machines in one open platform.” |
| Ready state | “Your robot is ready. Battery at 92%.” |
| Unknown location | “Robot location is unknown.” |
| Simulation | “This run uses simulated robot data.” |
| Connection loss | “Connection lost. Live telemetry is unavailable.” |
| Unconfirmed stop | “Stop requested. Robot acknowledgement is missing.” |
| Integration scope | “Arm control and joint telemetry are supported. Navigation is outside this integration.” |

## Terminology

| Term | Use |
|---|---|
| NeoDEM | Product name; preserve capitalization |
| Physical AI | AI interacting with the physical world through machines |
| Embodiment | A robot's physical configuration and its data/control description |
| Robot type | A supported robot model/configuration in the platform |
| Robot instance | One individual robot with its own identity and calibration |
| Embodied Loop | The Collect → Train → Deploy → Evaluate → Operate → Comply lifecycle |
| Live | Validated against the real hardware or real data relevant to the stated capability |
| Sim | Demonstrated in simulation; physical operation is not established by that result |
| Gated | A path exists but requires explicit enabling before the stated operation |

Apply readiness labels to the specific capability being described. A working camera feed does not establish readiness for autonomous movement.

Reference: [Brand and design contract](../../docs/brand.md).
