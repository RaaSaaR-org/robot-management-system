# VLA Integration Guide for Centralized Robot Fleet Management

**Vision-Language-Action models enable robots to understand natural language commands and visual context, then execute grounded physical actions.** This guide provides a complete implementation blueprint for integrating VLA models into a centralized Node.js-based robot management system—specifically designed for enterprise fleet deployment. The architecture supports the critical "learn once, deploy to fleet" paradigm where skills trained on one robot transfer seamlessly across heterogeneous fleets.

Modern VLA foundation models like OpenVLA (7B parameters), Physical Intelligence's π0 series, and NVIDIA GR00T N1.6 have achieved breakthrough generalization across robot embodiments. The core technical challenge lies in bridging these Python/CUDA-based models with Node.js Express backends while maintaining the **20-100ms latency budget** required for real-time robotic control.

---

## VLA model landscape: three foundation models compared

The VLA foundation model ecosystem has consolidated around three production-ready options, each with distinct architectural approaches and deployment characteristics.

### OpenVLA: the open-source benchmark

OpenVLA combines a fused DINOv2+SigLIP vision encoder with a Llama-2 7B language backbone, outputting **256-bin discretized action tokens**. The standard model achieves 4.2 Hz inference (239ms latency), but the optimized OpenVLA-OFT variant reaches **71 Hz** through parallel decoding and action chunking—a 26× speedup that enables real-time bimanual manipulation.

| Variant | Parameters | Inference Speed | GPU Memory | License |
|---------|-----------|-----------------|------------|---------|
| OpenVLA base | 7B | 4.2 Hz | 15-16 GB | Llama Community |
| OpenVLA (INT4) | 7B | ~6 Hz | 8 GB | Llama Community |
| OpenVLA-OFT | 7B | 71 Hz | 16 GB | Llama Community |

Fine-tuning requires **25-73 GB VRAM** for LoRA (single A100) or 8× A100 80GB for full fine-tuning. The MIT-licensed codebase and HuggingFace integration make OpenVLA the most accessible starting point for enterprises exploring VLA integration.

### Physical Intelligence π0 series: dexterous manipulation leaders

The π0 architecture separates a **3B PaliGemma VLM backbone** from a **300M action expert** using flow matching for continuous action generation. This dual-system design achieves up to 50 Hz control frequency for tasks like laundry folding and box assembly.

The evolution from π0 → π0.5 → π0.6 introduced progressively more sophisticated capabilities: open-world generalization through heterogeneous data co-training, then RL-based self-improvement via the RECAP method (Reinforcement learning with Experience and Corrections via Advantage-conditioned Policies).

**π0.6** (November 2025) represents the current state-of-the-art, with a Gemma3 4B backbone achieving **63ms per action chunk** on H100. Critically for commercial deployment, OpenPI (the open implementation) uses **Apache 2.0 licensing** for both code and model weights.

### NVIDIA GR00T N1.6: the humanoid-optimized foundation

GR00T N1.6 targets humanoid robots specifically, using the Cosmos-Reason-2B VLM with a 32-layer Diffusion Transformer action head. The architecture achieves **26 Hz on H100** (38ms latency) and **23 Hz on RTX 4090** (44ms).

Key differentiators include native Isaac Lab/Sim integration for simulation-to-reality transfer, pre-registered embodiment tags for platforms like UNITREE_G1 and GR1, and the FLARE world modeling objective for improved spatial reasoning. However, commercial deployment requires contacting NVIDIA for licensing terms beyond research use.

### Selection framework for German enterprise deployment

For a robotics-as-a-service company, the licensing implications are critical:

- **π0 via OpenPI** (Apache 2.0): Most commercially permissive, recommended for production deployment
- **OpenVLA**: Permitted under Llama Community License terms—requires legal review for commercial fleet use
- **GR00T**: Requires explicit NVIDIA commercial licensing agreement

---

## Centralized inference architecture: designing for fleet-scale VLA serving

The fundamental architectural tension in cloud-based robot control lies between inference latency and deployment simplicity. VLA models benefit from centralized GPU infrastructure for cost efficiency and model management, but robotic control demands consistent sub-100ms response times.

### Dual-system architecture for latency management

