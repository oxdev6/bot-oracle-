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

CMD ["node", "dist/index.js"]