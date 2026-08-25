import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { verifyApiKey, type ApiKeyAuth } from "@/lib/api-keys/auth";
import { apiKeyRateCheck } from "@/lib/api-keys/rate-limit";
import {
  runResearchOp,
  listFindingsOp,
  createFindingOp,
  listIdeasOp,
  createIdeaOp,
  updateIdeaOp,
  deleteIdeaOp,
  createCreationOp,
  listAssetsOp,
  getAssetOp,
  listChannelsOp,
  listAutomationsOp,
  createAutomationOp,
  updateAutomationOp,
  toggleAutomationOp,
  deleteAutomationOp,
  listAutomationRunsOp,
  runAutomationOp,
  getBrandOp,
  getDashboardSummaryOp,
  listAgentsOp,
  updateAgentOp,
  updateChannelOp,
  updateBrandOp,
} from "@/lib/api/operations";
import { agentPatchShape } from "@/lib/agents/schema";
import { channelPromptPatchShape } from "@/lib/channels/schema";
import { brandUpdateShape } from "@/lib/brand/schema";
import { produceIdea } from "@/lib/pipeline/produce";

/**
 * Servidor MCP de Marketería — endpoint /api/mcp (Streamable HTTP).
 *
 * Conexión desde Claude Code:
 *   claude mcp add --transport http marketeria https://TU-DOMINIO/api/mcp \
 *     --header "Authorization: Bearer spk_..."
 *
 * (clientes MCP: mismo endpoint y cabecera.)
 *
 * Auth por API key (Admin → Claves API). Las herramientas de escritura
 * requieren scope read_write; con scope read devuelven un error legible.
 *
 * Nota de enrutado: el segmento dinámico [transport] solo captura rutas /api/*
 * sin handler estático (las rutas existentes tienen precedencia). El endpoint
 * efectivo es /api/mcp.
 */

export const maxDuration = 300; // investigar/producir puede tardar

function text(data: unknown) {
  return {
    content: [
      { type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) },
    ],
  };
}

function writeDenied() {
  return {
    content: [
      {
        type: "text" as const,
        text: "Error: esta API key es de solo lectura (scope read); esta herramienta requiere una clave con scope read_write.",
      },
    ],
    isError: true,
  };
}