Modern VLA architectures (π0, GR00T, Figure AI's Helix) converge on a dual-system pattern separating deliberative reasoning from reactive control:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        CENTRAL INFERENCE HUB                            │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  System 2 (Slow): VLM Reasoning - 1-5 Hz                          │  │
│  │  • Task decomposition from natural language                       │  │
│  │  • Scene understanding and object grounding                       │  │
│  │  • High-level skill selection                                     │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  System 1 (Fast): Action Generation - 10-50 Hz                    │  │
│  │  • Diffusion/flow-matching action head                            │  │
│  │  • Action chunk prediction (8-16 timesteps)                       │  │
│  │  • Cloud-deployable with action buffering on robot                │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
            │  Robot 1    │ │  Robot 2    │ │  Robot N    │
            │ ┌─────────┐ │ │ ┌─────────┐ │ │ ┌─────────┐ │
            │ │ Action  │ │ │ │ Action  │ │ │ │ Action  │ │
            │ │ Buffer  │ │ │ │ Buffer  │ │ │ │ Buffer  │ │
            │ │(8-16 act)│ │ │ │(8-16 act)│ │ │ │(8-16 act)│ │
            │ └─────────┘ │ │ └─────────┘ │ │ └─────────┘ │
            │ ┌─────────┐ │ │ ┌─────────┐ │ │ ┌─────────┐ │
            │ │ Safety  │ │ │ │ Safety  │ │ │ │ Safety  │ │
            │ │ Ctrl    │ │ │ │ Ctrl    │ │ │ │ Ctrl    │ │
            │ │ (1kHz)  │ │ │ │ (1kHz)  │ │ │ │ (1kHz)  │ │
            │ └─────────┘ │ │ └─────────┘ │ │ └─────────┘ │
            └─────────────┘ └─────────────┘ └─────────────┘
```

The action buffering pattern is essential: the central server generates **action chunks** (8-16 future actions per inference), which robots execute locally while requesting the next chunk. This decouples inference latency from control frequency—even with 100ms network round-trips, robots maintain smooth 50 Hz execution.

### Latency budget allocation for fleet deployment

| Control Layer | Frequency | Latency Budget | Deployment |
|--------------|-----------|----------------|------------|
| Motor PID loops | 1 kHz | <1 ms | **Always local** |
| Safety monitoring | 200-500 Hz | <5 ms | **Always local** |
| Joint trajectory tracking | 60-200 Hz | 5-17 ms | Local/Edge |
| VLA action inference | 10-50 Hz | 20-100 ms | Cloud-suitable |
| Task planning/NL commands | 0.5-5 Hz | 200ms-2s | **Cloud-ideal** |

The critical insight: **low-level safety and motor control must remain on-device regardless of VLA architecture**. Cloud-based VLA inference is viable for the high-level action generation layer, with local action interpolation and safety monitoring.

### GPU infrastructure sizing for multi-robot fleets

Based on production benchmarks, a single A100 80GB with vLLM batching can serve:

| Model Class | Batch Size | Robots @ 10 Hz | Robots @ 50 Hz |
|-------------|-----------|----------------|----------------|
| 3B (π0-class) | 8-16 | 40-80 | 8-16 |
| 7B (OpenVLA) | 4-8 | 20-40 | 4-8 |
| 7B (OFT optimized) | 16-32 | 80-160 | 16-32 |

**Cost analysis for a 10-robot fleet operating 8 hours/day:**
- Cloud (A100 spot): €130-530/month
- Cloud (H100 on-demand): €300-800/month
- On-premises break-even: ~€3,000/month cloud spend

For German enterprise deployment, consider GDPR implications of streaming robot sensor data to cloud providers. On-premises GPU clusters (4-8× A100/H100) become cost-effective at 50+ robot scale and eliminate data residency concerns.

---

## Node.js and Python integration: bridging the runtime gap

The VLA ecosystem is Python-native (PyTorch, JAX), while the robot management backend uses Node.js Express. This section provides production-tested integration patterns.

### Protocol selection for real-time robot control

| Protocol | Round-Trip Latency | Best For | Node.js Library |
|----------|-------------------|----------|-----------------|
| **gRPC** | 1-3 ms (local) | ML inference, streaming | `@grpc/grpc-js` |
| ZeroMQ | 40 μs (IPC) | Ultra-low latency | `zeromq.js` |
| WebSocket | <1 ms (persistent) | UI telemetry | `ws`, `socket.io` |
| REST | 5-20 ms | Config APIs | `express`, `axios` |

**Recommendation: gRPC with bidirectional streaming** for the observation-action loop. It provides 3× better throughput than REST, strong typing via Protocol Buffers, and native support for continuous streaming—essential for VLA inference.

### gRPC service definition for robot inference

```protobuf
syntax = "proto3";
package robotics;

service VLAInference {
  // Single inference call
  rpc Predict(Observation) returns (ActionChunk) {}
  
  // Bidirectional streaming for continuous control
  rpc StreamControl(stream Observation) returns (stream ActionChunk) {}
}

message Observation {
  bytes camera_image = 1;           // JPEG compressed (224×224 for VLA)
  repeated float joint_positions = 2;
  repeated float joint_velocities = 3;
  string language_instruction = 4;  // Natural language task
  double timestamp = 5;
}

message ActionChunk {
  repeated Action actions = 1;      // 8-16 future actions
  float inference_time_ms = 2;
  string model_version = 3;
}

message Action {
  repeated float joint_commands = 1;  // 7-DoF for typical arms
  float gripper_command = 2;          // 0-1 gripper position
  double timestamp = 3;
}
```

### Python gRPC inference server with async batching

```python
# inference_server.py
import grpc
from grpc import aio
import torch
from transformers import AutoModelForVision2Seq, AutoProcessor
import asyncio
from collections import deque
import robot_pb2, robot_pb2_grpc

class VLAInferenceServicer(robot_pb2_grpc.VLAInferenceServicer):
    def __init__(self, model_path: str, device: str = "cuda"):
        self.processor = AutoProcessor.from_pretrained(
            model_path, trust_remote_code=True
        )
        self.model = AutoModelForVision2Seq.from_pretrained(
            model_path,
            torch_dtype=torch.bfloat16,
            attn_implementation="flash_attention_2"
        ).to(device).eval()
        
        self.device = device
        self.batch_queue = deque(maxlen=16)
        self.inference_lock = asyncio.Lock()

    async def Predict(self, request, context):
        # Decode observation
        image = self._decode_image(request.camera_image)
        joints = torch.tensor(request.joint_positions, device=self.device)
        
        # Prepare inputs
        inputs = self.processor(
            images=image,
            text=request.language_instruction,
            return_tensors="pt"
        ).to(self.device, dtype=torch.bfloat16)
        
        # Run inference
        start_time = torch.cuda.Event(enable_timing=True)
        end_time = torch.cuda.Event(enable_timing=True)
        
        start_time.record()
        with torch.no_grad():
            action_chunk = self.model.predict_action(
                **inputs,
                unnorm_key="bridge_orig",  # Dataset-specific
                do_sample=False
            )
        end_time.record()
        torch.cuda.synchronize()
        
        inference_ms = start_time.elapsed_time(end_time)
        
        # Build response with action chunk
        response = robot_pb2.ActionChunk(
            inference_time_ms=inference_ms,
            model_version=self.model_version
        )
        
        for i, action in enumerate(action_chunk):
            response.actions.append(robot_pb2.Action(
                joint_commands=action[:7].cpu().tolist(),
                gripper_command=float(action[7]),
                timestamp=request.timestamp + (i * 0.02)  # 50 Hz
            ))
        
        return response

    async def StreamControl(self, request_iterator, context):
        """Bidirectional streaming for continuous robot control"""
        async for observation in request_iterator:
            action_chunk = await self.Predict(observation, context)
            yield action_chunk

async def serve(port: int = 50051):
    server = aio.server(options=[
        ('grpc.max_send_message_length', 50 * 1024 * 1024),
        ('grpc.max_receive_message_length', 50 * 1024 * 1024),
    ])
    
    servicer = VLAInferenceServicer("openvla/openvla-7b")
    robot_pb2_grpc.add_VLAInferenceServicer_to_server(servicer, server)
    
    server.add_insecure_port(f'[::]:{port}')
    await server.start()
    print(f"VLA Inference Server running on port {port}")
    await server.wait_for_termination()

if __name__ == '__main__':
    asyncio.run(serve())
```

### Node.js gRPC client for robot-agents

```typescript
// robot-agent/src/vla-client.ts
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const PROTO_PATH = './protos/robot.proto';

interface ActionChunk {
  actions: Array<{ jointCommands: number[]; gripperCommand: number; timestamp: number }>;
  inferenceTimeMs: number;
  modelVersion: string;
}

export class VLAClient {
  private client: any;
  private actionBuffer: Array<{ jointCommands: number[]; gripperCommand: number }> = [];
  private streamCall: grpc.ClientDuplexStream<any, any> | null = null;

  constructor(serverAddress: string = 'localhost:50051') {
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
    });
    
    const proto = grpc.loadPackageDefinition(packageDefinition) as any;
    this.client = new proto.robotics.VLAInference(
      serverAddress,
      grpc.credentials.createInsecure()
    );
  }

  // Single inference call
  async predict(observation: {
    cameraImage: Buffer;
    jointPositions: number[];
    jointVelocities: number[];
    languageInstruction: string;
  }): Promise<ActionChunk> {
    return new Promise((resolve, reject) => {
      this.client.Predict({
        cameraImage: observation.cameraImage,
        jointPositions: observation.jointPositions,
        jointVelocities: observation.jointVelocities,
        languageInstruction: observation.languageInstruction,
        timestamp: Date.now() / 1000,
      }, (error: Error | null, response: ActionChunk) => {
        if (error) reject(error);
        else {
          this.actionBuffer.push(...response.actions);
          resolve(response);
        }
      });
    });
  }

  // Start continuous streaming control loop
  startStreamControl(
    getObservation: () => Promise<any>,
    onAction: (action: any) => void,
    intervalMs: number = 33  // ~30 Hz observation rate
  ): void {
    this.streamCall = this.client.StreamControl();
    
    this.streamCall.on('data', (actionChunk: ActionChunk) => {
      // Buffer new actions
      this.actionBuffer.push(...actionChunk.actions);
    });

    this.streamCall.on('error', (err: Error) => {
      console.error('Stream error:', err);
      // Implement reconnection logic
    });

    // Send observations at fixed rate
    const observationLoop = setInterval(async () => {
      try {
        const observation = await getObservation();
        this.streamCall?.write(observation);
      } catch (err) {
        console.error('Observation error:', err);
      }
    }, intervalMs);

    // Execute actions at higher rate (50 Hz)
    const actionLoop = setInterval(() => {
      const action = this.actionBuffer.shift();
      if (action) {
        onAction(action);
      }
    }, 20);
  }

  // Get next buffered action (for integration with existing control loops)
  getNextAction(): { jointCommands: number[]; gripperCommand: number } | null {
    return this.actionBuffer.shift() || null;
  }

  stop(): void {
    this.streamCall?.end();
  }
}
```

### Integration with Express backend

```typescript
// backend/src/routes/inference.ts
import { Router, Request, Response } from 'express';
import { VLAClient } from '../services/vla-client';

