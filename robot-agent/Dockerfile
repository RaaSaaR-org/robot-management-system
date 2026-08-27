# ============================================================================
# NeoDEM Robot Agent Dockerfile
# Multi-stage build for Node.js + Genkit AI robot agent
# ============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Builder
# -----------------------------------------------------------------------------
# 24, and it has to be, for two independent reasons.
#
# The forcing one is `npm ci`. npm 10 (Node 20/22) and npm 11 (Node 24) disagree
# about optional peer dependencies, and this tree has one:
# `@dsnp/parquetjs@1.8.9` -> `@zenfs/core` -> `kerium` -> `utilium@3.5.1`, whose
# peer `@xterm/xterm@^6.0.0` is marked optional. npm 11 writes a lockfile that
# omits it; npm 10 reads that lockfile, decides it should be there, and refuses
# the whole install with "Missing: @xterm/xterm@6.0.0 from lock file". The
# top-level `utilium@2.8.8` does pull `@xterm/xterm@5.5.0`, which does not
# satisfy `^6.0.0`. `--omit=optional` does NOT avoid this; only
# `--legacy-peer-deps` or a Node 24 toolchain does.
#
# The second is that `node:20-alpine` is end-of-life and frozen — the tag has
# not been rebuilt since 2026-04-15, so it stopped receiving OS and OpenSSL
# patches. That alone is reason enough to move.
#
# `@dsnp/parquetjs` also declares `engines: { node: ">=24.18.0" }`. That is
# ADVISORY, not enforced — there is no `.npmrc` setting `engine-strict`, so npm
# only warns. It is a good reason, not a forcing one, and no image has ever
# actually shipped it on Node 20: parquetjs entered this tree in 506ad218
# (TASK-215), after the last published robot-agent image.
#
# check.yml was moved to 24 when this broke every push to main. This file was
# not, and nothing caught it: the image build runs only on a tag, so it stayed
# green until v2026.08.27 — where `Build Robot Agent Image` failed on exactly
# that error while the app and server images published. The server is unaffected
# and stays on 20: it resolves `@dsnp/parquetjs@1.8.7` (`engines: >=18.18.2`),
# `@zenfs/core@1.11.4` and a single `utilium@1.10.1`, with no `kerium` and no
# nested peer.
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
# Must match the builder — node_modules is copied across from it, so the two
# stages have to agree on the Node ABI.
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
