import 'dotenv/config';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { adminRouter } from './routes/admin';
import { authRouter } from './routes/auth';
import { savesRouter } from './routes/saves';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' })); // una partida completa pesa unos cientos de KB
app.use(cookieParser());

// Defensa CSRF: las mutaciones exigen un header propio. Otro sitio no puede mandarlo sin pasar
// por un preflight CORS, y este servidor no habilita CORS.
app.use('/api', (req, res, next) => {
  const mutating = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
  if (mutating && req.headers['x-requested-with'] !== 'fetch') {
    return res.status(403).json({ error: 'Origen no permitido' });
  }
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/saves', savesRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'No encontrado' }));

// En producción el mismo servidor sirve el frontend compilado (npm run build).
const dist = resolve(import.meta.dirname, '../dist');
if (process.argv.includes('--prod') && existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // Errores de body-parser (JSON mal formado, cuerpo demasiado grande) traen su propio status.
  const status = (err as { status?: number; expose?: boolean })?.expose ? (err as { status: number }).status : 500;
  if (status === 500) console.error(err);
  res.status(status).json({
    error: status === 413 ? 'La partida es demasiado grande' : status === 500 ? 'Error interno del servidor' : 'Pedido inválido',
  });
});

const port = Number(process.env.API_PORT ?? 3001);
app.listen(port, (err?: Error) => {
  if (err) {
    console.error(`No se pudo abrir el puerto ${port}:`, err.message);
    process.exit(1);
  }
  console.log(`API escuchando en http://localhost:${port}`);
});
