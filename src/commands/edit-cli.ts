import { type Draft, type DraftStore, LocalDraftStore, persistDraft } from "../draft.js";
import { type Flags, out } from "../utils/cli.js";
import { applyOpacity, applySetText, applyShift, applyShiftAll, applySpeed, applyTrim, applyVolume } from "./edit.js";

export function cmdSetText(
  draft: Draft,
  filePath: string,
  segId: string,
  newText: string,
  flags: Flags,
  save = true,
  store: DraftStore = new LocalDraftStore(),
): void {
  const result = applySetText(draft, segId, newText);
  if (save) persistDraft(store, filePath, draft);
  out(result, flags);
}

export function cmdShift(
  draft: Draft,
  filePath: string,
  segId: string,
  offsetStr: string,
  flags: Flags,
  save = true,
  store: DraftStore = new LocalDraftStore(),
): void {
  const result = applyShift(draft, segId, offsetStr);
  if (save) persistDraft(store, filePath, draft);
  out(result, flags);
}

export function cmdShiftAll(
  draft: Draft,
  filePath: string,
  offsetStr: string,
  flags: Flags,
  save = true,
  store: DraftStore = new LocalDraftStore(),
): void {
  const result = applyShiftAll(draft, offsetStr, flags.track);
  if (save) persistDraft(store, filePath, draft);
  out(result, flags);
}

export function cmdSpeed(
  draft: Draft,
  filePath: string,
  segId: string,
  multiplier: string,
  flags: Flags,
  save = true,
  store: DraftStore = new LocalDraftStore(),
): void {
  const result = applySpeed(draft, segId, multiplier);
  if (save) persistDraft(store, filePath, draft);
  out(result, flags);
}

export function cmdVolume(
  draft: Draft,
  filePath: string,
  segId: string,
  levelStr: string,
  flags: Flags,
  save = true,
  store: DraftStore = new LocalDraftStore(),
): void {
  const result = applyVolume(draft, segId, levelStr);
  if (save) persistDraft(store, filePath, draft);
  out(result, flags);
}

export function cmdTrim(
  draft: Draft,
  filePath: string,
  segId: string,
  startStr: string,
  durationStr: string,
  flags: Flags,
  save = true,
  store: DraftStore = new LocalDraftStore(),
): void {
  const result = applyTrim(draft, segId, startStr, durationStr);
  if (save) persistDraft(store, filePath, draft);
  out(result, flags);
}

export function cmdOpacity(
  draft: Draft,
  filePath: string,
  segId: string,
  alphaStr: string,
  flags: Flags,
  save = true,
  store: DraftStore = new LocalDraftStore(),
): void {
  const result = applyOpacity(draft, segId, alphaStr);
  if (save) persistDraft(store, filePath, draft);
  out(result, flags);
}
