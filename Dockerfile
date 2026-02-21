# ─── Build Stage ─────────────────────────────────
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files and install production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ─── Production Stage ────────────────────────────
FROM node:18-alpine

WORKDIR /app

# Create non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY package.json ./
COPY src/ ./src/
COPY public/ ./public/
COPY config/ ./config/

# Set ownership
RUN chown -R appuser:appgroup /app

USER appuser

# Cloud Run injects PORT env var (default 8080)
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "src/server.js"]
