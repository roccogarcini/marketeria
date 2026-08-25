import type { Metadata, Viewport } from "next";
import { Anton, Archivo, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { PwaRegister } from "@/components/pwa-register";

// Tipografía del manual de Marketería: Anton para títulos y cifras (siempre
// en caja alta), Archivo para cuerpo e interfaz. El mono se queda para lo que
// es literalmente código (comandos MCP, claves), que Archivo no sabe alinear.
const anton = Anton({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-anton",
  display: "swap",
});

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Marketería",
  description:
    "Marketería — pipeline editorial con IA. La IA investiga fuentes, tú apruebas las ideas, y Marketería produce las piezas adaptadas a cada canal.",
  // Instalada en iOS: a pantalla completa y con su nombre corto bajo el icono.
  appleWebApp: { capable: true, title: "Marketería", statusBarStyle: "default" },
};

// Barra del sistema a juego con el fondo de la app en cada tema.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F2F3F6" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1230" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${archivo.variable} ${anton.variable} ${jetbrainsMono.variable}`}
    >
      <body className="relative min-h-screen font-sans antialiased">
        <Providers>{children}</Providers>
        <PwaRegister />
      </body>
    </html>
  );
}
