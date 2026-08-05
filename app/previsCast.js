export const PREVIS_WARDROBES = [
  { id: "casual", label: "Casual", color: "#50758a", accent: "#2e4e62" },
  { id: "formal", label: "Formal", color: "#2a374a", accent: "#161f2a" },
  { id: "outerwear", label: "Outerwear", color: "#85503f", accent: "#563126" },
  { id: "workwear", label: "Workwear", color: "#60755a", accent: "#3c5037" },
  { id: "evening", label: "Evening", color: "#7b4669", accent: "#4d283e" },
  { id: "bright", label: "Bright color", color: "#b17032", accent: "#70411b" },
];

export const PREVIS_SKIN_TONES = [
  { id: "fair", label: "Fair", color: "#f1c3a5" },
  { id: "light", label: "Light", color: "#dca27d" },
  { id: "warm", label: "Warm", color: "#bd7958" },
  { id: "tan", label: "Tan", color: "#a76845" },
  { id: "brown", label: "Brown", color: "#805035" },
  { id: "deep", label: "Deep", color: "#563226" },
];

export const PREVIS_HAIR_COLORS = [
  { id: "black", label: "Black", color: "#15191e" },
  { id: "brown", label: "Brown", color: "#4a2f24" },
  { id: "auburn", label: "Auburn", color: "#7c3b28" },
  { id: "blonde", label: "Blonde", color: "#c49d61" },
  { id: "silver", label: "Silver", color: "#9aa1a4" },
];

export const PREVIS_HAIR_STYLES = [
  { id: "buzz", label: "Buzz" },
  { id: "crop", label: "Crop" },
  { id: "wave", label: "Wavy" },
  { id: "curly", label: "Curly" },
  { id: "long", label: "Long" },
  { id: "bun", label: "Bun" },
  { id: "braids", label: "Braids" },
  { id: "pixie", label: "Pixie" },
];

export const PREVIS_CAST = [
  { id: "marcus", label: "Marcus", gender: "male", height: 6.15, build: "broad", skinTone: "deep", hairColor: "black", hairStyle: "buzz", wardrobe: "formal" },
  { id: "elias", label: "Elias", gender: "male", height: 5.95, build: "lean", skinTone: "light", hairColor: "brown", hairStyle: "wave", wardrobe: "casual" },
  { id: "daniel", label: "Daniel", gender: "male", height: 5.8, build: "average", skinTone: "warm", hairColor: "black", hairStyle: "crop", wardrobe: "workwear" },
  { id: "theo", label: "Theo", gender: "male", height: 5.7, build: "lean", skinTone: "fair", hairColor: "auburn", hairStyle: "curly", wardrobe: "bright" },
  { id: "jonah", label: "Jonah", gender: "male", height: 6.05, build: "average", skinTone: "tan", hairColor: "brown", hairStyle: "crop", wardrobe: "outerwear" },
  { id: "victor", label: "Victor", gender: "male", height: 5.9, build: "broad", skinTone: "brown", hairColor: "silver", hairStyle: "wave", wardrobe: "evening" },
  { id: "maya", label: "Maya", gender: "female", height: 5.65, build: "average", skinTone: "warm", hairColor: "black", hairStyle: "long", wardrobe: "casual" },
  { id: "nora", label: "Nora", gender: "female", height: 5.75, build: "lean", skinTone: "fair", hairColor: "blonde", hairStyle: "bun", wardrobe: "formal" },
  { id: "ava", label: "Ava", gender: "female", height: 5.55, build: "average", skinTone: "brown", hairColor: "black", hairStyle: "braids", wardrobe: "bright" },
  { id: "june", label: "June", gender: "female", height: 5.45, build: "lean", skinTone: "light", hairColor: "auburn", hairStyle: "pixie", wardrobe: "workwear" },
  { id: "sofia", label: "Sofia", gender: "female", height: 5.7, build: "average", skinTone: "tan", hairColor: "brown", hairStyle: "wave", wardrobe: "evening" },
  { id: "tessa", label: "Tessa", gender: "female", height: 5.85, build: "broad", skinTone: "deep", hairColor: "black", hairStyle: "curly", wardrobe: "outerwear" },
];

export const PREVIS_ASPECT_RATIOS = [
  { id: "1.33", label: "1.33 · Academy", value: 4 / 3 },
  { id: "1.66", label: "1.66 · European", value: 1.66 },
  { id: "1.78", label: "1.78 · 16:9", value: 16 / 9 },
  { id: "1.85", label: "1.85 · Flat", value: 1.85 },
  { id: "2.00", label: "2.00 · Univisium", value: 2 },
  { id: "2.39", label: "2.39 · Scope", value: 2.39 },
];

const lookup = (collection, id, fallback) => collection.find((item) => item.id === id) || fallback;

export const castMemberFor = (id, gender = "female") =>
  lookup(PREVIS_CAST, id, PREVIS_CAST.find((member) => member.gender === gender) || PREVIS_CAST[0]);

export const skinToneFor = (id) => lookup(PREVIS_SKIN_TONES, id, PREVIS_SKIN_TONES[2]);
export const hairColorFor = (id) => lookup(PREVIS_HAIR_COLORS, id, PREVIS_HAIR_COLORS[1]);
export const wardrobeFor = (id) => lookup(PREVIS_WARDROBES, id, PREVIS_WARDROBES[0]);
export const aspectRatioFor = (id) => lookup(PREVIS_ASPECT_RATIOS, id, PREVIS_ASPECT_RATIOS[5]);

export function appearanceForActor(actor) {
  const profile = castMemberFor(actor.previsCharacter, actor.gender);
  return {
    profile,
    gender: actor.gender || profile.gender,
    height: Number(actor.height) || profile.height,
    build: actor.previsBuild || profile.build,
    skin: skinToneFor(actor.previsSkinTone || profile.skinTone),
    hairColor: hairColorFor(actor.previsHairColor || profile.hairColor),
    hairStyle: actor.previsHairStyle || profile.hairStyle,
    wardrobe: wardrobeFor(actor.previsWardrobe || profile.wardrobe),
  };
}

export function profilePatch(profileId) {
  const profile = castMemberFor(profileId);
  return {
    previsCharacter: profile.id,
    gender: profile.gender,
    height: profile.height,
    previsBuild: profile.build,
    previsSkinTone: profile.skinTone,
    previsHairColor: profile.hairColor,
    previsHairStyle: profile.hairStyle,
    previsWardrobe: profile.wardrobe,
  };
}
