# syntax=docker/dockerfile:1.7
#
# CodeCinema frontend — Next.js standalone output.
#
# The image is deliberately self-contained: Monaco Editor (and its language
# workers) are served from `public/monaco/vs`, which is copied during
# `npm ci` by `scripts/copy-monaco.mjs`. Nothing is fetched from a CDN at
# runtime, which is what lets the video-export renderer work inside a
# network-restricted container.

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---------------------------------------------------------------- deps
FROM base AS deps
COPY package.json package-lock.json* ./
COPY scripts ./scripts
RUN npm ci --no-audit --no-fund

# ------------------------------------------------------------- builder
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `output: standalone` needs the public/ directory to exist.
RUN mkdir -p public
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL:-http://localhost:8000}
RUN npm run build

# -------------------------------------------------------------- runner
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
