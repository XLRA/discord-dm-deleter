import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              // Electron 28+ supports ESM main. Force pure-ESM output so
              // import.meta.url / import.meta.dirname work correctly and
              // we don't end up with CJS `require()` calls in a .mjs file.
              output: {
                format: "es",
                entryFileNames: "main.js",
              },
              // Only the `electron` runtime is provided by the host; everything
              // else (electron-store, etc.) must be bundled into main.js
              // because our packaged asar does not ship node_modules.
              external: ["electron"],
            },
          },
        },
      },
      preload: {
        input: "electron/preload.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              // Preload must be ESM with .mjs extension when running in a
              // context-isolated, non-sandboxed renderer in Electron 28+.
              output: {
                format: "es",
                entryFileNames: "preload.mjs",
                inlineDynamicImports: true,
              },
              external: ["electron"],
            },
          },
        },
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
