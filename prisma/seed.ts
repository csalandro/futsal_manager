// Crea (o actualiza) el usuario administrador a partir de ADMIN_USERNAME / ADMIN_PASSWORD del .env.
import bcrypt from 'bcryptjs';
import { prisma } from '../server/db.js';

async function main() {
  const username = (process.env.ADMIN_USERNAME ?? 'admin').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 8) throw new Error('ADMIN_PASSWORD falta o tiene menos de 8 caracteres');

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.user.upsert({
    where: { username },
    update: { passwordHash, role: 'ADMIN', active: true },
    create: { username, displayName: 'Administrador', passwordHash, role: 'ADMIN' },
  });
  console.log(`Admin listo: ${admin.username}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
