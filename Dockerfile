# exec-hangars web server (TanStack Start on Bun).
#   docker build -t exec-hangars .
#   docker run -d -p 3000:3000 -e ADMIN_TOKEN=... -v exec-hangars-data:/data exec-hangars

ARG BUN_VERSION=1.4.4

# ---- build ----
FROM oven/bun:${BUN_VERSION}-slim AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun test && bun run build

# ---- production dependencies only ----
FROM oven/bun:${BUN_VERSION}-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

# ---- runtime ----
FROM oven/bun:${BUN_VERSION}-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY scripts/serve.ts ./scripts/serve.ts
RUN mkdir -p /data && chown bun:bun /data
USER bun
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/time').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["bun", "scripts/serve.ts"]
