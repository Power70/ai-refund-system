# Debian-slim (glibc) rather than Alpine: avoids native-engine/OpenSSL issues
# with Prisma, which is added in the next build step.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Full toolchain (dev dependencies included). Later reused as the one-shot
# "migrate" service image, which needs the Prisma CLI.
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
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
