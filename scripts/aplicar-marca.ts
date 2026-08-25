/**
 * Escribe el perfil de marca de Marketería sobre una base de datos que ya
 * existe (el seed solo lo pone en instalaciones nuevas, y a propósito no pisa
 * lo que hayas editado a mano en /marca).
 *
 *   npx tsx --env-file=.env scripts/aplicar-marca.ts
 *
 * Es idempotente: se puede volver a lanzar cuando cambie el manual.
 */
import { PrismaClient } from "@prisma/client";
import { MARCA_MARKETERIA, logoDataUri } from "../prisma/marca-marketeria";

const prisma = new PrismaClient();

async function main() {
  const datos = { ...MARCA_MARKETERIA, logoDataUri: logoDataUri() };
  const kb = Math.round((datos.logoDataUri.length * 3) / 4 / 1024);
  if (kb > 200) throw new Error(`El logo pesa ${kb}KB y el máximo es 200KB.`);

  await prisma.brandProfile.upsert({
    where: { id: "default" },
    update: datos,
    create: { id: "default", ...datos },
  });
  console.log(`✓ Marca "${MARCA_MARKETERIA.name}" aplicada (logo ${kb}KB).`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("✗", e.message);
  await prisma.$disconnect();
  process.exit(1);
});
