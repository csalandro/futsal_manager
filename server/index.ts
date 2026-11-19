// Servidor de Node: desarrollo (`npm run dev:api`), `npm start` y el contenedor Docker.
// Con --prod además sirve el frontend compilado en dist/.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app.js';

const dist = resolve(import.meta.dirname, '../dist');
const serveWeb = process.argv.includes('--prod');
if (serveWeb && !existsSync(dist)) console.warn('No existe dist/: corré `npm run build` para servir el frontend.');

const app = createApp({ staticDir: serveWeb && existsSync(dist) ? dist : undefined });

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001);
const server = app.listen(port, (err?: Error) => {
  if (err) {
    console.error(`No se pudo abrir el puerto ${port}:`, err.message);
    process.exit(1);
  }
  console.log(`API escuchando en http://localhost:${port}${serveWeb ? ' (sirviendo también el frontend)' : ''}`);
});

// Docker manda SIGTERM al parar el contenedor: cerramos prolijo.
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
