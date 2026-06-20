import type { SpriteProject } from "../../SpriteProject";

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

export type SpritesheetJsonFrameMetadata = {
  frame: SpritesheetJsonFrameRectangle;
  duration: number;
};

export type SpritesheetJsonMetadata = {
  frames: SpritesheetJsonFrameMetadata[];
};

export type SpritesheetJsonImportOptions = {
  defaultFrameDurationMs?: number;
};

export type SpritesheetJsonImportDependencies = {
  decodePng?: (file: File) => Promise<ImageData>;
};

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
    throw new Error(
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
    throw new Error(`${path} must be an object.`);
  }
  if (value.rotated !== undefined && value.rotated !== false) {
    throw new Error(`${path}.rotated must be false; rotated frames are unsupported.`);
  }
  if (value.trimmed !== undefined && value.trimmed !== false) {
    throw new Error(`${path}.trimmed must be false; trimmed frames are unsupported.`);
  }
  if (!isRecord(value.frame)) {
    throw new Error(`${path}.frame must be an object.`);
  }

  const rectangle = value.frame;
  if (!isNonNegativeInteger(rectangle.x)) {
    throw new Error(`${path}.frame.x must be a non-negative integer.`);
  }
  if (!isNonNegativeInteger(rectangle.y)) {
    throw new Error(`${path}.frame.y must be a non-negative integer.`);
  }
  if (!isPositiveInteger(rectangle.w)) {
    throw new Error(`${path}.frame.w must be a positive integer.`);
  }
  if (!isPositiveInteger(rectangle.h)) {
    throw new Error(`${path}.frame.h must be a positive integer.`);
  }

  const duration = value.duration ?? defaultDuration;
  if (!isPositiveInteger(duration)) {
    throw new Error(`${path}.duration must be a positive integer in milliseconds.`);
  }

  return {
    frame: {
      x: rectangle.x,
      y: rectangle.y,
      w: rectangle.w,
      h: rectangle.h,
    },
    duration,
  };
}

/**
 * Parses the documented Aseprite-style metadata subset. `frames` may be an
 * ordered array or an object map; each entry needs `frame.{x,y,w,h}` and may
 * provide `duration`. Rotated and trimmed frames are not supported.
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
    throw new Error("Spritesheet metadata is not valid JSON.", { cause: error });
  }

  if (!isRecord(value)) {
    throw new Error("Spritesheet metadata must be an object.");
  }

  const frameEntries = Array.isArray(value.frames)
    ? value.frames.map((frame, index) => ({
        path: `frames[${index}]`,
        value: frame,
      }))
    : isRecord(value.frames)
      ? Object.entries(value.frames).map(([name, frame]) => ({
          path: `frames[${JSON.stringify(name)}]`,
          value: frame,
        }))
      : null;

  if (frameEntries === null) {
    throw new Error("Spritesheet metadata frames must be an array or object map.");
  }
  if (frameEntries.length === 0) {
    throw new Error("Spritesheet metadata must contain at least one frame.");
  }

  return {
    frames: frameEntries.map(({ path, value: frame }) =>
      parseFrame(frame, path, defaultDuration),
    ),
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

export function createSpritesheetJsonProject(
  spritesheet: ImageData,
  metadata: SpritesheetJsonMetadata,
): SpriteProject {
  if (!isValidImageData(spritesheet)) {
    throw new Error("Spritesheet contains invalid RGBA image data.");
  }
  if (metadata.frames.length === 0) {
    throw new Error("Spritesheet metadata must contain at least one frame.");
  }

  const firstRectangle = metadata.frames[0].frame;
  const cels = metadata.frames.map(({ frame }, frameIndex) => {
    if (
      frame.w !== firstRectangle.w ||
      frame.h !== firstRectangle.h
    ) {
      throw new Error(
        `Frame ${frameIndex + 1} dimensions ${frame.w}x${frame.h} do not match ` +
          `the first frame dimensions ${firstRectangle.w}x${firstRectangle.h}.`,
      );
    }
    if (frame.x + frame.w > spritesheet.width || frame.y + frame.h > spritesheet.height) {
      throw new Error(
        `Frame ${frameIndex + 1} rectangle (${frame.x}, ${frame.y}, ${frame.w}, ${frame.h}) ` +
          `is outside spritesheet dimensions ${spritesheet.width}x${spritesheet.height}.`,
      );
    }

    return {
      frameIndex,
      x: 0,
      y: 0,
      imageData: sliceFrame(spritesheet, frame),
    };
  });

  return {
    width: firstRectangle.w,
    height: firstRectangle.h,
    colorMode: "rgba",
    frames: metadata.frames.map(({ duration }, index) => ({
      index,
      durationMs: duration,
    })),
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
    throw new Error(`${file.name} is not a PNG file.`);
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
    throw new Error(
      `Could not decode spritesheet PNG (${spritesheetFile.name}).`,
      { cause: error },
    );
  }

  return createSpritesheetJsonProject(spritesheet, metadata);
}
