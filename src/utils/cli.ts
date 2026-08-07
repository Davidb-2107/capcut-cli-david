export interface Flags {
  human: boolean;
  quiet: boolean;
  track?: string;
  out?: string;
  fontSize?: number;
  color?: string;
  colorCycle?: string[];
  align?: number;
  x?: number;
  y?: number;
  trackName?: string;
  volume?: number;
  template?: string;
  drafts?: string;
  kind?: string;
  property?: string;
  value?: string;
  duration?: string;
  curve?: string;
  from?: string;
  to?: string;
  seed?: string;
  bind?: string;
  register?: boolean;
  projectsRoot?: string;
  keyword?: string;
  keywordRange?: string;
  keywordColor?: string;
  keywordSize?: number;
  highlightColor?: string;
  highlightSize?: number;
  transformY?: number;
  cloneStyle?: boolean;
  preset?: string;
  force?: boolean;
  strict?: boolean;
  checkAssets?: boolean;
  checkTimelines?: boolean;
  ids?: string[];
  skip?: string[];
  dryRun?: boolean;
  fix?: boolean;
  apply?: boolean;
  full?: boolean;
  all?: boolean;
  font?: string;
  width?: number;
  height?: number;
  batch?: string;
}

export class CliError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "CliError";
  }
}

export function die(msg: string): never {
  throw new CliError(msg);
}

export function requireArgs(args: string[], min: number, usage: string): void {
  if (args.length < min) die(`Missing arguments. Usage: ${usage}`);
}

export function out(data: unknown, flags: Flags): void {
  if (flags.quiet) return;
  process.stdout.write(`${JSON.stringify(data)}\n`);
}
