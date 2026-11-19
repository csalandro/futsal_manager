import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireAuth, setSessionCookie } from '../auth';
import { prisma } from '../db';
import { Prisma } from '../generated/prisma/client';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

const userSelect = {
  id: true,
  username: true,
  displayName: true,
  role: true,
  active: true,
  createdAt: true,
  _count: { select: { saves: true } },
} as const;

const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, 'El usuario debe tener 3 a 32 caracteres: letras, números, punto, guion o guion bajo');
const password = z.string().min(8, 'La contraseña necesita al menos 8 caracteres').max(200);
const displayName = z.string().trim().min(1, 'Falta el nombre').max(48);
const role = z.enum(['ADMIN', 'USER']);

function firstIssue(e: z.ZodError) {
  return e.issues[0]?.message ?? 'Datos inválidos';
}

adminRouter.get('/users', async (_req, res) => {
  const users = await prisma.user.findMany({ select: userSelect, orderBy: { createdAt: 'asc' } });
  res.json({ users });
});

adminRouter.post('/users', async (req, res) => {
  const parsed = z.object({ username, displayName, password, role: role.default('USER') }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error) });
  const { password: pw, ...data } = parsed.data;
  if (await prisma.user.findUnique({ where: { username: data.username } })) {
    return res.status(409).json({ error: 'Ese nombre de usuario ya existe' });
  }
  try {
    const user = await prisma.user.create({
      data: { ...data, passwordHash: await bcrypt.hash(pw, 12) },
      select: userSelect,
    });
    res.status(201).json({ user });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return res.status(409).json({ error: 'Ese nombre de usuario ya existe' });
    }
    throw e;
  }
});

adminRouter.patch('/users/:id', async (req, res) => {
  const parsed = z
    .object({ displayName, role, active: z.boolean(), password })
    .partial()
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error) });
  const id = req.params.id;
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

  const { password: pw, ...data } = parsed.data;
  // Un admin no puede sacarse a sí mismo el rol ni desactivarse (evita quedarse sin acceso).
  if (id === req.user!.id && (data.role === 'USER' || data.active === false)) {
    return res.status(400).json({ error: 'No podés quitarte el rol de admin ni desactivarte a vos mismo' });
  }
  const user = await prisma.user.update({
    where: { id },
    data: {
      ...data,
      ...(pw ? { passwordHash: await bcrypt.hash(pw, 12) } : {}),
      // Nueva contraseña o desactivación: se cierran las sesiones abiertas de ese usuario.
      ...(pw || data.active === false ? { tokenVersion: { increment: 1 } } : {}),
    },
    select: { ...userSelect, tokenVersion: true },
  });
  // Si el admin cambió su propia contraseña, renovamos su cookie para no echarlo.
  if (id === req.user!.id && pw) setSessionCookie(res, user);
  const { tokenVersion: _tv, ...rest } = user;
  res.json({ user: rest });
});

adminRouter.delete('/users/:id', async (req, res) => {
  const id = req.params.id;
  if (id === req.user!.id) return res.status(400).json({ error: 'No podés borrarte a vos mismo' });
  const deleted = await prisma.user.deleteMany({ where: { id } });
  if (deleted.count === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.status(204).end();
});
