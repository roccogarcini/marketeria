"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Send, Plus, Trash2, MessageSquare } from "lucide-react";

type Session = { id: string; title: string; updatedAt: string };
type Agent = { id: string; name: string; role: string };
type Message = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
};

export function ChatPanel({
  sessions,
  agents,
}: {
  sessions: Session[];
  agents: Agent[];
}) {
  const [localSessions, setLocalSessions] = useState<Session[]>(sessions);
  const [activeId, setActiveId] = useState<string | null>(sessions[0]?.id ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [agentId, setAgentId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeId) return;
    (async () => {
      const res = await fetch(`/api/chat/${activeId}`);
      if (!res.ok) return;
      const data = await res.json();
      setMessages(
        data.session.messages.map(
          (m: {
            id: string;
            role: string;
            content: string;
            createdAt: string;
          }) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
          }),
        ),
      );
    })();
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function newSession() {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) return;
    const data = await res.json();
    const s = {
      id: data.session.id,
      title: data.session.title,
      updatedAt: data.session.updatedAt,
    };
    setLocalSessions([s, ...localSessions]);
    setActiveId(s.id);
    setMessages([]);
  }

  async function removeSession(id: string) {
    if (!confirm("¿Eliminar conversación?")) return;
    await fetch(`/api/chat/${id}`, { method: "DELETE" });
    setLocalSessions(localSessions.filter((s) => s.id !== id));
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
  }

  async function send() {
    if (!activeId || !input.trim()) return;
    setBusy(true);
    setError(null);
    const userMsg: Message = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: input,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, userMsg]);
    const body = { content: input, ...(agentId ? { agentId } : {}) };
    setInput("");
    const res = await fetch(`/api/chat/${activeId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Error IA");
      return;
    }
    setMessages((m) => [...m, data.message]);
  }

  return (
    <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[240px_1fr]">
      <aside className="glass-card flex flex-col gap-2 p-3">
        <Button onClick={newSession} size="sm"><Plus className="h-4 w-4" /> Nueva</Button>
        <div className="flex flex-1 flex-col gap-1 overflow-auto">
          {localSessions.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">Sin conversaciones.</p>
          )}
          {localSessions.map((s) => (
            <div
              key={s.id}
              className={`group flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-2 text-sm ${
                activeId === s.id ? "bg-primary/15 text-foreground" : "hover:bg-accent/50"
              }`}
              onClick={() => setActiveId(s.id)}
            >
              <div className="flex min-w-0 items-center gap-2">
                <MessageSquare className="h-3 w-3 shrink-0" />
                <span className="truncate">{s.title}</span>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeSession(s.id); }}
                className="opacity-0 transition-opacity group-hover:opacity-100"
                aria-label="Eliminar"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex items-center gap-2">
          <Select
            value={agentId || "__none"}
            onValueChange={(v) => setAgentId(v === "__none" ? "" : v)}
          >
            <SelectTrigger className="h-9 w-auto min-w-0 max-w-full sm:min-w-[14rem]">
              <SelectValue placeholder="Sin agente" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Sin agente</SelectItem>
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} — {a.role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {agentId && <Badge variant="outline">agente activo</Badge>}
        </div>

        {error && (
          <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="glass-card flex flex-1 flex-col gap-3 overflow-auto p-4">
          {!activeId && (
            <p className="m-auto text-sm text-muted-foreground">Selecciona o crea una conversación.</p>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "bg-primary/20"
                    : m.role === "assistant"
                    ? "bg-accent/30"
                    : "bg-muted/30 text-muted-foreground"
                }`}
              >
                <div className="mb-1 flex items-center justify-between gap-3 text-[10px] uppercase text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <span>{m.role}</span>
                  </div>
                  <span>{new Date(m.createdAt).toLocaleTimeString("es-ES")}</span>
                </div>
                {m.role === "user" ? (
                  <p className="whitespace-pre-wrap">{m.content}</p>
                ) : (
                  <div className="prose prose-sm dark:prose-invert max-w-none break-words prose-p:my-2 prose-headings:mt-3 prose-headings:mb-1.5 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-code:rounded prose-code:bg-background/60 prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none prose-pre:rounded-md prose-pre:bg-background/50 prose-strong:text-foreground">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeSanitize]}
                    >
                      {m.content}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {activeId && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="glass-card flex gap-2 p-3"
          >
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribe tu mensaje…"
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <Button type="submit" disabled={busy || !input.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
