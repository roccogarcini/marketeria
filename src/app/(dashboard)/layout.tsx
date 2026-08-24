import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileHeader } from "@/components/layout/mobile-header";
import { BackLink } from "@/components/layout/back-link";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const user = {
    id: session.user.id,
    name: session.user.name ?? "",
    email: session.user.email ?? "",
    role: session.user.role,
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MobileHeader user={user} />
        <main className="flex-1 overflow-y-auto">
          <div className="flex w-full flex-col gap-4 px-5 pb-16 pt-6 sm:px-8">
            <BackLink />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
