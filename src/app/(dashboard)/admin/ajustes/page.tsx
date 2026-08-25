import { prisma } from "@/lib/prisma";
import { GOOGLE_SETTING_KEYS, getGoogleAuthAdminView } from "@/lib/auth/google-auth";
import { SMTP_SETTING_KEYS, getSmtpConfig } from "@/lib/mail/smtp";
import { BACKUP_SETTING_KEYS } from "@/lib/backups/service";
import { SettingsEditor } from "./settings-editor";
import { GoogleAuthSection } from "./google-auth-section";
import { SmtpSection } from "./smtp-section";
import { WhatsAppSection } from "./whatsapp-section";
import { WHATSAPP_SETTING_KEYS, getWhatsAppConfig } from "@/lib/whatsapp/config";

export const dynamic = "force-dynamic";

export default async function SettingsAdminPage() {
  // Claves en desuso: se filtran para no mostrar ajustes muertos.
  // Los `google_*` y `smtp_*` tienen su propia sección (secretos cifrados),
  // los `backup_*` se gestionan en Copias de seguridad, `budget_usd_monthly`
  // en Consumo IA y `ai.priceAutoRefresh` es un registro interno del refresco
  // de tarifas — ninguno debe aparecer como ajuste editable en crudo.
  const OBSOLETE_KEYS = ["ai_default_mode", "ai_phase_mode_overrides"];
  const MANAGED_ELSEWHERE_KEYS = ["budget_usd_monthly", "ai.priceAutoRefresh"];
  const HIDDEN_KEYS = [
    ...OBSOLETE_KEYS,
    ...MANAGED_ELSEWHERE_KEYS,
    ...GOOGLE_SETTING_KEYS,
    ...SMTP_SETTING_KEYS,
    ...BACKUP_SETTING_KEYS,
    ...WHATSAPP_SETTING_KEYS,
  ];

  const [settings, googleAuth, smtp, whatsapp, whatsappSource] = await Promise.all([
    prisma.appSetting.findMany({ orderBy: { key: "asc" } }),
    getGoogleAuthAdminView(),
    getSmtpConfig(),
    getWhatsAppConfig(),
    prisma.source.findFirst({
      where: { type: "WHATSAPP" },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, _count: { select: { findings: true } } },
    }),
  ]);
  // `/+$`, no `/$`: con más de una barra final quedaría una dirección de
  // retorno con doble barra, y esa es la que se copia y se pega en Google.
  const origin = (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="display-md">Ajustes</h1>
        <p className="text-sm text-muted-foreground">
          Acceso con Google, email (SMTP), entrada de WhatsApp y ajustes
          avanzados. El presupuesto de IA se configura en Consumo IA y las
          copias en Copias de seguridad.
        </p>
      </header>
      <GoogleAuthSection initial={googleAuth} origin={origin} />
      <SmtpSection initial={smtp} />
      <WhatsAppSection
        initial={whatsapp}
        source={
          whatsappSource
            ? {
                id: whatsappSource.id,
                name: whatsappSource.name,
                findings: whatsappSource._count.findings,
              }
            : null
        }
        origin={origin}
      />
      <SettingsEditor
        initial={settings
          .filter((s) => !HIDDEN_KEYS.includes(s.key))
          .map((s) => ({ ...s, updatedAt: s.updatedAt.toISOString() }))}
      />
    </div>
  );
}
