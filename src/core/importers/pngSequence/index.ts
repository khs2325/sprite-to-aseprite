import type { SpriteProject } from "../../SpriteProject";

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export const DEFAULT_FRAME_DURATION_MS = 100;

export type PngSequenceImportOptions = {
  frameDurationMs?: number;
};

export type PngSequenceImportDependencies = {
  decodePng?: (file: File) => Promise<ImageData>;
};

function getFrameDuration(options: PngSequenceImportOptions): number {
  const duration = options.frameDurationMs ?? DEFAULT_FRAME_DURATION_MS;

  if (!Number.isInteger(duration) || duration <= 0) {
    throw new Error("Frame duration must be a positive integer in milliseconds.");
  }

  return duration;
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

export function createPngSequenceProject(
  images: readonly ImageData[],
  options: PngSequenceImportOptions = {},
): SpriteProject {
  if (images.length === 0) {
    throw new Error("PNG sequence must contain at least one frame.");
  }

  const frameDurationMs = getFrameDuration(options);
  const [firstImage] = images;

  images.forEach((imageData, index) => {
    if (!isValidImageData(imageData)) {
      throw new Error(`Frame ${index + 1} contains invalid RGBA image data.`);
    }

    if (
      imageData.width !== firstImage.width ||
      imageData.height !== firstImage.height
    ) {
      throw new Error(
        `Frame ${index + 1} dimensions ${imageData.width}x${imageData.height} ` +
          `do not match the first frame dimensions ${firstImage.width}x${firstImage.height}.`,
      );
    }
  });

  return {
    width: firstImage.width,
    height: firstImage.height,
    colorMode: "rgba",
    frames: images.map((_, index) => ({
      index,
      durationMs: frameDurationMs,
    })),
    layers: [
      {
        id: "main",
        name: "Main",
        visible: true,
        opacity: 255,
        cels: images.map((imageData, frameIndex) => ({
          frameIndex,
          x: 0,
          y: 0,
          imageData,
        })),
      },
    ],
  };
}

async function assertPngFile(file: File, index: number): Promise<void> {
  const signature = new Uint8Array(
    await file.slice(0, PNG_SIGNATURE.length).arrayBuffer(),
  );
  const hasPngSignature =
    signature.length === PNG_SIGNATURE.length &&
    signature.every((byte, byteIndex) => byte === PNG_SIGNATURE[byteIndex]);

  if (!hasPngSignature) {
    throw new Error(`Frame ${index + 1} (${file.name}) is not a PNG file.`);
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

export async function importPngSequence(
  files: readonly File[],
  options: PngSequenceImportOptions = {},
  dependencies: PngSequenceImportDependencies = {},
): Promise<SpriteProject> {
  if (files.length === 0) {
    throw new Error("PNG sequence must contain at least one file.");
  }

  const decodePng = dependencies.decodePng ?? decodePngInBrowser;
  const images: ImageData[] = [];

  for (const [index, file] of files.entries()) {
    await assertPngFile(file, index);

    try {
      images.push(await decodePng(file));
    } catch (error) {
      throw new Error(`Could not decode PNG frame ${index + 1} (${file.name}).`, {
        cause: error,
      });
    }
  }

  return createPngSequenceProject(images, options);
}
