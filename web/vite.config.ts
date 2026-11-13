import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The engine lives in ../src and is shared with the command-line tools.
export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: [".."] } },
});
