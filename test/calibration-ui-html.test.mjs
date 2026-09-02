import { test } from "node:test";
import { ok } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("calibration UI is built and same-origin", () => {
  ok(existsSync(resolve(ROOT, "dist/ui/calibration.html")));
  const html = readFileSync(resolve(ROOT, "dist/ui/calibration.html"), "utf8");
  const client = readFileSync(resolve(ROOT, "dist/ui/calibration-client.js"), "utf8");
  for (const label of ["Corpus", "Préparer", "Dry-run", "Résultat", "Profils"]) ok(html.includes(label));
  ok(html.includes("/calibration-client.js"));
  ok(!/src="https?:|href="https?:|ELEVENLABS_API_KEY/.test(html));
  ok(!html.includes("/*__CALIBRATION_TEMPLATE__*/"));
  ok(!/^\s*(?:import|export)\b/m.test(client), "browser client must have no runtime module imports/exports");
  ok(!client.includes("import("), "browser client must not use dynamic imports");
});
