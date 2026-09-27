# Debian-slim (glibc) Node LTS. npm 11 (bundled with Node 24) avoids an npm 10
# install bug with this dependency tree.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
RUN npm run build

FROM build AS prod-deps
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/package.json ./
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# SQL migrations, applied by the one-shot "migrate" service (dist/database/run-migrations.js).
COPY --from=build --chown=node:node /app/drizzle ./drizzle
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
