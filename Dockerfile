# =============================================================================
# SentinelOps — Multi-stage production Dockerfile
# Stage 1: Install all workspace dependencies (cached layer)
# Stage 2: Build TypeScript (separate layer for faster rebuilds)
# Stage 3: Minimal runtime image with non-root user
# =============================================================================

# ---- STAGE 1: Dependency installation ---------------------------------------
FROM node:22-alpine AS deps

# Install curl for healthchecks + dumb-init for proper signal handling
RUN apk add --no-cache curl dumb-init

WORKDIR /app

# Copy only manifests first (maximizes cache hits)
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY services ./services
COPY apps ./apps

# Install production dependencies only (respects root `overrides`)
# --ignore-scripts skips lifecycle scripts for speed
RUN npm install --no-audit --no-fund --ignore-scripts --omit=dev

# ---- STAGE 2: TypeScript build ---------------------------------------------
FROM deps AS builder

# Copy source files needed for build
COPY docs/runbooks ./docs/runbooks
COPY infrastructure/db ./infrastructure/db

# Build all packages/services (outputs to each package's dist/ via tsc)
# Requires "build": "tsc -p tsconfig.json" in root package.json
RUN npm run build

# ---- STAGE 3: Production runtime -------------------------------------------
FROM node:22-alpine AS runner

# Create non-root user/group for security
RUN apk add --no-cache curl dumb-init \
    && addgroup -g 1001 -S nodejs \
    && adduser -S nodejs -u 1001 -G nodejs

WORKDIR /app

# Copy built artifacts + production node_modules from builder
# Using --chown to avoid USER switch chown overhead
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/packages ./packages
COPY --from=builder --chown=nodejs:nodejs /app/services ./services
COPY --from=builder --chown=nodejs:nodejs /app/apps ./apps
COPY --from=builder --chown=nodejs:nodejs /app/docs/runbooks ./docs/runbooks
COPY --from=builder --chown=nodejs:nodejs /app/infrastructure/db ./infrastructure/db

# Copy package.json for runtime metadata (version, etc.)
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./package.json

# Switch to non-root user
USER nodejs

# Expose all service ports (data-plane 8080-8084, control-plane 8090-8095, api 4000, web 3000)
EXPOSE 8080 8081 8082 8083 8084 8090 8091 8095 4000 3000

# Use dumb-init to reap zombie processes and forward signals properly
ENTRYPOINT ["dumb-init", "--"]

# Default command (overridden per service in docker-compose.yml)
CMD ["node", "--version"]