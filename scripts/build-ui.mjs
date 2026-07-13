// Injecte {version, builtAt, capabilities, chains} dans le template → dist/ui/index.html.
// Tourne APRÈS tsc (lit dist/capabilities.js). Aucune dépendance.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { CAPABILITIES, CHAINS } = await import(new URL("../dist/capabilities.js", import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));

const data = {
  version: pkg.version,
  builtAt: new Date().toISOString().slice(0, 10),
  capabilities: CAPABILITIES,
  chains: CHAINS,
};
const template = readFileSync(resolve(ROOT, "src/ui/template.html"), "utf-8");
const marker = "/*__DATA__*/";
if (!template.includes(marker)) {
  console.error("build-ui: marqueur /*__DATA__*/ absent du template");
  process.exit(1);
}
// </script> dans une string JSON casserait le parseur HTML — échapper.
const json = JSON.stringify(data).replace(/<\//g, "<\\/");
const html = template.replace(marker, `const DATA = ${json};`);
mkdirSync(resolve(ROOT, "dist/ui"), { recursive: true });
writeFileSync(resolve(ROOT, "dist/ui/index.html"), html);
console.log(`build-ui: dist/ui/index.html (${CAPABILITIES.length} verbes, v${pkg.version})`);
