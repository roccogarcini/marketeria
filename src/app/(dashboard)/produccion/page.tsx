import { redirect } from "next/navigation";

// La producción vive dentro de Ideas: esta ruta redirige allí.
export default function ProductionLegacyRedirect() {
  redirect("/ideas");
}
