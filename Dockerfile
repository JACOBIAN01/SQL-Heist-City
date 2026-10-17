# Images for the game server, the admin (with its React UI) and the game page (Phase 20.1).
#   docker build --target server -t heist-server .
#   docker build --target admin  -t heist-admin  .
#   docker build --target client -t heist-client .
# `docker compose up --build` builds and runs all three with PostgreSQL (compose.yaml).

FROM node:24-slim AS base
WORKDIR /app
ENV NODE_ENV=development
# The workspaces run from TypeScript through tsx, so dependencies are installed whole.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY admin/package.json admin/
COPY client/package.json client/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY admin admin
COPY client client
COPY content content

# --- game server -----------------------------------------------------------------------------
FROM base AS server
ENV PORT=8080 SNAPSHOT_PATH=/data/content-snapshot.db SERVICE_NAME=game
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["npx", "tsx", "server/src/main.ts"]

# --- admin and account service ---------------------------------------------------------------
FROM base AS admin-build
RUN npm run build -w @heist/admin

FROM admin-build AS admin
ENV PORT=8081 SERVICE_NAME=admin
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8081
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["npx", "tsx", "admin/src/main.ts"]

# --- game page (static) ----------------------------------------------------------------------
FROM base AS client-build
RUN npm run build -w @heist/client

FROM nginx:1.27-alpine AS client
COPY --from=client-build /app/client/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
