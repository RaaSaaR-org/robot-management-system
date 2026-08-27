# ============================================================================
# NeoDEM Robot Agent Dockerfile
# Multi-stage build for Node.js + Genkit AI robot agent
# ============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Builder
# -----------------------------------------------------------------------------
# 24, and it has to be — the same reason .github/workflows/check.yml pins the
# robot-agent job to 24 rather than 22. `@dsnp/parquetjs@1.8.9` declares
# `engines: { node: ">=24.18.0" }`, and npm 10 (Node 20/22) and npm 11 (Node 24)
# disagree about optional peer dependencies. This tree has one:
# `@dsnp/parquetjs` -> `@zenfs/core` -> `kerium` -> `utilium@3.5.1`, whose
# optional peer is `@xterm/xterm@^6.0.0`. npm 11 writes a lockfile that omits
# it; npm 10 reads that lockfile, decides it should be there, and refuses the
# whole install with "Missing: @xterm/xterm@6.0.0 from lock file".
#
# check.yml was moved to 24 when this broke every push to main. This file was
# not, and nothing caught it: the image build only runs on a tagged release, so
# it stayed green until v2026.08.27 — where `Build Robot Agent Image` failed on
# exactly that error while the app and server images published. The server is
# unaffected and stays on 20: it resolves `@dsnp/parquetjs@1.8.7`
# (`engines: >=18.18.2`) and a single `utilium@1.10.1`, with no nested peer.
FROM node:24-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: Runner
# -----------------------------------------------------------------------------
# Must match the builder: node_modules is copied across from it, and
# `@dsnp/parquetjs` will not run on 20 whatever installed it.
FROM node:24-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy built assets and dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
# Copy prompts directory (Genkit loads these at runtime)
COPY --from=builder /app/src/prompts ./dist/prompts

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 neodem && \
    chown -R neodem:nodejs /app

USER neodem

# Expose port
EXPOSE 41243

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:41243/api/v1/health || exit 1

# Start robot agent
CMD ["npm", "start"]
