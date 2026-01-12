# NATS JetStream + RustFS Implementation Guide

## Complete Deployment for Robot Fleet Management System

---

## Executive Summary

This implementation guide covers the complete deployment of **NATS JetStream** (messaging, job queues, state management) and **RustFS** (S3-compatible distributed object storage) for the EmAI Robot Fleet Management System. The architecture replaces BullMQ/Redis with a unified NATS-based approach while leveraging RustFS's 2.3x performance advantage over MinIO for storing ML models, training datasets, and robot telemetry logs.

> ⚠️ **Important Note on RustFS**: RustFS explicitly states "Do NOT use in production environments!" as it's under rapid development (v1.0.0-alpha). This guide includes production-hardening strategies and fallback patterns. For mission-critical deployments, consider running RustFS alongside a proven backup solution until it reaches stable release.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Infrastructure Requirements](#2-infrastructure-requirements)
3. [NATS JetStream Deployment](#3-nats-jetstream-deployment)
4. [RustFS Deployment](#4-rustfs-deployment)
5. [Node.js Backend Integration](#5-nodejs-backend-integration)
6. [Robot-Agent Edge Deployment](#6-robot-agent-edge-deployment)
7. [Training Management System](#7-training-management-system)
8. [Security Configuration](#8-security-configuration)
9. [Monitoring & Observability](#9-monitoring--observability)
10. [Development Environment](#10-development-environment)
11. [Production Deployment](#11-production-deployment)
12. [Implementation Roadmap](#12-implementation-roadmap)

---

## 1. Architecture Overview

### System Topology

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CENTRAL INFRASTRUCTURE                               │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                     Node.js Express Backend                             │ │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │ │
│  │  │  Training   │ │    Task     │ │   Model     │ │   Fleet     │       │ │
│  │  │  Manager    │ │  Delegator  │ │  Registry   │ │Orchestrator │       │ │
│  │  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘       │ │
│  └─────────┼───────────────┼───────────────┼───────────────┼──────────────┘ │
│            │               │               │               │                 │
│            └───────────────┴───────┬───────┴───────────────┘                 │
│                                    │                                         │
│  ┌─────────────────────────────────▼─────────────────────────────────────┐  │
│  │                    NATS CLUSTER (3 nodes, JetStream)                   │  │
│  │  ┌──────────┐    ┌──────────┐    ┌──────────┐                         │  │
│  │  │  NATS-1  │◄──►│  NATS-2  │◄──►│  NATS-3  │   Replication: R=3     │  │
│  │  │ :4222    │    │ :4222    │    │ :4222    │                         │  │
│  │  │ :7422 LN │    │ :7422 LN │    │ :7422 LN │   Leaf Node Port       │  │
│  │  └──────────┘    └──────────┘    └──────────┘                         │  │
│  │                                                                        │  │
│  │  Streams:                                                              │  │
│  │  • TRAINING_JOBS (WorkQueue) - VLA fine-tuning jobs                   │  │
│  │  • INFERENCE_TASKS (WorkQueue) - Real-time inference requests         │  │
│  │  • ROBOT_TELEMETRY (Limits) - Sensor data, positions                  │  │
│  │  • FLEET_EVENTS (Interest) - Commands, model updates                  │  │
│  │                                                                        │  │
│  │  KV Stores:                                                            │  │
│  │  • ROBOT_STATE - Real-time robot status                               │  │
│  │  • MODEL_REGISTRY - Model versions and metadata                       │  │
│  │  • JOB_PROGRESS - Training job progress tracking                      │  │
│  │                                                                        │  │
│  │  Object Store:                                                         │  │
│  │  • SKILL_DEFINITIONS - Skill templates (<10MB)                        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│  ┌─────────────────────────────────▼─────────────────────────────────────┐  │
│  │                    RUSTFS CLUSTER (4 nodes, Erasure Coded)             │  │
│  │  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐        │  │
│  │  │ RustFS-1 │    │ RustFS-2 │    │ RustFS-3 │    │ RustFS-4 │        │  │
│  │  │ :9000 API│    │ :9000 API│    │ :9000 API│    │ :9000 API│        │  │
│  │  │ :9001 UI │    │ :9001 UI │    │ :9001 UI │    │ :9001 UI │        │  │
│  │  └──────────┘    └──────────┘    └──────────┘    └──────────┘        │  │
│  │                                                                        │  │
│  │  Buckets:                                                              │  │
│  │  • training-datasets/    - LeRobot format demonstration data          │  │
│  │  • model-checkpoints/    - Training checkpoints (epoch snapshots)     │  │
│  │  • production-models/    - Deployed VLA models (ONNX)                 │  │
│  │  • robot-logs/           - Telemetry archives, incident logs          │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
       ┌──────▼──────┐          ┌──────▼──────┐          ┌──────▼──────┐
       │  Robot-001  │          │  Robot-002  │          │  Robot-00N  │
       │ ┌─────────┐ │          │ ┌─────────┐ │          │ ┌─────────┐ │
       │ │NATS Leaf│ │          │ │NATS Leaf│ │          │ │NATS Leaf│ │
       │ │  Node   │ │          │ │  Node   │ │          │ │  Node   │ │
       │ │(offline │ │          │ │(offline │ │          │ │(offline │ │
       │ │capable) │ │          │ │capable) │ │          │ │capable) │ │
       │ └────┬────┘ │          │ └────┬────┘ │          │ └────┬────┘ │
       │      │      │          │      │      │          │      │      │
       │ ┌────▼────┐ │          │ ┌────▼────┐ │          │ ┌────▼────┐ │
       │ │ Robot   │ │          │ │ Robot   │ │          │ │ Robot   │ │
       │ │ Agent   │ │          │ │ Agent   │ │          │ │ Agent   │ │
       │ │(Node.js)│ │          │ │(Node.js)│ │          │ │(Node.js)│ │
       │ └────┬────┘ │          │ └────┬────┘ │          │ └────┬────┘ │
       │      │      │          │      │      │          │      │      │
       │ ┌────▼────┐ │          │ ┌────▼────┐ │          │ ┌────▼────┐ │
       │ │VLA Model│ │          │ │VLA Model│ │          │ │VLA Model│ │
       │ │(ONNX RT)│ │          │ │(ONNX RT)│ │          │ │(ONNX RT)│ │
       │ └─────────┘ │          │ └─────────┘ │          │ └─────────┘ │
       │ Local Cache │          │ Local Cache │          │ Local Cache │
       │ (Models)    │          │ (Models)    │          │ (Models)    │
       └─────────────┘          └─────────────┘          └─────────────┘
```

### Component Responsibilities

| Component           | Technology                 | Responsibility                                  |
| ------------------- | -------------------------- | ----------------------------------------------- |
| **Job Queues**      | NATS JetStream (WorkQueue) | Training jobs, inference tasks, deployment jobs |
| **Pub/Sub**         | NATS JetStream (Interest)  | Fleet commands, model updates, alerts           |
| **Telemetry**       | NATS JetStream (Limits)    | Robot sensor data, position tracking            |
| **State Store**     | NATS KV                    | Robot status, job progress, config              |
| **Small Objects**   | NATS Object Store          | Skill definitions, configs (<10MB)              |
| **Large Objects**   | RustFS                     | Models, datasets, checkpoints, logs             |
| **Edge Resilience** | NATS Leaf Nodes            | Offline operation, local buffering              |

---

## 2. Infrastructure Requirements

### Central Infrastructure

| Resource           | Minimum    | Recommended | Notes                        |
| ------------------ | ---------- | ----------- | ---------------------------- |
| **NATS Nodes**     | 3          | 3-5         | Odd number for consensus     |
| **NATS CPU**       | 2 cores    | 4 cores     | Per node                     |
| **NATS Memory**    | 4 GB       | 8 GB        | Per node                     |
| **NATS Storage**   | 100 GB SSD | 500 GB NVMe | JetStream storage            |
| **RustFS Nodes**   | 4          | 4-8         | Minimum 4 for erasure coding |
| **RustFS CPU**     | 4 cores    | 8 cores     | Per node                     |
| **RustFS Memory**  | 8 GB       | 16 GB       | Per node                     |
| **RustFS Storage** | 500 GB SSD | 2 TB NVMe   | Per node, per drive          |
| **Network**        | 1 Gbps     | 10 Gbps     | Between nodes                |

### Robot Edge Requirements

| Resource      | Minimum      | Recommended |
| ------------- | ------------ | ----------- |
| **NATS Leaf** | ARM64/x86_64 | Any         |
| **CPU**       | 1 core       | 2 cores     |
| **Memory**    | 512 MB       | 1 GB        |
| **Storage**   | 1 GB         | 5 GB        |
| **Network**   | WiFi/4G      | 5G/Ethernet |

---

## 3. NATS JetStream Deployment

### 3.1 NATS Server Configuration

```hcl
# config/nats-server.conf
# NATS Server Configuration for Robot Fleet Management

server_name: nats-1
listen: 0.0.0.0:4222
http: 0.0.0.0:8222

# JetStream Configuration
jetstream {
  store_dir: /data/jetstream
  max_mem: 4G
  max_file: 100G
  domain: robot-fleet

  # Encryption at rest
  cipher: chachapoly
  key: $NATS_JS_ENCRYPTION_KEY
}

# Cluster Configuration (3-node)
cluster {
  name: robot-fleet-cluster
  listen: 0.0.0.0:6222

  routes: [
    nats-route://nats-2.nats.svc.cluster.local:6222
    nats-route://nats-3.nats.svc.cluster.local:6222
  ]

  # Cluster TLS
  tls {
    cert_file: /etc/nats/certs/cluster-cert.pem
    key_file: /etc/nats/certs/cluster-key.pem
    ca_file: /etc/nats/certs/ca.pem
    verify: true
  }
}

# Leaf Node Configuration (for robots)
leafnodes {
  port: 7422

  tls {
    cert_file: /etc/nats/certs/leaf-cert.pem
    key_file: /etc/nats/certs/leaf-key.pem
    ca_file: /etc/nats/certs/ca.pem
    verify: true
  }

  authorization {
    timeout: 5
  }
}

# Client TLS
tls {
  cert_file: /etc/nats/certs/server-cert.pem
  key_file: /etc/nats/certs/server-key.pem
  ca_file: /etc/nats/certs/ca.pem
  verify_and_map: true
}

# Accounts for Multi-tenancy
accounts {
  # System account
  $SYS {
    users: [
      {user: sys_admin, password: $SYS_ADMIN_PASSWORD}
    ]
  }

  # Backend services account
  BACKEND {
    jetstream: enabled

    users: [
      {user: training_service, password: $TRAINING_SVC_PWD}
      {user: task_delegator, password: $TASK_DELEGATOR_PWD}
      {user: model_registry, password: $MODEL_REGISTRY_PWD}
      {user: fleet_orchestrator, password: $FLEET_ORCH_PWD}
    ]

    exports: [
      # Commands to robots
      {stream: "commands.>", accounts: [ROBOTS]}
      # Fleet-wide events
      {stream: "fleet.>", accounts: [ROBOTS]}
      # Model update notifications
      {stream: "models.>", accounts: [ROBOTS]}
    ]

    imports: [
      # Robot telemetry
      {stream: {account: ROBOTS, subject: "telemetry.>"}}
      # Command acknowledgments
      {stream: {account: ROBOTS, subject: "ack.>"}}
      # Robot status updates
      {stream: {account: ROBOTS, subject: "status.>"}}
    ]
  }

  # Robot fleet account
  ROBOTS {
    jetstream: enabled

    # NKey-based authentication for each robot
    users: [
      # Robot keys are generated per-robot
      {nkey: UDXXX_ROBOT_001_PUBLIC_KEY}
      {nkey: UDXXX_ROBOT_002_PUBLIC_KEY}
      {nkey: UDXXX_ROBOT_003_PUBLIC_KEY}
      # ... more robots
    ]

    exports: [
      {stream: "telemetry.>"}
      {stream: "ack.>"}
      {stream: "status.>"}
    ]

    imports: [
      {stream: {account: BACKEND, subject: "commands.>"}}
      {stream: {account: BACKEND, subject: "fleet.>"}}
      {stream: {account: BACKEND, subject: "models.>"}}
    ]

    # Resource limits per robot
    limits {
      max_payload: 8MB
      max_connections: 10
      max_subscriptions: 100
    }
  }
}

# Logging
logging {
  dir: /var/log/nats
  size: 100MB
  time: true
  debug: false
  trace: false
}

# System events
system_account: $SYS
```

### 3.2 Stream Definitions

```typescript
// streams/stream-definitions.ts
import {
    JetStreamManager,
    RetentionPolicy,
    StorageType,
    DiscardPolicy,
    AckPolicy,
    DeliverPolicy,
    ReplayPolicy,
} from "@nats-io/jetstream";

export async function createAllStreams(jsm: JetStreamManager): Promise<void> {
    // ═══════════════════════════════════════════════════════════════════════════
    // TRAINING_JOBS - Work queue for VLA model training
    // ═══════════════════════════════════════════════════════════════════════════
    await jsm.streams.add({
        name: "TRAINING_JOBS",
        description:
            "VLA model training job queue with exactly-once processing",
        subjects: [
            "jobs.training.finetune", // Fine-tuning jobs
            "jobs.training.evaluate", // Model evaluation jobs
            "jobs.training.export", // ONNX export jobs
        ],
        retention: RetentionPolicy.WorkqueuePolicy, // Delete after ACK
        storage: StorageType.File,
        num_replicas: 3,
        max_msgs: 10000,
        max_bytes: 1024 * 1024 * 100, // 100MB
        max_age: 7 * 24 * 60 * 60 * 1e9, // 7 days
        max_msg_size: 1024 * 1024, // 1MB per message
        duplicate_window: 5 * 60 * 1e9, // 5 minute dedup window
        discard: DiscardPolicy.Old,
        deny_delete: false,
        deny_purge: false,
    });

    // Consumer for training workers
    await jsm.consumers.add("TRAINING_JOBS", {
        name: "training-workers",
        durable_name: "training-workers",
        description: "Durable consumer for GPU training workers",
        ack_policy: AckPolicy.Explicit,
        ack_wait: 30 * 60 * 1e9, // 30 minutes for long training jobs
        max_deliver: 3,
        max_ack_pending: 5, // Max 5 concurrent jobs per worker group
        deliver_policy: DeliverPolicy.All,
        replay_policy: ReplayPolicy.Instant,
        filter_subjects: ["jobs.training.>"],
        // Exponential backoff for retries
        backoff: [
            30 * 1e9, // 30 seconds
            5 * 60 * 1e9, // 5 minutes
            30 * 60 * 1e9, // 30 minutes
        ],
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // INFERENCE_TASKS - Real-time VLA inference requests
    // ═══════════════════════════════════════════════════════════════════════════
    await jsm.streams.add({
        name: "INFERENCE_TASKS",
        description: "Real-time VLA inference task queue",
        subjects: [
            "inference.request.*", // inference.request.{robot_id}
        ],
        retention: RetentionPolicy.WorkqueuePolicy,
        storage: StorageType.Memory, // Memory for low latency
        num_replicas: 3,
        max_msgs: 50000,
        max_bytes: 512 * 1024 * 1024, // 512MB
        max_age: 5 * 60 * 1e9, // 5 minutes max age
        max_msg_size: 512 * 1024, // 512KB (includes compressed image)
        duplicate_window: 10 * 1e9, // 10 second dedup
        discard: DiscardPolicy.Old,
    });

    await jsm.consumers.add("INFERENCE_TASKS", {
        name: "inference-workers",
        durable_name: "inference-workers",
        ack_policy: AckPolicy.Explicit,
        ack_wait: 5 * 1e9, // 5 seconds max
        max_deliver: 2,
        max_ack_pending: 100,
        deliver_policy: DeliverPolicy.New,
        replay_policy: ReplayPolicy.Instant,
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // ROBOT_TELEMETRY - Sensor data and position tracking
    // ═══════════════════════════════════════════════════════════════════════════
    await jsm.streams.add({
        name: "ROBOT_TELEMETRY",
        description: "Robot sensor data, positions, and diagnostics",
        subjects: [
            "telemetry.*.position", // telemetry.{robot_id}.position
            "telemetry.*.sensors", // telemetry.{robot_id}.sensors
            "telemetry.*.diagnostics", // telemetry.{robot_id}.diagnostics
            "telemetry.*.camera", // telemetry.{robot_id}.camera (compressed frames)
        ],
        retention: RetentionPolicy.Limits,
        storage: StorageType.File,
        num_replicas: 3,
        max_bytes: 100 * 1024 * 1024 * 1024, // 100GB total
        max_age: 7 * 24 * 60 * 60 * 1e9, // 7 days retention
        max_msgs_per_subject: 100000, // Per robot/type limit
        max_msg_size: 2 * 1024 * 1024, // 2MB for camera frames
        discard: DiscardPolicy.Old,
        // Enable subject-based message limits
        discard_new_per_subject: false,
    });

    // Consumer for telemetry processing (analytics, archival)
    await jsm.consumers.add("ROBOT_TELEMETRY", {
        name: "telemetry-processor",
        durable_name: "telemetry-processor",
        ack_policy: AckPolicy.Explicit,
        ack_wait: 30 * 1e9,
        max_deliver: 3,
        max_ack_pending: 1000,
        deliver_policy: DeliverPolicy.New,
    });

    // Consumer for real-time dashboard
    await jsm.consumers.add("ROBOT_TELEMETRY", {
        name: "dashboard-viewer",
        durable_name: "dashboard-viewer",
        ack_policy: AckPolicy.None, // Fire and forget for dashboards
        deliver_policy: DeliverPolicy.New,
        filter_subjects: ["telemetry.*.position", "telemetry.*.diagnostics"],
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // FLEET_EVENTS - Commands and notifications
    // ═══════════════════════════════════════════════════════════════════════════
    await jsm.streams.add({
        name: "FLEET_EVENTS",
        description: "Fleet-wide commands, model updates, and alerts",
        subjects: [
            "commands.*.*", // commands.{robot_id}.{command_type}
            "commands.broadcast.*", // commands.broadcast.{command_type}
            "models.deployed.*", // models.deployed.{model_name}
            "alerts.*.*", // alerts.{severity}.{type}
            "fleet.status.*", // fleet.status.{event_type}
        ],
        retention: RetentionPolicy.Interest, // Keep while consumers exist
        storage: StorageType.File,
        num_replicas: 3,
        max_msgs: 100000,
        max_bytes: 1024 * 1024 * 1024, // 1GB
        max_age: 24 * 60 * 60 * 1e9, // 24 hours
        max_msg_size: 10 * 1024 * 1024, // 10MB for model metadata
    });

    // Consumer for command acknowledgment tracking
    await jsm.consumers.add("FLEET_EVENTS", {
        name: "command-tracker",
        durable_name: "command-tracker",
        ack_policy: AckPolicy.Explicit,
        ack_wait: 60 * 1e9,
        filter_subjects: ["commands.>"],
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // DEAD_LETTER_QUEUE - Failed job handling
    // ═══════════════════════════════════════════════════════════════════════════
    await jsm.streams.add({
        name: "DEAD_LETTER_QUEUE",
        description: "Failed jobs and terminated messages",
        subjects: [
            "$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES.>",
            "$JS.EVENT.ADVISORY.CONSUMER.MSG_TERMINATED.>",
        ],
        retention: RetentionPolicy.Limits,
        storage: StorageType.File,
        num_replicas: 3,
        max_age: 30 * 24 * 60 * 60 * 1e9, // 30 days
    });

    console.log("All streams created successfully");
}
```

### 3.3 KV Store Definitions

```typescript
// stores/kv-stores.ts
import { Kvm, KvOptions } from "@nats-io/kv";
import { NatsConnection } from "@nats-io/transport-node";

export async function createKVStores(nc: NatsConnection): Promise<void> {
    const kvm = new Kvm(nc);

    // ═══════════════════════════════════════════════════════════════════════════
    // ROBOT_STATE - Real-time robot status
    // ═══════════════════════════════════════════════════════════════════════════
    await kvm.create("ROBOT_STATE", {
        description: "Real-time robot status and position",
        history: 10, // Keep 10 revisions for debugging
        ttl: 60 * 60 * 1000, // 1 hour TTL (robots must heartbeat)
        max_bytes: 100 * 1024 * 1024, // 100MB
        replicas: 3,
        storage: "file",
        // Compression for efficient storage
        compression: true,
    } as KvOptions);

    // ═══════════════════════════════════════════════════════════════════════════
    // MODEL_REGISTRY - Model versions and deployment status
    // ═══════════════════════════════════════════════════════════════════════════
    await kvm.create("MODEL_REGISTRY", {
        description: "VLA model versions, metadata, and deployment status",
        history: 50, // Keep version history
        max_bytes: 50 * 1024 * 1024, // 50MB
        replicas: 3,
        storage: "file",
    } as KvOptions);

    // ═══════════════════════════════════════════════════════════════════════════
    // JOB_PROGRESS - Training job progress tracking
    // ═══════════════════════════════════════════════════════════════════════════
    await kvm.create("JOB_PROGRESS", {
        description: "Training and deployment job progress",
        history: 5,
        ttl: 7 * 24 * 60 * 60 * 1000, // 7 day TTL
        max_bytes: 100 * 1024 * 1024, // 100MB
        replicas: 3,
        storage: "file",
    } as KvOptions);

    // ═══════════════════════════════════════════════════════════════════════════
    // FLEET_CONFIG - Fleet-wide configuration
    // ═══════════════════════════════════════════════════════════════════════════
    await kvm.create("FLEET_CONFIG", {
        description: "Fleet-wide configuration and feature flags",
        history: 100, // Full audit trail
        max_bytes: 10 * 1024 * 1024, // 10MB
        replicas: 3,
        storage: "file",
    } as KvOptions);

    console.log("All KV stores created successfully");
}
```

---

## 4. RustFS Deployment

### 4.1 RustFS Architecture

RustFS uses a **metadata-free distributed architecture** with erasure coding:

```
RustFS Cluster (4 nodes minimum)
├── Node 1: http://rustfs-1:9000/data/disk1, /data/disk2
├── Node 2: http://rustfs-2:9000/data/disk1, /data/disk2
├── Node 3: http://rustfs-3:9000/data/disk1, /data/disk2
└── Node 4: http://rustfs-4:9000/data/disk1, /data/disk2

Erasure Coding: EC:4 (4 data + 4 parity shards)
├── Can survive loss of up to 4 drives/nodes
├── Storage efficiency: 50% (2x raw capacity needed)
└── No metadata server (deterministic hashing)
```

### 4.2 Docker Compose Deployment

```yaml
# docker-compose.rustfs.yml
version: "3.9"

x-rustfs-common: &rustfs-common
    image: rustfs/rustfs:latest
    restart: unless-stopped
    environment:
        RUSTFS_ACCESS_KEY: ${RUSTFS_ACCESS_KEY:-emaifleetadmin}
        RUSTFS_SECRET_KEY: ${RUSTFS_SECRET_KEY:-supersecretkey123}
        RUSTFS_BROWSER: "on"
        RUSTFS_PROMETHEUS_AUTH_TYPE: "public"
    healthcheck:
        test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
        interval: 30s
        timeout: 20s
        retries: 3
    networks:
        - rustfs-network

services:
    # ═══════════════════════════════════════════════════════════════════════════
    # RustFS Distributed Cluster (4 nodes)
    # ═══════════════════════════════════════════════════════════════════════════
    rustfs-1:
        <<: *rustfs-common
        hostname: rustfs-1
        container_name: rustfs-1
        command: server http://rustfs-{1...4}:9000/data --console-address ":9001"
        ports:
            - "9000:9000"
            - "9001:9001"
        volumes:
            - rustfs-1-data:/data
            - ./logs/rustfs-1:/logs
        labels:
            - "traefik.enable=true"
            - "traefik.http.routers.rustfs-api.rule=Host(`storage.robotfleet.local`)"
            - "traefik.http.services.rustfs-api.loadbalancer.server.port=9000"

    rustfs-2:
        <<: *rustfs-common
        hostname: rustfs-2
        container_name: rustfs-2
        command: server http://rustfs-{1...4}:9000/data --console-address ":9001"
        ports:
            - "9002:9000"
            - "9003:9001"
        volumes:
            - rustfs-2-data:/data
            - ./logs/rustfs-2:/logs

    rustfs-3:
        <<: *rustfs-common
        hostname: rustfs-3
        container_name: rustfs-3
        command: server http://rustfs-{1...4}:9000/data --console-address ":9001"
        ports:
            - "9004:9000"
            - "9005:9001"
        volumes:
            - rustfs-3-data:/data
            - ./logs/rustfs-3:/logs

    rustfs-4:
        <<: *rustfs-common
        hostname: rustfs-4
        container_name: rustfs-4
        command: server http://rustfs-{1...4}:9000/data --console-address ":9001"
        ports:
            - "9006:9000"
            - "9007:9001"
        volumes:
            - rustfs-4-data:/data
            - ./logs/rustfs-4:/logs

    # ═══════════════════════════════════════════════════════════════════════════
    # Bucket Initialization
    # ═══════════════════════════════════════════════════════════════════════════
    rustfs-init:
        image: rustfs/rustfs:latest
        container_name: rustfs-init
        depends_on:
            rustfs-1:
                condition: service_healthy
            rustfs-2:
                condition: service_healthy
            rustfs-3:
                condition: service_healthy
            rustfs-4:
                condition: service_healthy
        entrypoint: /bin/sh
        command: |
            -c "
            sleep 10

            # Configure mc client
            mc alias set rustfs http://rustfs-1:9000 ${RUSTFS_ACCESS_KEY:-emaifleetadmin} ${RUSTFS_SECRET_KEY:-supersecretkey123}

            # Create buckets
            mc mb rustfs/training-datasets --ignore-existing
            mc mb rustfs/model-checkpoints --ignore-existing
            mc mb rustfs/production-models --ignore-existing
            mc mb rustfs/robot-logs --ignore-existing
            mc mb rustfs/telemetry-archives --ignore-existing

            # Set lifecycle rules
            mc ilm rule add rustfs/model-checkpoints --expire-days 90 --prefix 'temp/'
            mc ilm rule add rustfs/robot-logs --expire-days 30 --prefix 'debug/'
            mc ilm rule add rustfs/telemetry-archives --expire-days 365

            # Set bucket versioning for models
            mc version enable rustfs/production-models

            # Set bucket policies
            mc anonymous set download rustfs/production-models

            echo 'RustFS buckets initialized successfully'
            "
        networks:
            - rustfs-network

    # ═══════════════════════════════════════════════════════════════════════════
    # Load Balancer for RustFS
    # ═══════════════════════════════════════════════════════════════════════════
    rustfs-lb:
        image: nginx:alpine
        container_name: rustfs-lb
        ports:
            - "9090:80"
        volumes:
            - ./config/nginx-rustfs.conf:/etc/nginx/nginx.conf:ro
        depends_on:
            - rustfs-1
            - rustfs-2
            - rustfs-3
            - rustfs-4
        networks:
            - rustfs-network

volumes:
    rustfs-1-data:
        driver: local
    rustfs-2-data:
        driver: local
    rustfs-3-data:
        driver: local
    rustfs-4-data:
        driver: local

networks:
    rustfs-network:
        driver: bridge
```

### 4.3 Nginx Load Balancer Configuration

```nginx
# config/nginx-rustfs.conf
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 4096;
    use epoll;
    multi_accept on;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for" '
                    'rt=$request_time uct="$upstream_connect_time" '
                    'uht="$upstream_header_time" urt="$upstream_response_time"';

    access_log /var/log/nginx/access.log main;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;

    # RustFS upstream with health checks
    upstream rustfs_cluster {
        least_conn;

        server rustfs-1:9000 weight=1 max_fails=3 fail_timeout=30s;
        server rustfs-2:9000 weight=1 max_fails=3 fail_timeout=30s;
        server rustfs-3:9000 weight=1 max_fails=3 fail_timeout=30s;
        server rustfs-4:9000 weight=1 max_fails=3 fail_timeout=30s;

        keepalive 32;
    }

    # Large file upload settings
    client_max_body_size 5G;
    client_body_buffer_size 128k;
    proxy_connect_timeout 300;
    proxy_send_timeout 300;
    proxy_read_timeout 300;
    send_timeout 300;

    server {
        listen 80;
        server_name storage.robotfleet.local;

        # Health check endpoint
        location /health {
            access_log off;
            return 200 "healthy\n";
            add_header Content-Type text/plain;
        }

        # S3 API proxy
        location / {
            proxy_pass http://rustfs_cluster;
            proxy_http_version 1.1;

            proxy_set_header Host $http_host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            # Required for S3 signature
            proxy_set_header Authorization $http_authorization;

            # Chunked transfer encoding for large files
            proxy_set_header Connection "";
            chunked_transfer_encoding off;

            # Buffering settings
            proxy_buffering off;
            proxy_request_buffering off;
        }
    }
}
```

### 4.4 Kubernetes Deployment

```yaml
# kubernetes/rustfs/rustfs-statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
    name: rustfs
    namespace: robot-fleet
    labels:
        app: rustfs
spec:
    serviceName: rustfs
    replicas: 4
    podManagementPolicy: Parallel
    selector:
        matchLabels:
            app: rustfs
    template:
        metadata:
            labels:
                app: rustfs
            annotations:
                prometheus.io/scrape: "true"
                prometheus.io/port: "9000"
                prometheus.io/path: "/minio/v2/metrics/cluster"
        spec:
            affinity:
                podAntiAffinity:
                    requiredDuringSchedulingIgnoredDuringExecution:
                        - labelSelector:
                              matchExpressions:
                                  - key: app
                                    operator: In
                                    values:
                                        - rustfs
                          topologyKey: kubernetes.io/hostname
            containers:
                - name: rustfs
                  image: rustfs/rustfs:latest
                  args:
                      - server
                      - http://rustfs-{0...3}.rustfs.robot-fleet.svc.cluster.local:9000/data
                      - --console-address
                      - ":9001"
                  ports:
                      - containerPort: 9000
                        name: api
                      - containerPort: 9001
                        name: console
                  env:
                      - name: RUSTFS_ACCESS_KEY
                        valueFrom:
                            secretKeyRef:
                                name: rustfs-credentials
                                key: access-key
                      - name: RUSTFS_SECRET_KEY
                        valueFrom:
                            secretKeyRef:
                                name: rustfs-credentials
                                key: secret-key
                      - name: RUSTFS_PROMETHEUS_AUTH_TYPE
                        value: "public"
                  volumeMounts:
                      - name: data
                        mountPath: /data
                  resources:
                      requests:
                          cpu: "2"
                          memory: "4Gi"
                      limits:
                          cpu: "4"
                          memory: "8Gi"
                  livenessProbe:
                      httpGet:
                          path: /minio/health/live
                          port: 9000
                      initialDelaySeconds: 30
                      periodSeconds: 30
                      timeoutSeconds: 10
                  readinessProbe:
                      httpGet:
                          path: /minio/health/ready
                          port: 9000
                      initialDelaySeconds: 30
                      periodSeconds: 15
                      timeoutSeconds: 10
    volumeClaimTemplates:
        - metadata:
              name: data
          spec:
              accessModes: ["ReadWriteOnce"]
              storageClassName: fast-ssd
              resources:
                  requests:
                      storage: 500Gi
---
apiVersion: v1
kind: Service
metadata:
    name: rustfs
    namespace: robot-fleet
spec:
    ports:
        - port: 9000
          name: api
        - port: 9001
          name: console
    clusterIP: None
    selector:
        app: rustfs
---
apiVersion: v1
kind: Service
metadata:
    name: rustfs-external
    namespace: robot-fleet
spec:
    type: LoadBalancer
    ports:
        - port: 9000
          name: api
          targetPort: 9000
        - port: 9001
          name: console
          targetPort: 9001
    selector:
        app: rustfs
```

---

## 5. Node.js Backend Integration

### 5.1 Project Structure

```
backend/
├── src/
│   ├── config/
│   │   ├── nats.config.ts
│   │   └── rustfs.config.ts
│   ├── messaging/
│   │   ├── nats-client.ts
│   │   ├── job-queue.ts
│   │   ├── streams.ts
│   │   └── kv-stores.ts
│   ├── storage/
│   │   ├── rustfs-client.ts
│   │   ├── model-storage.ts
│   │   └── dataset-storage.ts
│   ├── services/
│   │   ├── training-service.ts
│   │   ├── inference-service.ts
│   │   ├── fleet-orchestrator.ts
│   │   └── model-registry.ts
│   ├── routes/
│   │   ├── training.routes.ts
│   │   ├── models.routes.ts
│   │   └── fleet.routes.ts
│   └── index.ts
├── package.json
└── tsconfig.json
```

### 5.2 NATS Client Implementation

```typescript
// src/messaging/nats-client.ts
import {
    connect,
    NatsConnection,
    JSONCodec,
    StringCodec,
} from "@nats-io/transport-node";
import {
    jetstream,
    jetstreamManager,
    JetStreamClient,
    JetStreamManager,
} from "@nats-io/jetstream";
import { Kvm, Kv } from "@nats-io/kv";
import { Objm, ObjectStore } from "@nats-io/obj";
import { EventEmitter } from "events";

export interface NatsConfig {
    servers: string[];
    user?: string;
    pass?: string;
    token?: string;
    tls?: {
        caFile?: string;
        certFile?: string;
        keyFile?: string;
    };
    reconnect?: boolean;
    maxReconnectAttempts?: number;
    reconnectTimeWait?: number;
}

export class NatsClient extends EventEmitter {
    private nc!: NatsConnection;
    private js!: JetStreamClient;
    private jsm!: JetStreamManager;
    private kvStores: Map<string, Kv> = new Map();
    private objStores: Map<string, ObjectStore> = new Map();

    private config: NatsConfig;
    private isConnected = false;

    constructor(config: NatsConfig) {
        super();
        this.config = config;
    }

    async connect(): Promise<void> {
        try {
            this.nc = await connect({
                servers: this.config.servers,
                user: this.config.user,
                pass: this.config.pass,
                token: this.config.token,
                tls: this.config.tls
                    ? {
                          caFile: this.config.tls.caFile,
                          certFile: this.config.tls.certFile,
                          keyFile: this.config.tls.keyFile,
                      }
                    : undefined,
                reconnect: this.config.reconnect ?? true,
                maxReconnectAttempts: this.config.maxReconnectAttempts ?? -1,
                reconnectTimeWait: this.config.reconnectTimeWait ?? 2000,
                pingInterval: 30000,
                maxPingOut: 5,
            });

            this.js = jetstream(this.nc);
            this.jsm = await jetstreamManager(this.nc);
            this.isConnected = true;

            // Monitor connection status
            this.monitorConnection();

            console.log(`Connected to NATS: ${this.config.servers.join(", ")}`);
            this.emit("connected");
        } catch (error) {
            console.error("Failed to connect to NATS:", error);
            this.emit("error", error);
            throw error;
        }
    }

    private async monitorConnection(): Promise<void> {
        (async () => {
            for await (const status of this.nc.status()) {
                switch (status.type) {
                    case "disconnect":
                        this.isConnected = false;
                        console.warn("NATS disconnected");
                        this.emit("disconnected");
                        break;
                    case "reconnect":
                        this.isConnected = true;
                        console.log("NATS reconnected");
                        this.emit("reconnected");
                        break;
                    case "error":
                        console.error("NATS error:", status.data);
                        this.emit("error", status.data);
                        break;
                    case "update":
                        console.log("NATS cluster update:", status.data);
                        break;
                }
            }
        })();
    }

    // Getters
    get connection(): NatsConnection {
        return this.nc;
    }
    get jetstream(): JetStreamClient {
        return this.js;
    }
    get jetstreamManager(): JetStreamManager {
        return this.jsm;
    }
    get connected(): boolean {
        return this.isConnected;
    }

    // KV Store access
    async getKV(name: string): Promise<Kv> {
        if (this.kvStores.has(name)) {
            return this.kvStores.get(name)!;
        }
        const kvm = new Kvm(this.nc);
        const kv = await kvm.open(name);
        this.kvStores.set(name, kv);
        return kv;
    }

    // Object Store access
    async getObjectStore(name: string): Promise<ObjectStore> {
        if (this.objStores.has(name)) {
            return this.objStores.get(name)!;
        }
        const objm = new Objm(this.nc);
        const store = await objm.open(name);
        this.objStores.set(name, store);
        return store;
    }

    // Publish helpers
    async publish(subject: string, data: unknown): Promise<void> {
        const jc = JSONCodec();
        await this.nc.publish(subject, jc.encode(data));
    }

    async jetPublish(
        subject: string,
        data: unknown,
        options?: {
            msgID?: string;
            expect?: { streamName?: string; lastMsgID?: string };
        },
    ): Promise<void> {
        const jc = JSONCodec();
        await this.js.publish(subject, jc.encode(data), {
            msgID: options?.msgID,
            expect: options?.expect,
        });
    }

    // Request/Reply
    async request<T>(
        subject: string,
        data: unknown,
        timeoutMs = 5000,
    ): Promise<T> {
        const jc = JSONCodec();
        const response = await this.nc.request(subject, jc.encode(data), {
            timeout: timeoutMs,
        });
        return jc.decode(response.data) as T;
    }

    // Graceful shutdown
    async close(): Promise<void> {
        if (this.nc) {
            await this.nc.drain();
            this.isConnected = false;
            console.log("NATS connection closed");
        }
    }
}

// Singleton instance
let natsClient: NatsClient | null = null;

export function getNatsClient(): NatsClient {
    if (!natsClient) {
        throw new Error(
            "NATS client not initialized. Call initNatsClient first.",
        );
    }
    return natsClient;
}

export async function initNatsClient(config: NatsConfig): Promise<NatsClient> {
    if (natsClient) {
        return natsClient;
    }
    natsClient = new NatsClient(config);
    await natsClient.connect();
    return natsClient;
}
```

### 5.3 Job Queue Implementation

```typescript
// src/messaging/job-queue.ts
import { JSONCodec, JsMsg } from "@nats-io/transport-node";
import {
    AckPolicy,
    Consumer,
    JetStreamClient,
    PullConsumer,
} from "@nats-io/jetstream";
import { Kv } from "@nats-io/kv";
import { getNatsClient } from "./nats-client";
import { randomUUID } from "crypto";

// ═══════════════════════════════════════════════════════════════════════════
// Type Definitions
// ═══════════════════════════════════════════════════════════════════════════

export interface JobPayload<T = unknown> {
    id: string;
    type: string;
    data: T;
    priority: "critical" | "high" | "normal" | "low";
    scheduledAt?: number;
    createdAt: number;
    attempts: number;
    metadata?: Record<string, string>;
}

export interface JobProgress {
    jobId: string;
    status: "pending" | "running" | "completed" | "failed" | "cancelled";
    progress: number;
    message?: string;
    startedAt?: number;
    completedAt?: number;
    error?: string;
    result?: unknown;
}

export interface JobOptions {
    priority?: "critical" | "high" | "normal" | "low";
    delay?: number;
    deduplicationId?: string;
    metadata?: Record<string, string>;
}

export type JobProcessor<T> = (
    job: JobPayload<T>,
    context: JobContext,
) => Promise<unknown>;

export interface JobContext {
    updateProgress: (progress: number, message?: string) => Promise<void>;
    heartbeat: () => void;
    isCancelled: () => boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// JetStream Job Queue
// ═══════════════════════════════════════════════════════════════════════════

export class JetStreamJobQueue<T = unknown> {
    private js: JetStreamClient;
    private progressKv!: Kv;
    private streamName: string;
    private consumerName: string;
    private running = false;
    private activeJobs = new Map<string, { cancel: () => void }>();
    private processor?: JobProcessor<T>;

    constructor(streamName: string, consumerName: string) {
        this.streamName = streamName;
        this.consumerName = consumerName;
        this.js = getNatsClient().jetstream;
    }

    async initialize(): Promise<void> {
        this.progressKv = await getNatsClient().getKV("JOB_PROGRESS");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Job Publishing
    // ─────────────────────────────────────────────────────────────────────────

    async addJob(type: string, data: T, options?: JobOptions): Promise<string> {
        const jc = JSONCodec<JobPayload<T>>();
        const jobId = options?.deduplicationId || randomUUID();
        const priority = options?.priority || "normal";

        const job: JobPayload<T> = {
            id: jobId,
            type,
            data,
            priority,
            scheduledAt: options?.delay
                ? Date.now() + options.delay
                : undefined,
            createdAt: Date.now(),
            attempts: 0,
            metadata: options?.metadata,
        };

        // Subject hierarchy: jobs.{stream}.{priority}.{type}
        const subject = `jobs.${this.streamName.toLowerCase()}.${priority}.${type}`;

        await this.js.publish(subject, jc.encode(job), {
            msgID: jobId, // Deduplication
            expect: { streamName: this.streamName },
        });

        // Initialize progress tracking
        await this.progressKv.put(
            `job.${jobId}`,
            JSON.stringify({
                jobId,
                status: "pending",
                progress: 0,
                createdAt: Date.now(),
            } as JobProgress),
        );

        console.log(`Job ${jobId} added to ${this.streamName}`);
        return jobId;
    }

    async addBulkJobs(
        jobs: Array<{ type: string; data: T; options?: JobOptions }>,
    ): Promise<string[]> {
        const jobIds: string[] = [];
        for (const job of jobs) {
            const id = await this.addJob(job.type, job.data, job.options);
            jobIds.push(id);
        }
        return jobIds;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Job Processing
    // ─────────────────────────────────────────────────────────────────────────

    async process(processor: JobProcessor<T>, concurrency = 1): Promise<void> {
        this.processor = processor;
        this.running = true;

        const consumer = await this.js.consumers.get(
            this.streamName,
            this.consumerName,
        );

        console.log(
            `Starting job processor for ${this.streamName} (concurrency: ${concurrency})`,
        );

        while (this.running) {
            // Respect concurrency limit
            if (this.activeJobs.size >= concurrency) {
                await new Promise((r) => setTimeout(r, 100));
                continue;
            }

            try {
                const msgs = await consumer.fetch({
                    max_messages: concurrency - this.activeJobs.size,
                    expires: 5000,
                });

                for await (const msg of msgs) {
                    this.handleMessage(msg, processor);
                }
            } catch (error) {
                if (this.running) {
                    console.error("Error fetching messages:", error);
                    await new Promise((r) => setTimeout(r, 1000));
                }
            }
        }
    }

    private async handleMessage(
        msg: JsMsg,
        processor: JobProcessor<T>,
    ): Promise<void> {
        const jc = JSONCodec<JobPayload<T>>();
        let job: JobPayload<T>;

        try {
            job = jc.decode(msg.data);
        } catch (error) {
            console.error("Failed to decode job:", error);
            msg.term();
            return;
        }

        job.attempts = msg.info.redeliveryCount + 1;

        // Check if delayed job is ready
        if (job.scheduledAt && job.scheduledAt > Date.now()) {
            const delay = Math.min(job.scheduledAt - Date.now(), 30000);
            msg.nak(delay);
            return;
        }

        // Setup cancellation
        let cancelled = false;
        const cancelFn = () => {
            cancelled = true;
        };
        this.activeJobs.set(job.id, { cancel: cancelFn });

        // Update progress to running
        await this.updateJobProgress(job.id, {
            status: "running",
            startedAt: Date.now(),
        });

        // Heartbeat for long-running jobs
        const heartbeatInterval = setInterval(() => {
            if (!cancelled) msg.working();
        }, 10000);

        // Create job context
        const context: JobContext = {
            updateProgress: async (progress: number, message?: string) => {
                await this.updateJobProgress(job.id, { progress, message });
            },
            heartbeat: () => msg.working(),
            isCancelled: () => cancelled,
        };

        try {
            const result = await processor(job, context);

            await this.updateJobProgress(job.id, {
                status: "completed",
                progress: 100,
                completedAt: Date.now(),
                result,
            });

            msg.ack();
            console.log(`Job ${job.id} completed successfully`);
        } catch (error) {
            const errorMsg =
                error instanceof Error ? error.message : "Unknown error";
            console.error(`Job ${job.id} failed:`, errorMsg);

            if (cancelled) {
                await this.updateJobProgress(job.id, { status: "cancelled" });
                msg.term();
            } else if (msg.info.redeliveryCount < 2) {
                // Exponential backoff: 30s, 5min, 30min
                const delays = [30000, 300000, 1800000];
                msg.nak(delays[msg.info.redeliveryCount] || 30000);
            } else {
                await this.updateJobProgress(job.id, {
                    status: "failed",
                    error: errorMsg,
                    completedAt: Date.now(),
                });
                msg.term(); // Send to DLQ
            }
        } finally {
            clearInterval(heartbeatInterval);
            this.activeJobs.delete(job.id);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Job Management
    // ─────────────────────────────────────────────────────────────────────────

    async getJobProgress(jobId: string): Promise<JobProgress | null> {
        try {
            const entry = await this.progressKv.get(`job.${jobId}`);
            if (entry?.value) {
                return JSON.parse(new TextDecoder().decode(entry.value));
            }
        } catch {
            // Key not found
        }
        return null;
    }

    async cancelJob(jobId: string): Promise<boolean> {
        const activeJob = this.activeJobs.get(jobId);
        if (activeJob) {
            activeJob.cancel();
            return true;
        }
        return false;
    }

    async watchJobProgress(
        jobId: string,
        callback: (progress: JobProgress) => void,
    ): Promise<() => void> {
        const watcher = await this.progressKv.watch({ key: `job.${jobId}` });

        (async () => {
            for await (const entry of watcher) {
                if (entry.value) {
                    callback(JSON.parse(new TextDecoder().decode(entry.value)));
                }
            }
        })();

        return () => watcher.stop();
    }

    private async updateJobProgress(
        jobId: string,
        update: Partial<JobProgress>,
    ): Promise<void> {
        try {
            const entry = await this.progressKv.get(`job.${jobId}`);
            if (entry?.value) {
                const current = JSON.parse(
                    new TextDecoder().decode(entry.value),
                );
                await this.progressKv.put(
                    `job.${jobId}`,
                    JSON.stringify({
                        ...current,
                        ...update,
                    }),
                );
            }
        } catch (error) {
            console.error(`Failed to update progress for job ${jobId}:`, error);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────────────────

    async stop(timeoutMs = 30000): Promise<void> {
        this.running = false;

        // Wait for active jobs to complete
        const deadline = Date.now() + timeoutMs;
        while (this.activeJobs.size > 0 && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 100));
        }

        // Cancel remaining jobs
        for (const [jobId, job] of this.activeJobs) {
            console.warn(`Force cancelling job ${jobId}`);
            job.cancel();
        }

        console.log(`Job queue ${this.streamName} stopped`);
    }
}
```

### 5.4 RustFS Client Implementation

```typescript
// src/storage/rustfs-client.ts
import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
    HeadObjectCommand,
    CopyObjectCommand,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable } from "stream";

export interface RustFSConfig {
    endpoint: string;
    accessKey: string;
    secretKey: string;
    region?: string;
    forcePathStyle?: boolean;
}

export interface UploadOptions {
    contentType?: string;
    metadata?: Record<string, string>;
    tags?: Record<string, string>;
    onProgress?: (progress: number) => void;
}

export interface ListOptions {
    prefix?: string;
    maxKeys?: number;
    continuationToken?: string;
    delimiter?: string;
}

export interface ListResult {
    objects: Array<{
        key: string;
        size: number;
        lastModified: Date;
        etag: string;
    }>;
    prefixes: string[];
    isTruncated: boolean;
    nextContinuationToken?: string;
}

export class RustFSClient {
    private client: S3Client;
    private config: RustFSConfig;

    constructor(config: RustFSConfig) {
        this.config = config;
        this.client = new S3Client({
            endpoint: config.endpoint,
            region: config.region || "us-east-1",
            forcePathStyle: config.forcePathStyle ?? true,
            credentials: {
                accessKeyId: config.accessKey,
                secretAccessKey: config.secretKey,
            },
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Basic Operations
    // ─────────────────────────────────────────────────────────────────────────

    async upload(
        bucket: string,
        key: string,
        body: Buffer | Readable | string,
        options?: UploadOptions,
    ): Promise<string> {
        const upload = new Upload({
            client: this.client,
            params: {
                Bucket: bucket,
                Key: key,
                Body: body,
                ContentType: options?.contentType,
                Metadata: options?.metadata,
                Tagging: options?.tags
                    ? Object.entries(options.tags)
                          .map(([k, v]) => `${k}=${v}`)
                          .join("&")
                    : undefined,
            },
            queueSize: 4,
            partSize: 10 * 1024 * 1024, // 10MB parts
            leavePartsOnError: false,
        });

        if (options?.onProgress) {
            upload.on("httpUploadProgress", (progress) => {
                if (progress.loaded && progress.total) {
                    options.onProgress!(
                        Math.round((progress.loaded / progress.total) * 100),
                    );
                }
            });
        }

        await upload.done();
        return `s3://${bucket}/${key}`;
    }

    async download(bucket: string, key: string): Promise<Buffer> {
        const response = await this.client.send(
            new GetObjectCommand({
                Bucket: bucket,
                Key: key,
            }),
        );

        const chunks: Buffer[] = [];
        const stream = response.Body as Readable;

        for await (const chunk of stream) {
            chunks.push(Buffer.from(chunk));
        }

        return Buffer.concat(chunks);
    }

    async getStream(bucket: string, key: string): Promise<Readable> {
        const response = await this.client.send(
            new GetObjectCommand({
                Bucket: bucket,
                Key: key,
            }),
        );
        return response.Body as Readable;
    }

    async delete(bucket: string, key: string): Promise<void> {
        await this.client.send(
            new DeleteObjectCommand({
                Bucket: bucket,
                Key: key,
            }),
        );
    }

    async exists(bucket: string, key: string): Promise<boolean> {
        try {
            await this.client.send(
                new HeadObjectCommand({
                    Bucket: bucket,
                    Key: key,
                }),
            );
            return true;
        } catch {
            return false;
        }
    }

    async getMetadata(
        bucket: string,
        key: string,
    ): Promise<{
        size: number;
        contentType: string;
        lastModified: Date;
        metadata: Record<string, string>;
    } | null> {
        try {
            const response = await this.client.send(
                new HeadObjectCommand({
                    Bucket: bucket,
                    Key: key,
                }),
            );
            return {
                size: response.ContentLength || 0,
                contentType: response.ContentType || "application/octet-stream",
                lastModified: response.LastModified || new Date(),
                metadata: response.Metadata || {},
            };
        } catch {
            return null;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Listing
    // ─────────────────────────────────────────────────────────────────────────

    async list(bucket: string, options?: ListOptions): Promise<ListResult> {
        const response = await this.client.send(
            new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: options?.prefix,
                MaxKeys: options?.maxKeys || 1000,
                ContinuationToken: options?.continuationToken,
                Delimiter: options?.delimiter,
            }),
        );

        return {
            objects: (response.Contents || []).map((obj) => ({
                key: obj.Key || "",
                size: obj.Size || 0,
                lastModified: obj.LastModified || new Date(),
                etag: obj.ETag || "",
            })),
            prefixes: (response.CommonPrefixes || []).map(
                (p) => p.Prefix || "",
            ),
            isTruncated: response.IsTruncated || false,
            nextContinuationToken: response.NextContinuationToken,
        };
    }

    async *listAll(
        bucket: string,
        prefix?: string,
    ): AsyncGenerator<{
        key: string;
        size: number;
        lastModified: Date;
    }> {
        let continuationToken: string | undefined;

        do {
            const result = await this.list(bucket, {
                prefix,
                continuationToken,
            });
            for (const obj of result.objects) {
                yield obj;
            }
            continuationToken = result.nextContinuationToken;
        } while (continuationToken);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Presigned URLs
    // ─────────────────────────────────────────────────────────────────────────

    async getPresignedDownloadUrl(
        bucket: string,
        key: string,
        expiresIn = 3600,
    ): Promise<string> {
        const command = new GetObjectCommand({ Bucket: bucket, Key: key });
        return getSignedUrl(this.client, command, { expiresIn });
    }

    async getPresignedUploadUrl(
        bucket: string,
        key: string,
        expiresIn = 3600,
        contentType?: string,
    ): Promise<string> {
        const command = new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            ContentType: contentType,
        });
        return getSignedUrl(this.client, command, { expiresIn });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Copy & Move
    // ─────────────────────────────────────────────────────────────────────────

    async copy(
        sourceBucket: string,
        sourceKey: string,
        destBucket: string,
        destKey: string,
    ): Promise<void> {
        await this.client.send(
            new CopyObjectCommand({
                Bucket: destBucket,
                Key: destKey,
                CopySource: `${sourceBucket}/${sourceKey}`,
            }),
        );
    }

    async move(
        sourceBucket: string,
        sourceKey: string,
        destBucket: string,
        destKey: string,
    ): Promise<void> {
        await this.copy(sourceBucket, sourceKey, destBucket, destKey);
        await this.delete(sourceBucket, sourceKey);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Model Storage Client
// ═══════════════════════════════════════════════════════════════════════════

export class ModelStorageClient {
    private client: RustFSClient;

    private readonly buckets = {
        datasets: "training-datasets",
        checkpoints: "model-checkpoints",
        models: "production-models",
        logs: "robot-logs",
    };

    constructor(config: RustFSConfig) {
        this.client = new RustFSClient(config);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Training Datasets
    // ─────────────────────────────────────────────────────────────────────────

    async uploadDataset(
        datasetName: string,
        version: string,
        data: Buffer,
        metadata: Record<string, string>,
    ): Promise<string> {
        const key = `${datasetName}/${version}/data.tar.gz`;
        return this.client.upload(this.buckets.datasets, key, data, {
            contentType: "application/gzip",
            metadata: {
                ...metadata,
                datasetName,
                version,
                uploadedAt: new Date().toISOString(),
            },
        });
    }

    async getDatasetStream(
        datasetName: string,
        version: string,
    ): Promise<Readable> {
        const key = `${datasetName}/${version}/data.tar.gz`;
        return this.client.getStream(this.buckets.datasets, key);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Model Checkpoints
    // ─────────────────────────────────────────────────────────────────────────

    async uploadCheckpoint(
        modelName: string,
        jobId: string,
        epoch: number,
        checkpoint: Buffer,
        metrics: Record<string, number>,
    ): Promise<string> {
        const key = `${modelName}/${jobId}/epoch-${epoch.toString().padStart(5, "0")}.pt`;
        return this.client.upload(this.buckets.checkpoints, key, checkpoint, {
            contentType: "application/octet-stream",
            metadata: {
                modelName,
                jobId,
                epoch: String(epoch),
                ...Object.fromEntries(
                    Object.entries(metrics).map(([k, v]) => [k, String(v)]),
                ),
            },
        });
    }

    async listCheckpoints(
        modelName: string,
        jobId: string,
    ): Promise<
        Array<{
            epoch: number;
            key: string;
            size: number;
        }>
    > {
        const result = await this.client.list(this.buckets.checkpoints, {
            prefix: `${modelName}/${jobId}/`,
        });

        return result.objects
            .filter((obj) => obj.key.endsWith(".pt"))
            .map((obj) => ({
                epoch: parseInt(obj.key.match(/epoch-(\d+)/)?.[1] || "0"),
                key: obj.key,
                size: obj.size,
            }))
            .sort((a, b) => a.epoch - b.epoch);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Production Models
    // ─────────────────────────────────────────────────────────────────────────

    async uploadProductionModel(
        modelName: string,
        version: string,
        model: Buffer,
        metadata: {
            trainingJobId: string;
            metrics: Record<string, number>;
            embodiments: string[];
        },
    ): Promise<string> {
        const key = `${modelName}/v${version}/model.onnx`;
        return this.client.upload(this.buckets.models, key, model, {
            contentType: "application/octet-stream",
            metadata: {
                modelName,
                version,
                trainingJobId: metadata.trainingJobId,
                metrics: JSON.stringify(metadata.metrics),
                embodiments: metadata.embodiments.join(","),
                deployedAt: new Date().toISOString(),
            },
        });
    }

    async getModelDownloadUrl(
        modelName: string,
        version: string,
        expiresIn = 3600,
    ): Promise<string> {
        const key = `${modelName}/v${version}/model.onnx`;
        return this.client.getPresignedDownloadUrl(
            this.buckets.models,
            key,
            expiresIn,
        );
    }

    async listModelVersions(modelName: string): Promise<
        Array<{
            version: string;
            size: number;
            deployedAt: Date;
        }>
    > {
        const result = await this.client.list(this.buckets.models, {
            prefix: `${modelName}/`,
            delimiter: "/",
        });

        return result.prefixes.map((prefix) => {
            const version = prefix.match(/v([\d.]+)/)?.[1] || "unknown";
            return {
                version,
                size: 0, // Would need additional HEAD request
                deployedAt: new Date(),
            };
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Robot Logs
    // ─────────────────────────────────────────────────────────────────────────

    async uploadRobotLog(
        robotId: string,
        logType: string,
        data: Buffer,
        timestamp: Date = new Date(),
    ): Promise<string> {
        const dateStr = timestamp.toISOString().split("T")[0];
        const timeStr = timestamp.toISOString().replace(/[:.]/g, "-");
        const key = `${robotId}/${dateStr}/${logType}-${timeStr}.log.gz`;

        return this.client.upload(this.buckets.logs, key, data, {
            contentType: "application/gzip",
            metadata: {
                robotId,
                logType,
                timestamp: timestamp.toISOString(),
            },
        });
    }
}

// Singleton
let modelStorage: ModelStorageClient | null = null;

export function getModelStorage(): ModelStorageClient {
    if (!modelStorage) {
        throw new Error("Model storage not initialized");
    }
    return modelStorage;
}

export function initModelStorage(config: RustFSConfig): ModelStorageClient {
    if (!modelStorage) {
        modelStorage = new ModelStorageClient(config);
    }
    return modelStorage;
}
```

---

## 6. Robot-Agent Edge Deployment

### 6.1 NATS Leaf Node Configuration

```hcl
# config/robot-leaf.conf
# NATS Leaf Node Configuration for Robot Edge

server_name: ${ROBOT_ID}
listen: 127.0.0.1:4222

# Local JetStream for offline operation
jetstream {
  store_dir: /data/jetstream
  domain: ${ROBOT_ID}
  max_mem: 256MB
  max_file: 2GB
}

# Connect to central hub
leafnodes {
  remotes [
    {
      urls: [
        "nats-leaf://nats-1.robotfleet.io:7422",
        "nats-leaf://nats-2.robotfleet.io:7422",
        "nats-leaf://nats-3.robotfleet.io:7422"
      ]

      # Robot credentials
      credentials: "/etc/nats/${ROBOT_ID}.creds"

      # TLS
      tls {
        ca_file: "/etc/nats/ca.pem"
      }

      # Subject filtering - only sync relevant subjects
      deny_imports: [
        "admin.>",
        "internal.>",
        "telemetry.*.camera"  # Don't pull other robots' camera feeds
      ]

      deny_exports: [
        "local.>",
        "debug.>"
      ]
    }
  ]

  # Reconnection settings
  reconnect: 5s
}

# Local services can connect without auth
authorization {
  users: [
    {user: "robot-agent", password: "${LOCAL_AGENT_PASSWORD}"}
  ]
}

# Logging
logging {
  dir: /var/log/nats
  size: 50MB
  time: true
}
```

### 6.2 Robot Agent Implementation

```typescript
// robot-agent/src/agent.ts
import {
    connect,
    NatsConnection,
    JSONCodec,
    StringCodec,
} from "@nats-io/transport-node";
import { jetstream, JetStreamClient } from "@nats-io/jetstream";
import { Kv, Kvm } from "@nats-io/kv";
import { EventEmitter } from "events";

// ═══════════════════════════════════════════════════════════════════════════
// Type Definitions
// ═══════════════════════════════════════════════════════════════════════════

interface RobotCommand {
    commandId: string;
    type:
        | "execute_skill"
        | "update_model"
        | "emergency_stop"
        | "calibrate"
        | "configure";
    payload: unknown;
    timestamp: number;
    priority: "critical" | "high" | "normal";
}

interface TelemetryData {
    robotId: string;
    timestamp: number;
    position: { x: number; y: number; z: number };
    orientation: { roll: number; pitch: number; yaw: number };
    velocity: { linear: number; angular: number };
    battery: number;
    temperature: number;
    jointStates: number[];
    status: "idle" | "executing" | "charging" | "error";
    currentSkill?: string;
}

interface ModelUpdatePayload {
    modelName: string;
    version: string;
    downloadUrl: string;
    checksum: string;
    metadata: Record<string, string>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Robot Agent
// ═══════════════════════════════════════════════════════════════════════════

export class RobotAgent extends EventEmitter {
    private nc!: NatsConnection;
    private js!: JetStreamClient;
    private localKv!: Kv;
    private robotId: string;
    private isConnectedToHub = false;
    private telemetryInterval?: NodeJS.Timeout;
    private currentModel: string = "default";

    constructor(robotId: string) {
        super();
        this.robotId = robotId;
    }

    async start(natsUrl: string = "nats://127.0.0.1:4222"): Promise<void> {
        // Connect to local NATS leaf node
        this.nc = await connect({
            servers: [natsUrl],
            user: "robot-agent",
            pass: process.env.LOCAL_AGENT_PASSWORD,
            reconnect: true,
            maxReconnectAttempts: -1,
            reconnectTimeWait: 1000,
            pingInterval: 10000,
        });

        this.js = jetstream(this.nc, { domain: this.robotId });

        // Initialize local storage
        await this.initializeLocalStorage();

        // Monitor hub connection
        this.monitorConnection();

        // Start command listener
        await this.startCommandListener();

        // Start telemetry publisher
        this.startTelemetryPublisher();

        // Watch for model updates
        await this.watchModelUpdates();

        console.log(`Robot ${this.robotId} agent started`);
        this.emit("started");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Initialization
    // ─────────────────────────────────────────────────────────────────────────

    private async initializeLocalStorage(): Promise<void> {
        const jsm = await this.js.jetstreamManager();
        const kvm = new Kvm(this.nc);

        // Local outbound telemetry buffer (survives disconnection)
        try {
            await jsm.streams.add({
                name: "LOCAL_TELEMETRY",
                subjects: [`telemetry.${this.robotId}.>`],
                storage: "file",
                max_bytes: 500 * 1024 * 1024, // 500MB buffer
                max_age: 24 * 60 * 60 * 1e9, // 24 hours
                discard: "old",
            });
        } catch {
            // Stream may already exist
        }

        // Local command queue (mirrored from hub)
        try {
            await jsm.streams.add({
                name: "LOCAL_COMMANDS",
                subjects: [`commands.${this.robotId}.>`],
                storage: "file",
                max_msgs: 1000,
            });
        } catch {
            // Stream may already exist
        }

        // Local state store
        this.localKv = await kvm.create("LOCAL_STATE", {
            history: 5,
            storage: "file",
        });

        // Load current model info
        try {
            const modelEntry = await this.localKv.get("current_model");
            if (modelEntry?.value) {
                this.currentModel = new TextDecoder().decode(modelEntry.value);
            }
        } catch {
            // First run, no saved state
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Connection Monitoring
    // ─────────────────────────────────────────────────────────────────────────

    private monitorConnection(): void {
        (async () => {
            for await (const status of this.nc.status()) {
                switch (status.type) {
                    case "reconnect":
                        console.log("Reconnected to hub - syncing state");
                        this.isConnectedToHub = true;
                        this.emit("connected");
                        await this.syncWithHub();
                        break;

                    case "disconnect":
                        console.log(
                            "Disconnected from hub - operating offline",
                        );
                        this.isConnectedToHub = false;
                        this.emit("disconnected");
                        break;

                    case "error":
                        console.error("NATS error:", status.data);
                        this.emit("error", status.data);
                        break;
                }
            }
        })();
    }

    private async syncWithHub(): Promise<void> {
        // Publish any buffered telemetry
        try {
            const consumer = await this.js.consumers.get(
                "LOCAL_TELEMETRY",
                "sync-consumer",
            );
            const msgs = await consumer.fetch({
                max_messages: 100,
                expires: 5000,
            });

            for await (const msg of msgs) {
                // Republish to hub (subject already includes robot ID)
                await this.nc.publish(msg.subject, msg.data);
                msg.ack();
            }

            console.log("Telemetry sync completed");
        } catch (error) {
            console.error("Telemetry sync failed:", error);
        }

        // Report current status
        await this.reportStatus();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Command Processing
    // ─────────────────────────────────────────────────────────────────────────

    private async startCommandListener(): Promise<void> {
        // Subscribe to direct commands
        const sub = this.nc.subscribe(`commands.${this.robotId}.>`);

        (async () => {
            const jc = JSONCodec<RobotCommand>();

            for await (const msg of sub) {
                try {
                    const command = jc.decode(msg.data);
                    console.log(
                        `Received command: ${command.type} (${command.commandId})`,
                    );

                    await this.executeCommand(command);

                    // Send acknowledgment
                    await this.nc.publish(
                        `ack.${this.robotId}.${command.commandId}`,
                        JSON.stringify({
                            commandId: command.commandId,
                            status: "completed",
                            timestamp: Date.now(),
                        }),
                    );
                } catch (error) {
                    console.error("Command execution failed:", error);

                    if (msg.reply) {
                        await this.nc.publish(
                            msg.reply,
                            JSON.stringify({
                                error:
                                    error instanceof Error
                                        ? error.message
                                        : "Unknown error",
                            }),
                        );
                    }
                }
            }
        })();

        // Also subscribe to broadcast commands
        const broadcastSub = this.nc.subscribe("commands.broadcast.>");
        (async () => {
            const jc = JSONCodec<RobotCommand>();
            for await (const msg of broadcastSub) {
                try {
                    const command = jc.decode(msg.data);
                    await this.executeCommand(command);
                } catch (error) {
                    console.error("Broadcast command failed:", error);
                }
            }
        })();
    }

    private async executeCommand(command: RobotCommand): Promise<void> {
        switch (command.type) {
            case "execute_skill":
                await this.executeSkill(
                    command.payload as { skillId: string; params: unknown },
                );
                break;

            case "update_model":
                await this.updateModel(command.payload as ModelUpdatePayload);
                break;

            case "emergency_stop":
                await this.emergencyStop();
                break;

            case "calibrate":
                await this.calibrate(command.payload as { type: string });
                break;

            case "configure":
                await this.configure(
                    command.payload as Record<string, unknown>,
                );
                break;

            default:
                console.warn(`Unknown command type: ${command.type}`);
        }
    }

    private async executeSkill(payload: {
        skillId: string;
        params: unknown;
    }): Promise<void> {
        console.log(`Executing skill: ${payload.skillId}`);
        this.emit("skill:start", payload);

        // TODO: Integrate with VLA model inference
        // This would call your ONNX runtime or send to inference service

        this.emit("skill:complete", payload);
    }

    private async updateModel(payload: ModelUpdatePayload): Promise<void> {
        console.log(
            `Updating model to ${payload.modelName} v${payload.version}`,
        );
        this.emit("model:updating", payload);

        try {
            // Download model from presigned URL
            const response = await fetch(payload.downloadUrl);
            if (!response.ok) {
                throw new Error(`Download failed: ${response.statusText}`);
            }

            const modelBuffer = await response.arrayBuffer();

            // Verify checksum
            const crypto = await import("crypto");
            const hash = crypto
                .createHash("sha256")
                .update(Buffer.from(modelBuffer))
                .digest("hex");

            if (hash !== payload.checksum) {
                throw new Error("Model checksum mismatch");
            }

            // Save model locally
            const fs = await import("fs/promises");
            const modelPath = `/data/models/${payload.modelName}-v${payload.version}.onnx`;
            await fs.writeFile(modelPath, Buffer.from(modelBuffer));

            // Update current model reference
            this.currentModel = `${payload.modelName}-v${payload.version}`;
            await this.localKv.put("current_model", this.currentModel);

            console.log(`Model updated successfully: ${this.currentModel}`);
            this.emit("model:updated", payload);
        } catch (error) {
            console.error("Model update failed:", error);
            this.emit("model:error", { payload, error });
            throw error;
        }
    }

    private async emergencyStop(): Promise<void> {
        console.log("!!! EMERGENCY STOP ACTIVATED !!!");
        this.emit("emergency_stop");

        // Immediately halt all motion
        // TODO: Send stop commands to motor controllers

        // Report status
        await this.nc.publish(
            `status.${this.robotId}.emergency`,
            JSON.stringify({
                robotId: this.robotId,
                timestamp: Date.now(),
                type: "emergency_stop",
            }),
        );
    }

    private async calibrate(payload: { type: string }): Promise<void> {
        console.log(`Running calibration: ${payload.type}`);
        this.emit("calibration:start", payload);
        // TODO: Implement calibration routines
        this.emit("calibration:complete", payload);
    }

    private async configure(config: Record<string, unknown>): Promise<void> {
        console.log("Applying configuration:", config);
        // Store configuration locally
        await this.localKv.put("config", JSON.stringify(config));
        this.emit("configured", config);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Telemetry Publishing
    // ─────────────────────────────────────────────────────────────────────────

    private startTelemetryPublisher(): void {
        // Publish telemetry at 10Hz
        this.telemetryInterval = setInterval(async () => {
            await this.publishTelemetry();
        }, 100);
    }

    private async publishTelemetry(): Promise<void> {
        const telemetry: TelemetryData = {
            robotId: this.robotId,
            timestamp: Date.now(),
            position: this.getCurrentPosition(),
            orientation: this.getCurrentOrientation(),
            velocity: this.getCurrentVelocity(),
            battery: this.getBatteryLevel(),
            temperature: this.getTemperature(),
            jointStates: this.getJointStates(),
            status: this.getCurrentStatus(),
            currentSkill: this.getCurrentSkill(),
        };

        // Publish to local JetStream (will be synced to hub when connected)
        await this.js.publish(
            `telemetry.${this.robotId}.full`,
            JSON.stringify(telemetry),
        );
    }

    private async reportStatus(): Promise<void> {
        const status = {
            robotId: this.robotId,
            timestamp: Date.now(),
            status: this.getCurrentStatus(),
            battery: this.getBatteryLevel(),
            currentModel: this.currentModel,
            connected: this.isConnectedToHub,
        };

        await this.nc.publish(
            `status.${this.robotId}.report`,
            JSON.stringify(status),
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Model Update Watching
    // ─────────────────────────────────────────────────────────────────────────

    private async watchModelUpdates(): Promise<void> {
        // Subscribe to model deployment notifications
        const sub = this.nc.subscribe("models.deployed.>");

        (async () => {
            const jc = JSONCodec<ModelUpdatePayload>();

            for await (const msg of sub) {
                try {
                    const update = jc.decode(msg.data);

                    // Check if this update is relevant to this robot
                    if (this.shouldUpdateModel(update)) {
                        console.log(
                            `New model available: ${update.modelName} v${update.version}`,
                        );

                        // Schedule model update
                        await this.updateModel(update);
                    }
                } catch (error) {
                    console.error("Failed to process model update:", error);
                }
            }
        })();
    }

    private shouldUpdateModel(update: ModelUpdatePayload): boolean {
        // Check if robot's embodiment is supported
        const embodiments = update.metadata.embodiments?.split(",") || [];
        const robotEmbodiment = process.env.ROBOT_EMBODIMENT || "default";

        return (
            embodiments.includes(robotEmbodiment) || embodiments.includes("*")
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Sensor/State Getters (To be implemented with actual hardware)
    // ─────────────────────────────────────────────────────────────────────────

    private getCurrentPosition(): { x: number; y: number; z: number } {
        // TODO: Get from localization system
        return { x: 0, y: 0, z: 0 };
    }

    private getCurrentOrientation(): {
        roll: number;
        pitch: number;
        yaw: number;
    } {
        // TODO: Get from IMU
        return { roll: 0, pitch: 0, yaw: 0 };
    }

    private getCurrentVelocity(): { linear: number; angular: number } {
        // TODO: Get from odometry
        return { linear: 0, angular: 0 };
    }

    private getBatteryLevel(): number {
        // TODO: Get from BMS
        return 85;
    }

    private getTemperature(): number {
        // TODO: Get from thermal sensors
        return 35;
    }

    private getJointStates(): number[] {
        // TODO: Get from motor encoders
        return [0, 0, 0, 0, 0, 0, 0];
    }

    private getCurrentStatus(): "idle" | "executing" | "charging" | "error" {
        return "idle";
    }

    private getCurrentSkill(): string | undefined {
        return undefined;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────────────────

    async stop(): Promise<void> {
        if (this.telemetryInterval) {
            clearInterval(this.telemetryInterval);
        }

        await this.nc.drain();
        console.log(`Robot ${this.robotId} agent stopped`);
        this.emit("stopped");
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Entry Point
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
    const robotId = process.env.ROBOT_ID;
    if (!robotId) {
        console.error("ROBOT_ID environment variable is required");
        process.exit(1);
    }

    const agent = new RobotAgent(robotId);

    // Handle shutdown gracefully
    process.on("SIGINT", async () => {
        console.log("Shutting down...");
        await agent.stop();
        process.exit(0);
    });

    process.on("SIGTERM", async () => {
        console.log("Shutting down...");
        await agent.stop();
        process.exit(0);
    });

    try {
        await agent.start();
    } catch (error) {
        console.error("Failed to start agent:", error);
        process.exit(1);
    }
}

main();
```

---

## 7. Training Management System

### 7.1 Training Service

```typescript
// src/services/training-service.ts
import {
    JetStreamJobQueue,
    JobPayload,
    JobContext,
} from "../messaging/job-queue";
import { ModelStorageClient, getModelStorage } from "../storage/rustfs-client";
import { getNatsClient } from "../messaging/nats-client";
import { Kv } from "@nats-io/kv";

interface TrainingJobData {
    modelName: string;
    baseModel: string;
    datasetId: string;
    hyperparameters: {
        learningRate: number;
        batchSize: number;
        epochs: number;
        loraRank?: number;
    };
    targetEmbodiments: string[];
    targetRobots?: string[]; // Specific robots or "all"
}

interface TrainingResult {
    modelPath: string;
    version: string;
    metrics: {
        finalLoss: number;
        validationAccuracy: number;
        trainingTime: number;
    };
}

export class TrainingManagementService {
    private jobQueue: JetStreamJobQueue<TrainingJobData>;
    private storage: ModelStorageClient;
    private modelRegistry!: Kv;
    private nc = getNatsClient();

    constructor() {
        this.jobQueue = new JetStreamJobQueue(
            "TRAINING_JOBS",
            "training-workers",
        );
        this.storage = getModelStorage();
    }

    async initialize(): Promise<void> {
        await this.jobQueue.initialize();
        this.modelRegistry = await this.nc.getKV("MODEL_REGISTRY");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Job Submission
    // ─────────────────────────────────────────────────────────────────────────

    async submitTrainingJob(config: TrainingJobData): Promise<string> {
        // Validate dataset exists
        const datasetExists = await this.validateDataset(config.datasetId);
        if (!datasetExists) {
            throw new Error(`Dataset ${config.datasetId} not found`);
        }

        // Submit job
        const jobId = await this.jobQueue.addJob("finetune", config, {
            priority: "high",
            metadata: {
                modelName: config.modelName,
                baseModel: config.baseModel,
            },
        });

        // Notify fleet that training is starting
        await this.nc.publish("fleet.status.training_started", {
            jobId,
            modelName: config.modelName,
            targetEmbodiments: config.targetEmbodiments,
            timestamp: Date.now(),
        });

        return jobId;
    }

    private async validateDataset(datasetId: string): Promise<boolean> {
        // Check if dataset exists in RustFS
        const [name, version] = datasetId.split(":");
        try {
            await this.storage.getDatasetStream(name, version);
            return true;
        } catch {
            return false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Job Processing
    // ─────────────────────────────────────────────────────────────────────────

    async startWorker(): Promise<void> {
        await this.jobQueue.process(async (job, context) => {
            return this.processTrainingJob(job, context);
        }, 2); // 2 concurrent jobs
    }

    private async processTrainingJob(
        job: JobPayload<TrainingJobData>,
        context: JobContext,
    ): Promise<TrainingResult> {
        const {
            modelName,
            baseModel,
            datasetId,
            hyperparameters,
            targetEmbodiments,
            targetRobots,
        } = job.data;

        console.log(`Starting training job ${job.id}: ${modelName}`);

        // 1. Download dataset
        await context.updateProgress(5, "Downloading dataset");
        const [datasetName, datasetVersion] = datasetId.split(":");
        const datasetStream = await this.storage.getDatasetStream(
            datasetName,
            datasetVersion,
        );

        // 2. Initialize training
        await context.updateProgress(10, "Initializing training");

        // Here you would:
        // - Load the base model
        // - Prepare the dataset
        // - Configure the optimizer

        // 3. Training loop
        const totalEpochs = hyperparameters.epochs;
        let finalLoss = 0;

        for (let epoch = 1; epoch <= totalEpochs; epoch++) {
            if (context.isCancelled()) {
                throw new Error("Training cancelled");
            }

            // Simulate training epoch
            // In reality, this would call your VLA training framework
            await new Promise((r) => setTimeout(r, 1000));
            finalLoss = Math.random() * 0.1; // Simulated loss

            // Update progress
            const progress = 10 + Math.floor((epoch / totalEpochs) * 80);
            await context.updateProgress(
                progress,
                `Epoch ${epoch}/${totalEpochs}, Loss: ${finalLoss.toFixed(4)}`,
            );

            // Save checkpoint every 10 epochs
            if (epoch % 10 === 0) {
                context.heartbeat();

                const checkpointBuffer = Buffer.from(`checkpoint-${epoch}`); // Simulated
                await this.storage.uploadCheckpoint(
                    modelName,
                    job.id,
                    epoch,
                    checkpointBuffer,
                    {
                        loss: finalLoss,
                        learningRate: hyperparameters.learningRate,
                    },
                );
            }
        }

        // 4. Export final model
        await context.updateProgress(92, "Exporting model to ONNX");
        const modelBuffer = Buffer.from("trained-model-onnx"); // Simulated
        const version = Date.now().toString();

        await this.storage.uploadProductionModel(
            modelName,
            version,
            modelBuffer,
            {
                trainingJobId: job.id,
                metrics: { loss: finalLoss, accuracy: 0.95 },
                embodiments: targetEmbodiments,
            },
        );

        // 5. Register model version
        await context.updateProgress(95, "Registering model");
        await this.registerModelVersion(modelName, version, {
            jobId: job.id,
            metrics: { finalLoss, validationAccuracy: 0.95 },
            embodiments: targetEmbodiments,
        });

        // 6. Deploy to fleet
        await context.updateProgress(98, "Deploying to fleet");
        await this.deployToFleet(
            modelName,
            version,
            targetRobots || targetEmbodiments,
        );

        await context.updateProgress(100, "Training complete");

        return {
            modelPath: `${modelName}/v${version}/model.onnx`,
            version,
            metrics: {
                finalLoss,
                validationAccuracy: 0.95,
                trainingTime: Date.now() - job.createdAt,
            },
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Model Registry
    // ─────────────────────────────────────────────────────────────────────────

    private async registerModelVersion(
        modelName: string,
        version: string,
        metadata: {
            jobId: string;
            metrics: Record<string, number>;
            embodiments: string[];
        },
    ): Promise<void> {
        const entry = {
            modelName,
            version,
            ...metadata,
            status: "ready",
            createdAt: Date.now(),
        };

        // Store version info
        await this.modelRegistry.put(
            `model.${modelName}.${version}`,
            JSON.stringify(entry),
        );

        // Update latest pointer
        await this.modelRegistry.put(`model.${modelName}.latest`, version);
    }

    async getLatestModelVersion(modelName: string): Promise<string | null> {
        try {
            const entry = await this.modelRegistry.get(
                `model.${modelName}.latest`,
            );
            return entry?.value ? new TextDecoder().decode(entry.value) : null;
        } catch {
            return null;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fleet Deployment
    // ─────────────────────────────────────────────────────────────────────────

    private async deployToFleet(
        modelName: string,
        version: string,
        targets: string[],
    ): Promise<void> {
        // Get presigned download URL
        const downloadUrl = await this.storage.getModelDownloadUrl(
            modelName,
            version,
            24 * 3600,
        );

        // Calculate checksum (in production, store this during upload)
        const checksum = "placeholder-checksum";

        // Broadcast model update to fleet
        await this.nc.jetPublish("models.deployed." + modelName, {
            modelName,
            version,
            downloadUrl,
            checksum,
            metadata: {
                embodiments: targets.join(","),
                deployedAt: new Date().toISOString(),
            },
        });

        console.log(`Model ${modelName} v${version} deployed to fleet`);
    }

    async canaryDeploy(
        modelName: string,
        version: string,
        canaryRobots: string[],
        successThreshold: number = 0.95,
        monitorDurationMs: number = 3600000,
    ): Promise<boolean> {
        console.log(`Starting canary deployment: ${modelName} v${version}`);
        console.log(`Canary robots: ${canaryRobots.join(", ")}`);

        // Deploy to canary robots only
        const downloadUrl = await this.storage.getModelDownloadUrl(
            modelName,
            version,
            24 * 3600,
        );

        for (const robotId of canaryRobots) {
            await this.nc.publish(`commands.${robotId}.update_model`, {
                commandId: `canary-${Date.now()}`,
                type: "update_model",
                payload: {
                    modelName,
                    version,
                    downloadUrl,
                    checksum: "placeholder",
                    metadata: { canary: "true" },
                },
                timestamp: Date.now(),
                priority: "high",
            });
        }

        // Monitor canary robots
        console.log(
            `Monitoring canary deployment for ${monitorDurationMs / 1000}s...`,
        );

        // In production, you would:
        // - Watch robot telemetry for errors
        // - Check task success rates
        // - Monitor performance metrics

        await new Promise((r) =>
            setTimeout(r, Math.min(monitorDurationMs, 10000)),
        );

        // For now, assume success
        const success = true;

        if (success) {
            console.log("Canary deployment successful!");
            return true;
        } else {
            console.log("Canary deployment failed - rolling back");
            // Rollback canary robots to previous version
            return false;
        }
    }
}
```

---

## 8. Security Configuration

### 8.1 NKey Generation Script

```bash
#!/bin/bash
# scripts/generate-robot-nkeys.sh
# Generate NKey credentials for a new robot

set -e

ROBOT_ID=$1
OUTPUT_DIR=${2:-/etc/nats/keys}

if [ -z "$ROBOT_ID" ]; then
    echo "Usage: $0 <robot_id> [output_dir]"
    exit 1
fi

mkdir -p "$OUTPUT_DIR"

# Generate NKey pair
echo "Generating NKey for $ROBOT_ID..."
nk -gen user > "${OUTPUT_DIR}/${ROBOT_ID}.seed"
nk -inkey "${OUTPUT_DIR}/${ROBOT_ID}.seed" -pubout > "${OUTPUT_DIR}/${ROBOT_ID}.pub"

PUBLIC_KEY=$(cat "${OUTPUT_DIR}/${ROBOT_ID}.pub")

# Generate credentials file
cat > "${OUTPUT_DIR}/${ROBOT_ID}.creds" << EOF
-----BEGIN NATS USER JWT-----
$(nsc generate creds --account ROBOTS --name ${ROBOT_ID} 2>/dev/null || echo "JWT_PLACEHOLDER")
-----END NATS USER JWT-----

------BEGIN USER NKEY SEED------
$(cat "${OUTPUT_DIR}/${ROBOT_ID}.seed")
------END USER NKEY SEED------
EOF

chmod 600 "${OUTPUT_DIR}/${ROBOT_ID}.seed"
chmod 600 "${OUTPUT_DIR}/${ROBOT_ID}.creds"

echo ""
echo "=== Robot Credentials Generated ==="
echo "Robot ID:    $ROBOT_ID"
echo "Public Key:  $PUBLIC_KEY"
echo "Credentials: ${OUTPUT_DIR}/${ROBOT_ID}.creds"
echo ""
echo "Add this public key to nats-server.conf under ROBOTS account:"
echo "  {nkey: $PUBLIC_KEY}"
```

### 8.2 TLS Certificate Generation

```bash
#!/bin/bash
# scripts/generate-certs.sh
# Generate TLS certificates for NATS cluster

set -e

CERT_DIR=${1:-/etc/nats/certs}
DOMAIN=${2:-robotfleet.local}

mkdir -p "$CERT_DIR"
cd "$CERT_DIR"

# Generate CA
echo "Generating CA..."
openssl genrsa -out ca-key.pem 4096
openssl req -new -x509 -days 3650 -key ca-key.pem -out ca.pem \
    -subj "/CN=RobotFleet CA/O=EmAI/C=DE"

# Generate server certificate
echo "Generating server certificate..."
openssl genrsa -out server-key.pem 2048

cat > server.cnf << EOF
[req]
req_extensions = v3_req
distinguished_name = req_distinguished_name

[req_distinguished_name]

[v3_req]
subjectAltName = @alt_names
extendedKeyUsage = serverAuth

[alt_names]
DNS.1 = nats-1.${DOMAIN}
DNS.2 = nats-2.${DOMAIN}
DNS.3 = nats-3.${DOMAIN}
DNS.4 = *.nats.svc.cluster.local
DNS.5 = localhost
IP.1 = 127.0.0.1
EOF

openssl req -new -key server-key.pem -out server.csr \
    -subj "/CN=nats-server/O=EmAI/C=DE" \
    -config server.cnf

openssl x509 -req -days 365 -in server.csr -CA ca.pem -CAkey ca-key.pem \
    -CAcreateserial -out server-cert.pem -extensions v3_req -extfile server.cnf

# Generate cluster certificate
echo "Generating cluster certificate..."
openssl genrsa -out cluster-key.pem 2048
openssl req -new -key cluster-key.pem -out cluster.csr \
    -subj "/CN=nats-cluster/O=EmAI/C=DE"
openssl x509 -req -days 365 -in cluster.csr -CA ca.pem -CAkey ca-key.pem \
    -CAcreateserial -out cluster-cert.pem

# Generate leaf node certificate
echo "Generating leaf node certificate..."
openssl genrsa -out leaf-key.pem 2048
openssl req -new -key leaf-key.pem -out leaf.csr \
    -subj "/CN=nats-leaf/O=EmAI/C=DE"
openssl x509 -req -days 365 -in leaf.csr -CA ca.pem -CAkey ca-key.pem \
    -CAcreateserial -out leaf-cert.pem

# Cleanup
rm -f *.csr *.cnf *.srl

echo ""
echo "=== Certificates Generated ==="
ls -la "$CERT_DIR"
```

---

## 9. Monitoring & Observability

### 9.1 Prometheus Configuration

```yaml
# config/prometheus.yml
global:
    scrape_interval: 15s
    evaluation_interval: 15s

alerting:
    alertmanagers:
        - static_configs:
              - targets: ["alertmanager:9093"]

rule_files:
    - "/etc/prometheus/rules/*.yml"

scrape_configs:
    # NATS metrics
    - job_name: "nats"
      static_configs:
          - targets: ["nats-1:8222", "nats-2:8222", "nats-3:8222"]
      metrics_path: "/varz"

    - job_name: "nats-jetstream"
      static_configs:
          - targets: ["nats-1:8222", "nats-2:8222", "nats-3:8222"]
      metrics_path: "/jsz"

    # RustFS metrics
    - job_name: "rustfs"
      static_configs:
          - targets:
                [
                    "rustfs-1:9000",
                    "rustfs-2:9000",
                    "rustfs-3:9000",
                    "rustfs-4:9000",
                ]
      metrics_path: "/minio/v2/metrics/cluster"

    # Backend services
    - job_name: "backend"
      static_configs:
          - targets: ["backend:3000"]
      metrics_path: "/metrics"
```

### 9.2 Alert Rules

```yaml
# config/prometheus-rules/nats-alerts.yml
groups:
    - name: nats_alerts
      rules:
          - alert: NATSHighLatency
            expr: nats_varz_mem > 3000000000
            for: 5m
            labels:
                severity: warning
            annotations:
                summary: "NATS memory usage high"
                description: "NATS server {{ $labels.instance }} memory above 3GB"

          - alert: NATSSlowConsumers
            expr: nats_varz_slow_consumers > 0
            for: 1m
            labels:
                severity: critical
            annotations:
                summary: "NATS slow consumers detected"
                description: "{{ $value }} slow consumers on {{ $labels.instance }}"

          - alert: JetStreamStorageHigh
            expr: (nats_jetstream_storage_bytes / nats_jetstream_storage_bytes_max) > 0.85
            for: 10m
            labels:
                severity: warning
            annotations:
                summary: "JetStream storage above 85%"

          - alert: JobQueueBacklog
            expr: nats_consumer_num_pending{stream="TRAINING_JOBS"} > 100
            for: 30m
            labels:
                severity: warning
            annotations:
                summary: "Training job backlog growing"
                description: "{{ $value }} pending training jobs"

          - alert: RobotOffline
            expr: time() - max by (robot_id) (nats_kv_entry_timestamp{bucket="ROBOT_STATE"}) > 300
            for: 5m
            labels:
                severity: warning
            annotations:
                summary: "Robot {{ $labels.robot_id }} offline"

    - name: rustfs_alerts
      rules:
          - alert: RustFSNodeDown
            expr: up{job="rustfs"} == 0
            for: 2m
            labels:
                severity: critical
            annotations:
                summary: "RustFS node {{ $labels.instance }} is down"

          - alert: RustFSStorageHigh
            expr: minio_cluster_disk_used_bytes / minio_cluster_disk_total_bytes > 0.85
            for: 30m
            labels:
                severity: warning
            annotations:
                summary: "RustFS storage above 85%"
```

---

## 10. Development Environment

### 10.1 Complete Docker Compose

```yaml
# docker-compose.dev.yml
version: "3.9"

services:
    # ═══════════════════════════════════════════════════════════════════════════
    # NATS Cluster
    # ═══════════════════════════════════════════════════════════════════════════
    nats-1:
        image: nats:2.10-alpine
        container_name: nats-1
        command: ["-c", "/etc/nats/nats.conf", "--name", "nats-1"]
        ports:
            - "4222:4222"
            - "6222:6222"
            - "7422:7422"
            - "8222:8222"
        volumes:
            - ./config/nats-dev.conf:/etc/nats/nats.conf:ro
            - nats-1-data:/data
        networks:
            - fleet-network
        healthcheck:
            test:
                [
                    "CMD",
                    "wget",
                    "-q",
                    "--spider",
                    "http://localhost:8222/healthz",
                ]
            interval: 10s
            timeout: 5s
            retries: 5

    nats-2:
        image: nats:2.10-alpine
        container_name: nats-2
        command: ["-c", "/etc/nats/nats.conf", "--name", "nats-2"]
        ports:
            - "4223:4222"
        volumes:
            - ./config/nats-dev.conf:/etc/nats/nats.conf:ro
            - nats-2-data:/data
        networks:
            - fleet-network
        depends_on:
            - nats-1

    nats-3:
        image: nats:2.10-alpine
        container_name: nats-3
        command: ["-c", "/etc/nats/nats.conf", "--name", "nats-3"]
        ports:
            - "4224:4222"
        volumes:
            - ./config/nats-dev.conf:/etc/nats/nats.conf:ro
            - nats-3-data:/data
        networks:
            - fleet-network
        depends_on:
            - nats-1

    # ═══════════════════════════════════════════════════════════════════════════
    # RustFS Cluster
    # ═══════════════════════════════════════════════════════════════════════════
    rustfs-1:
        image: rustfs/rustfs:latest
        container_name: rustfs-1
        hostname: rustfs-1
        command: server http://rustfs-{1...4}:9000/data --console-address ":9001"
        ports:
            - "9000:9000"
            - "9001:9001"
        environment:
            RUSTFS_ACCESS_KEY: emaifleetadmin
            RUSTFS_SECRET_KEY: supersecretkey123
        volumes:
            - rustfs-1-data:/data
        networks:
            - fleet-network
        healthcheck:
            test:
                ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
            interval: 30s
            timeout: 10s
            retries: 3

    rustfs-2:
        image: rustfs/rustfs:latest
        container_name: rustfs-2
        hostname: rustfs-2
        command: server http://rustfs-{1...4}:9000/data --console-address ":9001"
        environment:
            RUSTFS_ACCESS_KEY: emaifleetadmin
            RUSTFS_SECRET_KEY: supersecretkey123
        volumes:
            - rustfs-2-data:/data
        networks:
            - fleet-network

    rustfs-3:
        image: rustfs/rustfs:latest
        container_name: rustfs-3
        hostname: rustfs-3
        command: server http://rustfs-{1...4}:9000/data --console-address ":9001"
        environment:
            RUSTFS_ACCESS_KEY: emaifleetadmin
            RUSTFS_SECRET_KEY: supersecretkey123
        volumes:
            - rustfs-3-data:/data
        networks:
            - fleet-network

    rustfs-4:
        image: rustfs/rustfs:latest
        container_name: rustfs-4
        hostname: rustfs-4
        command: server http://rustfs-{1...4}:9000/data --console-address ":9001"
        environment:
            RUSTFS_ACCESS_KEY: emaifleetadmin
            RUSTFS_SECRET_KEY: supersecretkey123
        volumes:
            - rustfs-4-data:/data
        networks:
            - fleet-network

    # Initialize buckets
    rustfs-init:
        image: minio/mc:latest
        container_name: rustfs-init
        depends_on:
            rustfs-1:
                condition: service_healthy
        entrypoint: /bin/sh
        command: |
            -c "
            sleep 5
            mc alias set rustfs http://rustfs-1:9000 emaifleetadmin supersecretkey123
            mc mb rustfs/training-datasets --ignore-existing
            mc mb rustfs/model-checkpoints --ignore-existing
            mc mb rustfs/production-models --ignore-existing
            mc mb rustfs/robot-logs --ignore-existing
            mc version enable rustfs/production-models
            echo 'Buckets initialized'
            "
        networks:
            - fleet-network

    # ═══════════════════════════════════════════════════════════════════════════
    # Backend Service
    # ═══════════════════════════════════════════════════════════════════════════
    backend:
        build:
            context: ./backend
            dockerfile: Dockerfile.dev
        container_name: backend
        ports:
            - "3000:3000"
        environment:
            NODE_ENV: development
            NATS_SERVERS: nats://nats-1:4222,nats://nats-2:4222,nats://nats-3:4222
            RUSTFS_ENDPOINT: http://rustfs-1:9000
            RUSTFS_ACCESS_KEY: emaifleetadmin
            RUSTFS_SECRET_KEY: supersecretkey123
        volumes:
            - ./backend/src:/app/src
        depends_on:
            nats-1:
                condition: service_healthy
            rustfs-init:
                condition: service_completed_successfully
        networks:
            - fleet-network

    # ═══════════════════════════════════════════════════════════════════════════
    # Robot Simulator
    # ═══════════════════════════════════════════════════════════════════════════
    robot-sim-001:
        build:
            context: ./robot-agent
            dockerfile: Dockerfile.dev
        container_name: robot-sim-001
        environment:
            ROBOT_ID: robot-sim-001
            ROBOT_EMBODIMENT: unitree_g1
            NATS_URL: nats://nats-1:4222
            LOCAL_AGENT_PASSWORD: localpass123
        depends_on:
            nats-1:
                condition: service_healthy
        networks:
            - fleet-network

    # ═══════════════════════════════════════════════════════════════════════════
    # Monitoring Stack
    # ═══════════════════════════════════════════════════════════════════════════
    prometheus:
        image: prom/prometheus:latest
        container_name: prometheus
        ports:
            - "9090:9090"
        volumes:
            - ./config/prometheus.yml:/etc/prometheus/prometheus.yml
            - ./config/prometheus-rules:/etc/prometheus/rules
            - prometheus-data:/prometheus
        command:
            - "--config.file=/etc/prometheus/prometheus.yml"
            - "--storage.tsdb.path=/prometheus"
        networks:
            - fleet-network

    grafana:
        image: grafana/grafana:latest
        container_name: grafana
        ports:
            - "3001:3000"
        environment:
            GF_SECURITY_ADMIN_PASSWORD: admin
            GF_USERS_ALLOW_SIGN_UP: "false"
        volumes:
            - grafana-data:/var/lib/grafana
            - ./config/grafana/provisioning:/etc/grafana/provisioning
        depends_on:
            - prometheus
        networks:
            - fleet-network

    # NATS CLI tools
    nats-box:
        image: natsio/nats-box:latest
        container_name: nats-box
        command: ["tail", "-f", "/dev/null"]
        networks:
            - fleet-network

volumes:
    nats-1-data:
    nats-2-data:
    nats-3-data:
    rustfs-1-data:
    rustfs-2-data:
    rustfs-3-data:
    rustfs-4-data:
    prometheus-data:
    grafana-data:

networks:
    fleet-network:
        driver: bridge
```

### 10.2 NATS Development Configuration

```hcl
# config/nats-dev.conf
listen: 0.0.0.0:4222
http: 0.0.0.0:8222

jetstream {
  store_dir: /data/jetstream
  max_mem: 1G
  max_file: 10G
}

cluster {
  name: dev-cluster
  listen: 0.0.0.0:6222
  routes: [
    nats-route://nats-1:6222
    nats-route://nats-2:6222
    nats-route://nats-3:6222
  ]
}

leafnodes {
  port: 7422
}

# Simple auth for development
authorization {
  users: [
    {user: admin, password: admin}
  ]
}

logging {
  debug: false
  trace: false
  time: true
}
```

---

## 11. Production Deployment

### 11.1 Kubernetes Namespace and Secrets

```yaml
# kubernetes/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
    name: robot-fleet
    labels:
        name: robot-fleet
---
apiVersion: v1
kind: Secret
metadata:
    name: nats-credentials
    namespace: robot-fleet
type: Opaque
stringData:
    sys-password: "${SYS_ADMIN_PASSWORD}"
    training-svc-password: "${TRAINING_SVC_PWD}"
    encryption-key: "${NATS_JS_ENCRYPTION_KEY}"
---
apiVersion: v1
kind: Secret
metadata:
    name: rustfs-credentials
    namespace: robot-fleet
type: Opaque
stringData:
    access-key: "${RUSTFS_ACCESS_KEY}"
    secret-key: "${RUSTFS_SECRET_KEY}"
```

### 11.2 NATS Helm Values

```yaml
# kubernetes/nats-values.yaml
nats:
    image:
        repository: nats
        tag: "2.10-alpine"

    jetstream:
        enabled: true
        memStorage:
            enabled: true
            size: 4Gi
        fileStorage:
            enabled: true
            size: 100Gi
            storageClassName: fast-ssd

    cluster:
        enabled: true
        replicas: 3

    leafnodes:
        enabled: true
        port: 7422

    auth:
        enabled: true
        resolver:
            type: memory
            timeout: 5

    tls:
        enabled: true
        secretName: nats-tls
        ca: ca.pem
        cert: server-cert.pem
        key: server-key.pem

    resources:
        requests:
            cpu: "1"
            memory: "4Gi"
        limits:
            cpu: "2"
            memory: "8Gi"

    affinity:
        podAntiAffinity:
            requiredDuringSchedulingIgnoredDuringExecution:
                - labelSelector:
                      matchLabels:
                          app.kubernetes.io/name: nats
                  topologyKey: kubernetes.io/hostname

natsBox:
    enabled: true
```

---

## 12. Implementation Roadmap

### Phase 1: Infrastructure Foundation (Weeks 1-2)

| Task                         | Duration | Owner    | Deliverable                    |
| ---------------------------- | -------- | -------- | ------------------------------ |
| Deploy NATS 3-node cluster   | 2 days   | DevOps   | Running cluster with JetStream |
| Deploy RustFS 4-node cluster | 2 days   | DevOps   | S3-compatible storage          |
| Configure TLS certificates   | 1 day    | Security | Secure connections             |
| Create stream definitions    | 2 days   | Backend  | All streams configured         |
| Setup Prometheus + Grafana   | 1 day    | DevOps   | Monitoring dashboards          |
| Integration tests            | 2 days   | QA       | Validated connectivity         |

### Phase 2: Backend Integration (Weeks 3-4)

| Task                     | Duration | Owner   | Deliverable        |
| ------------------------ | -------- | ------- | ------------------ |
| NATS client library      | 2 days   | Backend | TypeScript client  |
| RustFS client library    | 2 days   | Backend | S3 client wrapper  |
| Job queue implementation | 3 days   | Backend | BullMQ replacement |
| Training service         | 3 days   | ML Team | Job processing     |
| Model registry           | 2 days   | Backend | Version management |

### Phase 3: Robot Agent (Weeks 5-6)

| Task                      | Duration | Owner    | Deliverable           |
| ------------------------- | -------- | -------- | --------------------- |
| Leaf node configuration   | 2 days   | DevOps   | Robot NATS config     |
| Robot agent library       | 3 days   | Embedded | Node.js agent         |
| Offline operation testing | 2 days   | QA       | Resilience validation |
| Telemetry pipeline        | 2 days   | Backend  | 10Hz streaming        |
| Command execution         | 1 day    | Embedded | Skill execution       |

### Phase 4: Fleet Operations (Weeks 7-8)

| Task                      | Duration | Owner    | Deliverable           |
| ------------------------- | -------- | -------- | --------------------- |
| Model deployment pipeline | 2 days   | ML Team  | Automated deployment  |
| Canary deployment system  | 2 days   | Backend  | Staged rollouts       |
| Fleet dashboard           | 3 days   | Frontend | Real-time monitoring  |
| Security hardening        | 2 days   | Security | NKey auth, TLS        |
| Load testing              | 1 day    | QA       | 100+ robot simulation |

### Phase 5: Production Launch (Weeks 9-10)

| Task                      | Duration | Owner    | Deliverable             |
| ------------------------- | -------- | -------- | ----------------------- |
| Disaster recovery testing | 2 days   | DevOps   | Backup/restore verified |
| Documentation             | 2 days   | All      | Runbooks, API docs      |
| Security audit            | 2 days   | Security | Penetration test        |
| Staged rollout            | 3 days   | All      | Production deployment   |
| Monitoring review         | 1 day    | DevOps   | Alert tuning            |

---

## Appendix: Quick Reference

### NATS CLI Commands

```bash
# Connect to NATS
nats context add robot-fleet --server nats://localhost:4222 --user admin --password admin

# Stream management
nats stream ls
nats stream info TRAINING_JOBS
nats stream report

# Consumer management
nats consumer ls TRAINING_JOBS
nats consumer info TRAINING_JOBS training-workers

# KV store
nats kv ls
nats kv get ROBOT_STATE robot.001

# Publish/Subscribe
nats pub commands.robot-001.test '{"type":"test"}'
nats sub 'telemetry.>'

# JetStream status
nats server report jetstream
```

### RustFS CLI Commands (mc)

```bash
# Configure alias
mc alias set rustfs http://localhost:9000 emaifleetadmin supersecretkey123

# Bucket operations
mc ls rustfs
mc mb rustfs/new-bucket
mc rb rustfs/old-bucket --force

# File operations
mc cp model.onnx rustfs/production-models/
mc cat rustfs/production-models/model.onnx
mc rm rustfs/production-models/old-model.onnx

# Admin operations
mc admin info rustfs
mc admin heal rustfs
mc admin prometheus generate rustfs
```

---

**Document Version**: 1.0  
**Last Updated**: January 2026  
**Author**: EmAI Technical Team

> ⚠️ **Remember**: RustFS is still in alpha. Monitor the [RustFS GitHub](https://github.com/rustfs/rustfs) for stable releases before full production deployment. Consider running parallel MinIO for critical data until RustFS reaches v1.0 stable.
