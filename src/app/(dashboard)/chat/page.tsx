import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ChatPanel } from "./chat-panel";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const session = await auth();
  const userId = session!.user.id;
  const [sessions, agents] = await Promise.all([
    prisma.chatSession.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 30,
    }),
    prisma.agent.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <ChatPanel
      sessions={sessions.map((s) => ({
        id: s.id,
        title: s.title,
        updatedAt: s.updatedAt.toISOString(),
      }))}
      agents={agents.map((a) => ({ id: a.id, name: a.name, role: a.role }))}
    />
  );
}
