import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="display-md">Mi perfil</h1>
        <p className="text-sm text-muted-foreground">
          Tu nombre, email y contraseña. Los cambios de email o contraseña
          cierran la sesión para volver a entrar con las credenciales nuevas.
        </p>
      </header>
      <ProfileForm
        initial={{
          name: session.user.name ?? "",
          email: session.user.email ?? "",
        }}
      />
    </div>
  );
}
