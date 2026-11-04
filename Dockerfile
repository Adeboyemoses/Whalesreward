# Keep these exact versions in sync with .nvmrc and package.json.
FROM node:26.12.0-bookworm-slim AS base
ENV TZ=UTC NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install --yes --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@10.17.1
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml .nvmrc ./
RUN test "$(cat .nvmrc)" = "$(node --version | cut -c 2-)" \
    && test "$(node -p 'require("./package.json").packageManager')" = "pnpm@$(pnpm --version)" \
    && pnpm install --frozen-lockfile \
    && pnpm exec prisma --version

FROM dependencies AS build
COPY next.config.ts tsconfig.json postcss.config.mjs ./
COPY src ./src
COPY public ./public
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0
# Prisma CLI and pg are intentionally included for migration and seed jobs.
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=dependencies --chown=node:node /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/next.config.ts ./next.config.ts
COPY --from=build --chown=node:node /app/public ./public
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node prisma.config.ts ./prisma.config.ts
COPY --chown=node:node scripts/deploy/entrypoint.mjs ./scripts/deploy/entrypoint.mjs
USER node
EXPOSE 8080
ENTRYPOINT ["node", "scripts/deploy/entrypoint.mjs"]
CMD ["pnpm", "start", "--hostname", "0.0.0.0", "--port", "8080"]
