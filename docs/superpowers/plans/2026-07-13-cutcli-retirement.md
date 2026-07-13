# cutcli Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the last live cutcli consumer (Repost_Amélioré phase 5) to capcut-david, retire the 1_CapCut-Draft-Builder skill (decision traced: its only pipeline caller, Niche_PC, is an abandoned niche — David, 2026-07-13), then purge cutcli.exe + cutcli-fix + the legacy env guards.

**Architecture:** Repost migration is mechanical: `build_video_infos.py` emits the capcut-david `--batch` item schema instead of cutcli's `--video-infos` schema; skill 5 step 0.a becomes `init --width/--height` + `init-meta --register`; step 5 becomes `add-video --batch`. A/B proof (old-chain draft vs new-chain draft, structural comparator + `validate` rc 0 + David's visual CapCut gate) BEFORE anything is shipped or deleted. Purge only after the gate.

**Tech Stack:** Python (vault `Projects/TikTok/Repost_Amélioré/tools/`, `Shared/montage-tools/` pytest), capcut-david >= 2.1.0 (npm latest), Git Bash, vault-session worktrees.

## Global Constraints

- Vault edits ONLY in a worktree: `bash tools/vault-session.sh start cutcli-retirement`; pipeline RUNS from the canonical vault path.
- CapCut CLOSED for every draft-writing command (engine enforces it since 1.7.0).
- Human gates: David's visual CapCut check on the A/B drafts BEFORE ship/purge; any npm/GitHub release = David (none expected here — no engine change).
- Backups-first for every deletion: `~/.claude/backups/<name>-2026-07-13/`.
- Item schema for `add-video --batch`: `[{path, start, duration, width?, height?, volume?, trackName?}]`, times in µs (int) or time strings; `duration` = timeline placement duration.
- `capcut-david init` writes NO `draft_meta_info.json` → always chain `init-meta --register`.
- Python subprocess on Windows: npm .CMD shims need `shutil.which()`; cutcli.exe masked this — irrelevant here since skill 5 runs CLI commands from Git Bash, not subprocess.
- Known cutcli refs that stay (historical/abandoned, documented in T8): `Projects/Niche_PC/` (abandoned niche), `Projects/CapCut-Assembler/Documentations/`, `Projects/Psycho/` archives, `docs/superpowers/` archives in skills, `Projects/CutCLI/` (the old project folder).

---

### Task 1: Worktree + `build_video_infos.py` → batch item schema

**Files:**
- Modify: `<worktree>/Projects/TikTok/Repost_Amélioré/tools/build_video_infos.py:44-53` (item literal), `:1-6` (docstring)

**Interfaces:**
- Produces: `outputs/<slug>/broll/_video_infos.json` items become `{path, start, duration, width, height, volume}` (µs ints, `duration` = `end - start` placement, `path` forward-slash absolute). Old keys `videoUrl`/`end` and the natural-duration `duration` disappear.
- Consumed by: Task 3's `capcut-david add-video --batch` call; skill 5 step 5 (Task 2).

- [ ] **Step 1: Start the worktree**

```bash
S="/c/Users/dbele/Documents/ObsidianVault/Wiki_Claude/tools/vault-session.sh"
bash "$S" start cutcli-retirement   # cd into the printed path
```

- [ ] **Step 2: Rewrite the item literal** — in `tools/build_video_infos.py`, replace lines 44-54 (`infos.append({...})` + `cum = end`):

```python
        infos.append(
            {
                "path": str(c.resolve()).replace("\\", "/"),
                "start": start,
                "duration": end - start,
                "width": W,
                "height": H,
                "volume": 0,
            }
        )
        cum = end
```

Docstring line 2-3: `"""Construit le @items.json pour capcut-david add-video --batch : clips b-roll bout-a-bout, dernier clip ajuste pour finir pile a fit_to_s."""` (drop both cutcli mentions).

- [ ] **Step 3: Runnable check** — run against the real episode from the CANONICAL path (script only reads broll/ + spec, writes one json — safe):

