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

export function resolveValidatedFontCalibration(
  identity: FontCalibrationIdentity,
  profiles: readonly FontCalibrationProfile[],
): FontCalibrationProfile {
  const profile = calibrationKeys(identity)
    .map((key) => profiles.find((candidate) => candidate.key === key))
    .find((candidate): candidate is FontCalibrationProfile => candidate !== undefined);

  if (!profile) {
    throw new Error(`No validated CapCut calibration profile for ${describeIdentity(identity)}.`);
  }

  if (profile.status !== "validated") {
    throw new Error(`Calibration profile for ${describeIdentity(identity)} is a candidate and is not validated.`);
  }

  if (!Number.isFinite(profile.scale) || profile.scale <= 0) {
    throw new Error(`Calibration profile for ${describeIdentity(identity)} has an invalid scale.`);
  }

  return profile;
}
