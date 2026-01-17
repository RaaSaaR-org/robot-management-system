"""
@file metrics.py
@description Prometheus metrics for VLA inference server
@feature vla-inference
"""

import time
import logging
from typing import Optional
from contextlib import contextmanager

logger = logging.getLogger(__name__)

# Try to import prometheus_client, provide fallback if not available
try:
    from prometheus_client import (
        Histogram,
        Counter,
        Gauge,
        Info,
        generate_latest,
        CONTENT_TYPE_LATEST,
        CollectorRegistry,
        start_http_server,
    )
    PROMETHEUS_AVAILABLE = True
except ImportError:
    PROMETHEUS_AVAILABLE = False
    logger.warning("prometheus_client not installed, metrics disabled")


class VLAMetrics:
    """
    Prometheus metrics collector for VLA inference.
    
    Provides metrics for:
    - Inference latency (histogram with buckets)
    - Request counts by status
    - GPU utilization and memory
    - Batch size distribution
    - Model information
    """
    
    def __init__(self, registry: Optional['CollectorRegistry'] = None):
        """
        Initialize metrics collectors.

        Args:
            registry: Optional custom registry (for testing). If None, uses default.
        """
        if not PROMETHEUS_AVAILABLE:
            self._enabled = False
            return

        self._enabled = True
        self._registry = registry

        # Build kwargs - only include registry if explicitly provided
        # (passing registry=None disables registration, not passing uses default)
        reg_kwargs = {'registry': registry} if registry is not None else {}

        # Latency buckets optimized for VLA inference (20-200ms typical)
        latency_buckets = (
            0.005, 0.01, 0.02, 0.03, 0.04, 0.05, 0.075,
            0.1, 0.15, 0.2, 0.3, 0.5, 1.0, 2.0, 5.0
        )

        # Inference latency histogram
        self.inference_latency = Histogram(
            'vla_inference_latency_seconds',
            'VLA inference latency in seconds',
            ['model_type', 'embodiment'],
            buckets=latency_buckets,
            **reg_kwargs,
        )

        # Request counter
        self.requests_total = Counter(
            'vla_inference_requests_total',
            'Total VLA inference requests',
            ['model_type', 'status'],
            **reg_kwargs,
        )
        
        # Batch size histogram
        self.batch_size = Histogram(
            'vla_batch_size',
            'Inference batch size distribution',
            ['model_type'],
            buckets=(1, 2, 4, 8, 16, 32, 64),
            **reg_kwargs,
        )

        # GPU metrics (gauges)
        self.gpu_utilization = Gauge(
            'vla_gpu_utilization_percent',
            'GPU utilization percentage',
            **reg_kwargs,
        )

        self.gpu_memory_used = Gauge(
            'vla_gpu_memory_used_bytes',
            'GPU memory used in bytes',
            **reg_kwargs,
        )

        self.gpu_memory_total = Gauge(
            'vla_gpu_memory_total_bytes',
            'Total GPU memory in bytes',
            **reg_kwargs,
        )

        # Queue metrics
        self.queue_depth = Gauge(
            'vla_queue_depth',
            'Current inference queue depth',
            **reg_kwargs,
        )

        # Model info
        self.model_info = Info(
            'vla_model',
            'Currently loaded VLA model information',
            **reg_kwargs,
        )

        # Server uptime
        self._start_time = time.time()
        self.uptime = Gauge(
            'vla_uptime_seconds',
            'Server uptime in seconds',
            **reg_kwargs,
        )
        
    @contextmanager
    def measure_latency(self, model_type: str, embodiment: str):
        """
        Context manager to measure inference latency.
        
        Usage:
            with metrics.measure_latency("pi0", "unitree_h1"):
                result = model.predict(observation)
        """
        if not self._enabled:
            yield
            return
            
        start = time.perf_counter()
        try:
            yield
            self.requests_total.labels(
                model_type=model_type, 
                status='success'
            ).inc()
        except Exception:
            self.requests_total.labels(
                model_type=model_type, 
                status='error'
            ).inc()
            raise
        finally:
            latency = time.perf_counter() - start
            self.inference_latency.labels(
                model_type=model_type,
                embodiment=embodiment,
            ).observe(latency)
            
    def record_request(self, model_type: str, status: str) -> None:
        """Record a request with status."""
        if not self._enabled:
            return
        self.requests_total.labels(model_type=model_type, status=status).inc()
        
    def record_batch(self, model_type: str, size: int) -> None:
        """Record batch size."""
        if not self._enabled:
            return
        self.batch_size.labels(model_type=model_type).observe(size)
        
    def update_gpu_stats(
        self,
        utilization: float,
        memory_used: int,
        memory_total: int,
    ) -> None:
        """Update GPU metrics."""
        if not self._enabled:
            return
        self.gpu_utilization.set(utilization)
        self.gpu_memory_used.set(memory_used)
        self.gpu_memory_total.set(memory_total)
        
    def update_queue_depth(self, depth: int) -> None:
        """Update queue depth metric."""
        if not self._enabled:
            return
        self.queue_depth.set(depth)
        
    def set_model_info(
        self,
        model_name: str,
        model_version: str,
        base_model: str,
        device: str,
    ) -> None:
        """Set model information."""
        if not self._enabled:
            return
        self.model_info.info({
            'model_name': model_name,
            'model_version': model_version,
            'base_model': base_model,
            'device': device,
        })
        
    def update_uptime(self) -> None:
        """Update uptime metric."""
        if not self._enabled:
            return
        self.uptime.set(time.time() - self._start_time)
        
    def get_uptime_seconds(self) -> float:
        """Get server uptime in seconds."""
        return time.time() - self._start_time
        
    def generate_metrics(self) -> bytes:
        """Generate Prometheus metrics output."""
        if not self._enabled:
            return b"# Metrics disabled\n"
            
        self.update_uptime()
        if self._registry:
            return generate_latest(self._registry)
        return generate_latest()
        
    @property
    def content_type(self) -> str:
        """Get Prometheus content type header."""
        if not self._enabled:
            return "text/plain"
        return CONTENT_TYPE_LATEST


# Global metrics instance
_metrics: Optional[VLAMetrics] = None


def get_metrics() -> VLAMetrics:
    """Get global metrics instance."""
    global _metrics
    if _metrics is None:
        _metrics = VLAMetrics()
    return _metrics


def start_metrics_server(port: int = 9090) -> None:
    """
    Start Prometheus metrics HTTP server.
    
    Args:
        port: Port to serve metrics on
    """
    if not PROMETHEUS_AVAILABLE:
        logger.warning("Cannot start metrics server: prometheus_client not installed")
        return
        
    try:
        start_http_server(port)
        logger.info(f"Prometheus metrics server started on port {port}")
    except Exception as e:
        logger.error(f"Failed to start metrics server: {e}")
