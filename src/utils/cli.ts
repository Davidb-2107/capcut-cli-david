export interface Flags {
  human: boolean;
  quiet: boolean;
  track?: string;
  out?: string;
  fontSize?: number;
  color?: string;
  align?: number;
  x?: number;
  y?: number;
  trackName?: string;
  volume?: number;
  template?: string;
  drafts?: string;
  property?: string;
  value?: string;
  curve?: string;
  from?: string;
  to?: string;
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
