import { redirect } from "next/navigation";

// Redirect a Módulos · Canales (/modulos/canales).
export default function SoportesLegacyRedirect() {
  redirect("/modulos/canales");
}
