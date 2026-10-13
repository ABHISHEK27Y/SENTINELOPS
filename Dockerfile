# Backend deliberately executes TypeScript using production tsx.
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.json tsconfig.tests.json eslint.config.mjs ./
COPY packages ./packages
COPY services ./services
COPY control-plane ./control-plane
COPY apps ./apps
COPY docs/runbooks ./docs/runbooks
COPY infrastructure/db ./infrastructure/db
RUN npm ci --no-audit --no-fund
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_WS_URL=ws://localhost:4000/ws
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL NEXT_TELEMETRY_DISABLED=1
RUN npm run build
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22-alpine AS runner
RUN apk add --no-cache curl dumb-init \
    && addgroup -g 1001 -S nodejs \
    && adduser -S nodejs -u 1001 -G nodejs
WORKDIR /app
COPY --from=builder --chown=nodejs:nodejs /app ./
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
USER nodejs
EXPOSE 8080 8081 8082 8083 8084 8090 8091 8095 4000 3000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "--version"]
