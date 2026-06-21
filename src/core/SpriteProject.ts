export type SpriteProject = {
  width: number;
  height: number;
  colorMode: "rgba";
  frames: SpriteFrame[];
  layers: SpriteLayer[];
};

export type SpriteFrame = {
  index: number;
  durationMs: number;
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

/** Aseprite stores each frame duration as an unsigned 16-bit millisecond value. */
export const MIN_FRAME_DURATION_MS = 1;
export const MAX_FRAME_DURATION_MS = 65_535;

export const LAYER_NAME_REQUIRED_MESSAGE =
  "Layer name must contain at least one non-whitespace character.";

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
