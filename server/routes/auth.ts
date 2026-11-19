import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { clearSessionCookie, publicUser, requireAuth, setSessionCookie } from '../auth';
import { prisma } from '../db';

export const authRouter = Router();

const loginBody = z.object({
  username: z.string().trim().toLowerCase().min(1).max(32),
  password: z.string().min(1).max(200),
});

// Freno simple contra fuerza bruta: 10 intentos fallidos por IP+usuario cada 15 minutos.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;
const fails = new Map<string, { count: number; since: number }>();

// Hash de relleno para que un usuario inexistente tarde lo mismo que una contraseña incorrecta.
const DUMMY_HASH = bcrypt.hashSync('relleno-para-igualar-tiempos', 12);

authRouter.post('/login', async (req, res) => {
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Completá usuario y contraseña' });
  const { username, password } = parsed.data;

  const key = `${req.ip}|${username}`;
  const now = Date.now();
  for (const [k, v] of fails) if (now - v.since >= WINDOW_MS) fails.delete(k);
  const entry = fails.get(key) ?? { count: 0, since: now };
  if (entry.count >= MAX_FAILS) {
    return res.status(429).json({ error: 'Demasiados intentos. Probá de nuevo en unos minutos.' });
  }
  // Se cuenta el intento antes de verificar, así una ráfaga en paralelo no esquiva el límite.
  entry.count++;
  fails.set(key, entry);

  const user = await prisma.user.findUnique({ where: { username } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok || !user.active) {
    return res.status(401).json({ error: user && ok && !user.active ? 'Tu usuario está desactivado' : 'Usuario o contraseña incorrectos' });
  }

  fails.delete(key);
  setSessionCookie(res, user);
  res.json({ user: publicUser(user) });
});

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

const passwordBody = z.object({
  current: z.string().min(1).max(200),
  next: z.string().min(8, 'La contraseña nueva necesita al menos 8 caracteres').max(200),
});

authRouter.post('/password', requireAuth, async (req, res) => {
  const parsed = passwordBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await bcrypt.compare(parsed.data.current, user.passwordHash))) {
    return res.status(400).json({ error: 'La contraseña actual no coincide' });
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(parsed.data.next, 12), tokenVersion: { increment: 1 } },
  });
  setSessionCookie(res, updated); // cierra las otras sesiones y mantiene esta
  res.status(204).end();
});
