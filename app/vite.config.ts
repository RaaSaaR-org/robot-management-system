import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// White-label: resolve brand name for HTML title injection
function brandHtmlPlugin(): Plugin {
  let brandName = 'NeoDEM';
  let brandTagline = 'The Open Physical AI Platform';
  const brandConfigPath = path.resolve(__dirname, '../brand/brand.config.ts');
  if (fs.existsSync(brandConfigPath)) {
    const content = fs.readFileSync(brandConfigPath, 'utf-8');
    const nameMatch = content.match(/name:\s*['"]([^'"]+)['"]/);
    const taglineMatch = content.match(/tagline:\s*['"]([^'"]+)['"]/);
    if (nameMatch) brandName = nameMatch[1];
    if (taglineMatch) brandTagline = taglineMatch[1];
  }
  return {
    name: 'brand-html',
    transformIndexHtml(html) {
      return html
        .replace('__BRAND_TITLE__', `${brandName} — ${brandTagline}`)
        .replace('__BRAND_DESCRIPTION__', `${brandName} — ${brandTagline}`);
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  base: process.env.VITE_DEMO_MODE === 'true'
    ? '/robot-management-system/'
    : '/',
  plugins: [react(), brandHtmlPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "/brand": path.resolve(__dirname, "../brand"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || true,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**", "**/server/**", "**/packages/**"],
    },
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true, ws: true },
      '/.well-known': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
}));
