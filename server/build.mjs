// Bundles the server into ../dist/server.js so the installed plugin needs no npm install, and
// collects the licenses of every bundled npm package into ../dist/THIRD_PARTY_LICENSES.txt.
import { build } from "esbuild";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const result = await build({
  entryPoints: ["src/index.ts"],
  outfile: "../dist/server.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  minify: false,
  legalComments: "none",
  metafile: true,
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
  logLevel: "info",
});

const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  const m = input.match(/^(.*node_modules\/)((?:@[^/]+\/)?[^/]+)\//);
  if (m) packages.set(m[2], m[1] + m[2]);
}
const sections = [...packages.entries()].sort().map(([name, dir]) => {
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const file = existsSync(dir) ? readdirSync(dir).find((f) => /^(licen[cs]e|copying)/i.test(f)) : undefined;
  const text = file ? readFileSync(path.join(dir, file), "utf8").trim() : `License: ${pkg.license ?? "unknown"}`;
  return `${"=".repeat(78)}\n${name}@${pkg.version} (${pkg.license ?? "unknown"})\n${"=".repeat(78)}\n${text}\n`;
});
writeFileSync(
  "../dist/THIRD_PARTY_LICENSES.txt",
  `Licenses of the npm packages bundled into dist/server.js\n\n${sections.join("\n")}`,
);
console.log(`collected licenses for ${packages.size} bundled packages`);
