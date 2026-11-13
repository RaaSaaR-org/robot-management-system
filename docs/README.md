# NeoDEM documentation

NeoDEM is an open platform for Physical AI. It covers the whole lifecycle of a
robot policy — **Collect → Train → Deploy → Evaluate → Operate → Comply** — so
fleet operation is one of six stages, not the whole product. The platform is the
integrating layer around [LeRobot](https://github.com/huggingface/lerobot):
datasets stay in the open LeRobot format and sync with the Hugging Face Hub in
both directions.

It is hardware-agnostic, and its focus is the cognitive humanoid: the
**Unitree G1**, including the G1 EDU with Dex3-1 hands (43 joints). The SO-101
arm is the embodiment the platform was bootstrapped on and is still supported.

This page is the way into the documentation. For what each part of the platform
does and how far it has actually been taken, read [the platform](platform.md)
first — it is the one page that states which claims are measured on real
hardware, which come from a simulator, and which are built but deliberately
locked.

## The six stages

| Stage | What happens there | In the app | Read |
| ----- | ------------------ | ---------- | ---- |
| Collect | Demonstrations, room scans, generated episodes and imported datasets end up in one open format, each episode with a record of where it came from. | [Recording sessions](/data-collection), [Datasets](/datasets), [Sites](/sites) | [The data engine](platform.md#the-data-engine) |
| Train | A base model is fine-tuned on a dataset version, on whichever GPU machine is pointed at the instance. | [Skill Training](/pipeline), [Training](/training), [Experiments](/experiments) | [Models](platform.md#models) |
| Deploy | A model registry, staged rollouts and rollback. | [Models](/models), [Deployments](/deployments) | [Readiness at a glance](platform.md#readiness-at-a-glance) |
| Evaluate | A model is scored attempt by attempt in simulation. | [Evaluation](/evaluation), [Simulation](/simulation) | [Readiness at a glance](platform.md#readiness-at-a-glance) |
| Operate | The fleet, its sites and zones, alerts, emergency stops, and robots that act on plain language. | [Dashboard](/dashboard), [Fleet](/fleet), [Agent Mode](/agent) | [Safety](platform.md#safety), [Agent Mode](agent-mode.md) |
| Comply | A tamper-evident audit trail, human oversight and approvals, records of processing and data-subject requests. | [Compliance](/compliance), [Approvals](/approvals), [Data privacy](/gdpr) | [Ownership and the record](platform.md#ownership-and-the-record) |

How far each stage is taken — `Live`, `Sim` or `Gated` — is stated in
[Readiness at a glance](platform.md#readiness-at-a-glance), and nowhere else, so
it cannot drift between pages.

## Start here

| If you want to… | Read |
| --------------- | ---- |
| Understand what the platform does and what is proven | [The platform](platform.md) |
| Install it — locally, with Docker, or on Kubernetes | [The platform → Install](platform.md#install), then [Deployment](deployment.md) |
| See how the parts fit together | [Architecture](architecture.md) and [Network architecture](network-architecture.md) |
| Put the three demo robots on an instance | [Demo fleet](demo-fleet.md) |

## Datasets

A dataset is a LeRobot dataset (v2.x or v3.0) with its versions. Whichever way
it arrives, it is validated — format, statistics and video — before it is used,
and curating it creates a new version while the original stays intact.

| Task | Where | Read |
| ---- | ----- | ---- |
| Record demonstrations on a robot | [Recording sessions](/data-collection) | [Two-person data collection](data-collection-two-person.md), [VR teleoperation](vr-teleop-data-collection.md) |
| Import a dataset from Hugging Face | [Datasets](/datasets) | [Demo fleet → Datasets to go with them](demo-fleet.md#datasets-to-go-with-them) |
| Upload a dataset directory from your own machine, with no Hugging Face repository in between | [Datasets](/datasets) | [Uploading a dataset directly](dataset-upload.md) — the complete API contract, resumable, file by file |
| Take a stored dataset back out as its LeRobot directory, byte for byte | `rmsctl datasets download <id>` | [Downloading a dataset's files](dataset-download.md) — file list and raw files with Range |
| Put a trained checkpoint from a local disk into the instance and its model registry, with no Hugging Face repository or URL in between | `rmsctl models upload <dir> --version <v>`, then [Models](/models) | [Uploading a model checkpoint directly](model-upload.md) — the complete API contract, resumable, multi-gigabyte files, and the way back out |
| Browse episodes, watch the camera video and read the joint chart | [Datasets](/datasets) → a dataset → Episodes | [The data engine → The pipeline](platform.md#the-pipeline) |
| Trim takes and drop failures without losing the original | [Datasets](/datasets) | [Curation keeps the original](platform.md#curation-keeps-the-original) |
| Publish a recorded dataset to the Hugging Face Hub | [Datasets](/datasets) | [Publishing to Hugging Face](huggingface-publish.md) |
| Read the ideas, experiments, reports and dataset assessments written about them | [Research](/research) | [Research publications](research-publications.md) |

## Training and models

| Document | What it covers |
| -------- | -------------- |
| [The platform → Models](platform.md#models) | The selectable base models and world action models, each with its status |
| [VLA integration](vla-integration-guide.md) | The inference pipeline: model server, the robot's closed loop, the safety layer |
| [Training pipeline testing](training-pipeline-testing.md) | An end-to-end test of the training worker |
| [Exporting a training run](training-run-export.md) | Running a job on a cluster the server cannot reach |

Training and model serving live in sibling repositories; see
[Sibling repositories](platform.md#sibling-repositories).

## Robots

| Document | What it covers |
| -------- | -------------- |
| [Robot integration](robot-integration-guide.md) | Connecting a robot through a hardware sidecar — the Unitree G1 EDU and the SO-101 |
| [Agent Mode, patrol and host mode](agent-mode.md) | The on-robot local-LLM agent: what it does, how to switch it on, what it refuses |
| [G1 EDU lab bring-up](g1-edu-lab-bringup.md) | The robot supervisor, the rehearsal robot and the staged path to the real G1 (a working log, in German) |
| [Real-G1 apple-to-plate runbook](real-g1-apple-runbook.md) | Closing the loop between a physical G1 and the serving stack |
| [Adding a new embodiment](new-embodiment-integration-plan.md) | Scope, steps, validation and handover for a new robot type |

## Architecture and API

| Document | What it covers |
| -------- | -------------- |
| [Architecture](architecture.md) | Services, data flow, infrastructure |
| [Network architecture](network-architecture.md) | Zones, ports, protocols, authentication per hop |
| [API reference](api.md) | HTTP endpoints |
| [App architecture](app-architecture.md) | Frontend patterns, stores, routes |
| [Process delegation](process-delegation-architecture.md) | How a process step becomes a robot task |
| [Multi-tenancy](multi-tenancy.md) | Serving several organizations from one instance |

## Running an instance

| Document | What it covers |
| -------- | -------------- |
| [Deployment](deployment.md) | Docker Compose, Kubernetes with Helm, and a single-node systemd setup |
| [Operations](operations.md) | Day-to-day operation: robots, secrets, logs, monitoring, backups |
| [Incident runbook](runbook.md) | Diagnosing and resolving common incidents |
| [NATS and RustFS](nats-rustfs.md) | The optional messaging and object-storage layer |
| [Demo day rehearsal](demo-day.md) | The browser demo used as a presentation fallback |
| [Dev workflow](dev-workflow.md) | Code conventions and feature structure |
| [AI operations guide](ai-operations-guide.md) | Service endpoints and checks, written for AI assistants working on the codebase |

## Compliance

| Document | What it covers |
| -------- | -------------- |
| [The platform → A record you can verify](platform.md#a-record-you-can-verify) | The implemented controls, mapped to the requirements they support |
| [Regulatory compliance](regulatory-compliance.md) | The wider EU requirements matrix |

## Design

| Document | What it covers |
| -------- | -------------- |
| [Brand and design contract](brand.md) | Name, logo, voice, colours, typography and the tokens every page follows |
