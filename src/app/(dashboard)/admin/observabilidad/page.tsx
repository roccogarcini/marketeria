import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function ObservabilityPage() {
  const [executions, activities, stats] = await Promise.all([
    prisma.aIExecution.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.activity.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { user: { select: { email: true, name: true } } },
    }),
    prisma.aIExecution.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="display-md">Observabilidad</h1>
        <p className="text-sm text-muted-foreground">
          Últimas ejecuciones IA y actividad del sistema.
        </p>
      </header>

      <section className="grid gap-3 md:grid-cols-4">
        {["RUNNING", "SUCCESS", "ERROR"].map((s) => {
          const count = stats.find((r) => r.status === s)?._count._all ?? 0;
          return (
            <div key={s} className="glass-card p-4">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">{s}</p>
              <p className="font-num text-3xl font-medium tabular-nums">{count}</p>
            </div>
          );
        })}
        <div className="glass-card p-4">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">TOTAL</p>
          <p className="font-num text-3xl font-medium tabular-nums">{stats.reduce((a, r) => a + r._count._all, 0)}</p>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-foreground/80">
          Últimas ejecuciones IA
        </h2>
        <div className="glass-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Fase</th>
                <th className="px-3 py-2 text-left">Modelo</th>
                <th className="px-3 py-2 text-left">Tokens in/out</th>
                <th className="px-3 py-2 text-left">Duración</th>
                <th className="px-3 py-2 text-left">Estado</th>
                <th className="px-3 py-2 text-left">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {executions.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    Sin ejecuciones todavía.
                  </td>
                </tr>
              )}
              {executions.map((e) => (
                <tr key={e.id} className="border-t border-border/40">
                  <td className="px-3 py-2">{e.phase}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{e.modelUsed ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{e.inputTokens ?? "—"} / {e.outputTokens ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{e.durationMs ?? "—"} ms</td>
                  <td className="px-3 py-2">
                    <Badge
                      variant={
                        e.status === "SUCCESS" ? "default" : e.status === "ERROR" ? "destructive" : "outline"
                      }
                    >
                      {e.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{e.createdAt.toLocaleString("es-ES")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-foreground/80">
          Actividad reciente
        </h2>
        <div className="glass-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Usuario</th>
                <th className="px-3 py-2 text-left">Acción</th>
                <th className="px-3 py-2 text-left">Entidad</th>
                <th className="px-3 py-2 text-left">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {activities.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                    Sin actividad registrada.
                  </td>
                </tr>
              )}
              {activities.map((a) => (
                <tr key={a.id} className="border-t border-border/40">
                  <td className="px-3 py-2">{a.user?.name ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{a.action}</td>
                  <td className="px-3 py-2 text-xs">{a.entityType}:{a.entityId}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{a.createdAt.toLocaleString("es-ES")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
