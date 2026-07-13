import { test } from "node:test";
import { ok } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HTML = resolve(ROOT, "dist/ui/index.html");

test("dist/ui/index.html existe et contient chaque verbe + la version", async () => {
  ok(existsSync(HTML), "dist/ui/index.html manquant — build-ui.mjs pas branché ?");
  const html = readFileSync(HTML, "utf-8");
  const { CAPABILITIES } = await import("../dist/capabilities.js");
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));
  ok(html.includes(`"version":"${pkg.version}"`), "version du paquet absente de la page");
  for (const c of CAPABILITIES) ok(html.includes(`"${c.verb}"`), `verbe ${c.verb} absent du HTML`);
  ok(!html.includes("/*__DATA__*/"), "marqueur d'injection non remplacé");
  ok(!/src=|href="http|url\(http/.test(html), "la page doit être autonome (aucune ressource réseau)");
});
