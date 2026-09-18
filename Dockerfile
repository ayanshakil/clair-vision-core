# Builds the app as a standalone Node server (via Nitro's node-server preset)
# instead of the Cloudflare Worker build used by `wrangler deploy`.

FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
ENV NITRO_PRESET=node-server
RUN bun run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/.output ./.output

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
