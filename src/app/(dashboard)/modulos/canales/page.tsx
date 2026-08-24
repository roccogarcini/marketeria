import { prisma } from "@/lib/prisma";
import { ChannelsConfig } from "./channels-config";

export const dynamic = "force-dynamic";

export default async function CanalesPage() {
  const [channels, agents] = await Promise.all([
    prisma.channel.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.agent.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className="eyebrow">Módulos · Configuración</span>
        <h1 className="display-md">Canales</h1>
        <p className="text-sm text-muted-foreground">
          Define los canales donde publicas y el prompt con el que se adapta
          cada contenido a cada uno. Los cambios aplican a la próxima producción.
        </p>
      </header>

      <ChannelsConfig
        initial={channels.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          constraintsJson: c.constraintsJson,
          templateMarkdown: c.templateMarkdown,
          systemPrompt: c.systemPrompt,
          agentId: c.agentId,
          isActive: c.isActive,
          sortOrder: c.sortOrder,
        }))}
        agents={agents}
      />
    </div>
  );
}
