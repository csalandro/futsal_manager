// Genera .env a partir de .env.example con contraseñas y secretos al azar.
// No pisa un .env existente.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

if (existsSync('.env')) {
  console.log('.env ya existe: no se modifica.');
  process.exit(0);
}

const rand = (n) => randomBytes(n).toString('base64url');
const pg = rand(18);
const values = { POSTGRES_PASSWORD: pg, JWT_SECRET: rand(48), ADMIN_PASSWORD: rand(9) };

let text = readFileSync('.env.example', 'utf8')
  .replace(/^#.*npm run setup.*\n/m, '# Configuración local (no se versiona). Plantilla: .env.example\n')
  .replace('futsal:cambiame@', `futsal:${pg}@`);
for (const [k, v] of Object.entries(values)) text = text.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`);

writeFileSync('.env', text, { flag: 'wx' });
console.log('.env creado. La contraseña del admin está en ADMIN_PASSWORD.');
