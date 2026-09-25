import { test } from "node:test";
import { strictEqual, ok, match } from "node:assert";
import { existsSync } from "node:fs";
import { planUi } from "../dist/commands/ui.js";
import { runCli } from "./helpers/spawn-cli.mjs";

test("ui: décision pure pour afficher le chemin ou ouvrir le navigateur", () => {
  strictEqual(planUi(true), "print-path");
  strictEqual(planUi(false), "open-browser");
});

test("ui --print-path: exit 0 + chemin existant, n'ouvre rien", async () => {
  const r = await runCli(["ui", "--print-path"]);
  strictEqual(r.status, 0, r.stderr);
  const p = r.stdout.trim();
  match(p, /index\.html$/);
  ok(existsSync(p), `chemin imprimé inexistant: ${p}`);
});

test("ui: apparaît dans --help", async () => {
  const r = await runCli(["--help"]);
  match(r.stdout, /ui\s+.*capacités|ui\s+.*capabilities/i);
});
