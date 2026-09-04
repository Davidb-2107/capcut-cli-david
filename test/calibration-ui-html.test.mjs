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
  for (const label of [
    "Corpus",
    "Préparer",
    "Simulation (dry-run)",
    "Résultat",
    "Profils",
    "ID de voix ElevenLabs",
    "Collez l’identifiant unique de la voix",
    "pas le nom affiché",
    "Modèle utilisé pour ce parcours : Eleven Multilingual v2",
    "Eleven v3 sera activé lorsque le corpus intégrera des balises d’émotion",
    "Simulation (dry-run)",
    "Préparer la simulation",
    "Simulation avant calibrage",
    "ne génère aucun audio",
    "n’appelle pas ElevenLabs",
    "Approuver la simulation",
    "Lancer le calibrage réel",
    "lecture seule",
    "Version publiée",
    "Protocole standard appliqué automatiquement",
    "garantir la comparabilité",
  ]) ok(html.includes(label));
  for (const id of ["add-item", "save-corpus", "publish-corpus", "schema-fields", "postproc", "model_id"])
    ok(!html.includes(`id="${id}"`), `calibration UI must not expose ${id}`);
  ok(!html.includes('name="voice_id"'), "calibration UI must not expose a redundant voice_id field");
  ok(html.includes('id="dry-run-summary"'), "calibration UI must show a human-readable dry-run summary");
  ok(html.includes('id="result-preview"'), "calibration UI must show a human-readable result summary");
  ok(!html.includes('<pre id="result-preview">'), "calibration UI must not expose the raw result JSON");
  ok(html.includes("Rendre la voix disponible dans les projets"), "the result action must use user-facing language");
  ok(html.includes("Détails techniques"), "technical metrics must be secondary to the result action");
  ok(!html.includes('id="request-preview"'), "calibration UI must not expose the raw request preview");
  ok(html.includes("/calibration-client.js"));
  ok(!/src="https?:|href="https?:|ELEVENLABS_API_KEY/.test(html));
  ok(!html.includes("/*__CALIBRATION_TEMPLATE__*/"));
  ok(!/^\s*(?:import|export)\b/m.test(client), "browser client must have no runtime module imports/exports");
  ok(!client.includes("import("), "browser client must not use dynamic imports");
});
