// Bundles the long-running Node entry points (worker, migrations) for the
// production image. Workspace packages (@pti/*, TypeScript sources) are
// inlined; npm dependencies stay external and come from the pruned
// node_modules, so native modules (argon2, sharp) are never bundled.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const externalNpm = {
  name: "external-npm",
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith("@pti/") || args.path.startsWith("@/")) return undefined;
      if (args.path === "server-only") return { path: here("../test/server-only.ts") };
      // next has no "exports" map, so Node's ESM resolver needs the file extension.
      if (/^next\/[\w-]+$/.test(args.path)) return { path: `${args.path}.js`, external: true };
      return { path: args.path, external: true };
    });
  },
};

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: "linked",
  tsconfig: here("./tsconfig.json"),
  plugins: [externalNpm],
  // ESM output still meets CJS deps that call require(); give them one.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: "info",
};

await Promise.all([
  build({
    ...common,
    entryPoints: [here("../worker/index.ts")],
    outfile: here("../dist/worker.mjs"),
  }),
  build({
    ...common,
    entryPoints: [here("../../../packages/db/src/migrate.ts")],
    outfile: here("../dist/migrate.mjs"),
  }),
]);
