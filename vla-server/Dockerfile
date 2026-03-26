# ============================================================================
# NeoDEM VLA Server Dockerfile
# FastAPI inference server for Vision-Language-Action models
# ============================================================================

FROM python:3.11-slim

WORKDIR /app

# Install uv for fast dependency management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy project files
COPY pyproject.toml ./
COPY server.py ./
COPY models/ ./models/

# Install dependencies (stub mode by default — no torch/LeRobot needed)
RUN uv pip install --system -e "."

# Copy config template
COPY config.yaml.example ./config.yaml

# Non-root user
RUN useradd --system --uid 1001 neodem && \
    chown -R neodem:neodem /app
USER neodem

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=5)"

CMD ["python", "server.py"]
