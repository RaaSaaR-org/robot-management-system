# ============================================================================
# NeoDEM App Dockerfile
# Multi-stage build for React + Vite frontend served by nginx
#
# The build context is app/, but the in-app documentation viewer (/docs) inlines
# the repository's docs/ folder at build time, and docs/ lives beside app/,
# outside the context. It comes in through the `docs` stage below:
#
#   - Given a NAMED build context, that is used — the docs of this checkout:
#       docker build --build-context docs=../docs -t neodem-app .     (from app/)
#     docker-compose.yml and scripts/e2e-k3d/up.sh pass it. A named context
#     replaces a stage of the same name.
#   - Otherwise the stage fetches docs/ of DOCS_GIT_REF from the repository, so
#     a plain `docker build ./app` (what .github/workflows/build-images.yml
#     runs) still ships the docs rather than an empty viewer (TASK-486).
#
# Either way the build fails if no README.md arrives, instead of producing an
# image whose help button opens an empty page.
# ============================================================================

# -----------------------------------------------------------------------------
# Stage 0: Docs (replaced by `--build-context docs=<dir>` when one is given)
# -----------------------------------------------------------------------------
FROM scratch AS docs
ARG DOCS_GIT_URL=https://github.com/RaaSaaR-org/robot-management-system.git
ARG DOCS_GIT_REF=main
ADD ${DOCS_GIT_URL}#${DOCS_GIT_REF}:docs /

# -----------------------------------------------------------------------------
# Stage 1: Builder
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# The docs the viewer bundles: ../docs relative to the app, as in the repo.
# app/.dockerignore drops *.md from the app context; it does not apply here.
COPY --from=docs / /docs
RUN test -f /docs/README.md

# Build arguments for Vite environment variables
ARG VITE_API_BASE_URL=http://localhost:3001/api
ARG VITE_WS_URL=ws://localhost:3001/api/a2a/ws
ARG VITE_A2A_SERVER_URL=http://localhost:3001

# Set environment variables for build
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_A2A_SERVER_URL=$VITE_A2A_SERVER_URL

# Build the application
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: Runner (nginx, rootless)
# -----------------------------------------------------------------------------
# nginxinc/nginx-unprivileged runs as a non-root UID and listens on 8080, so
# the image works under restricted PodSecurity (runAsNonRoot / arbitrary UID).
FROM nginxinc/nginx-unprivileged:alpine AS runner

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config as a template — the base image entrypoint runs envsubst on
# /etc/nginx/templates/*.template at startup, injecting API_UPSTREAM.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Backend the /api + A2A routes proxy to. Override per deployment
# (e.g. API_UPSTREAM=neodem-server:3001 in Kubernetes).
ENV API_UPSTREAM=server:3001

# Expose port (non-root nginx binds 8080)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Base image entrypoint renders templates then starts nginx.
CMD ["nginx", "-g", "daemon off;"]