function buildHandler(auth: ApiKeyAuth) {
  const canWrite = auth.scope === "read_write";
  return createMcpHandler(
    (server) => {
      // ── Lectura ─────────────────────────────────────────────────────
      server.tool(
        "list_channels",
        "Lista los canales de publicación activos de Marketería (id, nombre, tipo). Úsalo para conocer los channelIds antes de produce_content o create_creation.",
        {},
        async () => text(await listChannelsOp()),
      );
      server.tool(
        "list_findings",
        "Lista hallazgos de investigación de Marketería. status: NEW | SENT_TO_ANALYSIS | DISCARDED | PROMOTED.",
        {
          status: z.string().optional(),
          limit: z.number().int().min(1).max(100).optional(),
        },
        async (args) => text(await listFindingsOp(args)),
      );
      server.tool(
        "list_ideas",
        "Lista ideas editoriales de Marketería. status: PROPOSED | APPROVED | REJECTED | ARCHIVED.",
        {
          status: z.string().optional(),
          limit: z.number().int().min(1).max(100).optional(),
        },
        async (args) => text(await listIdeasOp(args)),
      );
      server.tool(
        "list_assets",
        "Lista creaciones (piezas finales por canal) con su cuerpo completo, incluidos los slides HTML de carruseles. Con includeBody=false devuelve solo tamaño y extracto (recomendado para explorar: un carrusel son decenas de KB) y luego se pide la pieza con get_asset.",
        {
          channelId: z.string().optional(),
          status: z.string().optional(),
          limit: z.number().int().min(1).max(50).optional(),
          includeBody: z.boolean().optional(),
        },
        async (args) => text(await listAssetsOp(args)),
      );
      server.tool(
        "get_asset",
        "Devuelve UNA creación por id con su cuerpo (recortado a maxChars, 20000 por defecto).",
        {
          id: z.string().min(1).max(128),
          maxChars: z.number().int().min(500).max(20000).optional(),
        },
        async (args) => text(await getAssetOp(args)),
      );
      server.tool(
        "list_automations",
        "Lista las automatizaciones de Marketería con su programación (cron legible), si están activas, su última ejecución y el nº total de ejecuciones.",
        {
          limit: z.number().int().min(1).max(100).optional(),
        },
        async (args) => text(await listAutomationsOp(args)),
      );
      server.tool(
        "list_automation_runs",
        "Historial de ejecuciones de una automatización de Marketería (estado, fechas y log recortado). Úsalo para comprobar a qué hora disparó el cron o depurar un fallo.",
        {
          automationId: z.string().min(1).max(128),
          limit: z.number().int().min(1).max(100).optional(),
        },
        async ({ automationId, limit }) => {
          const result = await listAutomationRunsOp(automationId, limit);
          return result.ok ? text(result) : { ...text(`Error: ${result.error}`), isError: true };
        },
      );
      server.tool(
        "list_agents",
        "Lista los agentes de chat de Marketería con su systemPrompt completo, rol, proveedor/modelo asignado y parámetros de generación. Úsalo para conocer el agentId antes de update_agent_prompt.",
        {},
        async () => text(await listAgentsOp()),
      );
      server.tool(
        "get_brand",
        "Devuelve el perfil de marca de Marketería (nombre, tono, voz, audiencia, líneas editoriales, qué evitar e identidad visual). Es el mismo perfil que se inyecta al producir contenido.",
        {},
        async () => text(await getBrandOp()),
      );
      server.tool(
        "get_dashboard_summary",
        "Resumen del pipeline de Marketería con las mismas cifras que el dashboard del panel: hallazgos, fuentes, ideas por revisar, ideas aprobadas, creaciones, ideas por estado, automatizaciones y canales activos.",
        {},
        async () => text(await getDashboardSummaryOp()),
      );

      // ── Escritura (scope read_write) ────────────────────────────────
      server.tool(
        "create_automation",
        "Crea y programa una automatización de investigación IA en Marketería. Rastrea la web con el brief y crea hallazgos de forma recurrente. 'cron' es una expresión cron estándar de 5 campos (min hora díaMes mes díaSemana), zona Europe/Madrid; ej: diario 9:00='0 9 * * *', cada 6h='0 */6 * * *', lunes 8:00='0 8 * * 1', laborables 9:00='0 9 * * 1-5'. Si omites cron queda MANUAL (se lanza con run_automation).",
        {
          name: z.string().min(1).max(200),
          brief: z.string().min(8).max(4000),
          cron: z.string().max(80).optional(),
          maxItems: z.number().int().min(3).max(12).optional(),
          maxAgeMonths: z.number().int().min(1).max(24).optional(),
        },
        async (args) => {
          if (!canWrite) return writeDenied();
          const result = await createAutomationOp(auth.userId, args);
          return result.ok ? text(result) : { ...text(`Error: ${result.error}`), isError: true };
        },
      );
      server.tool(
        "run_automation",
        "Lanza a mano una automatización de Marketería por su id y devuelve el estado (SUCCESS/ERROR) y el log de la ejecución.",
        {
          automationId: z.string().min(1).max(128),
        },
        async ({ automationId }) => {
          if (!canWrite) return writeDenied();
          const result = await runAutomationOp(auth.userId, automationId);
          return result.ok ? text(result) : { ...text(`Error: ${result.error}`), isError: true };
        },
      );
      server.tool(
        "update_automation",
        "Actualiza una automatización de Marketería: nombre, brief de investigación, cron (misma validación que el panel; cadena vacía la deja MANUAL), maxItems y maxAgeMonths. Solo cambia los campos que envíes.",
        {
          automationId: z.string().min(1).max(128),
          name: z.string().min(1).max(200).optional(),
          brief: z.string().min(8).max(4000).optional(),
          cron: z.string().max(80).optional(),
          maxItems: z.number().int().min(3).max(12).optional(),
          maxAgeMonths: z.number().int().min(1).max(24).optional(),
        },
        async ({ automationId, ...changes }) => {
          if (!canWrite) return writeDenied();
          const result = await updateAutomationOp(automationId, changes);
          return result.ok ? text(result) : { ...text(`Error: ${result.error}`), isError: true };
        },
      );
      server.tool(
        "toggle_automation",
        "Activa (isActive=true) o pausa (isActive=false) una automatización de Marketería y re-sincroniza su programación cron.",
        {
          automationId: z.string().min(1).max(128),
          isActive: z.boolean(),
        },
        async ({ automationId, isActive }) => {
          if (!canWrite) return writeDenied();
          const result = await toggleAutomationOp(automationId, isActive);
          return result.ok ? text(result) : { ...text(`Error: ${result.error}`), isError: true };
        },
      );
      server.tool(
        "delete_automation",
        "Borra una automatización de Marketería (y su historial de ejecuciones en cascada) y desprograma su cron. La acción no se puede deshacer.",
        {
          automationId: z.string().min(1).max(128),
        },
        async ({ automationId }) => {
          if (!canWrite) return writeDenied();
          const result = await deleteAutomationOp(automationId);
          return result.ok ? text(result) : { ...text(`Error: ${result.error}`), isError: true };
        },
      );
      server.tool(
        "update_idea",
        "Actualiza una idea editorial de Marketería: título, ángulo, justificación, referenceUrl y/o estado. Las transiciones de estado son las del panel (p. ej. PROPOSED → APPROVED | REJECTED, APPROVED → ARCHIVED); una transición no permitida devuelve error.",
        {
          ideaId: z.string().min(1).max(128),
          title: z.string().min(1).max(300).optional(),
          angle: z.string().max(2000).optional(),
          rationale: z.string().max(4000).optional(),
          status: z.enum(["DRAFT", "PROPOSED", "APPROVED", "REJECTED", "ARCHIVED"]).optional(),
          referenceUrl: z.string().url().max(1000).optional(),
        },
        async ({ ideaId, ...changes }) => {
          if (!canWrite) return writeDenied();
          const result = await updateIdeaOp(auth.userId, ideaId, changes);
          return result.ok ? text(result) : { ...text(`Error: ${result.error}`), isError: true };
        },
      );
      server.tool(
        "delete_idea",
        "Borra una idea de Marketería y, en cascada, sus comentarios y contenidos producidos (con sus creaciones). Devuelve los contadores de lo borrado. La acción no se puede deshacer.",
        {
          ideaId: z.string().min(1).max(128),
        },
        async ({ ideaId }) => {
          if (!canWrite) return writeDenied();
          const result = await deleteIdeaOp(auth.userId, ideaId);
          return result.ok ? text(result) : { ...text(`Error: ${result.error}`), isError: true };
        },
      );
      server.tool(
        "run_research",
        "Lanza una investigación IA en Marketería: busca en la web sobre el brief y crea hallazgos reales con URL y fecha. Por defecto solo devuelve piezas de los últimos 6 meses (ajustable con maxAgeMonths; el filtro no aplica si el brief pide histórico). Si no puede obtener resultados actuales, devuelve un error explicándolo.",
        {
          brief: z.string().min(8).max(4000),
          maxItems: z.number().int().min(3).max(12).optional(),
          maxAgeMonths: z.number().int().min(1).max(24).optional(),
        },
        async ({ brief, maxItems, maxAgeMonths }) => {
          if (!canWrite) return writeDenied();
          const result = await runResearchOp(auth.userId, brief, maxItems, maxAgeMonths);
          if (result.error) return { ...text(result), isError: true };
          return text(result);
        },
      );
      server.tool(
        "create_finding",
        "Inserta un hallazgo externo en la bandeja de investigación de Marketería.",
        {
          title: z.string().min(1).max(300),
          url: z.string().url().optional(),
          snippet: z.string().max(500).optional(),
          summary: z.string().max(20_000).optional(),
          author: z.string().max(200).optional(),
        },
        async (args) => {
          if (!canWrite) return writeDenied();
          return text(await createFindingOp(args));
        },
      );
      server.tool(
        "create_idea",
        "Crea una idea editorial en Marketería. approved=true (default) la deja lista para producir.",
        {
          title: z.string().min(1).max(300),
          angle: z.string().max(2000).optional(),
          rationale: z.string().max(4000).optional(),
          referenceUrl: z.string().url().optional(),
          approved: z.boolean().optional(),
        },
        async (args) => {
          if (!canWrite) return writeDenied();
          return text(await createIdeaOp(auth.userId, args));
        },
      );
      server.tool(
        "create_creation",
        "Inserta una creación YA HECHA (un copy, una newsletter, un post) en Marketería, con su traza idea→contenido→creación. channelType acepta tipo (NEWSLETTER, LINKEDIN…) o nombre del canal.",
        {
          title: z.string().min(1).max(300),
          body: z.string().min(1).max(200_000),
          channelId: z.string().optional(),
          channelType: z.string().max(60).optional(),
        },
        async (args) => {
          if (!canWrite) return writeDenied();
          const result = await createCreationOp(auth.userId, args);
          return result.ok ? text(result) : { ...text(`Error: ${result.error}`), isError: true };
        },
      );
      server.tool(
        "update_agent_prompt",
        "Actualiza un agente de chat de Marketería: systemPrompt, nombre, rol, temperature, maxTokens, icon, isActive y proveedor/modelo (misma validación que el panel de Agentes). Solo cambia los campos que envíes. Los agentes asignados a canales definen cómo se genera el contenido de ese canal.",
        {
          agentId: z.string().min(1).max(128),
          ...agentPatchShape,
        },
        async ({ agentId, ...changes }) => {
          if (!canWrite) return writeDenied();
          const result = await updateAgentOp(auth.userId, agentId, changes);
          return result.ok ? text(result) : { ...text(`Error: ${result.error}`), isError: true };
        },
      );
      server.tool(
        "update_channel_prompt",
        "Actualiza el prompt editorial de un canal de Marketería: systemPrompt (reglas de generación), templateMarkdown (ejemplo de output/estilo) y constraintsJson (restricciones como maxLength, formato o tono). Misma validación que el panel de Canales; null limpia un campo. Solo cambia los campos que envíes. Obtén el channelId con list_channels.",
        {
          channelId: z.string().min(1).max(128),
          ...channelPromptPatchShape,
        },
        async ({ channelId, ...changes }) => {
          if (!canWrite) return writeDenied();
          const result = await updateChannelOp(auth.userId, channelId, changes);
          return result.ok ? text(result) : { ...text(`Error: ${result.error}`), isError: true };
        },
      );
      server.tool(
        "update_brand",
        "Actualiza el perfil de marca de Marketería (el conocimiento editorial que se inyecta al producir contenido): nombre, tono, voz, audiencia, líneas editoriales, qué evitar e identidad visual. Misma validación que el panel Marca. Actualización parcial: solo cambia los campos que envíes; null limpia un campo.",
        {
          ...brandUpdateShape,
        },
        async (changes) => {
          if (!canWrite) return writeDenied();
          const result = await updateBrandOp(auth.userId, changes);
          return result.ok ? text(result) : { ...text(`Error: ${result.error}`), isError: true };
        },
      );
      server.tool(
        "produce_content",
        "Produce en Marketería el contenido de una idea APPROVED y sus creaciones para los canales indicados (usa los agentes de canal, la marca y la validación de carruseles).",
        {
          ideaId: z.string().min(1).max(128),
          channelIds: z.array(z.string()).max(20).optional(),
        },
        async ({ ideaId, channelIds }) => {
          if (!canWrite) return writeDenied();
          const result = await produceIdea(auth.userId, { ideaId, channelIds });
          if (!result.ok) return { ...text(`Error: ${result.error}`), isError: true };
          const { content, contentGenerated, results } = result;
          return text({ content, contentGenerated, results });
        },
      );
    },
    {},
    { basePath: "/api" },
  );
}

async function handler(req: Request) {
  const auth = await verifyApiKey(req);
  if (!auth) {
    return new Response(
      JSON.stringify({
        error:
          "API key inválida o ausente. Conecta con la cabecera Authorization: Bearer spk_… (créala en Admin → Claves API).",
      }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }
  const rate = apiKeyRateCheck(auth.keyId);
  if (rate.limited) {
    return new Response(
      JSON.stringify({ error: "Rate limit excedido (120 peticiones/minuto por clave)." }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "Retry-After": String(rate.retryAfterSeconds),
        },
      },
    );
  }
  return buildHandler(auth)(req);
}

export { handler as GET, handler as POST, handler as DELETE };
