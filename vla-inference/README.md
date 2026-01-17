# VLA Inference Server

High-performance gRPC server for Vision-Language-Action (VLA) model inference. Provides low-latency action predictions for robot control with support for multiple VLA architectures.

## Overview

The VLA Inference Server enables real-time inference for vision-language-action models, translating camera observations and natural language instructions into robot joint commands. It supports both single predictions and continuous streaming control.

### Supported Models

| Model | Type | Description |
|-------|------|-------------|
| **π0.6** (`pi0`) | Foundation | Physical Intelligence's foundation model for general manipulation |
| **OpenVLA 7B** (`openvla`) | Open-source | Open-source VLA based on Llama-2 architecture |
| **GR00T** (`groot`) | Humanoid | NVIDIA's humanoid foundation model (future support) |

## Quick Start

```bash
# Install dependencies
make install

# Generate proto files
make proto

# Run the server
make run
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Robot Agent (Client)                      │
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   Camera     │    │   Joints     │    │ Instruction  │  │
│  │   Image      │    │  Positions   │    │    Text      │  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘  │
│         │                   │                   │           │
│         └───────────────────┼───────────────────┘           │
│                             ▼                               │
│                    ┌────────────────┐                       │
│                    │  gRPC Client   │                       │
│                    └────────┬───────┘                       │
└─────────────────────────────┼───────────────────────────────┘
                              │ Observation
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  VLA Inference Server                        │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   gRPC Servicer                      │   │
│  │  • Predict() - Single inference                      │   │
│  │  • StreamControl() - Continuous streaming            │   │
│  │  • GetModelInfo() - Model metadata                   │   │
│  │  • HealthCheck() - Server status                     │   │
│  └─────────────────────────┬───────────────────────────┘   │
│                            │                                │
│  ┌─────────────────────────▼───────────────────────────┐   │
│  │              Model-Agnostic Layer                    │   │
│  │                                                      │   │
│  │   ┌─────────┐   ┌─────────┐   ┌─────────┐          │   │
│  │   │  π0.6   │   │ OpenVLA │   │  GR00T  │          │   │
│  │   │  Model  │   │  Model  │   │  Model  │          │   │
│  │   └────┬────┘   └────┬────┘   └────┬────┘          │   │
│  │        └─────────────┼─────────────┘                │   │
│  │                      ▼                              │   │
│  │               ┌─────────────┐                       │   │
│  │               │  GPU/CUDA   │                       │   │
│  │               └─────────────┘                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─────────────────┐    ┌─────────────────┐                │
│  │   Prometheus    │    │  GPU Monitoring │                │
│  │    Metrics      │    │    (pynvml)     │                │
│  │   :9090         │    │                 │                │
│  └─────────────────┘    └─────────────────┘                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ ActionChunk
                    ┌──────────────────┐
                    │  Joint Commands  │
                    │  (8-16 actions)  │
                    └──────────────────┘
```

## API Reference

### gRPC Services

#### `Predict(Observation) → ActionChunk`
Single inference request. Takes an observation and returns an action chunk.

```protobuf
message Observation {
  bytes camera_image = 1;           // JPEG compressed image
  repeated float joint_positions = 2;
  repeated float joint_velocities = 3;
  string language_instruction = 4;  // e.g., "Pick up the cup"
  string embodiment_tag = 6;        // e.g., "unitree_h1"
}

message ActionChunk {
  repeated Action actions = 1;      // 8-16 future actions
  float inference_time_ms = 2;
  float confidence = 4;
}
```

#### `StreamControl(stream Observation) → stream ActionChunk`
Bidirectional streaming for continuous real-time control.

#### `GetModelInfo(Empty) → ModelInfo`
Returns metadata about the loaded model.

#### `HealthCheck(Empty) → HealthStatus`
Returns server health including GPU utilization and queue depth.

## Configuration

All configuration is via environment variables:

### Model Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `VLA_MODEL_TYPE` | `pi0` | Model to use: `pi0`, `openvla`, `groot` |
| `VLA_MODEL_PATH` | - | Path to model checkpoint |
| `VLA_DEVICE` | `cpu` | Device: `cpu`, `cuda`, `cuda:0` |

### Inference Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `VLA_BATCH_SIZE` | `1` | Maximum batch size |
| `VLA_CHUNK_SIZE` | `16` | Actions per chunk |
| `VLA_TIMEOUT_MS` | `5000` | Request timeout |
| `VLA_IMAGE_WIDTH` | `224` | Expected image width |
| `VLA_IMAGE_HEIGHT` | `224` | Expected image height |
| `VLA_ACTION_DIM` | `7` | Action space dimensionality |

### Server Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `VLA_GRPC_PORT` | `50051` | gRPC server port |
| `VLA_MAX_WORKERS` | `4` | Maximum concurrent workers |
| `VLA_MAX_MESSAGE_SIZE_MB` | `16` | Max gRPC message size |

### Metrics

| Variable | Default | Description |
|----------|---------|-------------|
| `VLA_METRICS_ENABLED` | `true` | Enable Prometheus metrics |
| `VLA_METRICS_PORT` | `9090` | Metrics HTTP port |

## Development

### Project Structure

```
vla-inference/
├── server.py          # Async gRPC server entry point
├── servicer.py        # gRPC service implementation
├── config.py          # Configuration management
├── metrics.py         # Prometheus metrics
├── models/
│   ├── __init__.py    # Model factory
│   ├── base.py        # Abstract base class
│   ├── pi0.py         # π0.6 model implementation
│   ├── openvla.py     # OpenVLA model implementation
│   └── groot.py       # GR00T model (stub)
├── proto/             # Generated protobuf code
├── tests/             # Unit tests
├── Dockerfile         # Multi-stage Docker build
├── Makefile           # Build automation
└── requirements.txt   # Python dependencies
```

