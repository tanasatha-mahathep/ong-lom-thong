# build context = repo root (.railway/railway.ts → dockerfilePath: apps/api/Dockerfile)
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
ENV HUSKY=0 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# เวอร์ชัน pnpm มาจาก packageManager ใน package.json ที่เดียว (Renovate อัปเดตที่นั่น)
RUN corepack install
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @ong/web build && pnpm --filter @ong/api build
RUN pnpm --filter @ong/api deploy --prod --legacy /out

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out/dist ./dist
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/web/dist ./public
# dist/migrate.js อ่านจากที่นี่ (Railway preDeployCommand)
COPY --from=build /repo/packages/db/migrations ./migrations
USER node
EXPOSE 8787
CMD ["node", "--enable-source-maps", "dist/index.js"]
