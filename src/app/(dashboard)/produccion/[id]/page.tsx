import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { ContentEditor } from "./content-editor";

export const dynamic = "force-dynamic";

// Editor del contenido base: editar, historial de versiones y regeneración IA.
// Se llega desde el detalle de idea ("Contenido base") y desde Creaciones.
export default async function ContentEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const content = await prisma.content.findUnique({
    where: { id },
    include: {
      idea: { select: { id: true, title: true } },
      versions: { orderBy: { version: "desc" } },
    },
  });
  if (!content) notFound();

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/ideas/${content.idea.id}`}
        className="inline-flex items-center gap-2 self-start text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Volver a la idea
      </Link>
      <ContentEditor
        content={{
          id: content.id,
          title: content.title,
          body: content.body,
          status: content.status,
          currentVersion: content.currentVersion,
          ideaTitle: content.idea.title,
          ideaId: content.idea.id,
          versions: content.versions.map((v) => ({
            id: v.id,
            version: v.version,
            notes: v.notes,
            isMilestone: v.isMilestone,
            createdAt: v.createdAt.toISOString(),
            body: v.body,
          })),
        }}
      />
    </div>
  );
}
