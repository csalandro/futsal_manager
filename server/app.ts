import 'dotenv/config';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import { resolve } from 'node:path';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { savesRouter } from './routes/saves.js';

/**
 * La app Express sin `listen()`: la usan el servidor de Node (server/index.ts, local y Docker)
 * y la función serverless de Vercel (api/index.ts).
 *
 * `staticDir`: carpeta del frontend compilado para servirlo desde el mismo proceso
 * (Docker / `npm start`). En Vercel el frontend lo sirve la CDN y no se pasa.
 */
export function createApp({ staticDir }: { staticDir?: string } = {}) {
  const app = express();
  app.disable('x-powered-by');

  // Detrás de un proxy (Vercel, un reverse proxy delante del contenedor) req.ip sale de
  // X-Forwarded-For solo si se confía en esa cantidad de saltos. Sin proxy, dejarlo vacío.
  const hops = Number(process.env.TRUST_PROXY ?? 0);
  if (hops > 0) app.set('trust proxy', hops);

  // Vercel corta los cuerpos en 4,5 MB; una partida completa pesa unos cientos de KB.
  app.use(express.json({ limit: '4mb' }));
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

  if (staticDir) {
    // Los archivos de assets/ llevan hash en el nombre: se pueden cachear para siempre.
    app.use('/assets', express.static(resolve(staticDir, 'assets'), { maxAge: '1y', immutable: true }));
    app.use(express.static(staticDir, { index: false }));
    // Rutas del SPA: siempre index.html, sin caché para que un deploy nuevo se vea al recargar.
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(resolve(staticDir, 'index.html'));
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // Errores de body-parser (JSON mal formado, cuerpo demasiado grande) traen su propio status.
    const status = (err as { status?: number; expose?: boolean })?.expose ? (err as { status: number }).status : 500;
    if (status === 500) console.error(err);
    res.status(status).json({
      error: status === 413 ? 'La partida es demasiado grande' : status === 500 ? 'Error interno del servidor' : 'Pedido inválido',
    });
  });

  return app;
}
