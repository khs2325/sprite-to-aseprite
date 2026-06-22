import {
  MAX_FRAME_DURATION_MS,
  MIN_FRAME_DURATION_MS,
  type SpriteCel,
  type SpriteProject,
} from "../../SpriteProject";

const MODEL_VERSION = 2;
const MAX_DIMENSION = 1024;
const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const OUTER_FIELDS = new Set(["modelVersion", "piskel"]);
const PISKEL_FIELDS = new Set([
  "name",
  "description",
  "fps",
  "height",
  "width",
  "layers",
  "hiddenFrames",
]);
const LAYER_FIELDS = new Set([
  "name",
  "opacity",
  "visible",
  "frameCount",
  "chunks",
]);
const CHUNK_FIELDS = new Set(["layout", "base64PNG"]);

export type PiskelImportDependencies = {
  decodePng?: (pngBytes: Uint8Array) => Promise<ImageData>;
};

type ParsedChunk = {
  layout: number[][];
  pngBytes: Uint8Array;
  sheetWidth: number;
  sheetHeight: number;
};

type ParsedLayer = {
  name: string;
  opacity: number;
  visible: boolean;
  frameCount: number;
  chunks: ParsedChunk[];
};

type ParsedPiskel = {
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  layers: ParsedLayer[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function assertAllowedFields(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  path: string,
): void {
  if (Object.keys(value).some((field) => !allowedFields.has(field))) {
    throw new Error(`${path} contains unsupported fields.`);
  }
}

function assertRequiredField(
  value: Record<string, unknown>,
  field: string,
  path: string,
): void {
  if (!hasOwn(value, field)) {
    throw new Error(`${path}.${field} is required.`);
  }
}

function isDimension(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= MAX_DIMENSION
  );
}

function base64Value(character: string): number {
  const code = character.charCodeAt(0);
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  if (character === "+") return 62;
  if (character === "/") return 63;
  return -1;
}

function decodeStrictBase64(payload: string, path: string): Uint8Array {
  if (payload.length === 0 || payload.length % 4 !== 0) {
    throw new Error(`${path} must contain strict base64 PNG data.`);
  }

  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const dataLength = payload.length - padding;

  for (let index = 0; index < dataLength; index += 1) {
    if (base64Value(payload[index]) === -1) {
      throw new Error(`${path} must contain strict base64 PNG data.`);
    }
  }
  for (let index = dataLength; index < payload.length; index += 1) {
    if (payload[index] !== "=") {
      throw new Error(`${path} must contain strict base64 PNG data.`);
    }
  }

  if (
    (padding === 2 && (base64Value(payload[payload.length - 3]) & 0x0f) !== 0) ||
    (padding === 1 && (base64Value(payload[payload.length - 2]) & 0x03) !== 0)
  ) {
    throw new Error(`${path} must contain strict base64 PNG data.`);
  }

  const byteLength = (payload.length / 4) * 3 - padding;
  const bytes = new Uint8Array(byteLength);
  let outputIndex = 0;

  for (let index = 0; index < payload.length; index += 4) {
    const first = base64Value(payload[index]);
    const second = base64Value(payload[index + 1]);
    const third = payload[index + 2] === "=" ? 0 : base64Value(payload[index + 2]);
    const fourth = payload[index + 3] === "=" ? 0 : base64Value(payload[index + 3]);

    bytes[outputIndex] = (first << 2) | (second >> 4);
    outputIndex += 1;
    if (outputIndex < byteLength) {
      bytes[outputIndex] = ((second & 0x0f) << 4) | (third >> 2);
      outputIndex += 1;
    }
    if (outputIndex < byteLength) {
      bytes[outputIndex] = ((third & 0x03) << 6) | fourth;
      outputIndex += 1;
    }
  }

  return bytes;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function assertPngStructure(
  bytes: Uint8Array,
  expectedWidth: number,
  expectedHeight: number,
  path: string,
): void {
  const invalidMessage = `${path} does not contain valid PNG bytes.`;
  if (
    bytes.length < 33 ||
    PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)
  ) {
    throw new Error(invalidMessage);
  }

  let offset = PNG_SIGNATURE.length;
  let width: number | undefined;
  let height: number | undefined;
  let sawEnd = false;

  while (offset <= bytes.length - 12) {
    const length = readUint32(bytes, offset);
    const dataOffset = offset + 8;
    if (length > bytes.length - dataOffset - 4) {
      throw new Error(invalidMessage);
    }

    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    if (offset === PNG_SIGNATURE.length) {
      if (type !== "IHDR" || length !== 13) {
        throw new Error(invalidMessage);
      }
      width = readUint32(bytes, dataOffset);
      height = readUint32(bytes, dataOffset + 4);
      if (width === 0 || height === 0) {
        throw new Error(invalidMessage);
      }
    } else if (type === "IHDR") {
      throw new Error(invalidMessage);
    }

    offset = dataOffset + length + 4;
    if (type === "IEND") {
      if (length !== 0 || offset !== bytes.length) {
        throw new Error(invalidMessage);
      }
      sawEnd = true;
      break;
    }
  }

  if (!sawEnd || width === undefined || height === undefined) {
    throw new Error(invalidMessage);
  }
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(
      `${path} PNG dimensions must be ${expectedWidth}x${expectedHeight}.`,
    );
  }
}

