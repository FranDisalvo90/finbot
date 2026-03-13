FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Install dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json packages/api/
COPY packages/dashboard/package.json packages/dashboard/
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.json ./
COPY packages/api packages/api
COPY packages/dashboard packages/dashboard

# Build dashboard
RUN pnpm --filter dashboard build

# Build API
RUN pnpm --filter api build

# Production stage
FROM node:22-slim AS production
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json packages/api/
COPY packages/dashboard/package.json packages/dashboard/

RUN pnpm install --frozen-lockfile --prod

# Copy built API
COPY --from=base /app/packages/api/dist packages/api/dist

# Copy drizzle migrations (needed by migrate.js at runtime)
COPY --from=base /app/packages/api/drizzle packages/api/drizzle

# Copy built dashboard
COPY --from=base /app/packages/dashboard/dist packages/dashboard/dist

EXPOSE 3001

# Run migrations then start the server
CMD ["sh", "-c", "cd packages/api && node dist/migrate.js && cd /app && node packages/api/dist/index.js"]
