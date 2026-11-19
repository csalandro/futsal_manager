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
# Si las migraciones no terminan en 120 s (típico: DATABASE_URL apunta a un pooler en modo
# "transaction", como el puerto 6543 de Supabase) se corta con un mensaje claro en vez de colgarse.
CMD ["sh", "-c", "timeout 120 npx prisma migrate deploy || { echo 'ERROR: las migraciones fallaron o tardaron más de 120 s. Revisá DATABASE_URL (en Supabase usá el Session pooler, puerto 5432).'; exit 1; }; exec node --import tsx server/index.ts --prod"]
