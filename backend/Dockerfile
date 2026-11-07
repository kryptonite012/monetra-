# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------- deps
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# --------------------------------------------------------------- build
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ------------------------------------------------------------- runtime
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    UPLOAD_DIR=/data/uploads \
    REPORT_DIR=/data/reports
WORKDIR /app
RUN apk add --no-cache tini && addgroup -S monetra && adduser -S monetra -G monetra \
    && mkdir -p /data/uploads /data/reports && chown -R monetra:monetra /data
COPY --from=build --chown=monetra:monetra /app/node_modules ./node_modules
COPY --from=build --chown=monetra:monetra /app/dist ./dist
COPY --chown=monetra:monetra package.json ./
USER monetra
EXPOSE 4000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
# Apply pending migrations, then start the API.
CMD ["sh", "-c", "node dist/db/migrate.js latest && node dist/server.js"]
