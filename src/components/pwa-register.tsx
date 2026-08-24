'use client';

import { useEffect } from 'react';

/**
 * Registra el service worker, que es lo que permite instalar la app.
 *
 * No cachea nada (ver public/sw.js): que falle no rompe la aplicación, solo
 * hace que el navegador no ofrezca «Instalar». En desarrollo no se registra
 * para no meterse en medio del recarga en caliente de Next.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[pwa] no se pudo registrar el service worker', err);
    });
  }, []);

  return null;
}
