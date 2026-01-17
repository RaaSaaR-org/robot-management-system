#!/usr/bin/env python3
"""
@file server.py
@description Async gRPC server for VLA inference
@feature vla
"""

import os
import asyncio
import logging
import signal
from typing import Optional

import grpc
from grpc import aio
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Import generated proto code
try:
    from proto import vla_inference_pb2_grpc
except ImportError as e:
    print("Proto files not generated. Run 'make proto' first.")
    print(f"Error: {e}")
    exit(1)

from servicer import VLAInferenceServicer
from config import get_config
from metrics import start_metrics_server, get_metrics

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


class VLAInferenceServer:
    """
    Async gRPC server for VLA inference.

    Configuration via environment variables:
        VLA_GRPC_PORT: Server port (default: 50051)
        VLA_MAX_WORKERS: Maximum concurrent workers (default: 4)
        VLA_MODEL_PATH: Path to VLA model checkpoint (optional)
        VLA_DEVICE: Device for inference (default: cuda)
    """

    def __init__(self):
        self.config = get_config()
        self.server: Optional[aio.Server] = None
        self.servicer: Optional[VLAInferenceServicer] = None
        self._shutdown_event = asyncio.Event()

    async def start(self) -> None:
        """Start the gRPC server."""
        self.config.log_config()

        # Initialize metrics before starting metrics server
        # This ensures metrics are registered to the default registry
        metrics = get_metrics()

        # Start metrics server if enabled
        if self.config.metrics_enabled:
            start_metrics_server(self.config.metrics_port)

        # Create servicer with config (will reuse same metrics instance)
        self.servicer = VLAInferenceServicer(config=self.config)

        # Configure server options
        max_message_bytes = self.config.max_message_size_mb * 1024 * 1024
        options = [
            # Max message size (for images)
            ("grpc.max_send_message_length", max_message_bytes),
            ("grpc.max_receive_message_length", max_message_bytes),
            # Keepalive settings
            ("grpc.keepalive_time_ms", 10000),
            ("grpc.keepalive_timeout_ms", 5000),
            ("grpc.keepalive_permit_without_calls", True),
            # HTTP/2 settings
            ("grpc.http2.min_recv_ping_interval_without_data_ms", 5000),
        ]

        # Create async server
        self.server = aio.server(
            options=options,
            maximum_concurrent_rpcs=self.config.max_workers * 10,
        )

        # Add servicer
        vla_inference_pb2_grpc.add_VLAInferenceServicer_to_server(
            self.servicer, self.server
        )

        # Bind to port
        listen_addr = f"[::]:{self.config.grpc_port}"
        self.server.add_insecure_port(listen_addr)

        # Start server
        await self.server.start()
        logger.info(f"VLA Inference Server running on port {self.config.grpc_port}")

        # Wait for shutdown
        await self._shutdown_event.wait()

    async def stop(self) -> None:
        """Stop the gRPC server gracefully."""
        logger.info("Shutting down VLA Inference Server...")

        if self.server:
            # Graceful shutdown with 5 second timeout
            await self.server.stop(5)

        if self.servicer:
            self.servicer.shutdown()

        self._shutdown_event.set()
        logger.info("Server shutdown complete")

    def request_shutdown(self) -> None:
        """Request server shutdown (for signal handlers)."""
        asyncio.create_task(self.stop())


async def main() -> None:
    """Main entry point."""
    server = VLAInferenceServer()

    # Setup signal handlers
    loop = asyncio.get_event_loop()

    def signal_handler():
        logger.info("Received shutdown signal")
        server.request_shutdown()

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, signal_handler)

    try:
        await server.start()
    except Exception as e:
        logger.error(f"Server error: {e}")
        raise


if __name__ == "__main__":
    asyncio.run(main())
