import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    migrate: "src/scripts/migrate.ts",
    seed: "src/scripts/seed.ts",
    "create-user": "src/scripts/create-user.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node22",
  // workspace packages export TS source → bundle them; npm deps stay external
  noExternal: [/^@ong\//],
  sourcemap: true,
  clean: true,
});
