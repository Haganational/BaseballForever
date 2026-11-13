import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The engine lives in ../src and is shared with the command-line tools.
// BASE_PATH is set when publishing under a sub-path (GitHub Pages: /BaseballForever/).
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  server: { fs: { allow: [".."] } },
});
