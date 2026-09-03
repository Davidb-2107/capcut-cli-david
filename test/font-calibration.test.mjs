import assert from "node:assert/strict";
import test from "node:test";

import {
  calibrationKey,
  resolveValidatedFontCalibration,
} from "../dist/utils/font-calibration.js";

const rubik = {
  title: "Rubik",
  resourceId: "rubik-resource",
  fontPath: "C:\\Fonts\\Rubik-Bold.ttf",
};

test("prefers the catalogue resource identity over the local font path", () => {
  const profile = resolveValidatedFontCalibration(rubik, [
    {
      key: "resource:rubik-resource",
      scale: 5.22,
      status: "validated",
    },
    {
      key: "path:c:/fonts/rubik-bold.ttf",
      scale: 5.1,
      status: "validated",
    },
  ]);

  assert.equal(profile.scale, 5.22);
});

test("uses a normalized local path when no resource identity exists", () => {
  const identity = {
    title: "Pricedown",
    resourceId: null,
    fontPath: "C:\\Fonts\\Pricedown.ttf",
  };

  const profile = resolveValidatedFontCalibration(identity, [
    {
      key: "path:c:/fonts/pricedown.ttf",
      scale: 6.21,
      status: "validated",
    },
  ]);

  assert.equal(profile.scale, 6.21);
  assert.equal(calibrationKey(identity), "path:c:/fonts/pricedown.ttf");
});

test("falls back to the normalized path when the resource has no profile", () => {
  const profile = resolveValidatedFontCalibration(rubik, [
    {
      key: "path:c:/fonts/rubik-bold.ttf",
      scale: 5.22,
      status: "validated",
    },
  ]);

  assert.equal(profile.scale, 5.22);
});

test("does not activate a candidate profile", () => {
  assert.throws(
    () =>
      resolveValidatedFontCalibration(rubik, [
        {
          key: "resource:rubik-resource",
          scale: 5.22,
          status: "candidate",
        },
      ]),
    /candidate and is not validated/,
  );
});

test("fails explicitly when no profile is available", () => {
  assert.throws(
    () => resolveValidatedFontCalibration(rubik, []),
    /No validated CapCut calibration profile for font "Rubik"/,
  );
});
