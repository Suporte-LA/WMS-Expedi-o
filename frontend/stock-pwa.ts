import { createHash } from "node:crypto";
import type { Plugin } from "vite";

// Only emitted for the isolated development build, never for the public build.
export function stockPwa(): Plugin {
  return {
    name: "stock-development-pwa",
    apply: "build",
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((name) => !name.endsWith(".map"))
        .map((name) => "/" + name);
      const revision = createHash("sha256")
        .update(JSON.stringify(files))
        .digest("hex")
        .slice(0, 16);
      this.emitFile({
        type: "asset",
        fileName: "stock-icon.svg",
        source:
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="36" fill="#115e59"/><path d="M36 58h120v90H36zM36 58l60-30 60 30M96 58v90" fill="none" stroke="white" stroke-width="10"/></svg>',
      });
      this.emitFile({
        type: "asset",
        fileName: "stock.webmanifest",
        source: JSON.stringify({
          name: "WMS Estoque · Desenvolvimento",
          short_name: "Estoque DEV",
          lang: "pt-BR",
          start_url: "/estoque",
          scope: "/estoque",
          display: "standalone",
          background_color: "#f4f7f6",
          theme_color: "#115e59",
          icons: [
            {
              src: "/stock-icon.svg",
              sizes: "any",
              type: "image/svg+xml",
              purpose: "any maskable",
            },
          ],
        }),
      });
      this.emitFile({
        type: "asset",
        fileName: "stock-sw.js",
        source: `
const CACHE='wms-stock-shell-${revision}';
const ASSETS=${JSON.stringify([...files, "/index.html", "/stock-icon.svg", "/stock.webmanifest"])};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll([...new Set(ASSETS)]))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('wms-stock-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const url=new URL(e.request.url);if(e.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
if(e.request.mode==='navigate'&&url.pathname==='/estoque'){e.respondWith(fetch(e.request).catch(()=>caches.open(CACHE).then(c=>c.match('/index.html'))));return;}
if(ASSETS.includes(url.pathname))e.respondWith(caches.open(CACHE).then(async c=>(await c.match(url.pathname))||fetch(e.request)));});`,
      });
    },
  };
}
