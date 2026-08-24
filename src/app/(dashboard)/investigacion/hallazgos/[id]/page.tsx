import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FindingActions } from "./finding-actions";
import {
  ArrowLeft,
  ExternalLink,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  Flame,
  TrendingUp,
  Calendar,
  UserRound,
  Globe,
  Rss,
  PenLine,
} from "lucide-react";
import { computeFindingScores, pct } from "@/lib/research/scores";
import { materialLevel } from "@/lib/research/material";
import { MaterialBadge } from "@/components/research/material-badge";

export const dynamic = "force-dynamic";

type Params = { id: string };

function iconForSourceType(type: string) {
  const t = type.toUpperCase();
  if (t === "RSS") return Rss;
  if (t === "URL") return Globe;
  if (t === "MANUAL") return PenLine;
  return Globe;
}

function formatNumber(n: number | null): string {
  if (n === null || n === undefined || n === 0) return "—";
  return new Intl.NumberFormat("es-ES").format(n);
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(d);
}

export default async function FindingDetail({
  params,
}: {
  params: Promise<Params>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;
  const finding = await prisma.finding.findUnique({
    where: { id },
    include: { source: { select: { name: true, type: true, url: true } } },
  });
  if (!finding) notFound();

  const SourceIcon = iconForSourceType(finding.source.type);
  const totalReactions =
    (finding.likes ?? 0) + (finding.comments ?? 0) + (finding.shares ?? 0);
  const scores = computeFindingScores({
    reach: finding.reach,
    likes: finding.likes,
    comments: finding.comments,
    shares: finding.shares,
    publishedAt: finding.publishedAt,
  });
  const viralityPct = pct(scores.virality);
  const potentialPct = pct(scores.potential);

  return (
    <div className="flex flex-col gap-6">
      {/* Volver */}
      <div>
        <Button asChild variant="ghost" size="sm" className="text-xs">
          <Link href="/investigacion">
            <ArrowLeft className="h-3 w-3" /> Volver a la bandeja
          </Link>
        </Button>
      </div>

      {/* Cabecera */}
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          <Badge
            variant={finding.status === "NEW" ? "default" : "outline"}
            className="text-[10px]"
          >
            {finding.status}
          </Badge>
          <span>fase 1 · investigación</span>
        </div>
        <h1 className="display-md">
          {finding.title}
        </h1>
        {finding.url && (
          <a
            href={finding.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-foreground hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Ver original
          </a>
        )}
        <FindingActions findingId={finding.id} status={finding.status} />
        {/* Semáforo de materia prima: cuánto contenido real hay para trabajar */}
        <div className="max-w-xl">
          <MaterialBadge
            level={materialLevel(finding)}
            findingId={finding.id}
            canEnrich={Boolean(finding.url)}
          />
        </div>
      </header>

      {/* Stats crudas */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Eye className="h-4 w-4" />}
          label="Alcance"
          value={formatNumber(finding.reach)}
        />
        <StatCard
          icon={<Heart className="h-4 w-4" />}
          label="Reacciones"
          value={formatNumber(finding.likes)}
        />
        <StatCard
          icon={<MessageCircle className="h-4 w-4" />}
          label="Comentarios"
          value={formatNumber(finding.comments)}
        />
        <StatCard
          icon={<Share2 className="h-4 w-4" />}
          label="Compartidos"
          value={formatNumber(finding.shares)}
        />
      </section>

      {/* Scores calculados (sin IA, fórmula determinista) */}
      <section className="grid gap-3 sm:grid-cols-2">
        <ScoreCard
          icon={<Flame className="h-4 w-4" />}
          label="Viralidad"
          value={viralityPct}
          hint="Calculada desde share rate + engagement + conversación."
        />
        <ScoreCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Potencialidad"
          value={potentialPct}
          hint="Calculada desde alcance (log), engagement y frescura."
        />
      </section>

      {/* Metadatos */}
      <section className="glass-card flex flex-col gap-3 p-4 md:flex-row md:flex-wrap md:items-center md:gap-6">
        <Meta
          icon={<SourceIcon className="h-4 w-4" />}
          label="Fuente"
          value={`${finding.source.name} (${finding.source.type})`}
        />
        {finding.author && (
          <Meta
            icon={<UserRound className="h-4 w-4" />}
            label="Autor"
            value={finding.author}
          />
        )}
        {finding.publishedAt && (
          <Meta
            icon={<Calendar className="h-4 w-4" />}
            label="Publicado"
            value={formatDate(finding.publishedAt)}
          />
        )}
        <Meta
          icon={<Calendar className="h-4 w-4 opacity-60" />}
          label="Recogido"
          value={formatDate(finding.fetchedAt)}
        />
      </section>

      {/* Resumen */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground/80">
          Resumen
        </h2>
        {finding.summary ? (
          <div className="glass-card whitespace-pre-wrap p-5 text-sm leading-relaxed">
            {finding.summary}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border/50 p-5 text-sm text-muted-foreground">
            Sin resumen todavía.
            {finding.snippet && (
              <p className="mt-2 italic">{finding.snippet}</p>
            )}
          </div>
        )}
      </section>

      {/* Contenido completo (traído por el enriquecimiento) */}
      {finding.fullContent && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground/80">
            Contenido completo
          </h2>
          <details className="glass-card p-5">
            <summary className="cursor-pointer text-sm font-medium">
              Ver texto original ({Math.round(finding.fullContent.length / 1000)}k
              caracteres) — es la materia prima que usará la IA
            </summary>
            <div className="mt-3 max-h-[420px] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {finding.fullContent}
            </div>
          </details>
        </section>
      )}

      {/* Snippet si existe y es distinto al resumen */}
      {finding.snippet && finding.summary && (
        <section className="flex flex-col gap-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Extracto breve
          </h2>
          <p className="text-sm italic text-muted-foreground">
            {finding.snippet}
          </p>
        </section>
      )}

      {/* Estadística agregada visible */}
      {totalReactions === 0 && (finding.reach ?? 0) === 0 && (
        <div className="rounded-xl border border-dashed border-border/50 p-4 text-xs text-muted-foreground">
          Esta investigación no tiene métricas públicas de alcance o reacción
          (probablemente es una nota interna del equipo).
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="glass-card flex items-center gap-3 p-4">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-foreground">
        {icon}
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <span className="text-lg font-semibold tabular-nums">{value}</span>
      </div>
    </div>
  );
}

function ScoreCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  hint: string;
}) {
  const width = value !== null ? `${Math.max(2, value)}%` : "0%";
  return (
    <div className="glass-card flex flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-foreground">
          {icon}
        </div>
        <div className="flex-1 leading-tight">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {label}
          </div>
          <div className="text-lg font-semibold tabular-nums">
            {value !== null ? `${value}/100` : "—"}
          </div>
        </div>
      </div>
      {/* Barra visual */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width }}
        />
      </div>
      <p className="text-[10px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function Meta({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-background/60 text-foreground/80">
        {icon}
      </span>
      <div className="flex flex-col leading-tight">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <span className="text-sm font-medium">{value}</span>
      </div>
    </div>
  );
}
