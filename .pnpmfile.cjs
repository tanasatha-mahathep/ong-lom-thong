// pnpm hooks — keep build/test tooling out of the api runtime image (apps/api/Dockerfile → pnpm deploy --prod).
//
// better-auth declares drizzle-kit and vitest as *optional* peer dependencies (only its CLI schema generator
// and its test helpers use them). Because both exist in this workspace, pnpm links them into better-auth's
// dependency set, and `pnpm deploy --prod` then copies them — plus vite, jsdom and three esbuild binaries —
// into the runtime image. The server never imports them (verified: sign-in works in the image without them).
// Dropping the two peers here makes the lockfile say so honestly (better-auth@x no longer resolved with them).
// Remove an entry only if the server starts importing a better-auth entry point that needs it.
const DROP_PEERS = { "better-auth": ["drizzle-kit", "vitest"] };

function readPackage(pkg) {
  const drop = DROP_PEERS[pkg.name];
  if (drop) {
    for (const name of drop) {
      if (pkg.peerDependencies) delete pkg.peerDependencies[name];
      if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta[name];
    }
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
