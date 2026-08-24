// Bootstrap del primer ADMIN en despliegues sin seed.
// Se ejecuta en el entrypoint tras las migraciones. Idempotente:
//   - sin ADMIN_EMAIL/ADMIN_PASSWORD → no hace nada (aviso informativo)
//   - si ya existe cualquier usuario → no hace nada
// Así nunca pisa datos y las credenciales vienen del entorno (Level 2),
// no de código. Ejecutar con: node scripts/bootstrap-admin.mjs
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;

const prisma = new PrismaClient();
try {
  const existing = await prisma.user.count();
  if (existing > 0) {
    console.log(`[bootstrap-admin] ya existen ${existing} usuario(s) — omitido.`);
    process.exit(0);
  }
  if (!email || !password) {
    console.warn(
      "[bootstrap-admin] AVISO: la base de datos NO tiene usuarios y ADMIN_EMAIL/ADMIN_PASSWORD no están definidos.\n" +
        "[bootstrap-admin] Nadie podrá iniciar sesión. Define ambas variables de entorno y reinicia el contenedor,\n" +
        "[bootstrap-admin] o ejecuta el seed con ellas: ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run db:seed"
    );
    process.exit(0);
  }
  if (password.length < 8) {
    console.error("[bootstrap-admin] ADMIN_PASSWORD debe tener al menos 8 caracteres.");
    process.exit(1);
  }
  const hashedPassword = await bcrypt.hash(password, 12);
  await prisma.user.create({
    data: { email, name: "Admin", role: "ADMIN", hashedPassword, isActive: true },
  });
  console.log(`[bootstrap-admin] ADMIN creado: ${email}`);
} finally {
  await prisma.$disconnect();
}
