export type FontCalibrationStatus = "candidate" | "validated";

export interface FontCalibrationIdentity {
  title: string;
  resourceId: string | null;
  fontPath: string;
}

export interface FontCalibrationProfile {
  key: string;
  scale: number;
  status: FontCalibrationStatus;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Parse the persisted profile table without allowing malformed entries through. */
export function parseFontCalibrationProfiles(value: unknown): FontCalibrationProfile[] {
  if (!Array.isArray(value)) throw new Error("Font calibration file must contain a JSON array.");

  return value.map((entry, index) => {
    const profile = record(entry);
    if (!profile || typeof profile.key !== "string" || profile.key.trim() === "") {
      throw new Error(`Font calibration profile at index ${index} must have a non-empty string key.`);
    }
    if (typeof profile.scale !== "number" || !Number.isFinite(profile.scale) || profile.scale <= 0) {
      throw new Error(`Font calibration profile at index ${index} must have a positive finite numeric scale.`);
    }
    if (profile.status !== "candidate" && profile.status !== "validated") {
      throw new Error(`Font calibration profile at index ${index} must have status candidate or validated.`);
    }
    return {
      key: profile.key.trim(),
      scale: profile.scale,
      status: profile.status,
    };
  });
}

function normalizeFontPath(fontPath: string): string {
  return fontPath.trim().replaceAll("\\", "/").toLowerCase();
}

function calibrationKeys(identity: FontCalibrationIdentity): string[] {
  const keys: string[] = [];
  const resourceId = identity.resourceId?.trim();
  if (resourceId) {
    keys.push(`resource:${resourceId}`);
  }

  keys.push(`path:${normalizeFontPath(identity.fontPath)}`);
  return keys;
}

export function calibrationKey(identity: FontCalibrationIdentity): string {
  return calibrationKeys(identity)[0];
}

function describeIdentity(identity: FontCalibrationIdentity): string {
  const resourceId = identity.resourceId?.trim();
  return resourceId
    ? `font "${identity.title}" (resource_id=${resourceId})`
    : `font "${identity.title}" (path=${identity.fontPath})`;
}

export function resolveFontCalibration(
  identity: FontCalibrationIdentity,
  profiles: readonly FontCalibrationProfile[],
  options: { allowCandidate?: boolean } = {},
): FontCalibrationProfile {
  const profile = calibrationKeys(identity)
    .map((key) => profiles.find((candidate) => candidate.key === key))
    .find((candidate): candidate is FontCalibrationProfile => candidate !== undefined);

  if (!profile) {
    throw new Error(`No validated CapCut calibration profile for ${describeIdentity(identity)}.`);
  }

  if (profile.status !== "validated" && !options.allowCandidate) {
    throw new Error(`Calibration profile for ${describeIdentity(identity)} is a candidate and is not validated.`);
  }

  if (!Number.isFinite(profile.scale) || profile.scale <= 0) {
    throw new Error(`Calibration profile for ${describeIdentity(identity)} has an invalid scale.`);
  }

  return profile;
}

export function resolveValidatedFontCalibration(
  identity: FontCalibrationIdentity,
  profiles: readonly FontCalibrationProfile[],
): FontCalibrationProfile {
  return resolveFontCalibration(identity, profiles);
}
