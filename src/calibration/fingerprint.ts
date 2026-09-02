import { createHash } from "node:crypto";

import type { ResolvedCalibrationRequest } from "./domain.js";

function canonicalizeValue(value: unknown, path: string): unknown {
  if (value === undefined) {
    throw new TypeError(`undefined value at ${path}`);
  }

  if (value === null || typeof value !== "object") {
    if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
      throw new TypeError(`unsupported value at ${path}`);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalizeValue(item, `${path}[${index}]`));
  }

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = canonicalizeValue((value as Record<string, unknown>)[key], `${path}.${key}`);
  }
  return sorted;
}

export function canonicalizeRequest(request: ResolvedCalibrationRequest): string {
  return JSON.stringify(canonicalizeValue(request, "$"));
}

export function fingerprintRequest(request: ResolvedCalibrationRequest): string {
  return createHash("sha256").update(canonicalizeRequest(request), "utf8").digest("hex");
}
