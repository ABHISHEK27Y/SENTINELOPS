# Shared image for all Node/TypeScript services in the monorepo.
# One build, many services: docker-compose overrides `command` per service to run
# `npm run start -w @sentinelops/<name>`. Dev-oriented (runs via tsx); a multi-stage
# tsc build for lean production images is a Phase 19 hardening step (see ADR-0002).
FROM node:22-alpine

# curl for container healthchecks.
RUN apk add --no-cache curl

WORKDIR /app

# Manifests + tsconfig first. Copying every workspace's package.json (via the full
# packages/ and services/ trees) lets `npm install` link the workspace graph.
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY services ./services
COPY apps ./apps
# The platform API indexes these runbooks for RAG at runtime.
COPY docs/runbooks ./docs/runbooks
COPY infrastructure/db ./infrastructure/db

# Install the whole workspace (respects root `overrides`).
RUN npm install --no-audit --no-fund

# Data-plane 8080–8084, control-plane 8090–8095, api 4000, web 3000.
EXPOSE 8080 8081 8082 8083 8084 8090 8091 8095 4000 3000

# Overridden per service in docker-compose.yml.
CMD ["node", "--version"]