```bash
cd "/c/Users/dbele/Documents/ObsidianVault/Wiki_Claude/Projects/TikTok/Repost_Amélioré"
python <worktree>/Projects/TikTok/Repost_Amélioré/tools/build_video_infos.py --slug le-rappeur-dont-jai-repare-le-pc
python - <<'EOF'
import json; items=json.load(open("outputs/le-rappeur-dont-jai-repare-le-pc/broll/_video_infos.json"))
assert all(set(i)=={"path","start","duration","width","height","volume"} for i in items)
assert all(isinstance(i["start"],int) and isinstance(i["duration"],int) and i["duration"]>0 for i in items)
assert items[0]["start"]==0 and all(a["start"]+a["duration"]==b["start"] for a,b in zip(items,items[1:]))
print("OK", len(items), "items, end =", (items[-1]["start"]+items[-1]["duration"])/1e6, "s")
EOF
```

Expected: `OK N items, end = <fit_to_s> s`. (Heredoc python is fine from Git Bash; the `python -c` ban is about multiline `-c` via the Bash tool — write a scratch file in `temp/` if the hook objects.)

- [ ] **Step 4: Commit (worktree)**

```bash
git add -A && git commit -m "feat(repost): build_video_infos emits capcut-david add-video --batch schema (cutcli out)"
```

---

### Task 2: Skill 5 `repost-ameliore-montage` — cutcli out of the doc

**Files:**
- Modify: `<worktree>/Projects/TikTok/Repost_Amélioré/.claude/skills/5_repost-ameliore-montage/SKILL.md`

**Interfaces:**
- Produces: the phase-5 operator doc drives capcut-david only. Exact substitutions:

- [ ] **Step 1: Apply the substitutions**

1. Frontmatter description: `builds the draft in CLI (create → add-audio → import-captions → restyle...)` — unchanged wording works; remove nothing here.
2. Iron Law 1: `**backup draft_content.json AVANT** tout \`cutcli videos add\`` → `tout \`capcut-david add-video --batch\``.
3. Iron Law 4: `du \`cutcli draft create\` jusqu'au dernier \`cutcli videos add\`` → `du \`capcut-david init\` jusqu'au dernier \`capcut-david add-video --batch\``.
4. "Réutilise" bullet: `\`cutcli videos add\`` → `\`capcut-david add-video --batch\``.
5. Step 0.a becomes:

```markdown
   a. **Draft** : `capcut-david init d_<slug> --width 1080 --height 1920` → draft 1080×1920 dans le
      root CapCut plateforme, puis **`capcut-david init-meta "<draft-dir-absolu>" --register`**
      (init n'écrit PAS `draft_meta_info.json` et n'indexe pas — sans ça, `validate` rc=2
      `meta.missing` et draft invisible dans CapCut).
```

(keep the `d_<slug>` prefix note that follows — unchanged).
6. Step 5 becomes:

```markdown
5. **Injecter dans le draft** (CapCut FERMÉ ; **backup `draft_content.json` AVANT**) :
   `capcut-david add-video "<draft-dir-absolu>" --batch @outputs/<slug>/broll/_video_infos.json`
   (items `{path,start,duration,width,height,volume:0}` µs — all-or-nothing, UN save, ids ordonnés).
```

7. Gotcha bullet `**\`cutcli videos add\` COPIE** les médias…` → `**\`capcut-david add-video\` COPIE** les médias dans \`<draft>/Resources/\` et les référence via le jeton portable \`##_draftpath_placeholder_…_##\`` (same warning about false "missing", keep).
8. Engine floor bullet (last gotcha): `**Engine requis ≥ 2.0.0**` → `**Engine requis ≥ 2.1.0** (\`init --width/--height\` + \`add-video --batch\`, probe : \`capcut-david --help | grep -c -- --batch\` ≥ 3)`; keep the history line.

- [ ] **Step 2: Grep-proof the skill + commit**

```bash
grep -rn "cutcli" "Projects/TikTok/Repost_Amélioré/.claude/skills/" && echo LEFTOVERS || echo CLEAN
git add -A && git commit -m "docs(repost skill 5): mono-engine capcut-david — init/init-meta/add-video --batch, cutcli retiré"
```

