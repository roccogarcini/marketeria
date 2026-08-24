import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { listProviders } from "@/lib/ai/providers";
import { AgentEditForm } from "./agent-edit-form";

export const dynamic = "force-dynamic";

const LLM_TYPES = ["OPENAI", "ANTHROPIC", "OPENROUTER", "CUSTOM", "ZAI", "DEEPSEEK", "GEMINI"];

export default async function EditAgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) notFound();

  // Proveedores LLM del usuario, para el selector de modelo por agente.
  const providers = (await listProviders(session!.user.id))
    .filter((p) => LLM_TYPES.includes(p.providerType))
    .map((p) => ({
      id: p.id,
      displayName: p.displayName,
      providerType: p.providerType,
      defaultModel: p.defaultModel,
      isActive: p.isActive,
    }));

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/agentes"
        className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Volver a agentes
      </Link>
      <header>
        <h1 className="display-md">Editar agente</h1>
        <p className="text-sm text-muted-foreground">
          <code className="font-mono text-xs">@{agent.slug}</code> · el slug no
          es editable para no romper referencias en automatizaciones.
        </p>
      </header>
      <AgentEditForm
        agent={{
          id: agent.id,
          slug: agent.slug,
          name: agent.name,
          role: agent.role,
          systemPrompt: agent.systemPrompt,
          temperature: agent.temperature,
          maxTokens: agent.maxTokens,
          icon: agent.icon,
          isActive: agent.isActive,
          providerId: agent.providerId,
          modelId: agent.modelId,
        }}
        providers={providers}
      />
    </div>
  );
}
