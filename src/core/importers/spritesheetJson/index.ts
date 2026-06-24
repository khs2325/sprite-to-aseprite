import type { SpriteFrameTag, SpriteProject } from "../../SpriteProject";
import {
  detectAtlasJsonFormat,
  getAtlasJsonFormatLabel,
} from "./formatDetection";

export {
  detectAtlasJsonFormat,
  getAtlasJsonFormatLabel,
  type AtlasJsonFamily,
  type AtlasJsonFormatDetection,
  type AtlasJsonVariant,
} from "./formatDetection";

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export const DEFAULT_FRAME_DURATION_MS = 100;

export type SpritesheetJsonFrameRectangle = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type SpritesheetJsonSourceSize = {
  w: number;
  h: number;
};

type SpritesheetJsonUntrimmedFrameMetadata = {
  frame: SpritesheetJsonFrameRectangle;
  duration: number;
  rotated?: boolean;
  trimmed?: false;
};

type SpritesheetJsonTrimmedFrameMetadata = {
  frame: SpritesheetJsonFrameRectangle;
  duration: number;
  rotated?: boolean;
  trimmed: true;
  sourceSize: SpritesheetJsonSourceSize;
  spriteSourceSize: SpritesheetJsonFrameRectangle;
};

export type SpritesheetJsonFrameMetadata =
  | SpritesheetJsonUntrimmedFrameMetadata
  | SpritesheetJsonTrimmedFrameMetadata;

export type SpritesheetJsonMetadata = {
  frames: SpritesheetJsonFrameMetadata[];
  frameTags?: SpriteFrameTag[];
};

export type SpritesheetJsonImportOptions = {
  defaultFrameDurationMs?: number;
};

export type SpritesheetJsonImportDependencies = {
  decodePng?: (file: File) => Promise<ImageData>;
};

export type SpritesheetJsonImportErrorCode =
  | "browser-image-decode"
  | "invalid-field"
  | "invalid-frame-geometry"
  | "invalid-json"
  | "invalid-png"
  | "unknown-schema"
  | "unsupported-variant";

export class SpritesheetJsonImportError extends Error {
  constructor(
    readonly code: SpritesheetJsonImportErrorCode,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "SpritesheetJsonImportError";
  }
}

/** Returns importer-authored detail only; arbitrary thrown values stay private. */
export function getSpritesheetJsonImportDiagnostic(
  error: unknown,
): string | null {
  return error instanceof SpritesheetJsonImportError ? error.message : null;
}

