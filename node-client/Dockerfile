FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 oracle

COPY --from=builder /app/dist          ./dist
COPY --from=deps    /app/node_modules  ./node_modules
COPY --from=builder /app/package.json  ./
COPY --from=builder /app/config        ./config

USER oracle

ENV NODE_ENV=production
ENV HEALTH_PORT=9464

EXPOSE 9464

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O - "http://127.0.0.1:${HEALTH_PORT}/healthz" > /dev/null 2>&1 || exit 1

CMD ["node", "dist/index.js"]