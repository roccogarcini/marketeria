import type { MetadataRoute } from "next";

// Web App Manifest: lo que permite instalar Marketería como aplicación en el móvil
// y en el escritorio (icono propio, sin barra del navegador).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Marketería",
    short_name: "Marketería",
    description: "Pipeline editorial con IA",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    lang: "es",
    // Marino de marca: el splash casa con los iconos (M blanca sobre marino).
    background_color: "#121F4A",
    theme_color: "#121F4A",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // "maskable": Android recorta en círculo, por eso llevan más aire.
      { src: "/icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
