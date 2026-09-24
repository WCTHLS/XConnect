FROM node:20-alpine AS base
WORKDIR /app

# Install exact pnpm version
RUN npm install -g pnpm@10.14.0

# Copy workspace manifests
COPY package.json pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY backend/package.json ./backend/

# Install Linux dependencies cleanly without OS lockfile mismatch
RUN pnpm install --no-frozen-lockfile

# Copy source code
COPY packages/shared ./packages/shared
COPY backend ./backend

EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production

CMD ["pnpm", "--filter", "@confpresence/api", "start"]
