import { prisma } from "@/lib/prisma";
import { UsersManager } from "./users-manager";

export const dynamic = "force-dynamic";

export default async function UsersAdminPage() {
  const users = await prisma.user.findMany({
    // Los eliminados (soft-delete) no se listan: su fila solo existe para
    // conservar el histórico de contenidos/actividad.
    where: { deletedAt: null },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  return <UsersManager initialUsers={users.map((u) => ({
    ...u,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  }))} />;
}
