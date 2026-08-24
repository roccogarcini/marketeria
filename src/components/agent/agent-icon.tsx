import {
  Bot,
  Brain,
  Feather,
  Share2,
  Lightbulb,
  Sparkles,
  MessageSquare,
  Megaphone,
  Palette,
  Code2,
  PenTool,
  Eye,
  Target,
  ScanSearch,
  type LucideIcon,
} from "lucide-react";

/**
 * Lista curada de iconos lucide disponibles para agentes. La clave es lo que
 * se guarda en `Agent.icon` (string nullable). El form de edición usa esta
 * misma lista para el picker — añadir un icono aquí lo expone en ambos sitios.
 */
export const AGENT_ICONS: Array<{ name: string; Icon: LucideIcon }> = [
  { name: "bot", Icon: Bot },
  { name: "brain", Icon: Brain },
  { name: "feather", Icon: Feather },
  { name: "share-2", Icon: Share2 },
  { name: "lightbulb", Icon: Lightbulb },
  { name: "sparkles", Icon: Sparkles },
  { name: "message-square", Icon: MessageSquare },
  { name: "megaphone", Icon: Megaphone },
  { name: "palette", Icon: Palette },
  { name: "code-2", Icon: Code2 },
  { name: "pen-tool", Icon: PenTool },
  { name: "eye", Icon: Eye },
  { name: "target", Icon: Target },
  { name: "scan-search", Icon: ScanSearch },
];

const ICON_MAP: Record<string, LucideIcon> = Object.fromEntries(
  AGENT_ICONS.map((i) => [i.name, i.Icon]),
);

export function AgentIcon({
  name,
  className,
}: {
  name?: string | null;
  className?: string;
}) {
  const Icon = (name && ICON_MAP[name]) || Bot;
  return <Icon className={className} />;
}
