# VLA Inference Server Dockerfile
# Multi-stage build for Python gRPC server

# =============================================================================
# Stage 1: Builder - Install dependencies and generate proto code
# =============================================================================
FROM python:3.11-slim AS builder

WORKDIR /build

# Install system dependencies for proto compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY vla-inference/requirements.txt .
RUN pip install --no-cache-dir --target=/build/deps -r requirements.txt

# Copy proto file and generate Python code
COPY protos/vla_inference.proto /protos/
RUN mkdir -p /build/proto && \
    PYTHONPATH=/build/deps python -m grpc_tools.protoc \
    --proto_path=/protos \
    --python_out=/build/proto \
    --grpc_python_out=/build/proto \
    /protos/vla_inference.proto && \
    # Fix imports in generated gRPC file
    sed -i 's/import vla_inference_pb2/from . import vla_inference_pb2/' /build/proto/vla_inference_pb2_grpc.py && \
    # Create __init__.py
    echo 'from .vla_inference_pb2 import *' > /build/proto/__init__.py && \
    echo 'from .vla_inference_pb2_grpc import *' >> /build/proto/__init__.py

# =============================================================================
# Stage 2: Runtime - Minimal production image
# =============================================================================
FROM python:3.11-slim

WORKDIR /app

# Create non-root user (matching project pattern)
RUN useradd -u 1001 -m robomind

# Copy installed packages from builder
COPY --from=builder /build/deps /usr/local/lib/python3.11/site-packages

# Copy generated proto code
COPY --from=builder --chown=robomind:robomind /build/proto ./proto

# Copy application code
COPY --chown=robomind:robomind vla-inference/server.py .
COPY --chown=robomind:robomind vla-inference/servicer.py .
COPY --chown=robomind:robomind vla-inference/config.py .
COPY --chown=robomind:robomind vla-inference/metrics.py .
COPY --chown=robomind:robomind vla-inference/models ./models

# Switch to non-root user
USER robomind

# Expose gRPC port
EXPOSE 50051

# Health check using gRPC channel ready check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import grpc; ch = grpc.insecure_channel('localhost:50051'); grpc.channel_ready_future(ch).result(timeout=5)" || exit 1

# Run the server
CMD ["python", "server.py"]
