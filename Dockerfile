# ─────────────────────────────────────────────────────────────────
#  NetFlow Globe v2 — Dockerfile
#
#  Single-stage build (no npm deps means no build stage needed).
#  Final image: node:22-alpine  ~130 MB
# ─────────────────────────────────────────────────────────────────

FROM node:22-alpine

# Security: run as non-root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy source — package.json first so layer cache works if code changes
#COPY package.json ./

# No npm install needed — zero external dependencies

# Copy application source
COPY config.js      ./
COPY server.js      ./
COPY modules/       ./modules/
COPY public/        ./public/

# Data directory is mounted as a volume at runtime.
# Create it here so the container starts cleanly even without a mount.
RUN mkdir -p /data && chown appuser:appgroup /data

# Switch to non-root user
USER appuser

# ── Environment variable defaults ────────────────────────────────
# All can be overridden in docker-compose.yml or with -e flags.
ENV NODE_ENV=production \
    PORT=3000 \
    NTOP_HOST=ntop.example.com \
    NTOP_USER=admin \
    NTOP_PASS=password123 \
    NTOP_COOKIE="" \
    POLL_MS=3000 \
    DATA_DIR=/data \
    HOME_LAT=10.8505 \
    HOME_LON=76.2711 \
    DEFAULT_IFID=0 \
    DEFAULT_LENGTH=50 \
    DEFAULT_PROTO=tcp

EXPOSE 3000

# Graceful shutdown
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/status || exit 1

CMD ["node", "server.js"]
