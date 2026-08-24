import { redirect } from "next/navigation";

// El análisis vive dentro de Investigación: esta ruta redirige allí.
export default function AnalysisLegacyRedirect() {
  redirect("/investigacion");
}
