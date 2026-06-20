import type { SpriteProject } from "../../SpriteProject";

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export const DEFAULT_FRAME_DURATION_MS = 100;

export type SpritesheetGridFrameOrder = "row-major" | "column-major";

export type SpritesheetGridImportOptions = {
  frameWidth: number;
  frameHeight: number;
  rows: number;
  columns: number;
  frameOrder: SpritesheetGridFrameOrder;
  frameDurationMs?: number;
};

export type SpritesheetGridImportDependencies = {
  decodePng?: (file: File) => Promise<ImageData>;
};

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

function isValidImageData(imageData: ImageData): boolean {
  return (
    Number.isInteger(imageData.width) &&
    imageData.width > 0 &&
    Number.isInteger(imageData.height) &&
    imageData.height > 0 &&
    (imageData.colorSpace === "srgb" ||
      imageData.colorSpace === "display-p3") &&
    imageData.data instanceof Uint8ClampedArray &&
    imageData.data.length === imageData.width * imageData.height * 4
  );
}

function sliceFrame(
  source: ImageData,
  sourceX: number,
  sourceY: number,
  frameWidth: number,
  frameHeight: number,
): ImageData {
  const data = new Uint8ClampedArray(frameWidth * frameHeight * 4);
  const rowLength = frameWidth * 4;

  for (let row = 0; row < frameHeight; row += 1) {
    const sourceOffset = ((sourceY + row) * source.width + sourceX) * 4;
    data.set(source.data.subarray(sourceOffset, sourceOffset + rowLength), row * rowLength);
  }

  return {
    colorSpace: source.colorSpace,
    data,
    height: frameHeight,
    width: frameWidth,
  };
}

export function createSpritesheetGridProject(
  spritesheet: ImageData,
  options: SpritesheetGridImportOptions,
): SpriteProject {
  if (!isValidImageData(spritesheet)) {
    throw new Error("Spritesheet contains invalid RGBA image data.");
  }

  assertPositiveInteger(options.frameWidth, "Frame width");
  assertPositiveInteger(options.frameHeight, "Frame height");
  assertPositiveInteger(options.rows, "Rows");
  assertPositiveInteger(options.columns, "Columns");

  if (
    options.frameOrder !== "row-major" &&
    options.frameOrder !== "column-major"
  ) {
    throw new Error('Frame order must be "row-major" or "column-major".');
  }

  const durationMs = options.frameDurationMs ?? DEFAULT_FRAME_DURATION_MS;
  assertPositiveInteger(durationMs, "Frame duration in milliseconds");

  const gridWidth = options.frameWidth * options.columns;
  const gridHeight = options.frameHeight * options.rows;

  if (gridWidth !== spritesheet.width || gridHeight !== spritesheet.height) {
    throw new Error(
      `Grid dimensions ${gridWidth}x${gridHeight} do not fit spritesheet dimensions ` +
        `${spritesheet.width}x${spritesheet.height}.`,
    );
  }

  const frameCount = options.rows * options.columns;
  const frames = Array.from({ length: frameCount }, (_, index) => ({
    index,
    durationMs,
  }));
  const cels = frames.map(({ index: frameIndex }) => {
    const row =
      options.frameOrder === "row-major"
        ? Math.floor(frameIndex / options.columns)
        : frameIndex % options.rows;
    const column =
      options.frameOrder === "row-major"
        ? frameIndex % options.columns
        : Math.floor(frameIndex / options.rows);

    return {
      frameIndex,
      x: 0,
      y: 0,
      imageData: sliceFrame(
        spritesheet,
        column * options.frameWidth,
        row * options.frameHeight,
        options.frameWidth,
        options.frameHeight,
      ),
    };
  });

  return {
    width: options.frameWidth,
    height: options.frameHeight,
    colorMode: "rgba",
    frames,
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

export async function importSpritesheetGrid(
  file: File,
  options: SpritesheetGridImportOptions,
  dependencies: SpritesheetGridImportDependencies = {},
): Promise<SpriteProject> {
  await assertPngFile(file);

  const decodePng = dependencies.decodePng ?? decodePngInBrowser;
  let spritesheet: ImageData;

  try {
    spritesheet = await decodePng(file);
  } catch (error) {
    throw new Error(`Could not decode spritesheet PNG (${file.name}).`, {
      cause: error,
    });
  }

  return createSpritesheetGridProject(spritesheet, options);
}
