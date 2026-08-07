import { test } from "node:test";
import { strictEqual } from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { findVaultRoot, resolveCataloguePath } from "../dist/utils/vault.js";

// Builds <tmp>/vault/{Projects,Shared} and returns { root, deep } where deep is
// <root>/Projects/proj/repo/src — a path several levels below the anchor.
function makeVault(t) {
  const base = mkdtempSync(join(tmpdir(), "capcut-vault-test-"));
  const root = join(base, "vault");
  mkdirSync(join(root, "Shared"), { recursive: true });
  const deep = join(root, "Projects", "proj", "repo", "src");
  mkdirSync(deep, { recursive: true });
  t.after(() => {
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });
  return { root, deep };
}

test("findVaultRoot: walks up to the ancestor holding Projects/ + Shared/", (t) => {
  const { root, deep } = makeVault(t);
  strictEqual(findVaultRoot(deep), root);
});

test("findVaultRoot: the anchor itself is a valid answer", (t) => {
  const { root } = makeVault(t);
  strictEqual(findVaultRoot(root), root);
});

test("findVaultRoot: null when no ancestor qualifies", (t) => {
  const base = mkdtempSync(join(tmpdir(), "capcut-novault-test-"));
  const deep = join(base, "a", "b");
  mkdirSync(deep, { recursive: true });
  t.after(() => {
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });
  strictEqual(findVaultRoot(deep), null);
});

test("findVaultRoot: Projects/ alone is not enough", (t) => {
  const base = mkdtempSync(join(tmpdir(), "capcut-halfvault-test-"));
  const deep = join(base, "Projects", "x");
  mkdirSync(deep, { recursive: true });
  t.after(() => {
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });
  strictEqual(findVaultRoot(deep), null);
});

test("resolveCataloguePath: --catalogue override wins over everything", (t) => {
  const { deep } = makeVault(t);
  strictEqual(resolveCataloguePath("/tmp/x.json", deep), resolve("/tmp/x.json"));
});

test("resolveCataloguePath: inside a vault → Shared/capcut-catalogue.json", (t) => {
  const { root, deep } = makeVault(t);
  strictEqual(resolveCataloguePath(undefined, deep), join(root, "Shared", "capcut-catalogue.json"));
});

test("resolveCataloguePath: outside a vault → cwd", (t) => {
  const base = mkdtempSync(join(tmpdir(), "capcut-nov2-test-"));
  t.after(() => {
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });
  strictEqual(resolveCataloguePath(undefined, base), join(base, "capcut-catalogue.json"));
});
