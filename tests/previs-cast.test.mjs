import assert from "node:assert/strict";
import test from "node:test";
import {
  PREVIS_ASPECT_RATIOS,
  PREVIS_CAST,
  PREVIS_HAIR_COLORS,
  PREVIS_HAIR_STYLES,
  PREVIS_SKIN_TONES,
  PREVIS_WARDROBES,
  appearanceForActor,
  aspectRatioFor,
  profilePatch,
} from "../app/previsCast.js";

test("the previs cast is a balanced twelve-person library", () => {
  assert.equal(PREVIS_CAST.length, 12);
  assert.equal(PREVIS_CAST.filter((person) => person.gender === "male").length, 6);
  assert.equal(PREVIS_CAST.filter((person) => person.gender === "female").length, 6);
  assert.equal(new Set(PREVIS_CAST.map((person) => person.id)).size, 12);
});

test("a cast profile produces scene-safe appearance fields", () => {
  const patch = profilePatch("maya");
  assert.deepEqual(Object.keys(patch).sort(), [
    "gender",
    "height",
    "previsBuild",
    "previsCharacter",
    "previsHairColor",
    "previsHairStyle",
    "previsSkinTone",
    "previsWardrobe",
  ]);
  const appearance = appearanceForActor({ name: "Lead", ...patch, previsWardrobe: "formal", previsHairStyle: "bun" });
  assert.equal(appearance.profile.label, "Maya");
  assert.equal(appearance.wardrobe.label, "Formal");
  assert.equal(appearance.hairStyle, "bun");
  assert.ok(appearance.height > 4);
});

test("previs appearance choices and cinematic formats remain extensible", () => {
  assert.ok(PREVIS_WARDROBES.length >= 6);
  assert.ok(PREVIS_SKIN_TONES.length >= 6);
  assert.ok(PREVIS_HAIR_COLORS.length >= 5);
  assert.ok(PREVIS_HAIR_STYLES.length >= 8);
  assert.deepEqual(PREVIS_ASPECT_RATIOS.map((format) => format.id), ["1.33", "1.66", "1.78", "1.85", "2.00", "2.39"]);
  assert.equal(aspectRatioFor("2.39").value, 2.39);
  assert.equal(aspectRatioFor("missing").id, "2.39");
});
