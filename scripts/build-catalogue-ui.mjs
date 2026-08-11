// Copie src/ui/catalogue-template.html → dist/ui/ et tente une régénération du
// miroir vault. Best-effort : l'absence de vault (CI, clone nu) n'est pas une
// erreur de build.
import { copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
copyFileSync(resolve(ROOT, "src/ui/catalogue-template.html"), resolve(ROOT, "dist/ui/catalogue-template.html"));
console.log("build-catalogue-ui: dist/ui/catalogue-template.html");
try {
  const mod = await import(new URL("../dist/ui/catalogue-ui.js", import.meta.url));
  const { findVaultRoot } = await import(new URL("../dist/utils/vault.js", import.meta.url));
  const vault = findVaultRoot(ROOT);
  if (vault) {
    const mirror = mod.regenerateCatalogueMirror(resolve(vault, "Shared/capcut-catalogue.json"));
    if (mirror) console.log(`build-catalogue-ui: miroir → ${mirror}`);
  }
} catch (e) {
  console.log(`build-catalogue-ui: skip (${e.message})`);
}
