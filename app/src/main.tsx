// Auto-recover from stale chunk errors (happens when GH Pages deploys new version)
window.addEventListener('vite:preloadError', () => {
  if (!sessionStorage.getItem('chunk-reload')) {
    sessionStorage.setItem('chunk-reload', '1');
    window.location.reload();
  }
});

// Fallback for older Vite versions / browsers
window.addEventListener('error', (event) => {
  const isChunkError =
    event.message?.includes('Failed to fetch dynamically imported module') ||
    event.message?.includes('Importing a module script failed') ||
    (event.filename && event.filename.includes('/assets/') && event.filename.endsWith('.js'));

  if (isChunkError && !sessionStorage.getItem('chunk-reload')) {
    sessionStorage.setItem('chunk-reload', '1');
    window.location.reload();
  }
});

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { AuthProvider, ThemeProvider } from "./app/providers";
import { BrandProvider } from "./brand";
import { App } from "./App";

// Self-hosted. A page whose thesis is "no data leaving the building" cannot send
// every visitor's IP to fonts.googleapis.com before the headline paints — and for
// a German GmbH that request is a live GDPR exposure. Self-hosting also removes a
// render-blocking third-party round trip and works in a packaged Tauri build with
// no network. Archivo ships the wdth axis, which the display type uses.
//
// These must be imported from JS, not via `@import` in index.css — Tailwind v4's
// PostCSS plugin inlines CSS imports before Vite can register the woff2 files as
// assets, which emits @font-face rules pointing at files that were never built.
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";

async function prepare() {
  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    const { worker } = await import('./mocks/browser');
    await worker.start({
      onUnhandledRequest: 'bypass',
      serviceWorker: {
        url: `${import.meta.env.BASE_URL}mockServiceWorker.js`,
      },
    });
  }
}

const Router = import.meta.env.VITE_DEMO_MODE === 'true' ? HashRouter : BrowserRouter;

prepare().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <Router>
        <BrandProvider>
          <ThemeProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ThemeProvider>
        </BrandProvider>
      </Router>
    </React.StrictMode>,
  );
});
