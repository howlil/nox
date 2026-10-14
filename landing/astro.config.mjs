import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

// Pre-render all pages: Cloudflare Workers serves static assets with no SSR runtime.
export default defineConfig({
  output: "static",
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
});
