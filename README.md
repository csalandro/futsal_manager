# Futsal Manager

Manager de fútbol sala en el navegador: elegís un club entre 54 (3 divisiones), armás alineación y tácticas, y jugás la liga fecha a fecha. Port del prototipo de un solo HTML a una app modular.

## Correr

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # tests del motor (vitest)
npm run build
```

## Arquitectura

```
src/
  domain/types.ts      Modelo (GameState, Team, Player…). Todo serializable a JSON.
  engine/              Lógica pura del juego: sin DOM, sin storage, sin Math.random.
    rng.ts             RNG con semilla (mulberry32); su estado se guarda en GameState.rngState.
    config.ts          Constantes de balance.
    poisson.ts         Muestreo y probabilidades de Poisson.
    match.ts           Motor de partido único (vivo y simulado).
    strength.ts        Fuerza del equipo según jugadores, tácticas y moral.
    generate.ts        Generación de jugadores, equipos y partida nueva.
    schedule.ts        Fixture todos contra todos, ida y vuelta.
    standings.ts       Tabla de posiciones.
    season.ts          Jugar fechas, nueva temporada, ascensos/descensos, progresión.
  data/                Nombres, ciudades, relato.
  repo/                Persistencia detrás de la interfaz GameRepository.
  store/gameStore.ts   Estado de la app (Zustand + Immer); llama al motor y al repositorio.
  ui/                  Componentes React.
supabase/migrations/   Esquema SQL para Supabase.
```

### Motor de partido (Poisson)

Cada equipo tiene una fuerza `S` (promedio de los titulares + tácticas + moral). Los goles esperados son

- `λ_local = μ · exp(k · (S_local + ventaja − S_visitante)) · intensidad`
- `λ_visitante = μ · exp(−k · (S_local + ventaja − S_visitante)) · intensidad`

y los goles de cada equipo salen de `Poisson(λ)`. Los minutos de los goles y del resto de los eventos (ocasiones, atajadas, faltas, tarjetas) se reparten de manera uniforme en los 40 minutos, así que el relato en vivo y el resultado vienen de la misma distribución. Los partidos de la computadora usan exactamente el mismo motor. Los empates en eliminatorias se definen por penales para todos.

`μ`, `k` y la ventaja local están en `src/engine/config.ts`. `src/engine/match.test.ts` verifica la calibración: 5 a 6,5 goles por partido entre equipos parejos y ventaja de localía.

### Datos: mock ahora, Supabase después

La app usa solo `GameRepository` (`listSaves`, `load`, `save`, `remove`). `VITE_DATA_SOURCE` elige la implementación:

- `mock` (por defecto): `MockRepository` guarda en `localStorage`, con latencia simulada.
- `supabase`: `SupabaseRepository` usa la tabla `saves` (estado completo en `jsonb`, RLS por usuario). Para activarlo, copiá `.env.example` a `.env`, completá URL y anon key, aplicá `supabase/migrations/0001_saves.sql` y agregá login (Supabase Auth).

Los guardados llevan `version` y pasan por `parseSave` (Zod + migraciones) al cargar.

## Pendiente respecto del prototipo

Copa, Copa Internacional, Copa de Campeones, playoffs, mercado de pases, finanzas, estadio, empleados, juveniles, entrenamiento, contratos y renovaciones, tarjetas y suspensiones, lesiones y carrera del DT.
