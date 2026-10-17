// Plain JS in dist/ for use from node_modules (Node won't strip types there). No dependencies: uses Node's own stripper.
import { stripTypeScriptTypes } from "node:module";
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
mkdirSync("dist", { recursive: true });
for (const f of ["index", "cli"]) {
  const js = stripTypeScriptTypes(readFileSync(`src/${f}.ts`, "utf8"), { mode: "transform" }).replaceAll('from "./index.ts"', 'from "./index.js"');
  writeFileSync(`dist/${f}.js`, js);
}
chmodSync("dist/cli.js", 0o755);
