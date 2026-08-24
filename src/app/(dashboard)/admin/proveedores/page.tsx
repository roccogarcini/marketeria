import { auth } from "@/auth";
import { listProviders } from "@/lib/ai/providers";
import { ProvidersManager } from "./providers-manager";

export const dynamic = "force-dynamic";

export default async function ProvidersAdminPage() {
  const session = await auth();
  const userId = session!.user.id;
  const providers = await listProviders(userId);
  return <ProvidersManager initial={providers.map((p) => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }))} />;
}
