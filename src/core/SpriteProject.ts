export type SpriteProject = {
  width: number;
  height: number;
  colorMode: "rgba";
  frames: SpriteFrame[];
  frameTags?: SpriteFrameTag[];
  layers: SpriteLayer[];
};

export type SpriteFrame = {
  index: number;
  durationMs: number;
};

export type SpriteFrameTagDirection = "forward" | "reverse" | "ping-pong";

export type SpriteFrameTag = {
  name: string;
  from: number;
  to: number;
  direction: SpriteFrameTagDirection;
};

export type SpriteLayer = {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  cels: SpriteCel[];
};

export type SpriteCel = {
  frameIndex: number;
  x: number;
  y: number;
  imageData: ImageData;
};

/**
 * SpriteProject stores frame durations as whole milliseconds in this range.
 * Importers normalize source timing here; exporters may enforce additional
 * format-specific limits when they consume the model.
 */
export const MIN_FRAME_DURATION_MS = 1;
export const MAX_FRAME_DURATION_MS = 65_535;

export const LAYER_NAME_REQUIRED_MESSAGE =
  "Layer name must contain at least one non-whitespace character.";

export const FRAME_TAG_NAME_REQUIRED_MESSAGE =
  "Frame tag name must contain at least one non-whitespace character.";

export function isValidFrameTagName(name: unknown): name is string {
  return typeof name === "string" && name.trim().length > 0;
}

export function isValidFrameTagDirection(
  direction: unknown,
): direction is SpriteFrameTagDirection {
  return (
    direction === "forward" ||
    direction === "reverse" ||
    direction === "ping-pong"
  );
}

export function isValidLayerName(name: unknown): name is string {
  return typeof name === "string" && name.trim().length > 0;
}

export function renameLayer(
  project: SpriteProject,
  layerId: string,
  name: string,
): SpriteProject {
  if (!isValidLayerName(name)) {
    throw new RangeError(LAYER_NAME_REQUIRED_MESSAGE);
  }

  const layerPosition = project.layers.findIndex((layer) => layer.id === layerId);
  if (layerPosition === -1) {
    throw new RangeError(`Layer id "${layerId}" does not exist.`);
  }

  const layers = project.layers.slice();
  layers[layerPosition] = { ...layers[layerPosition], name };
  return { ...project, layers };
}

export function isValidFrameDuration(durationMs: number): boolean {
  return (
    Number.isFinite(durationMs) &&
    Number.isInteger(durationMs) &&
    durationMs >= MIN_FRAME_DURATION_MS &&
    durationMs <= MAX_FRAME_DURATION_MS
  );
}

export function normalizeFrameDurationMs(durationMs: number): number {
  if (!Number.isFinite(durationMs)) {
    throw new RangeError("Frame duration must be a finite number.");
  }

  return Math.max(
    MIN_FRAME_DURATION_MS,
    Math.min(MAX_FRAME_DURATION_MS, Math.round(durationMs)),
  );
}

export function updateFrameDuration(
  project: SpriteProject,
  frameIndex: number,
  durationMs: number,
): SpriteProject {
  if (!isValidFrameDuration(durationMs)) {
    throw new RangeError(
      `Frame duration must be a whole number from ${MIN_FRAME_DURATION_MS} to ${MAX_FRAME_DURATION_MS} milliseconds.`,
    );
  }

  const framePosition = project.frames.findIndex(
    (frame) => frame.index === frameIndex,
  );
  if (framePosition === -1) {
    throw new RangeError(`Frame index ${frameIndex} does not exist.`);
  }

  const frames = project.frames.slice();
  frames[framePosition] = { ...frames[framePosition], durationMs };
  return { ...project, frames };
}
