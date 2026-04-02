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
