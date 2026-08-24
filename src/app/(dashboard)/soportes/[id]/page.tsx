import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { AssetEditor } from "./asset-editor";

export const dynamic = "force-dynamic";

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const asset = await prisma.asset.findUnique({
    where: { id },
    include: {
      channel: true,
      content: { include: { idea: { select: { id: true, title: true, status: true } } } },
    },
  });
  if (!asset) notFound();

  return (
    <AssetEditor
      asset={{
        id: asset.id,
        body: asset.body,
        status: asset.status,
        scheduledAt: asset.scheduledAt?.toISOString() ?? null,
        notes: asset.notes,
        channel: {
          id: asset.channel.id,
          name: asset.channel.name,
          type: asset.channel.type,
          constraintsJson: asset.channel.constraintsJson,
        },
        content: {
          id: asset.content.id,
          title: asset.content.title,
          body: asset.content.body,
          status: asset.content.status,
          ideaTitle: asset.content.idea.title,
        },
      }}
    />
  );
}
