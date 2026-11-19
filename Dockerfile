# Imagen única: API Express + frontend compilado, servidos por el mismo proceso Node.
#   docker compose up -d --build     (ver docker-compose.yml)
# Al arrancar aplica las migraciones pendientes y después levanta el servidor.

# ---------- build: dependencias completas, compila el frontend ----------
FROM node:24-alpine AS build
WORKDIR /app
# prisma generate (postinstall) lee prisma.config.ts, que pide DATABASE_URL aunque no se conecte.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build

# ---------- runtime: solo dependencias de producción ----------
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=build /app/server/generated ./server/generated
COPY --from=build /app/dist ./dist

USER node
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["sh", "-c", "npx prisma migrate deploy && exec node --import tsx server/index.ts --prod"]
