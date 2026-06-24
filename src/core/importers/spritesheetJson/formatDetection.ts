export type AtlasJsonFamily =
  | "aseprite"
  | "texturepacker"
  | "phaser-pixi"
  | "unknown";

export type AtlasJsonVariant =
  | "array"
  | "hash"
  | "root-frames"
  | "multiatlas"
  | "unknown";

export type AtlasJsonFormatDetection = {
  family: AtlasJsonFamily;
  variant: AtlasJsonVariant;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getAppSignal(value: Record<string, unknown>): string {
  if (!isRecord(value.meta) || typeof value.meta.app !== "string") {
    return "";
  }
  return value.meta.app.toLowerCase();
}

/** Detects atlas families from JSON structure and fixed producer signals only. */
export function detectAtlasJsonFormat(value: unknown): AtlasJsonFormatDetection {
  if (!isRecord(value)) {
    return { family: "unknown", variant: "unknown" };
  }

  const app = getAppSignal(value);
  const isAseprite = app.includes("aseprite");
  const isTexturePacker = app.includes("texturepacker");
  const isPhaserOrPixi = app.includes("phaser") || app.includes("pixi");
  const framesVariant = Array.isArray(value.frames)
    ? "array"
    : isRecord(value.frames)
      ? "hash"
      : "root-frames";

  if (isAseprite) {
    return { family: "aseprite", variant: framesVariant };
  }
  if ("textures" in value) {
    return { family: "phaser-pixi", variant: "multiatlas" };
  }
  if (isPhaserOrPixi || isRecord(value.animations)) {
    return { family: "phaser-pixi", variant: framesVariant };
  }
  if (isTexturePacker) {
    return { family: "texturepacker", variant: framesVariant };
  }
  if (framesVariant === "array" || framesVariant === "hash") {
    return { family: "texturepacker", variant: framesVariant };
  }
  if ("frames" in value) {
    return { family: "unknown", variant: "root-frames" };
  }
  return { family: "unknown", variant: "unknown" };
}

export function getAtlasJsonFormatLabel(
  detection: AtlasJsonFormatDetection,
): string {
  if (detection.family === "aseprite") {
    return "Aseprite JSON";
  }
  if (detection.family === "texturepacker") {
    if (detection.variant === "array") {
      return "TexturePacker Array";
    }
    if (detection.variant === "hash") {
      return "TexturePacker Hash";
    }
    return "TexturePacker";
  }
  if (detection.family === "phaser-pixi") {
    return detection.variant === "multiatlas"
      ? "Phaser Multi-Atlas"
      : "Phaser/Pixi-compatible atlas";
  }
  return "Atlas JSON";
}
