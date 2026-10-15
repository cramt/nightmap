import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the project under /<repo>/; CI sets this, local dev stays at /.
  base: process.env.VITE_BASE ?? "/",
});
