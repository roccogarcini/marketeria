import { prisma } from "@/lib/prisma";
import { runAPI } from "./api";
import {
  listActiveLLMProviderInstances,
  type LLMProviderInstance,
} from "./providers";
import { BudgetExceededError, budgetBlockReason } from "./budget";
import type { AIRequest, AIResult } from "./types";

/**
 * Corte por presupuesto, común a execute() y trackExecution().
 *
 * Si el tope mensual está superado, deja constancia del bloqueo en
 * `AIExecution` (status ERROR, sin tokens) y devuelve la fila + el mensaje.
 * Dejar el rastro es intencionado: /admin/consumo —donde vive el tope— es
 * justo el sitio donde el operador va a buscar por qué no se ejecuta nada.
 * Si el registro fallara, el bloqueo se aplica igualmente.
 *
 * Devuelve null cuando se puede ejecutar.
 */
async function budgetBlock(
  req: Pick<AIRequest, "phase" | "agentId" | "refType" | "refId" | "model">,
): Promise<{ executionId: string | null; message: string } | null> {
  const message = await budgetBlockReason();
  if (!message) return null;
  console.error(`[budget] llamada bloqueada (${req.phase}): ${message}`);
  const execution = await prisma.aIExecution
    .create({
      data: {
        phase: req.phase,
        agentId: req.agentId ?? null,
        refType: req.refType ?? null,
        refId: req.refId ?? null,
        executionMode: "API",
        status: "ERROR",
        modelUsed: req.model ?? null,
        errorMessage: message,
        durationMs: 0,
      },
    })
    .catch(() => null);
  return { executionId: execution?.id ?? null, message };
}

/**
 * Ejecuta una petición IA contra el proveedor LLM configurado (vía API), con
 * fallback: si el proveedor preferido falla, prueba los demás activos en orden.
 * Registra la ejecución en `AIExecution` para observabilidad.
 *
 * La app es 100% API: el motor de ejecución siempre es un proveedor LLM
 * (OpenAI/Anthropic/OpenRouter/compatibles) configurado en /admin/proveedores.
 */
export async function execute(
  userId: string,
  req: AIRequest,
): Promise<AIResult> {
  const startedAt = Date.now();

  // Tope mensual: se comprueba ANTES de tocar al proveedor. Sin tope
  // configurado no corta nada (ver budget.ts).
  const blocked = await budgetBlock(req);
  if (blocked) {
    return {
      executionId: blocked.executionId ?? "",
      mode: "API",
      status: "ERROR",
      output: "",
      error: blocked.message,
      tokenUsage: null,
      durationMs: Date.now() - startedAt,
      provider: null,
      model: null,
      fallbackReason: null,
    };
  }

  const execution = await prisma.aIExecution.create({
    data: {
      phase: req.phase,
      agentId: req.agentId ?? null,
      refType: req.refType ?? null,
      refId: req.refId ?? null,
      executionMode: "API",
      status: "RUNNING",
      modelUsed: req.model ?? null,
    },
  });

  // Orden de intentos por INSTANCIA. Preferida primero (la instancia asignada
  // por id, o si no la primera del tipo pedido), luego el resto como respaldo.
  const active = await listActiveLLMProviderInstances(userId);
  let primary: LLMProviderInstance | undefined;
  if (req.providerId) {
    primary = active.find((p) => p.id === req.providerId);
  }
  if (!primary && req.providerType) {
    primary = active.find((p) => p.providerType === req.providerType);
  }
  const order: LLMProviderInstance[] = primary
    ? [primary, ...active.filter((p) => p.id !== primary!.id)]
    : active;

  let output = "";
  let tokenUsage: AIResult["tokenUsage"] = null;
  let error: string | null = null;
  let status: AIResult["status"] = "SUCCESS";
  let usedProvider: string | null = null;
  let usedModel: string | null = null;
  let fallbackReason: string | null = null;

  if (order.length === 0) {
    // Sin proveedores: dejamos que runAPI dé el mensaje claro de siempre.
    try {
      await runAPI(userId, req);
    } catch (err) {
      status = "ERROR";
      error =
        err instanceof Error ? err.message : "No hay proveedor LLM activo.";
    }
  } else {
    const errors: string[] = [];
    for (let i = 0; i < order.length; i++) {
      const inst = order[i];
      const isPrimary = primary ? inst.id === primary.id : i === 0;
      try {
        // El modelo forzado (el que tiene asignado el agente) pertenece a SU
        // instancia: si caemos a otro proveedor de respaldo, no arrastramos ese
        // modelId (sería inexistente) → ese proveedor usa su modelo por defecto.
        const model = isPrimary ? req.model : undefined;
        const r = await runAPI(userId, { ...req, providerId: inst.id, model });
        output = r.output;
        tokenUsage = r.tokenUsage;
        usedProvider = inst.providerType;
        usedModel = r.model;
        if (!isPrimary) {
          fallbackReason = `El proveedor ${order[0].displayName} falló; se usó ${inst.displayName} como respaldo.`;
        }
        break;
      } catch (err) {
        errors.push(
          `${inst.displayName}: ${err instanceof Error ? err.message : "error desconocido"}`,
        );
      }
    }
    if (!usedProvider) {
      status = "ERROR";
      error = `Todos los proveedores fallaron. ${errors.join(" · ")}`;
    }
  }

  const durationMs = Date.now() - startedAt;
  await prisma.aIExecution.update({
    where: { id: execution.id },
    data: {
      status,
      executionMode: "API",
      modelUsed: usedModel ?? req.model ?? null,
      errorMessage: error,
      durationMs,
      inputTokens: tokenUsage?.promptTokens ?? null,
      outputTokens: tokenUsage?.completionTokens ?? null,
    },
  });

  return {
    executionId: execution.id,
    mode: "API",
    status,
    output,
    error,
    tokenUsage,
    durationMs,
    provider: usedProvider,
    model: usedModel,
    fallbackReason,
  };
}

