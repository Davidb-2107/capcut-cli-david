import { createHash } from "node:crypto";

import type { ResolvedCalibrationRequest } from "./domain.js";

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function serializeValue(value: unknown, path: string): string {
  if (value === undefined) {
    throw new TypeError(`undefined value at ${path}`);
  }

  if (value === null || typeof value !== "object") {
    if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
      throw new TypeError(`unsupported value at ${path}`);
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        throw new TypeError(`undefined value at ${path}[${index}]`);
      }
      items.push(serializeValue(value[index], `${path}[${index}]`));
    }
    return `[${items.join(",")}]`;
  }

  if (!isPlainObject(value)) {
    throw new TypeError(`non-plain object at ${path}`);
  }

  const members = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serializeValue(value[key], `${path}.${key}`)}`);
  return `{${members.join(",")}}`;
}

export function canonicalizeRequest(request: ResolvedCalibrationRequest): string {
  return serializeValue(request, "$");
}

export function fingerprintRequest(request: ResolvedCalibrationRequest): string {
  return createHash("sha256").update(canonicalizeRequest(request), "utf8").digest("hex");
}
