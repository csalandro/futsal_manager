// Prepara una base remota (Supabase, etc.): aplica las migraciones y crea/actualiza el admin.
// Lee las variables de un archivo aparte, por defecto .env.production (no se versiona).
//
//   npm run db:remote                      → usa .env.production y pide confirmación
//   npm run db:remote -- --env otro.env    → otro archivo
//   npm run db:remote -- --yes             → sin confirmación (para scripts)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import dotenv from 'dotenv';

const args = process.argv.slice(2);
const envIdx = args.indexOf('--env');
const envFile = envIdx >= 0 ? args[envIdx + 1] : '.env.production';
const skipConfirm = args.includes('--yes') || args.includes('-y');

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

if (!envFile || !existsSync(envFile)) {
  fail(`No existe ${envFile ?? '(sin archivo)'}. Copiá .env.production.example a .env.production y completalo.`);
}

const vars = dotenv.parse(readFileSync(envFile));
const { DATABASE_URL, ADMIN_USERNAME, ADMIN_PASSWORD } = vars;

if (!DATABASE_URL) fail(`Falta DATABASE_URL en ${envFile}.`);
if (DATABASE_URL.includes('[YOUR-PASSWORD]')) fail('DATABASE_URL todavía tiene [YOUR-PASSWORD]: reemplazalo por la contraseña de la base.');
if (!ADMIN_USERNAME) fail(`Falta ADMIN_USERNAME en ${envFile}.`);
if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) fail(`ADMIN_PASSWORD falta o tiene menos de 8 caracteres en ${envFile}.`);

let target;
try {
  const u = new URL(DATABASE_URL);
  target = `${u.hostname}:${u.port || 5432}${u.pathname} (usuario ${decodeURIComponent(u.username)})`;
  if (/^(localhost|127\.0\.0\.1|db)$/.test(u.hostname)) console.warn(`\n⚠ Ojo: ${envFile} apunta a una base local (${u.hostname}).`);
  if (u.hostname.endsWith('pooler.supabase.com') && u.port === '6543') {
    fail(
      'DATABASE_URL usa el "Transaction pooler" de Supabase (puerto 6543): las migraciones se cuelgan ahí.\n' +
        '  Usá el "Session pooler": mismo host con el puerto 5432.',
    );
  }
  if (u.hostname.startsWith('db.') && u.hostname.endsWith('.supabase.co')) {
    console.warn('\n⚠ Es la conexión "Direct" de Supabase (solo IPv6 en el plan gratis). Si no conecta, usá la del "Session pooler".');
  }
} catch {
  fail('DATABASE_URL no es una URL válida. Si la contraseña tiene símbolos (@ # / ? %), codificalos o cambiala.');
}

console.log(`\nBase destino: ${target}`);
console.log(`Admin:        ${ADMIN_USERNAME}`);
console.log('Pasos:        1) prisma migrate deploy   2) prisma db seed\n');

if (!skipConfirm) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('¿Continuar? (s/N) ')).trim().toLowerCase();
  rl.close();
  if (answer !== 's' && answer !== 'si' && answer !== 'sí' && answer !== 'y') fail('Cancelado.');
}

// Las variables del archivo ganan sobre las del entorno; dotenv/config (dentro de Prisma y del seed)
// no pisa variables que ya existen, así que nunca se mezcla con el .env local.
const env = { ...process.env, ...vars };

function run(label, cmd) {
  console.log(`\n▶ ${label}`);
  const r = spawnSync(cmd, { stdio: 'inherit', env, shell: true });
  if (r.status !== 0) fail(`${label} falló (código ${r.status}). Revisá el mensaje de arriba.`);
}

run('Aplicando migraciones', 'npx prisma migrate deploy');
run('Creando/actualizando el admin', 'npx prisma db seed');

console.log(`\n✔ Base lista. Entrá a la app con el usuario "${ADMIN_USERNAME}".\n`);
