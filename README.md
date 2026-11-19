# Futsal Manager

Manager de fútbol sala en el navegador: elegís un club entre 54 (3 divisiones), armás alineación y tácticas, y jugás la liga fecha a fecha. Interfaz al estilo de los juegos de manager, pensada también para celular. Cada usuario tiene sus partidas guardadas en Postgres.

## Correr con Docker (todo en contenedores)

Requisitos: Docker Desktop y Node (solo para generar el `.env`).

```bash
npm run setup        # crea .env con contraseñas y secretos al azar (no pisa uno existente)
npm run docker:up    # construye la imagen y levanta Postgres + app
npm run docker:seed  # crea el usuario admin (ADMIN_USERNAME / ADMIN_PASSWORD del .env)
```

La app queda en http://localhost:3000. El contenedor aplica las migraciones pendientes cada vez que arranca. Un solo proceso Node sirve la API y el frontend compilado (`Dockerfile`).

## Desarrollo (Postgres en Docker, app en tu máquina)

Requisitos: Node 22+ y Docker Desktop.

```bash
npm install
npm run setup        # crea .env (si no existe)
npm run db:up        # solo Postgres
npm run db:deploy    # aplica las migraciones de Prisma
npm run db:seed      # crea el usuario admin
npm run dev          # API en :3001 + web con recarga en caliente en http://localhost:5173
```

Entrá con el usuario admin. Desde **Usuarios** creás cuentas, asignás el rol (Jugador o Administrador), cambiás contraseñas y desactivás o borrás usuarios. No hay registro público.

Otros comandos:

| Comando | Qué hace |
| --- | --- |
| `npm test` | Tests del motor (vitest) |
| `npm run build` | Genera el cliente de Prisma, chequea tipos y compila el frontend en `dist/` |
| `npm start` | Producción: la API sirve también `dist/` (con HTTPS, poné `COOKIE_SECURE=true`) |
| `npm run db:migrate -- --name <cambio>` | Nueva migración después de editar `prisma/schema.prisma` |
| `npm run db:studio` | Explorar la base con Prisma Studio |
| `npm run db:down` | Apagar Postgres (los datos quedan en el volumen `pgdata`) |

## Base remota (Supabase u otra)

Para crear las tablas y el usuario admin en la base de producción desde tu máquina:

```bash
cp .env.production.example .env.production   # completá DATABASE_URL, ADMIN_USERNAME y ADMIN_PASSWORD
npm run db:remote                              # muestra la base destino, pide confirmación, migra y crea el admin
```

`.env.production` no se versiona y no se mezcla con tu `.env` local. En Supabase usá la URI del **Session pooler** (puerto 5432). Se puede volver a correr sin problema: solo aplica migraciones pendientes y actualiza la contraseña del admin. Opciones: `--env <archivo>` y `--yes` (sin confirmación).

## Desplegar en Render (Docker)

1. **New → Web Service** → el repo → rama `main` → la misma región que la base → **Language: Docker**. Health Check Path: `/api/health`.
2. Variables: `DATABASE_URL` (Session pooler de Supabase), `JWT_SECRET`, `COOKIE_SECURE=true`, `TRUST_PROXY=1`, `DB_POOL_MAX=5`.
3. Cada deploy aplica las migraciones al arrancar. El admin se crea una vez con `npm run db:remote`.

## Desplegar en Vercel

Un solo proyecto de Vercel sirve las dos partes: el frontend (`dist/`) desde su CDN y la API como una función serverless (`api/index.ts`, que reutiliza `server/app.ts`). Al ser el mismo dominio, la cookie de sesión funciona sin CORS. El navegador nunca se conecta a la base: navegador → `/api` → Prisma → Postgres.

