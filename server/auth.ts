import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from './db.js';
import type { Role } from './generated/prisma/client.js';

export const COOKIE_NAME = 'fm_session';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) throw new Error('JWT_SECRET falta o tiene menos de 32 caracteres');
const JWT_SECRET: string = secret;

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
  }
}

export function publicUser(u: SessionUser): SessionUser {
  return { id: u.id, username: u.username, displayName: u.displayName, role: u.role };
}

export function setSessionCookie(res: Response, user: { id: string; tokenVersion: number }) {
  const token = jwt.sign({ sub: user.id, v: user.tokenVersion }, JWT_SECRET, { expiresIn: Math.floor(MAX_AGE_MS / 1000) });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Solo con HTTPS: si se activa sirviendo por http el navegador descarta la cookie.
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: MAX_AGE_MS,
    path: '/',
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/**
 * Lee la cookie y carga el usuario de la base en cada request: así, si el admin
 * desactiva o borra a alguien, pierde el acceso en el acto aunque tenga un token válido.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  let userId: string;
  let version: number;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (typeof payload !== 'object' || typeof payload.sub !== 'string') throw new Error('token inválido');
    userId = payload.sub;
    version = typeof payload.v === 'number' ? payload.v : -1;
  } catch {
    clearSessionCookie(res);
    return res.status(401).json({ error: 'Sesión vencida' });
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active || user.tokenVersion !== version) {
    clearSessionCookie(res);
    return res.status(401).json({ error: 'Usuario inexistente o desactivado' });
  }
  req.user = publicUser(user);
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Solo para administradores' });
  next();
}
