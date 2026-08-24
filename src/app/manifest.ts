import type { MetadataRoute } from "next";

// Web App Manifest: lo que permite instalar spAIder como aplicación en el móvil
// y en el escritorio (icono propio, sin barra del navegador).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SpAIder",
    short_name: "SpAIder",
    description: "Pipeline editorial con IA",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    lang: "es",
    // Crema del sistema visual: el splash casa con los iconos (marca en
    // tinta sobre crema).
    background_color: "#F5F4EF",
    theme_color: "#F5F4EF",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "maskable" },
      { src: "/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
