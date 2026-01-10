# ============================================================================
# RoboMindOS App Dockerfile
# Multi-stage build for React + Vite frontend served by nginx
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
# Stage 2: Runner (nginx)
# -----------------------------------------------------------------------------
FROM nginx:alpine AS runner

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
