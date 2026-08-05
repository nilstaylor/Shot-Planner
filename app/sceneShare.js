import LZString from "lz-string";

export const SHARE_HASH_KEY = "shot-plan";
export const MAX_SHARE_URL_LENGTH = 14000;

export function makePortableShareScene(scene) {
  const { blueprint, ...portable } = scene;
  return {
    ...portable,
    shareFormat: "shot-planner-link-v1",
    blueprint: null,
  };
}

export function encodeSceneShare(scene) {
  return LZString.compressToEncodedURIComponent(JSON.stringify(makePortableShareScene(scene)));
}

export function decodeSceneShare(encoded) {
  const text = LZString.decompressFromEncodedURIComponent(encoded);
  if (!text) throw new Error("This share link is incomplete or could not be read.");
  const scene = JSON.parse(text);
  if (!scene || !Array.isArray(scene.objects)) throw new Error("This share link does not contain a Shot Planner scene.");
  return scene;
}

export function buildSceneShareUrl(pageUrl, scene) {
  const url = new URL(pageUrl);
  url.hash = `${SHARE_HASH_KEY}=${encodeURIComponent(encodeSceneShare(scene))}`;
  return url.toString();
}

export function sceneFromShareHash(hash) {
  const rawHash = String(hash || "").replace(/^#/, "");
  const parameters = new URLSearchParams(rawHash);
  const payload = parameters.get(SHARE_HASH_KEY);
  return payload ? decodeSceneShare(payload) : null;
}
