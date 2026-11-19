import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('Falta DATABASE_URL (ver .env.example)');

// En serverless (Vercel) cada instancia abre su propio pool: conviene DB_POOL_MAX bajo (ej. 3)
// y una DATABASE_URL con pooler del proveedor (Neon, Supabase, etc.).
const max = Number(process.env.DB_POOL_MAX ?? 10);

export const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString, max }) });
