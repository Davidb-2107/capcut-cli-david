import { die, type Flags, out } from "../utils/cli.js";
import { registerDraft } from "./register.js";

export function cmdRegister(positional: string[], flags: Flags): void {
  const draftDir = positional[1];
  if (!draftDir) die("Usage: capcut-david register <draft-dir> [--projects-root <dir>]");
  const result = registerDraft({ draftDir, projectsRoot: flags.projectsRoot });
  out(
    {
      ok: true,
      draft_id: result.draftId,
      draft_name: result.draftName,
      root_meta_path: result.rootMetaPath,
      added: result.added,
    },
    flags,
  );
}
