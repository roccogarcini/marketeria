import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Sello del build (lo escribe el Dockerfile): verificable desde fuera qué
// build está sirviendo prod. En dev/local no existe → null.
async function buildTime(): Promise<string | null> {
  try {
    return (await readFile(`${process.cwd()}/BUILD_TIME`, "utf8")).trim() || null;
  } catch {
    return null;
  }
}

// Política: public (healthcheck)
export async function GET() {
  const build = await buildTime();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", db: "ok", build });
  } catch {
    return NextResponse.json({ status: "degraded", db: "error", build }, { status: 503 });
  }
}
