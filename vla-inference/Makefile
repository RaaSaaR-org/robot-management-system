# VLA Inference Server Makefile

.PHONY: all proto install dev run test clean help

# Default target
all: install proto

# Generate Python proto files
proto:
	@echo "Generating Python proto files..."
	python3 -m grpc_tools.protoc \
		--proto_path=../protos \
		--python_out=proto \
		--grpc_python_out=proto \
		../protos/vla_inference.proto
	@# Fix imports in generated grpc file
	@sed -i 's/import vla_inference_pb2/from . import vla_inference_pb2/' proto/vla_inference_pb2_grpc.py 2>/dev/null || \
		sed -i '' 's/import vla_inference_pb2/from . import vla_inference_pb2/' proto/vla_inference_pb2_grpc.py
	@# Create __init__.py
	@echo 'from .vla_inference_pb2 import *' > proto/__init__.py
	@echo 'from .vla_inference_pb2_grpc import *' >> proto/__init__.py
	@echo "Proto files generated in proto/"

# Install dependencies
install:
	pip install -r requirements.txt

# Install dev dependencies
dev: install
	pip install pytest pytest-asyncio

# Run the server
run: proto
	python server.py

# Run tests
test: proto
	pytest tests/ -v

# Clean generated files
clean:
	rm -f proto/vla_inference_pb2.py
	rm -f proto/vla_inference_pb2_grpc.py
	rm -f proto/__init__.py
	rm -rf __pycache__
	rm -rf proto/__pycache__
	rm -rf .pytest_cache

# Help
help:
	@echo "VLA Inference Server"
	@echo ""
	@echo "Usage:"
	@echo "  make proto    - Generate Python proto files"
	@echo "  make install  - Install dependencies"
	@echo "  make dev      - Install dev dependencies"
	@echo "  make run      - Run the server"
	@echo "  make test     - Run tests"
	@echo "  make clean    - Clean generated files"
	@echo ""
	@echo "Environment variables:"
	@echo "  VLA_GRPC_PORT      - Server port (default: 50051)"
	@echo "  VLA_MAX_WORKERS    - Max concurrent workers (default: 4)"
	@echo "  VLA_MODEL_PATH     - Path to VLA model checkpoint"
	@echo "  VLA_DEVICE         - Device for inference (default: cuda)"
