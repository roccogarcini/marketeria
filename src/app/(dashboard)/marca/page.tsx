import { prisma } from "@/lib/prisma";
import { BrandForm } from "./brand-form";

export const dynamic = "force-dynamic";

export default async function BrandPage() {
  const profile = await prisma.brandProfile.findUnique({ where: { id: "default" } });
  return (
    <BrandForm
      initial={
        profile
          ? {
              name: profile.name,
              tone: profile.tone ?? "",
              voice: profile.voice ?? "",
              audience: profile.audience ?? "",
              editorialLines: profile.editorialLinesJson
                ? (JSON.parse(profile.editorialLinesJson) as string[])
                : [],
              mustAvoid: profile.mustAvoid ?? "",
              visualIdentity: profile.visualIdentity ?? "",
              logoDataUri: profile.logoDataUri ?? "",
            }
          : null
      }
    />
  );
}
