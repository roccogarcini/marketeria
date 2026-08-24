import { getBackupOverview, listBackupRuns } from "@/lib/backups/service";
import { BackupsManager } from "./backups-manager";

export const dynamic = "force-dynamic";

export default async function BackupsAdminPage() {
  const [overview, runs] = await Promise.all([getBackupOverview(), listBackupRuns()]);
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="display-md">Copias de seguridad</h1>
        <p className="text-sm text-muted-foreground">
          Copias cifradas de la base de datos en tu bucket S3 / R2.
        </p>
      </header>
      <BackupsManager initialOverview={overview} initialRuns={runs} />
    </div>
  );
}
