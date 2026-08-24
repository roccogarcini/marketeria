import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AutomationsPanel } from "./automations-panel";

export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  // Solo ADMIN: las APIs de crear/ejecutar automatizaciones exigen ese rol.
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/dashboard");

  const [automations, sources] = await Promise.all([
    prisma.automation.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { runs: true } } },
    }),
    // Incluimos platform + configJson para que el formulario de automatización
    // pueda recargar los criterios completos de una fuente APIFY enlazada al
    // editar (query, hashtags, filtros del actor, actor override) sin que el
    // usuario tenga que re-teclear lo que ya guardó.
    prisma.source.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        type: true,
        isActive: true,
        platform: true,
        configJson: true,
      },
    }),
  ]);
  // Zona horaria en la que el scheduler interpreta los cron (ver
  // lib/automations/scheduler.ts). Se muestra en el formulario para que la hora
  // programada no sea ambigua. El contenedor corre en UTC; esto NO lo cambia.
  const cronTz = process.env.CRON_TZ ?? "Europe/Madrid";

  return (
    <AutomationsPanel
      cronTz={cronTz}
      sources={sources}
      initial={automations.map((a) => ({
        id: a.id,
        name: a.name,
        triggerType: a.triggerType,
        cron: a.cron,
        targetType: a.targetType,
        paramsJson: a.paramsJson,
        isActive: a.isActive,
        lastRunAt: a.lastRunAt?.toISOString() ?? null,
        runsCount: a._count.runs,
      }))}
    />
  );
}
