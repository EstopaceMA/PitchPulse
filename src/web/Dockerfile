# syntax=docker/dockerfile:1
# PitchPulse production image: the Next.js standalone server on Node 24 (output: "standalone" in next.config.ts).
# azd builds it in Azure Container Registry; see "Deploy to Azure" in README.md.
FROM node:24-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Each image gets its own deployment ID, so open tabs reload cleanly after a redeploy.
ARG DEPLOYMENT_VERSION
RUN DEPLOYMENT_VERSION="${DEPLOYMENT_VERSION:-$(date +%s)}" npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 8080
# Platforms may set HOSTNAME to the replica name; listen on every interface and let node receive signals.
CMD ["sh", "-c", "HOSTNAME=0.0.0.0 exec node server.js"]