function parsePngDataUrl(
  value: unknown,
  expectedWidth: number,
  expectedHeight: number,
  path: string,
): Uint8Array {
  if (typeof value !== "string" || !value.startsWith(PNG_DATA_URL_PREFIX)) {
    throw new Error(`${path} must be an embedded PNG data URL.`);
  }

  const bytes = decodeStrictBase64(
    value.slice(PNG_DATA_URL_PREFIX.length),
    path,
  );
  assertPngStructure(bytes, expectedWidth, expectedHeight, path);
  return bytes;
}

function parseChunk(
  value: unknown,
  layerIndex: number,
  chunkIndex: number,
  width: number,
  height: number,
  frameCount: number,
  coveredFrames: Set<number>,
): ParsedChunk {
  const path = `Piskel layer ${layerIndex + 1}, chunk ${chunkIndex + 1}`;
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object.`);
  }
  assertAllowedFields(value, CHUNK_FIELDS, path);
  assertRequiredField(value, "layout", path);
  assertRequiredField(value, "base64PNG", path);

  if (!Array.isArray(value.layout) || value.layout.length === 0) {
    throw new Error(`${path}.layout must be a non-empty column array.`);
  }

  const layout: number[][] = [];
  let rowCount: number | undefined;
  for (const [columnIndex, column] of value.layout.entries()) {
    if (!Array.isArray(column) || column.length === 0) {
      throw new Error(`${path}.layout columns must be non-empty arrays.`);
    }
    if (rowCount === undefined) {
      rowCount = column.length;
    } else if (column.length !== rowCount) {
      throw new Error(`${path}.layout must be rectangular.`);
    }

    const parsedColumn: number[] = [];
    for (const [rowIndex, frameIndex] of column.entries()) {
      if (!Number.isSafeInteger(frameIndex)) {
        throw new Error(
          `${path}.layout[${columnIndex}][${rowIndex}] must be an integer frame index.`,
        );
      }
      if ((frameIndex as number) < 0 || (frameIndex as number) >= frameCount) {
        throw new Error(`${path}.layout contains an out-of-range frame index.`);
      }
      if (coveredFrames.has(frameIndex as number)) {
        throw new Error(`${path}.layout contains a duplicate frame index.`);
      }
      coveredFrames.add(frameIndex as number);
      parsedColumn.push(frameIndex as number);
    }
    layout.push(parsedColumn);
  }

  const sheetWidth = width * layout.length;
  const sheetHeight = height * rowCount!;
  if (!Number.isSafeInteger(sheetWidth) || !Number.isSafeInteger(sheetHeight)) {
    throw new Error(`${path}.layout dimensions are too large.`);
  }

  return {
    layout,
    pngBytes: parsePngDataUrl(
      value.base64PNG,
      sheetWidth,
      sheetHeight,
      `${path}.base64PNG`,
    ),
    sheetWidth,
    sheetHeight,
  };
}

function parseLayer(
  encodedLayer: unknown,
  layerIndex: number,
  width: number,
  height: number,
  expectedFrameCount: number | undefined,
): ParsedLayer {
  const path = `Piskel layer ${layerIndex + 1}`;
  if (typeof encodedLayer !== "string") {
    throw new Error(`${path} must be a string-encoded JSON record.`);
  }

  let value: unknown;
  try {
    value = JSON.parse(encodedLayer) as unknown;
  } catch {
    throw new Error(`${path} is not valid JSON.`);
  }
  if (!isRecord(value)) {
    throw new Error(`${path} must decode to an object.`);
  }
  if (hasOwn(value, "base64PNG") && !hasOwn(value, "chunks")) {
    throw new Error(`${path} uses the unsupported legacy PNG layout.`);
  }
  assertAllowedFields(value, LAYER_FIELDS, path);
  for (const field of ["name", "opacity", "frameCount", "chunks"]) {
    assertRequiredField(value, field, path);
  }

  if (typeof value.name !== "string" || value.name.trim().length === 0) {
    throw new Error(`${path}.name must be a non-empty string.`);
  }
  if (
    typeof value.opacity !== "number" ||
    !Number.isFinite(value.opacity) ||
    value.opacity < 0 ||
    value.opacity > 1
  ) {
    throw new Error(`${path}.opacity must be a finite number from 0 to 1.`);
  }
  if (value.visible !== undefined && typeof value.visible !== "boolean") {
    throw new Error(`${path}.visible must be a boolean when present.`);
  }
  if (!Number.isSafeInteger(value.frameCount) || (value.frameCount as number) <= 0) {
    throw new Error(`${path}.frameCount must be a positive integer.`);
  }
  if (
    expectedFrameCount !== undefined &&
    value.frameCount !== expectedFrameCount
  ) {
    throw new Error("All Piskel layers must have the same frameCount.");
  }
  if (!Array.isArray(value.chunks) || value.chunks.length === 0) {
    throw new Error(`${path}.chunks must be a non-empty array.`);
  }

  const frameCount = value.frameCount as number;
  const coveredFrames = new Set<number>();
  const chunks = value.chunks.map((chunk, chunkIndex) =>
    parseChunk(
      chunk,
      layerIndex,
      chunkIndex,
      width,
      height,
      frameCount,
      coveredFrames,
    ),
  );

  if (coveredFrames.size !== frameCount) {
    throw new Error(`${path} frame coverage is incomplete.`);
  }

  return {
    name: value.name,
    opacity: Math.round(value.opacity * 255),
    visible: value.visible ?? true,
    frameCount,
    chunks,
  };
}

function parsePiskelDocument(json: string): ParsedPiskel {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    throw new Error("Piskel file is not valid JSON.");
  }
  if (!isRecord(value)) {
    throw new Error("Piskel document must be an object.");
  }
  assertAllowedFields(value, OUTER_FIELDS, "Piskel document");
  assertRequiredField(value, "modelVersion", "Piskel document");
  assertRequiredField(value, "piskel", "Piskel document");

  if (value.modelVersion !== MODEL_VERSION) {
    throw new Error("Unsupported Piskel modelVersion; expected integer 2.");
  }
  if (!isRecord(value.piskel)) {
    throw new Error("Piskel document.piskel must be an object.");
  }

  const piskel = value.piskel;
  assertAllowedFields(piskel, PISKEL_FIELDS, "Piskel object");
  for (const field of ["name", "fps", "height", "width", "layers"]) {
    assertRequiredField(piskel, field, "Piskel object");
  }

  if (typeof piskel.name !== "string" || piskel.name.trim().length === 0) {
    throw new Error("Piskel object.name must be a non-empty string.");
  }
  if (piskel.description !== undefined && typeof piskel.description !== "string") {
    throw new Error("Piskel object.description must be a string when present.");
  }
  if (
    typeof piskel.fps !== "number" ||
    !Number.isFinite(piskel.fps) ||
    piskel.fps <= 0
  ) {
    throw new Error("Piskel object.fps must be a finite number greater than zero.");
  }
  if (!isDimension(piskel.width)) {
    throw new Error("Piskel object.width must be an integer from 1 to 1024.");
  }
  if (!isDimension(piskel.height)) {
    throw new Error("Piskel object.height must be an integer from 1 to 1024.");
  }
  if (!Array.isArray(piskel.layers) || piskel.layers.length === 0) {
    throw new Error("Piskel object.layers must be a non-empty array.");
  }
  if (
    piskel.hiddenFrames !== undefined &&
    (!Array.isArray(piskel.hiddenFrames) || piskel.hiddenFrames.length !== 0)
  ) {
    throw new Error("Piskel object.hiddenFrames must be absent or empty.");
  }

  const layers: ParsedLayer[] = [];
  let frameCount: number | undefined;
  for (const [layerIndex, encodedLayer] of piskel.layers.entries()) {
    const layer = parseLayer(
      encodedLayer,
      layerIndex,
      piskel.width,
      piskel.height,
      frameCount,
    );
    frameCount ??= layer.frameCount;
    layers.push(layer);
  }

  return {
    width: piskel.width,
    height: piskel.height,
    fps: piskel.fps,
    frameCount: frameCount!,
    layers,
  };
}

function isValidDecodedImage(
  image: unknown,
  expectedWidth: number,
  expectedHeight: number,
): image is ImageData {
  if (!isRecord(image)) return false;
  if (image.width !== expectedWidth || image.height !== expectedHeight) return false;
  const byteLength = expectedWidth * expectedHeight * 4;
  return (
    Number.isSafeInteger(byteLength) &&
    (image.colorSpace === "srgb" || image.colorSpace === "display-p3") &&
    image.data instanceof Uint8ClampedArray &&
    image.data.length === byteLength
  );
}

function sliceCel(
  sheet: ImageData,
  sourceX: number,
  sourceY: number,
  width: number,
  height: number,
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  const rowLength = width * 4;

  for (let row = 0; row < height; row += 1) {
    const sourceOffset = ((sourceY + row) * sheet.width + sourceX) * 4;
    data.set(
      sheet.data.subarray(sourceOffset, sourceOffset + rowLength),
      row * rowLength,
    );
  }

  return {
    colorSpace: sheet.colorSpace,
    data,
    width,
    height,
  };
}

async function decodePngInBrowser(pngBytes: Uint8Array): Promise<ImageData> {
  const ownedBytes = new Uint8Array(pngBytes);
  const bitmap = await createImageBitmap(
    new Blob([ownedBytes.buffer], { type: "image/png" }),
  );

  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) {
      throw new Error("A browser canvas context is required to decode Piskel PNG data.");
    }
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

/**
 * Imports the documented model-version-2 Piskel subset. The global frame
 * duration rule is clamp(Math.round(1000 / fps), 1, 65535).
 */
export async function importPiskelJson(
  json: string,
  dependencies: PiskelImportDependencies = {},
): Promise<SpriteProject> {
  const parsed = parsePiskelDocument(json);
  const decodePng = dependencies.decodePng ?? decodePngInBrowser;
  const durationMs = Math.max(
    MIN_FRAME_DURATION_MS,
    Math.min(MAX_FRAME_DURATION_MS, Math.round(1000 / parsed.fps)),
  );

  const layers: SpriteProject["layers"] = [];
  for (const [layerIndex, layer] of parsed.layers.entries()) {
    const cels = new Array<SpriteCel | undefined>(parsed.frameCount);

    for (const [chunkIndex, chunk] of layer.chunks.entries()) {
      let sheet: ImageData;
      try {
        sheet = await decodePng(chunk.pngBytes);
      } catch {
        throw new Error(
          `Could not decode PNG for Piskel layer ${layerIndex + 1}, chunk ${chunkIndex + 1}.`,
        );
      }
      if (!isValidDecodedImage(sheet, chunk.sheetWidth, chunk.sheetHeight)) {
        throw new Error(
          `Decoded PNG for Piskel layer ${layerIndex + 1}, chunk ${chunkIndex + 1} ` +
            `must contain ${chunk.sheetWidth}x${chunk.sheetHeight} RGBA pixels.`,
        );
      }

      for (const [columnIndex, column] of chunk.layout.entries()) {
        for (const [rowIndex, frameIndex] of column.entries()) {
          cels[frameIndex] = {
            frameIndex,
            x: 0,
            y: 0,
            imageData: sliceCel(
              sheet,
              columnIndex * parsed.width,
              rowIndex * parsed.height,
              parsed.width,
              parsed.height,
            ),
          };
        }
      }
    }

    layers.push({
      id: `piskel-layer-${layerIndex}`,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      cels: cels as SpriteCel[],
    });
  }

  return {
    width: parsed.width,
    height: parsed.height,
    colorMode: "rgba",
    frames: Array.from({ length: parsed.frameCount }, (_, index) => ({
      index,
      durationMs,
    })),
    layers,
  };
}

/** Reads a local .piskel File and performs all conversion in the browser. */
export async function importPiskel(
  file: File,
  dependencies: PiskelImportDependencies = {},
): Promise<SpriteProject> {
  return importPiskelJson(await file.text(), dependencies);
}
