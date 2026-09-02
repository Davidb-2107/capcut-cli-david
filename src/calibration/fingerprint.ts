import { createHash } from "node:crypto";

import type { ResolvedCalibrationRequest } from "./domain.js";

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertNoIgnoredProperties(value: object, path: string): void {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`symbol property at ${path}`);
  }

  const enumerableNames = new Set(Object.keys(value));
  for (const name of Object.getOwnPropertyNames(value)) {
    if (!enumerableNames.has(name)) {
      throw new TypeError(`non-enumerable property at ${path}.${name}`);
    }
  }
}

function isArrayIndexName(name: string, length: number): boolean {
  if (!/^(0|[1-9]\d*)$/u.test(name)) return false;
  const index = Number(name);
  return Number.isSafeInteger(index) && index < length && String(index) === name;
}

function serializeValue(value: unknown, path: string): string {
  if (value === undefined) {
    throw new TypeError(`undefined value at ${path}`);
  }

  if (value === null || typeof value !== "object") {
    if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
      throw new TypeError(`unsupported value at ${path}`);
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError(`non-finite number at ${path}`);
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError(`symbol property at ${path}`);
    }
    for (const name of Object.getOwnPropertyNames(value)) {
      if (name !== "length" && !isArrayIndexName(name, value.length)) {
        throw new TypeError(`extra array property at ${path}.${name}`);
      }
    }
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

  assertNoIgnoredProperties(value, path);

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
