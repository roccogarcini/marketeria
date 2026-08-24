import test, { before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createFakePrisma } from "../helpers/fake-prisma.ts";

/**
 * El chat agéntico no mete los cuerpos completos de las creaciones en el
 * historial, que se reenvía en CADA una de las 6 iteraciones del bucle de
 * tool-calling.
 *
 * Un carrusel es HTML de decenas de KB: si `listar_creaciones` devolviera 30
 * assets con `body` entero, una sola pregunta costaría millones de tokens.
 *
 * Lo que se prueba aquí:
 *  - el resultado de `listar_creaciones` NO lleva cuerpos completos,
 *  - pero sí lleva lo necesario para decidir (id, título, canal, estado,
 *    tamaño y un extracto),
 *  - existe una herramienta para pedir el cuerpo de UNA creación,
 *  - y ningún resultado de herramienta puede pasar de un tope duro.
 *
 * El contrato de la API v1 / MCP (`listAssetsOp` sin más) no cambia.
 */

const db = createFakePrisma();

/** 30 KB de HTML por creación: el tamaño real de un slide de carrusel. */
const BIG_BODY = `<!doctype html><html><body>${"x".repeat(30_000)}</body></html>`;

let executeAgentTool: typeof import("@/lib/ai/agent-tools").executeAgentTool;
let AGENT_TOOLS: typeof import("@/lib/ai/agent-tools").AGENT_TOOLS;
let listAssetsOp: typeof import("@/lib/api/operations").listAssetsOp;

before(async () => {
  mock.module("@/lib/prisma", { namedExports: { prisma: db.prisma } });
  ({ executeAgentTool, AGENT_TOOLS } = await import("@/lib/ai/agent-tools"));
  ({ listAssetsOp } = await import("@/lib/api/operations"));
});

function seedAssets(n: number) {
  for (let i = 0; i < n; i++) {
    db.seed("asset", {
      id: `asset-${i}`,
      body: BIG_BODY,
      status: "READY",
      updatedAt: new Date(1_800_000_000_000 + i),
      channel: { id: "ch-1", name: "Instagram", type: "CAROUSEL" },
      content: { id: `content-${i}`, title: `Carrusel ${i}` },
    });
  }
}

beforeEach(() => db.reset());

test("listar_creaciones no vuelca los cuerpos completos en el historial del chat", async () => {
  seedAssets(30);

  const raw = await executeAgentTool("user-1", "listar_creaciones", "{}");

  assert.ok(
    !raw.includes("x".repeat(1_000)),
    "el resultado sigue llevando el cuerpo entero de las creaciones",
  );
  assert.ok(
    raw.length < 20_000,
    `el resultado ocupa ${raw.length} caracteres; con 30 carruseles se dispara el coste de cada iteración`,
  );
});

test("listar_creaciones sigue dando lo necesario para decidir: id, título, estado y tamaño", async () => {
  seedAssets(2);

  const items = JSON.parse(await executeAgentTool("user-1", "listar_creaciones", "{}")) as Array<
    Record<string, unknown>
  >;

  assert.equal(items.length, 2);
  const first = items[0];
  assert.ok(typeof first.id === "string" && first.id.length > 0, "falta el id para pedir el cuerpo");
  assert.equal(first.status, "READY");
  assert.ok(first.content, "falta el contenido/título");
  assert.equal(
    first.body,
    undefined,
    "el cuerpo completo no debe viajar en el listado",
  );
  assert.equal(typeof first.bodyChars, "number", "falta el tamaño del cuerpo");
  assert.ok(
    typeof first.bodyPreview === "string" && (first.bodyPreview as string).length <= 400,
    "falta un extracto corto del cuerpo (o es demasiado largo)",
  );
});

test("hay una herramienta para pedir el cuerpo de UNA creación", async () => {
  seedAssets(3);

  const names = AGENT_TOOLS.map((t) => t.function.name);
  assert.ok(
    names.includes("ver_creacion"),
    `no existe la herramienta para leer una creación concreta (tools: ${names.join(", ")})`,
  );

  const one = JSON.parse(
    await executeAgentTool("user-1", "ver_creacion", JSON.stringify({ id: "asset-1" })),
  ) as Record<string, unknown>;

  assert.equal(one.id, "asset-1");
  assert.ok(typeof one.body === "string" && (one.body as string).length > 1_000, "no devuelve el cuerpo");
});

test("el cuerpo de una creación también se recorta: un carrusel entero no cabe en el contexto", async () => {
  seedAssets(1);

  const one = JSON.parse(
    await executeAgentTool("user-1", "ver_creacion", JSON.stringify({ id: "asset-0" })),
  ) as Record<string, unknown>;

  assert.ok(
    (one.body as string).length <= 20_000,
    `devuelve ${(one.body as string).length} caracteres del cuerpo sin recorte`,
  );
  assert.equal(one.truncated, true, "no avisa de que el cuerpo viene recortado");
  assert.equal(one.bodyChars, BIG_BODY.length, "no informa del tamaño real");
});

test("ver_creacion con un id que no existe devuelve un error legible, no una excepción", async () => {
  seedAssets(1);
  const out = JSON.parse(
    await executeAgentTool("user-1", "ver_creacion", JSON.stringify({ id: "no-existe" })),
  ) as Record<string, unknown>;
  assert.ok(typeof out.error === "string" && (out.error as string).length > 0);
});

test("ningún resultado de herramienta supera el tope duro de caracteres", async () => {
  // Aunque una operación devuelva algo enorme por otra vía, el resultado que
  // entra en el historial va capado: es la última red de seguridad.
  for (let i = 0; i < 40; i++) {
    db.seed("finding", {
      title: `Hallazgo ${i}`,
      summary: "y".repeat(20_000),
      fullContent: "z".repeat(40_000),
      status: "NEW",
    });
  }
  const raw = await executeAgentTool("user-1", "listar_hallazgos", JSON.stringify({ limit: 50 }));
  assert.ok(
    raw.length <= 32_000,
    `un resultado de herramienta de ${raw.length} caracteres entra tal cual en cada iteración`,
  );
});

test("la API v1 / MCP siguen recibiendo el cuerpo completo (contrato intacto)", async () => {
  seedAssets(1);
  const assets = (await listAssetsOp({ limit: 10 })) as Array<Record<string, unknown>>;
  assert.equal(assets[0].body, BIG_BODY, "se ha roto el contrato de /api/v1/assets y MCP list_assets");
});
