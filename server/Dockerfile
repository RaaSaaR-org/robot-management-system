# ============================================================================
# NeoDEM Server Dockerfile
# Multi-stage build for Node.js Express + Prisma server
# ============================================================================

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

# Switch Prisma provider to PostgreSQL for production build
RUN sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma

# Generate Prisma client (must happen before TypeScript build)
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: Runner
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy built assets and dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma

# Run as the base image's `node` user, UID/GID 1000 — the UID both Helm
# charts force (`securityContext.runAsUser: 1000`). A UID of its own (it was
# 1001) left /app owned by someone else in the cluster, so every write under
# /app/data failed with EACCES (TASK-351).
RUN mkdir -p /app/data && chown -R node:node /app

USER node

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Start server (runs Prisma migrations, then starts Node.js)
CMD ["npm", "run", "start:prod"]
