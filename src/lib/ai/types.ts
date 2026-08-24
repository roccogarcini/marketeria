export type Phase =
  | "RESEARCH"
  | "ANALYSIS"
  | "IDEATION"
  | "PRODUCTION"
  | "ASSET"
  | "CHAT";
/** La app es 100% API; el modo de ejecución siempre es "API". */
export type ExecutionMode = "API";
export type ExecutionStatus = "PENDING" | "RUNNING" | "SUCCESS" | "ERROR";

export type AIRequest = {
  phase: Phase;
  agentId?: string | null;
  refType?: string; // ej. "idea", "content", "analysis_run"
  refId?: string;
  systemPrompt?: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  // Permite al caller forzar proveedor específico (si no se infiere del agent/ProcessConfig)
  providerType?: "OPENAI" | "ANTHROPIC" | "OPENROUTER" | "CUSTOM" | "ZAI" | "DEEPSEEK" | "GEMINI";
  // Fuerza una INSTANCIA de proveedor concreta (por id). Tiene prioridad sobre
  // providerType: permite distinguir dos proveedores del mismo tipo (p. ej. dos
  // z.ai, coding y estándar). Es lo que asigna cada agente.
  providerId?: string;
};

export type AIResult = {
  executionId: string;
  mode: ExecutionMode;
  status: ExecutionStatus;
  output: string;
  error: string | null;
  tokenUsage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  } | null;
  durationMs: number;
  /** Proveedor LLM realmente usado (puede diferir del pedido si hubo fallback). */
  provider?: string | null;
  /** Modelo realmente usado. */
  model?: string | null;
  /** Si el proveedor preferido falló y se usó otro, motivo legible. */
  fallbackReason?: string | null;
};
