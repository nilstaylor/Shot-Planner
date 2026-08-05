import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" keeps asset and stencil paths working whether the app is served
// from a domain root or from a project subfolder on GitHub Pages.
export default defineConfig({
  base: "./",
  plugins: [react()],
});
