// Tests for src/commands/register.ts (compiled to dist/commands/register.js).
// Covers: register a psycho-build draft in CapCut's root_meta_info.json so it
// surfaces in the CapCut UI. Idempotency, projects-root override, and CLI wiring.
import { test } from "node:test";
import { deepStrictEqual, match, ok, strictEqual } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { registerDraft } from "../dist/commands/register.js";
import { runCli } from "./helpers/spawn-cli.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function scratchDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "capcut-cli-david-register-"));
  if (t && typeof t.after === "function") t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeFakeDraft(t, name = "fake-draft", overrides = {}) {
  const tmp = scratchDir(t);
  const projectsRoot = resolve(tmp, "Projects", "com.lveditor.draft");
  const draftDir = resolve(projectsRoot, name);
  mkdirSync(draftDir, { recursive: true });
  const draftId = overrides.draft_id ?? "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";
  const now = Date.now() * 1000;
  const meta = {
    draft_id: draftId,
    draft_name: name,
    draft_fold_path: draftDir,
    draft_root_path: projectsRoot,
    draft_cover: "draft_cover.jpg",
    draft_new_version: "164.0.0",
    draft_type: "",
    tm_draft_create: now,
    tm_draft_modified: now,
    tm_duration: 9_000_000,
    ...overrides,
  };
  writeFileSync(resolve(draftDir, "draft_meta_info.json"), JSON.stringify(meta), "utf-8");
  writeFileSync(resolve(draftDir, "draft_content.json"), JSON.stringify({ id: draftId, name }), "utf-8");
  return { tmp, projectsRoot, draftDir, draftId, name };
}

test("register: appends entry to root_meta_info.json .all_draft_store", (t) => {
  const { projectsRoot, draftDir, draftId, name } = makeFakeDraft(t, "psycho-A");
  const result = registerDraft({ draftDir, projectsRoot });

  strictEqual(result.draftId, draftId);
  strictEqual(result.draftName, name);
  strictEqual(result.added, true);
  strictEqual(result.rootMetaPath, resolve(projectsRoot, "root_meta_info.json"));

  const root = JSON.parse(readFileSync(result.rootMetaPath, "utf-8"));
  ok(Array.isArray(root.all_draft_store));
  strictEqual(root.all_draft_store.length, 1);
  const entry = root.all_draft_store[0];
  strictEqual(entry.draft_id, draftId);
  strictEqual(entry.draft_name, name);
  strictEqual(entry.draft_fold_path, draftDir);
  strictEqual(entry.tm_duration, 9_000_000);
  strictEqual(entry.draft_json_file, resolve(draftDir, "draft_content.json"));
  ok(typeof entry.tm_draft_create === "number" && entry.tm_draft_create > 0);
});

test("register: idempotent — second call does not duplicate the entry", (t) => {
  const { projectsRoot, draftDir, draftId } = makeFakeDraft(t, "psycho-idem");
  const first = registerDraft({ draftDir, projectsRoot });
  strictEqual(first.added, true);

  const second = registerDraft({ draftDir, projectsRoot });
  strictEqual(second.added, false, "second call should report added=false");
  strictEqual(second.draftId, draftId);

  const root = JSON.parse(readFileSync(first.rootMetaPath, "utf-8"));
  strictEqual(root.all_draft_store.length, 1, "must not duplicate");
});

test("register: creates root_meta_info.json if absent", (t) => {
  const { projectsRoot, draftDir } = makeFakeDraft(t, "psycho-new-root");
  const rootPath = resolve(projectsRoot, "root_meta_info.json");
  ok(!existsSync(rootPath), "precondition: root_meta_info.json should not exist yet");

  const result = registerDraft({ draftDir, projectsRoot });
  ok(existsSync(result.rootMetaPath));
  const root = JSON.parse(readFileSync(result.rootMetaPath, "utf-8"));
  strictEqual(root.all_draft_store.length, 1);
  strictEqual(root.root_path, projectsRoot);
});

test("register: appends to existing root_meta_info.json without clobbering prior entries", (t) => {
  const { projectsRoot, draftDir } = makeFakeDraft(t, "psycho-second");
  const existing = {
    all_draft_store: [{ draft_id: "PRE-EXISTING-DRAFT-ID", draft_name: "old-draft" }],
    draft_ids: ["PRE-EXISTING-DRAFT-ID"],
    root_path: projectsRoot,
  };
  const rootPath = resolve(projectsRoot, "root_meta_info.json");
  writeFileSync(rootPath, JSON.stringify(existing), "utf-8");

  const result = registerDraft({ draftDir, projectsRoot });
  strictEqual(result.added, true);
  const root = JSON.parse(readFileSync(rootPath, "utf-8"));
  strictEqual(root.all_draft_store.length, 2);
  ok(root.all_draft_store.some((e) => e.draft_id === "PRE-EXISTING-DRAFT-ID"));
  ok(root.all_draft_store.some((e) => e.draft_id === result.draftId));
});

test("register: errors when draft_meta_info.json is missing", (t) => {
  const tmp = scratchDir(t);
  const draftDir = resolve(tmp, "no-meta-here");
  mkdirSync(draftDir, { recursive: true });
  // intentionally do NOT create draft_meta_info.json

  let caught;
  try { registerDraft({ draftDir, projectsRoot: tmp }); }
  catch (e) { caught = e; }
  ok(caught, "expected error when draft_meta_info.json missing");
  match(String(caught.message), /draft_meta_info\.json/);
});

test("cli: register <draft-dir> --projects-root <dir> end-to-end", (t) => {
  const { projectsRoot, draftDir, draftId, name } = makeFakeDraft(t, "cli-psycho-reg");

  const r = runCli(["register", draftDir, "--projects-root", projectsRoot]);
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  ok(r.json, `expected JSON on stdout, got: ${r.stdout}`);
  strictEqual(r.json.ok, true);
  strictEqual(r.json.draft_id, draftId);
  strictEqual(r.json.draft_name, name);
  strictEqual(r.json.added, true);

  const root = JSON.parse(readFileSync(resolve(projectsRoot, "root_meta_info.json"), "utf-8"));
  strictEqual(root.all_draft_store.length, 1);
});

test("cli: register missing <draft-dir> arg returns CliError", () => {
  const r = runCli(["register"]);
  strictEqual(r.status, 1);
  ok(r.errorJson);
  match(r.errorJson.error, /Usage: capcut-david register/);
});

test("cli: register on second call reports added=false", (t) => {
  const { projectsRoot, draftDir } = makeFakeDraft(t, "cli-psycho-idem");

  const r1 = runCli(["register", draftDir, "--projects-root", projectsRoot]);
  strictEqual(r1.status, 0);
  strictEqual(r1.json.added, true);

  const r2 = runCli(["register", draftDir, "--projects-root", projectsRoot]);
  strictEqual(r2.status, 0);
  strictEqual(r2.json.added, false);
});
