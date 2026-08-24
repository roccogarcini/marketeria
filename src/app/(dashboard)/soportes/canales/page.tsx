import { redirect } from "next/navigation";

// La gestión de canales vive en Módulos · Canales (/modulos/canales):
// esta ruta redirige allí.
export default function ChannelsLegacyRedirect() {
  redirect("/modulos/canales");
}