const router = Router();
const vlaClients = new Map<string, VLAClient>();

// POST /api/inference/predict - Single VLA inference
router.post('/predict', async (req: Request, res: Response) => {
  const { robotId, cameraImage, jointPositions, languageInstruction } = req.body;
  
  let client = vlaClients.get(robotId);
  if (!client) {
    client = new VLAClient(process.env.VLA_SERVER_ADDRESS);
    vlaClients.set(robotId, client);
  }

  try {
    const actionChunk = await client.predict({
      cameraImage: Buffer.from(cameraImage, 'base64'),
      jointPositions,
      jointVelocities: [],
      languageInstruction,
    });

    res.json({
      success: true,
      actions: actionChunk.actions,
      inferenceTimeMs: actionChunk.inferenceTimeMs,
      modelVersion: actionChunk.modelVersion,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// POST /api/inference/start-stream - Start continuous inference for robot
router.post('/start-stream/:robotId', async (req: Request, res: Response) => {
  const { robotId } = req.params;
  const { languageInstruction } = req.body;
  
  // Implementation would connect to robot-agent WebSocket
  // and start bidirectional gRPC stream to VLA server
  
  res.json({ success: true, message: `Stream started for ${robotId}` });
});

export default router;
```

---

## Fine-tuning pipeline: from demonstrations to deployed skills

Fine-tuning VLA models for specific tasks and robot embodiments requires a structured pipeline from data collection through deployment.

### Teleoperation data collection hardware

For German industrial applications, **leader-follower arm systems** provide the highest quality demonstrations:

- **ALOHA/ALOHA 2** (~€20-30K): Physical leader arms that operators backdrive, positions sync to follower arms. Best for bimanual manipulation research.
- **GELLO** (~€500-2K/arm): Low-cost exoskeleton controllers adaptable to various robot arms (UR5, Franka, KUKA). Most practical for enterprise fleet deployment.
- **Kinesthetic teaching**: Direct physical guidance using collaborative robot force sensing. Simple but limited scalability.

**Demonstration quantity guidelines:**

| Model | Task Complexity | Required Demonstrations |
|-------|-----------------|------------------------|
| π0 | Simple manipulation | 1-20 hours of data |
| OpenVLA-OFT | ALOHA bimanual | 50-300 demonstrations |
| GR00T N1.6 | New embodiment | 20-50 minimum |
| Full fine-tuning | Complex dexterous | 300-1000+ demonstrations |

### Data format selection: LeRobot v3 as the standard

The ecosystem has converged on **LeRobot v3** as the preferred format, with native HuggingFace Hub integration and compatibility with OpenVLA, π0/OpenPI, and GR00T:

```
dataset/
├── meta/
│   ├── info.json          # Dataset metadata, FPS, features
│   ├── stats.json         # Normalization statistics
│   └── episodes.json      # Episode boundaries
├── data/
│   └── train-*.parquet    # State/action as Parquet tables
└── videos/
    └── observation.images.cam_front/
        └── episode_*.mp4   # H.264 encoded video streams
```

**info.json schema:**
```json
{
  "codebase_version": "v3.0",
  "robot_type": "franka_panda",
  "fps": 30,
  "features": {
    "observation.images.front": {"dtype": "video", "shape": [480, 640, 3]},
    "observation.state": {"dtype": "float32", "shape": [7]},
    "action": {"dtype": "float32", "shape": [7]}
  },
  "splits": {"train": "0:250", "test": "250:300"}
}
```

### Recording demonstrations with LeRobot

```bash
# Install LeRobot
pip install lerobot

# Record demonstrations
python -m lerobot.record \
  --robot.type=so100_follower \
  --robot.port=/dev/ttyACM0 \
  --robot.cameras="{ front: {type: opencv, index_or_path: /dev/video0}}" \
  --dataset.repo_id=$HF_USER/warehouse_pick_place \
  --dataset.single_task="Pick up the package and place it on the conveyor"
```

### Fine-tuning approaches compared

| Approach | VRAM Required | Training Time | Performance | Use Case |
|----------|--------------|---------------|-------------|----------|
| **LoRA (r=32)** | 25-27 GB | 4-8 hours | ~95% of full | Production default |
| QLoRA (4-bit) | 16 GB | 12-36 hours | ~90% | Limited GPU memory |
| Full fine-tuning | 8× 80 GB | 1-3 days | 100% | New embodiments |
| OFT recipe | 38 GB | 1-2 days | 97%+ | High-frequency control |

**LoRA fine-tuning command (OpenVLA):**
```bash
torchrun --standalone --nnodes 1 --nproc-per-node 1 \
  vla-scripts/finetune.py \
  --vla_path "openvla/openvla-7b" \
  --data_root_dir ~/datasets \
  --dataset_name warehouse_pick_place \
  --lora_rank 32 \
  --batch_size 16 \
  --learning_rate 5e-4 \
  --image_aug True \
  --wandb_project vla-warehouse-skills \
  --save_steps 1000
```

**π0 fine-tuning via OpenPI:**
```bash
# Convert data to LeRobot format (if needed)
uv run examples/convert_custom_data.py --data_dir /path/to/data

# Compute normalization statistics
uv run scripts/compute_norm_stats.py --config-name pi0_custom

# Launch fine-tuning
XLA_PYTHON_CLIENT_MEM_FRACTION=0.9 uv run scripts/train.py pi0_custom \
  --exp-name=warehouse_pick_place \
  --config.batch_size=16 \
  --config.max_steps=20000
```

---

## Multi-robot knowledge sharing: the fleet learning architecture

The "learn once, deploy to fleet" paradigm requires careful architectural design for model versioning, skill abstraction, and cross-embodiment transfer.

### Cross-embodiment transfer mechanisms

VLA foundation models achieve transfer through three mechanisms:

1. **Shared visual representations**: DINOv2/SigLIP encoders learn embodiment-agnostic visual features
2. **Language grounding**: Natural language instructions abstract away robot-specific details
3. **Action space normalization**: Standard 7-DoF (x, y, z, roll, pitch, yaw, gripper) mapping across embodiments

**Embodiment adaptation requires only 20-40 demonstrations** when fine-tuning from a pre-trained VLA. NVIDIA GR00T uses explicit **embodiment tags** in configuration files to handle different robot kinematics:

```yaml
# embodiment_configs/ur10_config.yaml
embodiment_tag: CUSTOM_UR10
action_dim: 7
proprioception_dim: 14
cameras:
  - name: wrist_camera
    resolution: [224, 224]
  - name: base_camera
    resolution: [224, 224]
action_normalization:
  mean: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.5]
  std: [0.1, 0.1, 0.1, 0.2, 0.2, 0.2, 0.3]
```

### Skill library architecture

Design a three-tier skill abstraction:

```
Task Level: "Prepare customer order #4521"
    ↓ (LLM decomposition)
Skill Level: [navigate_to(shelf_A3), pick(sku_12345), place(packing_station)]
    ↓ (VLA execution)
Primitive Level: [action_chunk_1, action_chunk_2, ...]
```

**Skill definition schema:**
```typescript
interface SkillDefinition {
  id: string;
  name: string;                    // "pick_object"
  version: string;
  parameters: {
    objectId: { type: 'string'; required: true };
    graspPose: { type: 'pose'; default: 'auto_detect' };
    approachDirection: { type: 'vector3'; default: [0, 0, -1] };
    gripForce: { type: 'number'; range: [0.1, 10.0] };
  };
  preconditions: string[];         // ["gripper_empty", "object_visible"]
  postconditions: string[];        // ["object_grasped"]
  compatibleEmbodiments: string[]; // ["ur10", "franka", "kuka_iiwa"]
  modelVersionId: string;          // Reference to trained VLA checkpoint
}
```

### Model version management with MLflow

```
model-registry/
├── base-models/
│   ├── openvla-7b-v1.0/
│   └── pi0-base-v1.0/
├── embodiment-adapters/
│   ├── ur10-lora-v1.2/
│   ├── franka-lora-v1.1/
│   └── kuka-iiwa-lora-v1.0/
└── skill-checkpoints/
    ├── pick-and-place/
    │   ├── ur10-v2.3/     → production alias
    │   └── ur10-v2.4/     → canary alias
    └── palletizing/
        └── kuka-v1.0/
```

**MLflow model registration:**
```python
import mlflow

with mlflow.start_run(run_name="warehouse_pick_place_training"):
    # Log training parameters
    mlflow.log_params({
        "base_model": "openvla/openvla-7b",
        "lora_rank": 32,
        "learning_rate": 5e-4,
        "dataset": "warehouse_pick_place_v2",
        "demonstrations": 150
    })
    
    # Log training metrics
    mlflow.log_metrics({"val_loss": 0.023, "action_accuracy": 0.94})
    
    # Register model version
    mlflow.pytorch.log_model(
        model, 
        "vla_model",
        registered_model_name="warehouse_pick_place"
    )
    
    # Set alias for deployment
    client = mlflow.MlflowClient()
    client.set_registered_model_alias(
        name="warehouse_pick_place",
        alias="production",
        version=3
    )
```

### Fleet deployment with canary rollout

```typescript
// Canary deployment configuration
interface CanaryConfig {
  modelVersionId: string;
  steps: [
    { percentage: 5, durationMinutes: 60 },   // 5% for 1 hour
    { percentage: 20, durationMinutes: 120 }, // 20% for 2 hours
    { percentage: 50, durationMinutes: 240 }, // 50% for 4 hours
    { percentage: 100, durationMinutes: 0 }   // Full rollout
  ];
  rollbackThresholds: {
    errorRate: 0.05;        // Rollback if >5% task failures
    latencyP99Ms: 500;      // Rollback if P99 latency exceeds 500ms
  };
  targetRobotSelector: {
    robotTypes: ['ur10'];
    locations: ['warehouse_munich'];
  };
}
```

---

## Training management system: the Node.js architecture

The training management system orchestrates the complete ML lifecycle from dataset management through production deployment.

### System architecture overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   API GATEWAY (Node.js Express)                         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌───────────────┐  │
│  │ Training API │ │ Dataset API  │ │ Model API    │ │ Deployment API│  │
│  └──────────────┘ └──────────────┘ └──────────────┘ └───────────────┘  │
├─────────────────────────────────────────────────────────────────────────┤
│                    MESSAGE QUEUE (BullMQ + Redis)                       │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌───────────────┐  │
│  │ Training     │ │ Dataset      │ │ Model        │ │ Inference     │  │
│  │ Orchestrator │ │ Processor    │ │ Registry     │ │ Router        │  │
│  │ (Python)     │ │ (Python)     │ │ (MLflow)     │ │ (gRPC LB)     │  │
│  └──────────────┘ └──────────────┘ └──────────────┘ └───────────────┘  │
├─────────────────────────────────────────────────────────────────────────┤
│  PostgreSQL      │  RustFS/S3      │  MLflow        │  Prometheus     │
│  (Metadata)      │  (Artifacts)    │  (Experiments) │  (Metrics)      │
└─────────────────────────────────────────────────────────────────────────┘
```

### Database schema for training management

```sql
-- Core entities
CREATE TABLE robot_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    manufacturer VARCHAR(100),
    model VARCHAR(100),
    dof_count INT,
    capabilities JSONB,  -- ["manipulation", "navigation"]
    embodiment_config JSONB
);

CREATE TABLE skill_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    parameters_schema JSONB,
    compatible_robot_types UUID[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Dataset management
CREATE TABLE datasets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    version VARCHAR(50) NOT NULL,
    robot_type_id UUID REFERENCES robot_types(id),
    skill_id UUID REFERENCES skill_definitions(id),
    num_demonstrations INT,
    total_duration_seconds INT,
    storage_path VARCHAR(500),
    huggingface_repo VARCHAR(255),
    quality_score DECIMAL(4,3),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(100),
    UNIQUE(name, version)
);

-- Training jobs
CREATE TABLE training_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id UUID REFERENCES datasets(id),
    skill_id UUID REFERENCES skill_definitions(id),
    
    -- Configuration
    base_model VARCHAR(255) NOT NULL,
    fine_tuning_method VARCHAR(50),  -- 'lora', 'full', 'oft'
    hyperparameters JSONB,
    gpu_requirements JSONB,
    
    -- Execution
    status VARCHAR(50) DEFAULT 'pending',
    priority INT DEFAULT 3,
    mlflow_run_id VARCHAR(100),
    worker_node VARCHAR(100),
    
    -- Progress
    current_epoch INT DEFAULT 0,
    total_epochs INT,
    current_step INT DEFAULT 0,
    total_steps INT,
    latest_metrics JSONB,
    
    -- Timing
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    
    created_by VARCHAR(100)
);

-- Model versions
CREATE TABLE model_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_id UUID REFERENCES skill_definitions(id),
    training_job_id UUID REFERENCES training_jobs(id),
    version INT NOT NULL,
    
    -- Artifacts
    artifact_uri VARCHAR(500),
    model_size_bytes BIGINT,
    
    -- Performance
    training_metrics JSONB,
    validation_metrics JSONB,
    
    -- Deployment status
    status VARCHAR(50) DEFAULT 'staging',  -- staging, canary, production, archived
    deployed_robot_count INT DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Deployments
CREATE TABLE deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_version_id UUID REFERENCES model_versions(id),
    strategy VARCHAR(50),  -- 'canary', 'blue_green', 'rolling'
    
    traffic_percentage INT DEFAULT 0,
    target_robot_ids UUID[],
    
    canary_config JSONB,
    rollback_thresholds JSONB,
    
    status VARCHAR(50) DEFAULT 'pending',
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(100)
);

-- Indexes
CREATE INDEX idx_training_jobs_status ON training_jobs(status);
CREATE INDEX idx_training_jobs_skill ON training_jobs(skill_id);
CREATE INDEX idx_model_versions_skill ON model_versions(skill_id);
CREATE INDEX idx_deployments_status ON deployments(status);
```

### Training job queue with BullMQ

```typescript
// backend/src/queues/training.queue.ts
import { Queue, Worker, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

// Training job queue with priority support
export const trainingQueue = new Queue<TrainingJobData>('training-jobs', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  }
});

interface TrainingJobData {
  jobId: string;
  datasetId: string;
  baseModel: string;
  fineTuningMethod: 'lora' | 'full' | 'oft';
  hyperparameters: {
    learningRate: number;
    batchSize: number;
    epochs: number;
    loraRank?: number;
  };
  gpuRequirements: {
    count: number;
    memoryGb: number;
    type: 'a100' | 'h100' | 'rtx4090';
  };
  callbackUrl: string;
}

// Add training job
export async function submitTrainingJob(data: TrainingJobData): Promise<string> {
  const job = await trainingQueue.add('train-vla', data, {
    jobId: data.jobId,
    priority: getPriorityScore(data),
  });
  return job.id!;
}

// Queue events for progress tracking
const queueEvents = new QueueEvents('training-jobs', { connection: redis });

queueEvents.on('progress', ({ jobId, data }) => {
  // Broadcast to WebSocket subscribers
  broadcastTrainingProgress(jobId, data);
});

queueEvents.on('completed', ({ jobId, returnvalue }) => {
  // Trigger model registration pipeline
  registerTrainedModel(jobId, returnvalue);
});
```

### REST API endpoints

```typescript
// backend/src/routes/training.routes.ts
import { Router } from 'express';
import { submitTrainingJob, getJobStatus, cancelJob } from '../services/training.service';

const router = Router();

// POST /api/training/jobs - Submit new training job
router.post('/jobs', async (req, res) => {
  const { datasetId, skillId, baseModel, hyperparameters, gpuRequirements } = req.body;
  
  try {
    const job = await submitTrainingJob({
      datasetId,
      skillId,
      baseModel,
      hyperparameters,
      gpuRequirements,
      userId: req.user.id,
    });
    
    res.status(201).json({ jobId: job.id, status: 'pending' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit training job' });
  }
});

// GET /api/training/jobs/:jobId - Get job status and metrics
router.get('/jobs/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const job = await getJobStatus(jobId);
  
  res.json({
    id: job.id,
    status: job.status,
    progress: {
      currentEpoch: job.currentEpoch,
      totalEpochs: job.totalEpochs,
      currentStep: job.currentStep,
      totalSteps: job.totalSteps,
    },
    metrics: job.latestMetrics,
    startedAt: job.startedAt,
    estimatedCompletion: job.estimatedCompletion,
  });
});

// POST /api/training/jobs/:jobId/cancel - Cancel running job
router.post('/jobs/:jobId/cancel', async (req, res) => {
  await cancelJob(req.params.jobId);
  res.json({ success: true });
});

// GET /api/training/jobs/:jobId/logs - Stream training logs
router.get('/jobs/:jobId/logs', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  
  const logStream = getJobLogStream(req.params.jobId);
  logStream.pipe(res);
});

export default router;
```

### WebSocket for real-time training progress

```typescript
// backend/src/websocket/training.ws.ts
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';

export function setupTrainingWebSocket(io: Server, redis: Redis) {
  io.adapter(createAdapter(redis, redis.duplicate()));

  io.on('connection', (socket) => {
    // Subscribe to training job updates
    socket.on('subscribe:training', (jobId: string) => {
      socket.join(`training:${jobId}`);
    });

    socket.on('unsubscribe:training', (jobId: string) => {
      socket.leave(`training:${jobId}`);
    });
  });

  // Listen for training updates from Python workers
  redis.subscribe('training-progress');
  redis.on('message', (channel, message) => {
    if (channel === 'training-progress') {
      const data = JSON.parse(message);
      io.to(`training:${data.jobId}`).emit('training:progress', {
        jobId: data.jobId,
        epoch: data.epoch,
        step: data.step,
        trainLoss: data.trainLoss,
        valLoss: data.valLoss,
        learningRate: data.learningRate,
        gpuUtilization: data.gpuUtilization,
        estimatedTimeRemaining: data.eta,
      });
    }
  });
}
```

---

## ROS 2 integration on robot-agents

The robot-agents run on each physical robot, bridging the central Node.js backend with the local ROS 2 control stack.

### Robot-agent architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ROBOT-AGENT (Node.js)                        │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────────┐ │
│  │ Backend      │ │ VLA Client   │ │ ROS 2 Bridge                 │ │
│  │ WebSocket    │ │ (gRPC)       │ │ (rclnodejs)                  │ │
│  └──────────────┘ └──────────────┘ └──────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│                          ROS 2 HUMBLE                                │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────────┐ │
│  │ /camera/image│ │ /joint_states│ │ /trajectory_controller       │ │
│  │ Subscription │ │ Subscription │ │ Action Client                │ │
│  └──────────────┘ └──────────────┘ └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### ROS 2 bridge implementation with rclnodejs

```typescript
// robot-agent/src/ros2-bridge.ts
import * as rclnodejs from 'rclnodejs';
import { VLAClient } from './vla-client';

export class ROS2Bridge {
  private node: rclnodejs.Node;
  private vlaClient: VLAClient;
  
  private imageSubscription: rclnodejs.Subscription;
  private jointStateSubscription: rclnodejs.Subscription;
  private trajectoryClient: rclnodejs.ActionClient;
  
  private latestImage: Buffer | null = null;
  private latestJointState: number[] = [];
  private actionBuffer: any[] = [];
  private safetyWatchdog: NodeJS.Timeout;

  constructor(vlaServerAddress: string) {
    this.vlaClient = new VLAClient(vlaServerAddress);
  }

  async initialize(): Promise<void> {
    await rclnodejs.init();
    this.node = new rclnodejs.Node('vla_robot_agent');

    // Subscribe to camera images
    this.imageSubscription = this.node.createSubscription(
      'sensor_msgs/msg/CompressedImage',
      '/camera/image/compressed',
      (msg: any) => {
        this.latestImage = Buffer.from(msg.data);
      }
    );

    // Subscribe to joint states
    this.jointStateSubscription = this.node.createSubscription(
      'sensor_msgs/msg/JointState',
      '/joint_states',
      (msg: any) => {
        this.latestJointState = Array.from(msg.position);
      }
    );

    // Create trajectory action client
    this.trajectoryClient = new rclnodejs.ActionClient(
      this.node,
      'control_msgs/action/FollowJointTrajectory',
      '/joint_trajectory_controller/follow_joint_trajectory'
    );

    // Start safety watchdog (100ms timeout)
    this.setupSafetyWatchdog();

    rclnodejs.spin(this.node);
  }

  // Execute VLA inference and send trajectory
  async executeVLAAction(languageInstruction: string): Promise<void> {
    if (!this.latestImage || this.latestJointState.length === 0) {
      throw new Error('No sensor data available');
    }

    const actionChunk = await this.vlaClient.predict({
      cameraImage: this.latestImage,
      jointPositions: this.latestJointState,
      jointVelocities: [],
      languageInstruction,
    });

    // Convert action chunk to ROS 2 trajectory
    const trajectory = this.actionsToTrajectory(actionChunk.actions);
    
    // Send trajectory goal
    await this.executeTrajectory(trajectory);
    
    // Reset watchdog
    this.resetWatchdog();
  }

  private actionsToTrajectory(actions: any[]): any {
    const jointNames = ['joint_1', 'joint_2', 'joint_3', 'joint_4', 'joint_5', 'joint_6', 'joint_7'];
    
    return {
      joint_names: jointNames,
      points: actions.map((action, i) => ({
        positions: action.jointCommands,
        velocities: new Array(7).fill(0),
        time_from_start: {
          sec: Math.floor(i * 0.02),
          nanosec: Math.floor((i * 0.02 % 1) * 1e9),
        },
      })),
    };
  }

  private setupSafetyWatchdog(): void {
    let lastCommandTime = Date.now();
    
    this.safetyWatchdog = setInterval(() => {
      if (Date.now() - lastCommandTime > 100) {
        // No command received in 100ms - execute safety stop
        this.executeSafetyStop();
      }
    }, 10);  // Check every 10ms
  }

  private async executeSafetyStop(): Promise<void> {
    console.warn('Safety watchdog triggered - executing hold position');
    // Send zero-velocity command to hold current position
    const holdTrajectory = {
      joint_names: ['joint_1', 'joint_2', 'joint_3', 'joint_4', 'joint_5', 'joint_6', 'joint_7'],
      points: [{
        positions: this.latestJointState,
        velocities: new Array(7).fill(0),
        time_from_start: { sec: 0, nanosec: 0 },
      }],
    };
    await this.executeTrajectory(holdTrajectory);
  }
}
```

---

## Safety considerations for production deployment

Deploying VLA models in industrial environments requires multiple safety layers.

### Safety architecture requirements

1. **Local safety controller (mandatory)**: Independent RTOS running at 1 kHz with:
   - Joint position/velocity/torque limits
   - Collision detection via force/torque sensing
   - Workspace boundary enforcement
   - Hardware E-stop integration

2. **Command validation layer**: Before executing any VLA-generated action:
   - Reject physically impossible commands
   - Rate-limit sudden direction changes
   - Verify actions within calibrated workspace

3. **Network watchdog configuration**:
   - Hardware watchdog: 50-100ms timeout
   - Software watchdog: 100-500ms for cloud commands
   - Fallback sequence: Hold position → Gentle stop → Safe retract

4. **Model validation pipeline**:
```
Simulation Testing (Isaac Sim) → HIL Testing → Single Robot Staging
         ↓                            ↓                ↓
    Unit tests per skill       Real-time verify    Human supervision
    Edge case coverage         Safety boundaries    Controlled environment
         ↓                            ↓                ↓
    Canary Deployment (5-10% fleet) → Full Fleet Rollout
         ↓                                    ↓
    Automatic metric monitoring         Gradual % increase
    Rollback triggers                   Continuous monitoring
```

---

## Implementation roadmap

### Phase 1: Infrastructure foundation (Weeks 1-4)

- Deploy PostgreSQL + Redis + RustFS storage cluster
- Set up MLflow tracking server
- Implement core database schema
- Create Node.js Express API skeleton
- Configure Kubernetes GPU node pool (4× A100)

### Phase 2: Training pipeline (Weeks 5-8)

- Implement BullMQ training job queue
- Build Python training workers with MLflow integration
- Create dataset upload and validation endpoints
- Implement WebSocket training progress streaming
- Deploy Prometheus + Grafana monitoring

### Phase 3: Inference infrastructure (Weeks 9-12)

- Deploy vLLM inference server with OpenVLA/π0
- Implement gRPC inference service
- Build robot-agent ROS 2 bridge
- Create action buffering and interpolation logic
- Implement safety watchdog system

### Phase 4: Fleet deployment (Weeks 13-16)

- Build model registry and versioning system
- Implement canary deployment pipeline
- Create A/B testing infrastructure
- Deploy to pilot robot fleet (5-10 units)
- Validate end-to-end skill training and deployment

### Phase 5: Production hardening (Weeks 17-20)

- Load testing with full fleet simulation
- Security audit and penetration testing
- GDPR compliance review for sensor data
- Documentation and operator training
- Production rollout

---

## Technology stack summary

| Component | Recommended Technology | Rationale |
|-----------|----------------------|-----------|
| **VLA Model** | π0 via OpenPI | Apache 2.0 licensing, production-ready |
| **Inference Server** | vLLM + gRPC | High throughput, batching, streaming |
| **Backend** | Node.js Express + TypeScript | Existing infrastructure, strong async |
| **Job Queue** | BullMQ + Redis | Native Node.js, persistent, priority |
| **Database** | PostgreSQL | Relational + JSONB flexibility |
| **Object Storage** | RustFS (S3-compatible) | Self-hosted, GDPR compliant |
| **ML Tracking** | MLflow | Open-source, comprehensive registry |
| **Data Format** | LeRobot v3 | Ecosystem standard, HF integration |
| **Monitoring** | Prometheus + Grafana | Industry standard, GPU metrics |
| **Container Orchestration** | Kubernetes | GPU scheduling, horizontal scaling |
| **ROS Bridge** | rclnodejs | Native Node.js ROS 2 client |

This architecture enables a German robotics-as-a-service company to build an enterprise-grade VLA-powered fleet management system—supporting natural language task specification, fleet-wide skill deployment, and continuous improvement through centralized training management.
