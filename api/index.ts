// Función serverless de Vercel: toda la API (/api/*) entra por acá (ver vercel.json).
// El frontend lo sirve la CDN de Vercel desde dist/; el navegador nunca habla con la base:
// navegador → /api (esta función) → Prisma → Postgres.
import { createApp } from '../server/app.js';

export default createApp();