Expected: `CLEAN`. (Also fix `Projects/TikTok/Repost_Amélioré/AGENTS.md` + `.claude/skills/AGENTS.md` if their cutcli mentions are prescriptive, not historical.)

---

### Task 3: A/B proof on le-rappeur + David's visual gate

**Files:**
- Create: `<canonical>/Projects/TikTok/Repost_Amélioré/script_temp/compare_drafts.py` (disposable)

**Interfaces:**
- Consumes: Task 1's `_video_infos.json`, the episode's `narration.mp3` + `audio.json` + `captions-styled.json` (already on disk — episode shipped).
- Produces: draft `d_le-rappeur-dont-jai-repare-le-pc-abtest` next to the prod draft; comparator verdict; gate handoff.

- [ ] **Step 1: Locate draft A** (old-chain prod draft):

```bash
ls "/c/Users/dbele/AppData/Local/CapCut/User Data/Projects/com.lveditor.draft" | grep rappeur
```

If absent (deleted since ship): rebuild A first with the OLD chain (cutcli still installed — that's why the purge is LAST): `cutcli draft create --name d_<slug>-abref` + old-schema infos (`git show HEAD~1:...build_video_infos.py` from the worktree for the old emitter) + `cutcli videos add` + the capcut-david audio/captions steps 0.b-d. A = `-abref`.

- [ ] **Step 2: Build B with the new chain** (canonical path, CapCut CLOSED, worktree script for the infos):

```bash
cd "/c/Users/dbele/Documents/ObsidianVault/Wiki_Claude/Projects/TikTok/Repost_Amélioré"
SLUG=le-rappeur-dont-jai-repare-le-pc
capcut-david init "d_${SLUG}-abtest" --width 1080 --height 1920          # → note draft_path
DRAFT="/c/Users/dbele/AppData/Local/CapCut/User Data/Projects/com.lveditor.draft/d_${SLUG}-abtest"
capcut-david init-meta "$DRAFT" --register
DUR=$(python -c "import json;print(json.load(open('outputs/${SLUG}/audio/audio.json'))['duration_s'])")
capcut-david add-audio "$DRAFT" "outputs/${SLUG}/audio/narration.mp3" 0 "${DUR}s"
capcut-david import-captions "$DRAFT" "outputs/${SLUG}/captions-styled.json"
capcut-david restyle "$DRAFT" --preset "$(python ../../../Shared/montage-tools/gabarit.py --resolve derstil)"
capcut-david add-video "$DRAFT" --batch "@outputs/${SLUG}/broll/_video_infos.json"
capcut-david validate "$DRAFT" -q && echo VALIDATE_OK
```

(Adjust file names to what `outputs/<slug>/` actually contains — `audio.json` key per skill 3, captions file per `_project/captions-variant.json`. Follow skill 5 order exactly: draft → voix → captions → style → b-roll.)

- [ ] **Step 3: Recreate the structural comparator** at `script_temp/compare_drafts.py` — copy VERBATIM the canon/diff script from `docs/superpowers/plans/2026-07-13-batch-media-mono-engine.md` Task 10 Step 3 (repo `capcut-cli-david`). Run:

```bash
python script_temp/compare_drafts.py "<draft A dir>" "<draft B dir>"
```

Expected: `EQUIVALENT`, or a diff where EVERY line is explained (known classes: cutcli's degenerate keyframes on mp4 stills; caption/material count drift only if inputs changed since A shipped).

- [ ] **Step 4: STOP — David's visual gate.** Report: comparator verdict, validate rcs, draft names. David opens `d_<slug>-abtest` (and A) in CapCut: b-roll order, contiguity, captions styled, voice audible. **No ship, no deletion before his OK.**

---

### Task 4: Ship the vault branch (after gate OK)

- [ ] **Step 1:**

```bash
cd <worktree> && bash "$S" ship "feat(repost): phase 5 mono-moteur capcut-david — cutcli retiré de Repost_Amélioré"
```

- [ ] **Step 2: Delete the `-abtest` (and `-abref` if created) draft folders** once David is done comparing (he may prefer deleting in CapCut UI — ask in the gate message).

---

### Task 5: Retire 1_CapCut-Draft-Builder (backup-first)

**Decision traced:** only live caller was Niche_PC (`scripts/build_capcut_draft.py` → `build_draft.py`); David declared Niche_PC abandoned (2026-07-13) → retrait, no migration. Psycho-build covers any future images+audio+captions need; the shared mono-engine chain covers episode assembly.

- [ ] **Step 1: Backup + remove**

```bash
mkdir -p ~/.claude/backups
cp -r ~/.claude/skills/1_CapCut-Draft-Builder ~/.claude/backups/1_CapCut-Draft-Builder-2026-07-13
rm -rf ~/.claude/skills/1_CapCut-Draft-Builder
```

- [ ] **Step 2: Commit the skills repo** (`~/.claude/skills` is git-tracked — the skills-drift hook watches it):

```bash
cd ~/.claude/skills && git add -A && git commit -m "retire 1_CapCut-Draft-Builder (cutcli-based; only caller Niche_PC abandoned — backup 2026-07-13)" && git push
```

- [ ] **Step 3: Update the two skill catalogues** — `~/.claude/CLAUDE.md` runtime-skills line (drop `1_CapCut-Draft-Builder`), and `SKILLS MAP.md` via a vault worktree in Task 8 (single docs ship).

---

### Task 6: Purge legacy guards from `engine.py` (+ tests)

**Files (new worktree or same `cutcli-retirement` if not yet shipped — if Task 4 shipped, start `cutcli-purge`):**
- Modify: `Shared/montage-tools/engine.py` (delete `ensure_cut_drafts_env` :112, `require_capcut_drafts_root` :123, the CUT_DRAFTS_DIR docstring block :17-19, `winreg` import if now unused)
- Modify: `Shared/montage-tools/test_engine.py` (delete the two test sections :159-229)

**Interfaces:** nothing consumes these anymore (verified 2026-07-13: only defs + their tests match `ensure_cut_drafts_env|require_capcut_drafts_root` under Shared/ + Projects/).

- [ ] **Step 1: Delete the two functions + their tests + stale docstring/comments** (also sweep `test_add_sfx_to_montage.py` and `_test_prime_mirror.py` for cutcli-era comments/asserts — update wording, keep behavior).

- [ ] **Step 2: Full hermetic suite**

```bash
cd <worktree>/Shared/montage-tools && python -m pytest -q
```

Expected: green (76+ minus the ~7 deleted guard tests). Then:

```bash
grep -rn "cutcli\|CUT_DRAFTS_DIR" *.py | grep -v "^Binary"
```

Expected: zero hits (test files included).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore(engine.py): drop cutcli-era guards ensure_cut_drafts_env/require_capcut_drafts_root (+tests) — mono-engine by construction"
```

---

### Task 7: Machine purge — cutcli.exe, cutcli-fix, ZoomFX preflight, env var

- [ ] **Step 1: Backup + delete cutcli.exe** (101 MB):

```bash
mkdir -p ~/.claude/backups/cutcli-2026-07-13 && cp ~/bin/cutcli.exe ~/.claude/backups/cutcli-2026-07-13/ && rm ~/bin/cutcli.exe
```

- [ ] **Step 2: Delete `tools/cutcli-fix/`** (vault worktree, same branch as Task 6): `git rm -r tools/cutcli-fix` + commit `"chore: retire cutcli-fix (cubic-out native in capcut-david since 1.5; last consumer ZoomFX preflight patched)"`.

- [ ] **Step 3: Patch ZoomFX** — `~/.claude/skills/CapCut-ZoomFX/Tools/fix_zoom_keyframes.py:137-141`: replace the `sys.path.insert(...cutcli-fix)` + `from preflight import require_capcut_david, require_cutcli` + `require_cutcli("1.3.0")` block with an inline check:

```python
import shutil
if shutil.which("capcut-david") is None:
    sys.exit("[fail] capcut-david introuvable — npm i -g capcut-cli-david@latest")
```

(keep whatever `require_capcut_david` version floor was enforced by probing `--help` if the old preflight did more — read `tools/cutcli-fix/preflight.py` BEFORE deleting it in Step 2 and mirror only what fix_zoom_keyframes needs). Also update `CapCut-ZoomFX/SKILL.md` requires-block (drop cutcli + cutcli-fix lines) and `parity_extract.py` if it imports cutcli-fix at runtime (docstring-only refs stay). Run the ZoomFX test suite: `python -m pytest ~/.claude/skills/CapCut-ZoomFX/Tools/tests -q` → green. Commit + push the skills repo.

- [ ] **Step 4: Remove the user env var** (LAST — nothing may read it anymore):

```bash
reg delete "HKCU\Environment" /v CUT_DRAFTS_DIR /f
```

---

### Task 8: Docs, memory, acceptance sweep

- [ ] **Step 1: `Shared/ENGINE-FACTS.md`** (worktree from Task 6/7 branch) — CapCut/cutcli section:
  - Retitle section `## CapCut / capcut-david`.
  - New fact line: `**cutcli RETIRÉ de la machine (2026-07-13)** : dernier consommateur prod (Repost_Amélioré phase 5) migré sur capcut-david (init/init-meta/add-video --batch), skill 1_CapCut-Draft-Builder retiré (seul appelant = Niche_PC, niche abandonnée), ~/bin/cutcli.exe supprimé (backup ~/.claude/backups/cutcli-2026-07-13), CUT_DRAFTS_DIR supprimée. Preuve : A/B structurel d_le-rappeur (comparateur + validate rc 0 + gate visuel David) ; grep « zéro cutcli hors historique » Shared/+skills.`
  - Rewrite the two CUT_DRAFTS_DIR bullets as historical one-liners (gotcha n'existe plus par construction) or fold into the retirement line.
- [ ] **Step 2: `SKILLS MAP.md`** — remove/mark-retired 1_CapCut-Draft-Builder entry; update skill-5 repost row (mono-engine, floor 2.1.0); update ZoomFX deps (no cutcli/cutcli-fix).
- [ ] **Step 3: Ship** `bash "$S" ship "chore: purge cutcli — guards engine.py, cutcli-fix, ENGINE-FACTS + SKILLS MAP (chantier migration legacy clos)"`.
- [ ] **Step 4: Memory + brief** — new memory note `cutcli-retirement-progress.md` (+ MEMORY.md line); `~/.claude/brief.md`: close the thread (✅ Clos).
- [ ] **Step 5: Final acceptance sweep**

```bash
cd "/c/Users/dbele/Documents/ObsidianVault/Wiki_Claude"
grep -rln "cutcli" --include="*.py" --include="*.sh" Shared/ Projects/TikTok/ ~/.claude/skills/   # → empty
ls ~/bin/cutcli.exe 2>/dev/null                                                                  # → absent
reg query "HKCU\Environment" /v CUT_DRAFTS_DIR                                                   # → error (gone)
```

Documented residuals (allowed): `Projects/Niche_PC/` (abandoned), `Projects/CutCLI/`, `Projects/CapCut-Assembler/Documentations/`, `Projects/Psycho/` archives, `docs/superpowers/` history in skills, git history.

---

## Self-Review Notes

- **Spec coverage:** Repost migration mécanique (T1-T2), preuve A/B + gate visuel (T3), ship (T4), décision Draft-Builder tracée + retrait backup-first (T5), purge guards + tests (T6), cutcli.exe/cutcli-fix/ZoomFX/env var (T7), ENGINE-FACTS + SKILLS MAP + mémoire + brief + grep-proof (T8). 4 critères d'acceptation mappés : (1) T3+T4, (2) T5, (3) T7, (4) T8.
- **Discovered during planning, folded in:** Niche_PC était un 3ᵉ consommateur vivant (via build_draft.py) — résolu par la décision « niche abandonnée » ; ZoomFX `require_cutcli` preflight vivant — patch T7.3 ; `~/.claude/CLAUDE.md` liste le skill retiré — T5.3.
- **Ordering:** purge strictly after David's T3 gate — cutcli reste dispo pour reconstruire A si besoin.
