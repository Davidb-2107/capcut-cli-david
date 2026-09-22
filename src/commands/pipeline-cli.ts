import { die, type Flags, out } from "../utils/cli.js";
import { type PsychoBuildRegisterOpts, psychoBuild } from "./pipeline.js";

export function cmdPsychoBuild(positional: string[], flags: Flags): void {
  const manifestPath = positional[1];
  if (!manifestPath)
    die(
      "Usage: capcut-david psycho-build <manifest.yaml> [--out <dir>] [--seed <n>] [--register] [--projects-root <dir>]",
    );
  const registerOpt: PsychoBuildRegisterOpts | undefined = flags.register
    ? { register: true, projectsRoot: flags.projectsRoot }
    : undefined;
  const result = psychoBuild(manifestPath, flags.out, flags.seed, registerOpt);
  out(
    {
      ok: true,
      draft_path: result.draftPath,
      file_path: result.filePath,
      meta_info_path: result.metaInfoPath,
      draft_info_path: result.draftInfoPath,
      total_duration_us: result.total_duration_us,
      images: result.images,
      voice: result.voice,
      music: result.music,
      captions: result.captions,
      seeded: result.seeded,
      registered: result.registered,
      register_root_meta_path: result.registerRootMetaPath,
    },
    flags,
  );
}
