import { prisma } from "@/lib/prisma";
import { AgentsGrid } from "./agents-grid";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const agents = await prisma.agent.findMany({ orderBy: { createdAt: "desc" } });
  return (
    <AgentsGrid
      initial={agents.map((a) => ({
        id: a.id,
        slug: a.slug,
        name: a.name,
        role: a.role,
        systemPrompt: a.systemPrompt,
        isActive: a.isActive,
        icon: a.icon,
      }))}
    />
  );
}
