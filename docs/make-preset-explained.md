# `make-preset` explained (like you're 5)

*Plain-language walkthrough of the `make-preset` verb (v1.14.0).*

## The tiny problem

You want all your captions in a nice font — say **SpeedLines**. The `restyle`
command can do that, but it needs a little **recipe card** (a "preset" file) that
says *which* font: its secret number (`resource_id`), where the `.ttf` lives, and its
name. Writing that card by hand means hunting through CapCut's guts. Annoying.

`make-preset` writes the card **for you**.

## How it works (the whole idea)

You already used SpeedLines in some video once. When you did, CapCut wrote down the
font's full details inside that project's file. So `make-preset` just:

1. **Looks through all your CapCut projects** (your "drafts library").
2. **Finds the font** you named (by a piece of its name, or by its exact number).
3. **Copies its details** out of a project that already uses it.
4. **Hands you a recipe card** you can give straight to `restyle`.

No magic, no extra software — it reads the same project files everything else reads.

```
# write the recipe card
capcut-david make-preset --font SpeedLines --out speedlines.json

# use it
capcut-david restyle "<...>/com.lveditor.draft/<draft>" --preset speedlines.json
```

## The two clever bits

**"Bare font" only.** The card carries *just the font* — not bold, not shadows, not
size. So it swaps the font and leaves everything else alone.

**It copies the font's name tag faithfully.** CapCut shows a font's name in its little
dropdown only if it recognizes the font. `make-preset` copies the *exact* name tag
(`title` + `source_platform`) from your real project, so the dropdown reads it just
like when you pick the font by hand. (More on that quirk below.)

## When it says "no" (on purpose)

- **Can't find the font?** It tells you "apply it once in CapCut, then retry" — because
  a font you've never used isn't in any project yet.
- **Two different fonts match your word** (e.g. "line" → *LineArt* and *Lineback*)? It
  **lists both and refuses to guess**. You pick.
- **It's a local font** (a `.ttf` you dragged in, with no catalogue number)? It refuses
  — that kind can't make a dropdown-resolvable card.

## How you talk to it

| You type | It does |
|----------|---------|
| `make-preset --font SpeedLines` | finds by name (part of it is fine) |
| `make-preset --font 7605981975781887248` | finds by exact number |
| `make-preset --font speed --out p.json` | writes the card to `p.json` |
| `make-preset --font derstil --human` | prints a friendly one-liner |
| `make-preset --font x --drafts <dir>` | search a specific projects folder |

**Exit codes:** `0` = fine (even "found nothing" or "too many — here are the
choices"); `2` = couldn't work (projects folder missing, or a local-only font); `1` =
you forgot `--font`.

## The "System" dropdown footnote

If you restyle onto a catalogue font and CapCut's dropdown says **"System"** instead
of the name, that's a CapCut quirk: it only shows the name when the font's catalogue
entry is in *its own* cache (which a hand-pick fills). The video always renders the
right font — it's purely the label. `make-preset` copies the real name tag so it's as
resolvable as a native pick; the rest is CapCut's internal cache, not the file. Full
story in the CapCut-CaptionStyling skill's `CapCutGotchas.md`.

## In one sentence

`make-preset` turns *"I want the SpeedLines font"* into a ready-to-use `restyle`
recipe card, by copying the font's real details out of a project you already made.
