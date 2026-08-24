import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, KeyRound, Settings, Activity, Plug, Coins, DatabaseBackup } from "lucide-react";

export default function AdminHome() {
  const tiles = [
    { href: "/admin/usuarios", title: "Usuarios", desc: "Crear, editar y desactivar usuarios", icon: Users },
    { href: "/admin/proveedores", title: "Proveedores LLM", desc: "Claves API cifradas (Level 3)", icon: KeyRound },
    { href: "/admin/claves-api", title: "Claves API / MCP", desc: "Conectar otras apps, Claude Code y otros agentes MCP", icon: Plug },
    { href: "/admin/ajustes", title: "Ajustes", desc: "Configuración global de la app", icon: Settings },
    { href: "/admin/observabilidad", title: "Observabilidad", desc: "Actividad y ejecuciones IA", icon: Activity },
    { href: "/admin/consumo", title: "Consumo IA", desc: "Tokens y coste por agente y modelo", icon: Coins },
    { href: "/admin/copias", title: "Copias de seguridad", desc: "Copias cifradas de la BD en tu bucket S3 / R2", icon: DatabaseBackup },
  ];
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="display-md">Administración</h1>
        <p className="text-sm text-muted-foreground">
          Gestión del sistema. Solo accesible con rol ADMIN.
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <Link key={t.href} href={t.href}>
              <Card className="pipeline-card transition hover:border-primary/50">
                <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-foreground">
                    <Icon className="h-4 w-4" />
                  </div>
                  <CardTitle className="text-base">{t.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{t.desc}</p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
