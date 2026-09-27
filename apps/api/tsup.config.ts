import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  // workspace packages export TS source → bundle them; npm deps stay external
  noExternal: [/^@ong\//],
  sourcemap: true,
  clean: true,
});
