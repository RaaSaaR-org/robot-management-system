#!/bin/bash
#
# @file build.sh
# @description Generates JavaScript/TypeScript and Python code from Protocol Buffer definitions
# @feature vla

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check for required tools
check_requirements() {
    log_info "Checking requirements..."

    # Check for protoc
    if ! command -v protoc &> /dev/null; then
        log_error "protoc is not installed. Please install Protocol Buffers compiler."
        log_info "  Ubuntu/Debian: sudo apt install protobuf-compiler"
        log_info "  macOS: brew install protobuf"
        exit 1
    fi

    # Check for grpc_tools_node_protoc_plugin (optional, we use proto-loader instead)
    # Node.js uses @grpc/proto-loader for dynamic loading, no code gen needed

    # Check for Python grpcio-tools
    if ! python3 -c "import grpc_tools.protoc" 2>/dev/null; then
        log_warn "grpcio-tools not found. Installing for Python code generation..."
        pip3 install grpcio-tools --quiet
    fi

    log_info "All requirements satisfied."
}

# Generate Python code
generate_python() {
    local output_dir="${PROJECT_ROOT}/vla-inference/proto"

    log_info "Generating Python code..."

    # Create output directory
    mkdir -p "$output_dir"

    # Generate Python protobuf and gRPC code
    python3 -m grpc_tools.protoc \
        --proto_path="$SCRIPT_DIR" \
        --python_out="$output_dir" \
        --grpc_python_out="$output_dir" \
        "$SCRIPT_DIR/vla_inference.proto"

    # Create __init__.py for proper Python package
    cat > "$output_dir/__init__.py" << 'EOF'
"""
@file __init__.py
@description Generated Protocol Buffer code for VLA inference
@feature vla
"""

from .vla_inference_pb2 import (
    Observation,
    ActionChunk,
    Action,
    ModelInfo,
    HealthStatus,
    Empty,
)
from .vla_inference_pb2_grpc import (
    VLAInferenceServicer,
    VLAInferenceStub,
    add_VLAInferenceServicer_to_server,
)

__all__ = [
    "Observation",
    "ActionChunk",
    "Action",
    "ModelInfo",
    "HealthStatus",
    "Empty",
    "VLAInferenceServicer",
    "VLAInferenceStub",
    "add_VLAInferenceServicer_to_server",
]
EOF

    # Fix imports in generated gRPC file (common issue with grpc_tools)
    sed -i 's/import vla_inference_pb2/from . import vla_inference_pb2/' "$output_dir/vla_inference_pb2_grpc.py" 2>/dev/null || \
    sed -i '' 's/import vla_inference_pb2/from . import vla_inference_pb2/' "$output_dir/vla_inference_pb2_grpc.py"

    log_info "Python code generated in $output_dir"
}

# Copy proto to robot-agent for dynamic loading
copy_for_nodejs() {
    local output_dir="${PROJECT_ROOT}/robot-agent/src/vla/proto"

    log_info "Copying proto file for Node.js dynamic loading..."

    # Create output directory
    mkdir -p "$output_dir"

    # Copy proto file (Node.js uses @grpc/proto-loader for dynamic loading)
    cp "$SCRIPT_DIR/vla_inference.proto" "$output_dir/"

    log_info "Proto file copied to $output_dir"
}

# Main
main() {
    log_info "Starting proto code generation..."
    log_info "Proto directory: $SCRIPT_DIR"
    log_info "Project root: $PROJECT_ROOT"

    check_requirements

    # Create vla-inference directory if it doesn't exist
    mkdir -p "${PROJECT_ROOT}/vla-inference"

    generate_python
    copy_for_nodejs

    log_info "Proto code generation complete!"
    echo ""
    log_info "Generated files:"
    echo "  - vla-inference/proto/vla_inference_pb2.py"
    echo "  - vla-inference/proto/vla_inference_pb2_grpc.py"
    echo "  - vla-inference/proto/__init__.py"
    echo "  - robot-agent/src/vla/proto/vla_inference.proto"
}

main "$@"