### Make Commands

```bash
make install    # Install dependencies
make proto      # Generate Python proto files
make run        # Run the server
make test       # Run tests
make clean      # Clean generated files
make help       # Show available commands
```

### Running Tests

```bash
make test

# Or directly with pytest
pytest tests/ -v
```

### Adding a New Model

1. Create a new file in `models/` (e.g., `models/mymodel.py`)
2. Implement the `VLAModel` interface:

```python
from .base import VLAModel, ModelInfo, Observation, ActionChunk

class MyModel(VLAModel):
    def load(self, checkpoint_path: str, device: str) -> None:
        # Load model weights
        pass

    def predict(self, observation: Observation) -> ActionChunk:
        # Run inference
        pass

    @property
    def model_info(self) -> ModelInfo:
        return ModelInfo(
            model_name="my-model",
            model_version="1.0.0",
            action_dim=7,
            chunk_size=16,
            supported_embodiments=["unitree_h1"],
        )
```

3. Register in `models/__init__.py`:

```python
model_map = {
    "mymodel": MyModel,
    # ...
}
```

## Docker

### Building

```bash
# From repository root
docker build -f vla-inference/Dockerfile -t vla-inference:latest .
```

### Running

```bash
docker run -d \
  --name vla-inference \
  -p 50051:50051 \
  -p 9090:9090 \
  -e VLA_MODEL_TYPE=pi0 \
  -e VLA_DEVICE=cuda \
  --gpus all \
  vla-inference:latest
```

### With Kubernetes/Helm

The service is deployed via the RoboMindOS Helm chart:

```yaml
# values.yaml
vlaInference:
  enabled: true
  modelType: pi0
  device: cuda
  resources:
    limits:
      nvidia.com/gpu: 1
```

## Metrics

Prometheus metrics are exposed on port 9090 (configurable via `VLA_METRICS_PORT`).

### Available Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `vla_inference_latency_seconds` | Histogram | Inference latency by model/embodiment |
| `vla_inference_requests_total` | Counter | Total requests by model/status |
| `vla_batch_size` | Histogram | Batch size distribution |
| `vla_gpu_utilization_percent` | Gauge | GPU utilization % |
| `vla_gpu_memory_used_bytes` | Gauge | GPU memory used |
| `vla_gpu_memory_total_bytes` | Gauge | Total GPU memory |
| `vla_queue_depth` | Gauge | Current queue depth |
| `vla_uptime_seconds` | Gauge | Server uptime |
| `vla_model` | Info | Model name, version, device |

### Example Prometheus Queries

```promql
# Average inference latency (last 5 min)
rate(vla_inference_latency_seconds_sum[5m]) / rate(vla_inference_latency_seconds_count[5m])

# Request rate by model
rate(vla_inference_requests_total[1m])

# GPU memory utilization %
vla_gpu_memory_used_bytes / vla_gpu_memory_total_bytes * 100
```

## Integration with Robot Agent

The robot agent connects to this server via gRPC:

```typescript
// robot-agent/src/vla/VLAClient.ts
const client = new VLAInferenceClient('vla-inference:50051');

// Single prediction
const actionChunk = await client.predict({
  cameraImage: imageBuffer,
  jointPositions: [0.1, 0.2, ...],
  languageInstruction: "Pick up the red cup",
  embodimentTag: "unitree_h1",
});

// Execute actions
for (const action of actionChunk.actions) {
  await robot.executeAction(action.jointCommands);
}
```

## Performance Tuning

### GPU Optimization

1. **Use CUDA device**: Set `VLA_DEVICE=cuda` for GPU inference
2. **Batch requests**: Increase `VLA_BATCH_SIZE` for throughput
3. **Enable TensorRT**: Compile models with TensorRT for faster inference
4. **Use FP16**: Enable mixed-precision inference for 2x speedup

### Latency Optimization

1. **Keep model warm**: Send periodic dummy requests
2. **Use streaming**: `StreamControl` eliminates per-request overhead
3. **Tune chunk size**: Larger chunks reduce inference frequency
4. **Place near robots**: Deploy close to robot agents to minimize network latency

### Memory Management

1. **Monitor GPU memory**: Watch `vla_gpu_memory_used_bytes`
2. **Set memory limits**: Configure container memory limits
3. **Unload unused models**: Only load required model type

## Troubleshooting

### Common Issues

**Proto files not generated**
```
Error: Proto files not generated. Run 'make proto' first.
```
Solution: `make proto`

**CUDA out of memory**
```
RuntimeError: CUDA out of memory
```
Solutions:
- Reduce `VLA_BATCH_SIZE`
- Use smaller model (e.g., quantized)
- Increase GPU memory

**gRPC connection refused**
```
grpc._channel._InactiveRpcError: Connection refused
```
Solutions:
- Check server is running: `docker ps`
- Verify port: `netstat -tlnp | grep 50051`
- Check firewall rules

### Health Check

```bash
# Check server health via gRPC
python -c "
import grpc
from proto import vla_inference_pb2, vla_inference_pb2_grpc

channel = grpc.insecure_channel('localhost:50051')
stub = vla_inference_pb2_grpc.VLAInferenceStub(channel)
status = stub.HealthCheck(vla_inference_pb2.Empty())
print(f'Ready: {status.ready}')
print(f'GPU Util: {status.gpu_utilization}%')
print(f'Uptime: {status.uptime_seconds}s')
"
```

## License

Part of RoboMindOS. See repository root for license information.
