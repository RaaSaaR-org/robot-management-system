# ============================================================================
# RoboMindOS Robot Agent Dockerfile
# Multi-stage build for Node.js + Genkit AI robot agent
# ============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Builder
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

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
FROM node:20-alpine AS runner

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
    adduser --system --uid 1001 robomind && \
    chown -R robomind:nodejs /app

USER robomind

# Expose port
EXPOSE 41243

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:41243/api/v1/health || exit 1

# Start robot agent
CMD ["npm", "start"]