1. Creá un Postgres en la nube (Neon, Supabase o Vercel Postgres). Tu Docker local no es accesible desde Vercel.
2. Prepará la base desde tu máquina (ver **Base remota** abajo): `npm run db:remote`.
3. Importá el repo en Vercel; `vercel.json` ya define el build y las rutas.
4. Variables de entorno en Vercel: `DATABASE_URL` (la URL **con pooler**), `JWT_SECRET`, `COOKIE_SECURE=true`, `TRUST_PROXY=1`, `DB_POOL_MAX=3`.

Limitaciones en serverless: el freno de intentos de login vive en memoria de cada instancia, así que protege menos que en un servidor único. Los cuerpos están limitados a 4,5 MB (una partida pesa unos cientos de KB).

## Arquitectura

```
api/index.ts           Entrada de la función serverless de Vercel.
server/                API Express 5 + Prisma 7 (adapter-pg)
  app.ts               App Express (sin listen): defensa CSRF, rutas, estáticos opcionales.
  index.ts             Servidor de Node (desarrollo, npm start y Docker); --prod sirve dist/.
  auth.ts              Sesión JWT en cookie httpOnly; requireAuth / requireAdmin.
  routes/auth.ts       Login (con freno de fuerza bruta), logout, me, cambio de contraseña.
  routes/admin.ts      Alta, baja y modificación de usuarios (solo ADMIN).
  routes/saves.ts      Partidas del usuario logueado: 3 ranuras, estado completo en JSON.
prisma/                schema.prisma, migraciones y seed del admin.
src/
  domain/types.ts      Modelo (GameState, Team, Player…). Todo serializable a JSON.
  engine/              Lógica pura del juego: sin DOM, sin storage, sin Math.random.
  data/                Nombres, ciudades, relato.
  api/client.ts        fetch a /api (cookies, header CSRF; un 401 cierra la sesión).
  repo/                Persistencia detrás de GameRepository (ApiRepository).
  store/               authStore (sesión) y gameStore (Zustand + Immer).
  ui/                  Componentes React. En pantallas de menos de 900px la barra lateral pasa a ser una barra inferior.
```

### Usuarios y sesiones

- Contraseñas con bcrypt. La sesión es un JWT de 7 días en una cookie httpOnly y SameSite=Lax.
- En cada request se lee el usuario de la base. Si el admin lo desactiva, lo borra o le cambia la contraseña, sus sesiones abiertas dejan de valer en el acto (`tokenVersion`).
- Un admin no puede quitarse su propio rol, desactivarse ni borrarse.

### Motor de partido (Poisson)

Cada equipo tiene una fuerza `S` (promedio de los titulares + tácticas + moral). Los goles esperados son

- `λ_local = μ · exp(k · (S_local + ventaja − S_visitante)) · intensidad`
- `λ_visitante = μ · exp(−k · (S_local + ventaja − S_visitante)) · intensidad`

y los goles de cada equipo salen de `Poisson(λ)`. Los minutos de los goles y del resto de los eventos (ocasiones, atajadas, faltas, tarjetas) se reparten de manera uniforme en los 40 minutos, así que el relato en vivo y el resultado vienen de la misma distribución. Los partidos de la computadora usan exactamente el mismo motor. Los empates en eliminatorias se definen por penales para todos.

`μ`, `k` y la ventaja local están en `src/engine/config.ts`. `src/engine/match.test.ts` verifica la calibración: 5 a 6,5 goles por partido entre equipos parejos y ventaja de localía.

### Datos

Cada usuario tiene hasta 3 partidas en la tabla `Save` (`userId` + `slot` únicos). El juego guarda después de cada acción, con un solo guardado en vuelo a la vez: los cambios que llegan mientras tanto se juntan en uno con el estado más reciente. Los guardados llevan `version` y pasan por `parseSave` (Zod + migraciones) al cargar.

## Pendiente respecto del prototipo

Copa, Copa Internacional, Copa de Campeones, playoffs, mercado de pases, finanzas, estadio, empleados, juveniles, entrenamiento, contratos y renovaciones, tarjetas y suspensiones, lesiones y carrera del DT.