function fail(
  code: SpritesheetJsonImportErrorCode,
  message: string,
): never {
  throw new SpritesheetJsonImportError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function getDefaultFrameDuration(options: SpritesheetJsonImportOptions): number {
  const duration =
    options.defaultFrameDurationMs ?? DEFAULT_FRAME_DURATION_MS;

  if (!isPositiveInteger(duration)) {
    fail(
      "invalid-field",
      "Default frame duration must be a positive integer in milliseconds.",
    );
  }

  return duration;
}

function parseFrame(
  value: unknown,
  path: string,
  defaultDuration: number,
): SpritesheetJsonFrameMetadata {
  if (!isRecord(value)) {
    fail("invalid-field", `${path} must be an object.`);
  }
  if (value.rotated !== undefined && typeof value.rotated !== "boolean") {
    fail(
      "invalid-field",
      `${path}.rotated must be a boolean; true uses TexturePacker's ` +
        "90-degree clockwise atlas convention.",
    );
  }
  if (value.trimmed !== undefined && typeof value.trimmed !== "boolean") {
    fail("invalid-field", `${path}.trimmed must be a boolean.`);
  }
  if (!isRecord(value.frame)) {
    fail("invalid-field", `${path}.frame must be an object.`);
  }

  const rectangle = value.frame;
  if (!isNonNegativeInteger(rectangle.x)) {
    fail("invalid-field", `${path}.frame.x must be a non-negative integer.`);
  }
  if (!isNonNegativeInteger(rectangle.y)) {
    fail("invalid-field", `${path}.frame.y must be a non-negative integer.`);
  }
  if (!isPositiveInteger(rectangle.w)) {
    fail("invalid-field", `${path}.frame.w must be a positive integer.`);
  }
  if (!isPositiveInteger(rectangle.h)) {
    fail("invalid-field", `${path}.frame.h must be a positive integer.`);
  }

  const duration = value.duration ?? defaultDuration;
  if (!isPositiveInteger(duration)) {
    fail(
      "invalid-field",
      `${path}.duration must be a positive integer in milliseconds.`,
    );
  }

  const frame = {
    x: rectangle.x,
    y: rectangle.y,
    w: rectangle.w,
    h: rectangle.h,
  };

  if (value.trimmed === true) {
    if (!isRecord(value.sourceSize)) {
      fail(
        "invalid-field",
        `${path}.sourceSize must be an object when trimmed is true.`,
      );
    }
    if (!isPositiveInteger(value.sourceSize.w)) {
      fail("invalid-field", `${path}.sourceSize.w must be a positive integer.`);
    }
    if (!isPositiveInteger(value.sourceSize.h)) {
      fail("invalid-field", `${path}.sourceSize.h must be a positive integer.`);
    }
    if (!isRecord(value.spriteSourceSize)) {
      fail(
        "invalid-field",
        `${path}.spriteSourceSize must be an object when trimmed is true.`,
      );
    }
    if (!isNonNegativeInteger(value.spriteSourceSize.x)) {
      fail(
        "invalid-field",
        `${path}.spriteSourceSize.x must be a non-negative integer.`,
      );
    }
    if (!isNonNegativeInteger(value.spriteSourceSize.y)) {
      fail(
        "invalid-field",
        `${path}.spriteSourceSize.y must be a non-negative integer.`,
      );
    }
    if (!isPositiveInteger(value.spriteSourceSize.w)) {
      fail(
        "invalid-field",
        `${path}.spriteSourceSize.w must be a positive integer.`,
      );
    }
    if (!isPositiveInteger(value.spriteSourceSize.h)) {
      fail(
        "invalid-field",
        `${path}.spriteSourceSize.h must be a positive integer.`,
      );
    }
    const restoredWidth = value.rotated === true ? frame.h : frame.w;
    const restoredHeight = value.rotated === true ? frame.w : frame.h;
    if (value.spriteSourceSize.w !== restoredWidth) {
      fail(
        "invalid-frame-geometry",
        value.rotated === true
          ? `${path}.spriteSourceSize.w must match ${path}.frame.h when rotated is true.`
          : `${path}.spriteSourceSize.w must match ${path}.frame.w for an unrotated trimmed frame.`,
      );
    }
    if (value.spriteSourceSize.h !== restoredHeight) {
      fail(
        "invalid-frame-geometry",
        value.rotated === true
          ? `${path}.spriteSourceSize.h must match ${path}.frame.w when rotated is true.`
          : `${path}.spriteSourceSize.h must match ${path}.frame.h for an unrotated trimmed frame.`,
      );
    }
    if (
      value.spriteSourceSize.x + value.spriteSourceSize.w > value.sourceSize.w ||
      value.spriteSourceSize.y + value.spriteSourceSize.h > value.sourceSize.h
    ) {
      fail(
        "invalid-frame-geometry",
        `${path}.spriteSourceSize rectangle (` +
          `${value.spriteSourceSize.x}, ${value.spriteSourceSize.y}, ` +
          `${value.spriteSourceSize.w}, ${value.spriteSourceSize.h}) is outside ` +
          `${path}.sourceSize dimensions ${value.sourceSize.w}x${value.sourceSize.h}.`,
      );
    }
    if (
      value.spriteSourceSize.x === 0 &&
      value.spriteSourceSize.y === 0 &&
      value.spriteSourceSize.w === value.sourceSize.w &&
      value.spriteSourceSize.h === value.sourceSize.h
    ) {
      fail(
        "invalid-frame-geometry",
        `${path}.trimmed is true but spriteSourceSize fills sourceSize without trimming.`,
      );
    }

    return {
      frame,
      duration,
      ...(value.rotated === true ? { rotated: true } : {}),
      trimmed: true,
      sourceSize: {
        w: value.sourceSize.w,
        h: value.sourceSize.h,
      },
      spriteSourceSize: {
        x: value.spriteSourceSize.x,
        y: value.spriteSourceSize.y,
        w: value.spriteSourceSize.w,
        h: value.spriteSourceSize.h,
      },
    };
  }

  return {
    frame,
    duration,
    ...(value.rotated === true ? { rotated: true } : {}),
  };
}

function parseAsepriteFrameTags(
  value: Record<string, unknown>,
  frameCount: number,
): SpriteFrameTag[] | undefined {
  if (!isRecord(value.meta) || value.meta.frameTags === undefined) {
    return undefined;
  }
  if (!Array.isArray(value.meta.frameTags)) {
    fail("invalid-field", "meta.frameTags must be an array when provided.");
  }

  const names = new Set<string>();
  return value.meta.frameTags.map((frameTag, index) => {
    const path = `meta.frameTags[${index}]`;
    if (!isRecord(frameTag)) {
      fail("invalid-field", `${path} must be an object.`);
    }
    if (typeof frameTag.name !== "string" || frameTag.name.trim().length === 0) {
      fail(
        "invalid-field",
        `${path}.name must contain at least one non-whitespace character.`,
      );
    }
    if (names.has(frameTag.name)) {
      fail(
        "invalid-field",
        `${path}.name duplicates an earlier frame tag name.`,
      );
    }
    names.add(frameTag.name);

    if (!isNonNegativeInteger(frameTag.from)) {
      fail(
        "invalid-field",
        `${path}.from must be a non-negative safe integer.`,
      );
    }
    if (!isNonNegativeInteger(frameTag.to)) {
      fail(
        "invalid-field",
        `${path}.to must be a non-negative safe integer.`,
      );
    }
    if (frameTag.from > frameTag.to) {
      fail(
        "invalid-field",
        `${path}.from must be less than or equal to ${path}.to.`,
      );
    }
    if (frameTag.from >= frameCount) {
      fail(
        "invalid-field",
        `${path}.from must reference an existing frame index from 0 to ${frameCount - 1}.`,
      );
    }
    if (frameTag.to >= frameCount) {
      fail(
        "invalid-field",
        `${path}.to must reference an existing frame index from 0 to ${frameCount - 1}.`,
      );
    }

    if (
      frameTag.direction !== "forward" &&
      frameTag.direction !== "reverse" &&
      frameTag.direction !== "pingpong"
    ) {
      fail(
        "invalid-field",
        `${path}.direction must be "forward", "reverse", or "pingpong".`,
      );
    }

    return {
      name: frameTag.name,
      from: frameTag.from,
      to: frameTag.to,
      direction: frameTag.direction === "pingpong"
        ? "ping-pong"
        : frameTag.direction,
    };
  });
}

/**
 * Parses the documented Aseprite-style metadata subset. `frames` may be an
 * ordered array or an object map; each entry needs `frame.{x,y,w,h}` and may
 * provide `duration`. TexturePacker-style frames may use `rotated: true` for
 * the 90-degree clockwise atlas convention. Trimmed frames also need complete
 * `sourceSize` and `spriteSourceSize` placement geometry. Aseprite metadata
 * may also provide the supported `meta.frameTags` subset.
 */
export function parseSpritesheetJsonMetadata(
  json: string,
  options: SpritesheetJsonImportOptions = {},
): SpritesheetJsonMetadata {
  const defaultDuration = getDefaultFrameDuration(options);
  let value: unknown;

  try {
    value = JSON.parse(json) as unknown;
  } catch (error) {
    throw new SpritesheetJsonImportError(
      "invalid-json",
      "Spritesheet metadata is not valid JSON.",
      { cause: error },
    );
  }

  const detection = detectAtlasJsonFormat(value);
  if (!isRecord(value)) {
    fail(
      "unknown-schema",
      "Atlas JSON schema is not recognized. Expected a JSON object with root-level frames.",
    );
  }

  if (
    detection.family === "phaser-pixi" &&
    detection.variant === "multiatlas"
  ) {
    if (!Array.isArray(value.textures)) {
      fail(
        "invalid-field",
        "Phaser Multi-Atlas metadata is incomplete: textures must be an array.",
      );
    }
    if (value.textures.length === 0) {
      fail(
        "invalid-field",
        "Phaser Multi-Atlas metadata is incomplete: textures must contain at least one atlas page.",
      );
    }
    value.textures.forEach((texture, index) => {
      if (!isRecord(texture)) {
        fail(
          "invalid-field",
          `Phaser Multi-Atlas texture ${index + 1} must be an object.`,
        );
      }
      if (!Array.isArray(texture.frames)) {
        fail(
          "invalid-field",
          `Phaser Multi-Atlas texture ${index + 1}.frames must be an array.`,
        );
      }
    });
    fail(
      "unsupported-variant",
      "Phaser Multi-Atlas metadata is recognized but not supported because it contains nested atlas pages instead of one root-level frame collection.",
    );
  }

  if (detection.family === "unknown" && detection.variant === "unknown") {
    fail(
      "unknown-schema",
      "Atlas JSON schema is not recognized. Expected root-level frames or Phaser Multi-Atlas textures.",
    );
  }

  const frameEntries = Array.isArray(value.frames)
    ? value.frames.map((frame, index) => ({
        path: `frames[${index}]`,
        value: frame,
      }))
    : isRecord(value.frames)
      ? Object.values(value.frames).map((frame, index) => ({
          path: `frames object entry ${index + 1}`,
          value: frame,
        }))
      : null;

  const formatLabel = getAtlasJsonFormatLabel(detection);
  if (frameEntries === null) {
    fail(
      "invalid-field",
      `${formatLabel} metadata is incomplete: frames must be an array or object map.`,
    );
  }
  if (frameEntries.length === 0) {
    fail(
      "invalid-field",
      `${formatLabel} metadata must contain at least one frame.`,
    );
  }

  const frames = frameEntries.map(({ path, value: frame }) =>
    parseFrame(frame, path, defaultDuration),
  );
  const frameTags = detection.family === "aseprite"
    ? parseAsepriteFrameTags(value, frames.length)
    : undefined;

  return {
    frames,
    ...(frameTags === undefined ? {} : { frameTags }),
  };
}

function isValidImageData(imageData: ImageData): boolean {
  return (
    Number.isSafeInteger(imageData.width) &&
    imageData.width > 0 &&
    Number.isSafeInteger(imageData.height) &&
    imageData.height > 0 &&
    (imageData.colorSpace === "srgb" ||
      imageData.colorSpace === "display-p3") &&
    imageData.data instanceof Uint8ClampedArray &&
    imageData.data.length === imageData.width * imageData.height * 4
  );
}

function sliceFrame(
  spritesheet: ImageData,
  rectangle: SpritesheetJsonFrameRectangle,
): ImageData {
  const data = new Uint8ClampedArray(rectangle.w * rectangle.h * 4);
  const rowLength = rectangle.w * 4;

  for (let row = 0; row < rectangle.h; row += 1) {
    const sourceOffset =
      ((rectangle.y + row) * spritesheet.width + rectangle.x) * 4;
    data.set(
      spritesheet.data.subarray(sourceOffset, sourceOffset + rowLength),
      row * rowLength,
    );
  }

  return {
    colorSpace: spritesheet.colorSpace,
    data,
    height: rectangle.h,
    width: rectangle.w,
  };
}

function restoreTexturePackerRotation(frame: ImageData): ImageData {
  const data = new Uint8ClampedArray(frame.width * frame.height * 4);
  const width = frame.height;
  const height = frame.width;

  for (let sourceY = 0; sourceY < frame.height; sourceY += 1) {
    for (let sourceX = 0; sourceX < frame.width; sourceX += 1) {
      const destinationX = sourceY;
      const destinationY = frame.width - sourceX - 1;
      const sourceOffset = (sourceY * frame.width + sourceX) * 4;
      const destinationOffset = (destinationY * width + destinationX) * 4;
      data.set(
        frame.data.subarray(sourceOffset, sourceOffset + 4),
        destinationOffset,
      );
    }
  }

  return {
    colorSpace: frame.colorSpace,
    data,
    height,
    width,
  };
}

function placeTrimmedFrame(
  frame: ImageData,
  metadata: SpritesheetJsonTrimmedFrameMetadata,
): ImageData {
  const { sourceSize, spriteSourceSize } = metadata;
  const data = new Uint8ClampedArray(sourceSize.w * sourceSize.h * 4);
  const rowLength = frame.width * 4;

  for (let row = 0; row < frame.height; row += 1) {
    const sourceOffset = row * rowLength;
    const destinationOffset =
      ((spriteSourceSize.y + row) * sourceSize.w + spriteSourceSize.x) * 4;
    data.set(
      frame.data.subarray(sourceOffset, sourceOffset + rowLength),
      destinationOffset,
    );
  }

  return {
    colorSpace: frame.colorSpace,
    data,
    height: sourceSize.h,
    width: sourceSize.w,
  };
}

function rebuildFrame(
  spritesheet: ImageData,
  metadata: SpritesheetJsonFrameMetadata,
): ImageData {
  const atlasFrame = sliceFrame(spritesheet, metadata.frame);
  const restoredFrame = metadata.rotated === true
    ? restoreTexturePackerRotation(atlasFrame)
    : atlasFrame;

  return metadata.trimmed === true
    ? placeTrimmedFrame(restoredFrame, metadata)
    : restoredFrame;
}

function getFrameDimensions(metadata: SpritesheetJsonFrameMetadata): {
  width: number;
  height: number;
} {
  if (metadata.trimmed === true) {
    return {
      width: metadata.sourceSize.w,
      height: metadata.sourceSize.h,
    };
  }

  return metadata.rotated === true
    ? { width: metadata.frame.h, height: metadata.frame.w }
    : { width: metadata.frame.w, height: metadata.frame.h };
}

export function createSpritesheetJsonProject(
  spritesheet: ImageData,
  metadata: SpritesheetJsonMetadata,
): SpriteProject {
  if (!isValidImageData(spritesheet)) {
    fail("invalid-png", "Spritesheet contains invalid RGBA image data.");
  }
  if (metadata.frames.length === 0) {
    fail(
      "invalid-field",
      "Spritesheet metadata must contain at least one frame.",
    );
  }

  const firstFrame = metadata.frames[0];
  const { width: firstWidth, height: firstHeight } =
    getFrameDimensions(firstFrame);
  const cels = metadata.frames.map((frameMetadata, frameIndex) => {
    const { frame } = frameMetadata;
    const { width, height } = getFrameDimensions(frameMetadata);
    if (
      width !== firstWidth ||
      height !== firstHeight
    ) {
      fail(
        "invalid-frame-geometry",
        `Frame ${frameIndex + 1} dimensions ${width}x${height} do not match ` +
          `the first frame dimensions ${firstWidth}x${firstHeight}.`,
      );
    }
    if (frame.x + frame.w > spritesheet.width || frame.y + frame.h > spritesheet.height) {
      fail(
        "invalid-frame-geometry",
        `Frame ${frameIndex + 1} rectangle (${frame.x}, ${frame.y}, ${frame.w}, ${frame.h}) ` +
          `is outside spritesheet dimensions ${spritesheet.width}x${spritesheet.height}.`,
      );
    }

    return {
      frameIndex,
      x: 0,
      y: 0,
      imageData: rebuildFrame(spritesheet, frameMetadata),
    };
  });

  return {
    width: firstWidth,
    height: firstHeight,
    colorMode: "rgba",
    frames: metadata.frames.map(({ duration }, index) => ({
      index,
      durationMs: duration,
    })),
    ...(metadata.frameTags === undefined
      ? {}
      : { frameTags: metadata.frameTags.map((frameTag) => ({ ...frameTag })) }),
    layers: [
      {
        id: "main",
        name: "Main",
        visible: true,
        opacity: 255,
        cels,
      },
    ],
  };
}

async function assertPngFile(file: File): Promise<void> {
  const signature = new Uint8Array(
    await file.slice(0, PNG_SIGNATURE.length).arrayBuffer(),
  );
  const hasPngSignature =
    signature.length === PNG_SIGNATURE.length &&
    signature.every((byte, index) => byte === PNG_SIGNATURE[index]);

  if (!hasPngSignature) {
    fail("invalid-png", "Selected spritesheet image is not a valid PNG file.");
  }
}

async function decodePngInBrowser(file: File): Promise<ImageData> {
  const bitmap = await createImageBitmap(file);

  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) {
      throw new Error("A browser canvas context is required to decode PNG files.");
    }

    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

export async function importSpritesheetJson(
  spritesheetFile: File,
  metadataFile: File,
  options: SpritesheetJsonImportOptions = {},
  dependencies: SpritesheetJsonImportDependencies = {},
): Promise<SpriteProject> {
  await assertPngFile(spritesheetFile);

  const metadata = parseSpritesheetJsonMetadata(
    await metadataFile.text(),
    options,
  );
  const decodePng = dependencies.decodePng ?? decodePngInBrowser;
  let spritesheet: ImageData;

  try {
    spritesheet = await decodePng(spritesheetFile);
  } catch (error) {
    throw new SpritesheetJsonImportError(
      "browser-image-decode",
      "Could not decode the selected spritesheet PNG in this browser.",
      { cause: error },
    );
  }

  return createSpritesheetJsonProject(spritesheet, metadata);
}
