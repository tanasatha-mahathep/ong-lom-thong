# build context = repo root (railway.json → dockerfilePath: apps/api/Dockerfile)
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.18.2 --activate
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @ong/web build && pnpm --filter @ong/api build
RUN pnpm --filter @ong/api deploy --prod --legacy /out

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out/dist ./dist
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/web/dist ./public
EXPOSE 8787
CMD ["node", "dist/index.js"]
