import { redirect } from "next/navigation";

// La bandeja de hallazgos vive en /investigacion: esta ruta redirige allí.
export default function FindingsLegacyRedirect() {
  redirect("/investigacion");
}