/** Lo que devuelve la llamada envuelta por trackExecution(). */
export type TrackedCall<T> = {
  /** Valor que se devuelve al caller (trackExecution es transparente). */
  value: T;
  /** Modelo realmente usado, si el proveedor lo informa. */
  model?: string | null;
  tokenUsage?: AIResult["tokenUsage"];
};

/**
 * Registra en `AIExecution` una llamada al LLM que NO puede pasar por
 * execute(): las búsquedas web NATIVAS usan formato propio del proveedor
 * (modelos `*-search-preview` de OpenAI, tool `web_search` de z.ai contra su
 * endpoint nativo) y runAPI —el motor de execute()— solo sabe hacer chat
 * completions estándar. Sin esto, esas llamadas no aparecían en /admin/consumo:
 * una investigación podían ser 8-10 llamadas de coste invisible.
 *
 * Escribe la misma fila y los mismos campos que execute(), para que el consumo
 * se agregue por el mismo camino. Es transparente: propaga el error tal cual
 * después de marcar la ejecución como ERROR.
 */
export async function trackExecution<T>(
  req: Pick<AIRequest, "phase" | "agentId" | "refType" | "refId" | "model">,
  call: () => Promise<TrackedCall<T>>,
): Promise<T> {
  const startedAt = Date.now();

  // Mismo corte que en execute(). Aquí SÍ lanzamos: trackExecution es
  // transparente y sus callers (búsqueda web nativa) esperan excepciones; el
  // BudgetExceededError acaba en `attempts` de la investigación y de ahí al
  // mensaje de error que ve el operador.
  const blocked = await budgetBlock(req);
  if (blocked) throw new BudgetExceededError(blocked.message);

  const execution = await prisma.aIExecution.create({
    data: {
      phase: req.phase,
      agentId: req.agentId ?? null,
      refType: req.refType ?? null,
      refId: req.refId ?? null,
      executionMode: "API",
      status: "RUNNING",
      modelUsed: req.model ?? null,
    },
  });

  try {
    const result = await call();
    await prisma.aIExecution.update({
      where: { id: execution.id },
      data: {
        status: "SUCCESS",
        executionMode: "API",
        modelUsed: result.model ?? req.model ?? null,
        durationMs: Date.now() - startedAt,
        inputTokens: result.tokenUsage?.promptTokens ?? null,
        outputTokens: result.tokenUsage?.completionTokens ?? null,
      },
    });
    return result.value;
  } catch (err) {
    await prisma.aIExecution
      .update({
        where: { id: execution.id },
        data: {
          status: "ERROR",
          errorMessage: err instanceof Error ? err.message : "Error desconocido",
          durationMs: Date.now() - startedAt,
        },
      })
      // Un fallo al registrar nunca debe tapar el error real de la llamada.
      .catch(() => {});
    throw err;
  }
}
