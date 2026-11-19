import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { prisma } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';

export const savesRouter = Router();
savesRouter.use(requireAuth);

export const MAX_SLOTS = 3;
const slotParam = z.coerce.number().int().min(1).max(MAX_SLOTS);

// El servidor valida la forma general; el detalle (y las migraciones de versión) lo resuelve el cliente con parseSave.
const saveBody = z.object({
  teamName: z.string().max(80).nullable(),
  state: z
    .object({
      version: z.number().int(),
      season: z.number().int(),
      divisions: z.object({ A: z.any(), B: z.any(), C: z.any() }),
    })
    .passthrough(),
});

savesRouter.get('/', async (req, res) => {
  const saves = await prisma.save.findMany({
    where: { userId: req.user!.id },
    select: { slot: true, teamName: true, season: true, updatedAt: true },
    orderBy: { slot: 'asc' },
  });
  res.json({ saves });
});

savesRouter.get('/:slot', async (req, res) => {
  const slot = slotParam.safeParse(req.params.slot);
  if (!slot.success) return res.status(400).json({ error: 'Ranura inválida' });
  const save = await prisma.save.findUnique({
    where: { userId_slot: { userId: req.user!.id, slot: slot.data } },
    select: { state: true },
  });
  if (!save) return res.status(404).json({ error: 'Ranura vacía' });
  res.json({ state: save.state });
});

savesRouter.put('/:slot', async (req, res) => {
  const slot = slotParam.safeParse(req.params.slot);
  if (!slot.success) return res.status(400).json({ error: 'Ranura inválida' });
  const body = saveBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Partida inválida' });
  const { state, teamName } = body.data;
  const data = {
    version: state.version,
    season: state.season,
    teamName,
    state: state as Prisma.InputJsonValue,
  };
  const userId = req.user!.id;
  const saved = await prisma.save.upsert({
    where: { userId_slot: { userId, slot: slot.data } },
    create: { userId, slot: slot.data, ...data },
    update: data,
    select: { slot: true, teamName: true, season: true, updatedAt: true },
  });
  res.json({ save: saved });
});

savesRouter.delete('/:slot', async (req, res) => {
  const slot = slotParam.safeParse(req.params.slot);
  if (!slot.success) return res.status(400).json({ error: 'Ranura inválida' });
  await prisma.save.deleteMany({ where: { userId: req.user!.id, slot: slot.data } });
  res.status(204).end();
});
