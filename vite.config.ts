import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 4173,
    strictPort: true
  },
  preview: {
    port: 4173,
    strictPort: true
  },
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/three/examples/")) return "three-addons";
          if (id.includes("/three/")) return "three-core";
          if (id.includes("/src/render/")) {
            return "world-renderer";
          }
          if (id.endsWith("/src/ui/HUD.ts")) return "hud";
          if (
            id.endsWith("/src/game/blueprints.ts") ||
            id.endsWith("/src/game/blueprintLibrary.ts")
          ) {
            return "blueprint-kernel";
          }
        }
      }
    }
  }
});
