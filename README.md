# Futsal Manager

Manager de fútbol sala en el navegador: elegís un club entre 54 (3 divisiones), armás alineación y tácticas, y jugás la liga fecha a fecha. Interfaz al estilo de los juegos de manager, pensada también para celular. Cada usuario tiene sus partidas guardadas en Postgres.

## Correr (local con Docker)

Requisitos: Node 22+ y Docker Desktop.

```bash
npm install
npm run setup        # crea .env con contraseñas y secretos al azar (no pisa uno existente)
npm run db:up        # Postgres en Docker (docker-compose.yml)
npm run db:deploy    # aplica las migraciones de Prisma
npm run db:seed      # crea el usuario admin (ADMIN_USERNAME / ADMIN_PASSWORD del .env)
npm run dev          # API en :3001 + web en http://localhost:5173
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

## Arquitectura

```
server/                API Express 5 + Prisma 7 (adapter-pg)
  index.ts             App, defensa CSRF (header X-Requested-With), estáticos en producción.
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
