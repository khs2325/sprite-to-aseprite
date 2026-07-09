import {
  normalizeFrameDurationMs,
  type SpriteCel,
  type SpriteProject,
} from "../../SpriteProject";

const PIXIL_FORMAT = "pixilart.com/pixil-project";
const SUPPORTED_SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 96 * 1024 * 1024;
const MAX_DIMENSION = 1024;
const MAX_FRAMES = 512;
const MAX_LAYERS = 64;
const MAX_CELS = 4096;
const MAX_TOTAL_CEL_BYTES = 64 * 1024 * 1024;
const MAX_STRING_LENGTH = 1024;

const ROOT_FIELDS = new Set(["pixil"]);
const PROJECT_FIELDS = new Set([
  "format",
  "schemaVersion",
  "width",
  "height",
  "frameCount",
  "layerCount",
  "frames",
  "layers",
]);
const FRAME_FIELDS = new Set(["index", "durationMs"]);
const LAYER_FIELDS = new Set([
  "index",
  "name",
  "visible",
  "opacity",
  "blendMode",
  "cels",
]);
const CEL_FIELDS = new Set([
  "frameIndex",
  "x",
  "y",
  "width",
  "height",
  "rgbaBase64",
]);

export type PixilImportErrorCode =
  | "allocation-limit"
  | "file-read"
  | "file-too-large"
  | "invalid-container"
  | "invalid-json"
  | "invalid-pixels"
  | "invalid-project"
  | "unsupported-feature"
  | "unsupported-version";

export class PixilImportError extends Error {
  constructor(
    readonly code: PixilImportErrorCode,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "PixilImportError";
  }
}

/** Returns importer-authored detail only; arbitrary thrown values stay private. */
export function getPixilImportDiagnostic(error: unknown): string | null {
  return error instanceof PixilImportError ? error.message : null;
}

type ParsedFrame = {
  durationMs: number;
};

type ParsedCel = {
  frameIndex: number;
  pixels: Uint8Array;
};

type ParsedLayer = {
  name: string;
  opacity: number;
  visible: boolean;
  cels: ParsedCel[];
};

type ParsedPixil = {
  frames: ParsedFrame[];
  height: number;
  layers: ParsedLayer[];
  width: number;
};

function fail(code: PixilImportErrorCode, message: string): never {
  throw new PixilImportError(code, message);
}

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
  const unsupported = Object.keys(value).find((field) => !allowedFields.has(field));
  if (unsupported !== undefined) {
    fail(
      "unsupported-feature",
      `${path} contains unsupported field ${JSON.stringify(unsupported)}.`,
    );
  }
}

function assertRequiredField(
  value: Record<string, unknown>,
  field: string,
  path: string,
): void {
  if (!hasOwn(value, field)) {
    fail("invalid-project", `${path}.${field} is required.`);
  }
}

function parseDimension(value: unknown, path: string): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > MAX_DIMENSION
  ) {
    fail(
      "allocation-limit",
      `${path} must be an integer from 1 through ${MAX_DIMENSION}.`,
    );
  }
  return value as number;
}

function parseStrictCount(
  value: unknown,
  expected: number,
  path: string,
): void {
  if (!Number.isSafeInteger(value) || value !== expected) {
    fail("invalid-project", `${path} must equal ${expected}.`);
  }
}

function expectSafeString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length > MAX_STRING_LENGTH) {
    fail(
      "invalid-project",
      `${path} must be a string no longer than ${MAX_STRING_LENGTH} characters.`,
    );
  }
  return value;
}

function parseFrame(value: unknown, frameIndex: number): ParsedFrame {
  const path = `Pixil frame ${frameIndex + 1}`;
  if (!isRecord(value)) {
    fail("invalid-project", `${path} must be an object.`);
  }
  assertAllowedFields(value, FRAME_FIELDS, path);
  assertRequiredField(value, "index", path);
  assertRequiredField(value, "durationMs", path);

  if (value.index !== frameIndex) {
    fail(
      "invalid-project",
      `${path}.index must be ${frameIndex} to keep frame order explicit.`,
    );
  }
  if (
    typeof value.durationMs !== "number" ||
    !Number.isFinite(value.durationMs) ||
    value.durationMs <= 0
  ) {
    fail(
      "invalid-project",
      `${path}.durationMs must be a finite number greater than zero.`,
    );
  }

  return {
    durationMs: normalizeFrameDurationMs(value.durationMs),
  };
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
  if (/^https?:\/\//iu.test(payload)) {
    fail("unsupported-feature", `${path} must not reference an external image URL.`);
  }
  if (payload.length === 0 || payload.length % 4 !== 0) {
    fail("invalid-pixels", `${path} must contain strict base64 RGBA data.`);
  }

  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const dataLength = payload.length - padding;

  for (let index = 0; index < dataLength; index += 1) {
    if (base64Value(payload[index]) === -1) {
      fail("invalid-pixels", `${path} must contain strict base64 RGBA data.`);
    }
  }
  for (let index = dataLength; index < payload.length; index += 1) {
    if (payload[index] !== "=") {
      fail("invalid-pixels", `${path} must contain strict base64 RGBA data.`);
    }
  }

  if (
    (padding === 2 && (base64Value(payload[payload.length - 3]) & 0x0f) !== 0) ||
    (padding === 1 && (base64Value(payload[payload.length - 2]) & 0x03) !== 0)
  ) {
    fail("invalid-pixels", `${path} must contain strict base64 RGBA data.`);
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

function parseCel(
  value: unknown,
  layerIndex: number,
  celIndex: number,
  width: number,
  height: number,
  coveredFrames: Set<number>,
): ParsedCel {
  const path = `Pixil layer ${layerIndex + 1} cel ${celIndex + 1}`;
  if (!isRecord(value)) {
    fail("invalid-project", `${path} must be an object.`);
  }
  assertAllowedFields(value, CEL_FIELDS, path);
  for (const field of CEL_FIELDS) {
    assertRequiredField(value, field, path);
  }

  if (!Number.isSafeInteger(value.frameIndex) || (value.frameIndex as number) < 0) {
    fail("invalid-project", `${path}.frameIndex must be a non-negative safe integer.`);
  }
  const frameIndex = value.frameIndex as number;
  if (coveredFrames.has(frameIndex)) {
    fail("invalid-project", `${path}.frameIndex duplicates another cel in the same layer.`);
  }
  coveredFrames.add(frameIndex);

  if (value.x !== 0 || value.y !== 0) {
    fail(
      "unsupported-feature",
      `${path} uses unsupported partial-canvas cel placement; x and y must be 0.`,
    );
  }
  if (value.width !== width || value.height !== height) {
    fail(
      "unsupported-feature",
      `${path} must be a full-canvas cel with dimensions ${width}x${height}.`,
    );
  }

  const expectedByteLength = width * height * 4;
  const rawPayloadPath = `${path}.rgbaBase64`;
  if (typeof value.rgbaBase64 !== "string") {
    fail("invalid-pixels", `${rawPayloadPath} must contain strict base64 RGBA data.`);
  }
  if (/^https?:\/\//iu.test(value.rgbaBase64)) {
    fail(
      "unsupported-feature",
      `${rawPayloadPath} must not reference an external image URL.`,
    );
  }
  if (value.rgbaBase64.length !== Math.ceil(expectedByteLength / 3) * 4) {
    fail(
      "invalid-pixels",
      `${rawPayloadPath} must decode to exactly ${expectedByteLength} RGBA bytes.`,
    );
  }

  const pixels = decodeStrictBase64(value.rgbaBase64, rawPayloadPath);
  if (pixels.length !== expectedByteLength) {
    fail(
      "invalid-pixels",
      `${rawPayloadPath} must decode to exactly ${expectedByteLength} RGBA bytes.`,
    );
  }

  return { frameIndex, pixels };
}

function parseLayer(
  value: unknown,
  layerIndex: number,
  frameCount: number,
  width: number,
  height: number,
): ParsedLayer {
  const path = `Pixil layer ${layerIndex + 1}`;
  if (!isRecord(value)) {
    fail("invalid-project", `${path} must be an object.`);
  }
  assertAllowedFields(value, LAYER_FIELDS, path);
  for (const field of LAYER_FIELDS) {
    assertRequiredField(value, field, path);
  }

  if (value.index !== layerIndex) {
    fail(
      "invalid-project",
      `${path}.index must be ${layerIndex} to keep layer order explicit.`,
    );
  }
  const name = expectSafeString(value.name, `${path}.name`);
  if (name.trim().length === 0) {
    fail("invalid-project", `${path}.name must be a non-empty string.`);
  }
  if (typeof value.visible !== "boolean") {
    fail("invalid-project", `${path}.visible must be a boolean.`);
  }
  if (
    typeof value.opacity !== "number" ||
    !Number.isFinite(value.opacity) ||
    value.opacity < 0 ||
    value.opacity > 1
  ) {
    fail("invalid-project", `${path}.opacity must be a finite number from 0 to 1.`);
  }
  if (value.blendMode !== "normal") {
    fail(
      "unsupported-feature",
      `${path} uses unsupported blend mode ${JSON.stringify(value.blendMode)}.`,
    );
  }
  if (!Array.isArray(value.cels) || value.cels.length !== frameCount) {
    fail(
      "invalid-project",
      `${path}.cels must contain exactly one full-canvas cel per frame.`,
    );
  }

  const coveredFrames = new Set<number>();
  const parsedCels = value.cels.map((cel, celIndex) =>
    parseCel(cel, layerIndex, celIndex, width, height, coveredFrames),
  );
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    if (!coveredFrames.has(frameIndex)) {
      fail("invalid-project", `${path}.cels is missing frame ${frameIndex}.`);
    }
  }

  return {
    name,
    opacity: Math.round(value.opacity * 255),
    visible: value.visible,
    cels: parsedCels.sort((left, right) => left.frameIndex - right.frameIndex),
  };
}

function assertAllocationLimits(
  width: number,
  height: number,
  frameCount: number,
  layerCount: number,
): void {
  if (frameCount < 1 || frameCount > MAX_FRAMES) {
    fail("allocation-limit", `Pixil frame count must be from 1 through ${MAX_FRAMES}.`);
  }
  if (layerCount < 1 || layerCount > MAX_LAYERS) {
    fail("allocation-limit", `Pixil layer count must be from 1 through ${MAX_LAYERS}.`);
  }
  const celCount = frameCount * layerCount;
  if (!Number.isSafeInteger(celCount) || celCount > MAX_CELS) {
    fail("allocation-limit", `Pixil cel count must not exceed ${MAX_CELS}.`);
  }

  const rawCelBytes = width * height * 4;
  const totalCelBytes = rawCelBytes * celCount;
  if (
    !Number.isSafeInteger(rawCelBytes) ||
    !Number.isSafeInteger(totalCelBytes) ||
    totalCelBytes > MAX_TOTAL_CEL_BYTES
  ) {
    fail(
      "allocation-limit",
      `Pixil raw cel data exceeds the ${MAX_TOTAL_CEL_BYTES}-byte import limit.`,
    );
  }
}

function parsePixilDocument(json: string): ParsedPixil {
  if (json.length > MAX_FILE_BYTES) {
    fail("file-too-large", `Pixil file exceeds the ${MAX_FILE_BYTES}-byte import limit.`);
  }

  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    fail("invalid-json", "Pixil file is not valid JSON.");
  }
  if (!isRecord(value)) {
    fail("invalid-container", "Pixil document must be an object.");
  }
  assertAllowedFields(value, ROOT_FIELDS, "Pixil document");
  assertRequiredField(value, "pixil", "Pixil document");
  if (!isRecord(value.pixil)) {
    fail("invalid-container", "Pixil document.pixil must be an object.");
  }

  const pixil = value.pixil;
  assertAllowedFields(pixil, PROJECT_FIELDS, "Pixil project");
  for (const field of PROJECT_FIELDS) {
    assertRequiredField(pixil, field, "Pixil project");
  }
  if (pixil.format !== PIXIL_FORMAT) {
    fail(
      "invalid-container",
      `Pixil project.format must be ${JSON.stringify(PIXIL_FORMAT)}.`,
    );
  }
  if (pixil.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    fail(
      "unsupported-version",
      `Unsupported Pixil schemaVersion; expected integer ${SUPPORTED_SCHEMA_VERSION}.`,
    );
  }

  const width = parseDimension(pixil.width, "Pixil project.width");
  const height = parseDimension(pixil.height, "Pixil project.height");
  if (!Array.isArray(pixil.frames) || pixil.frames.length === 0) {
    fail("invalid-project", "Pixil project.frames must be a non-empty array.");
  }
  if (!Array.isArray(pixil.layers) || pixil.layers.length === 0) {
    fail("invalid-project", "Pixil project.layers must be a non-empty array.");
  }
  parseStrictCount(pixil.frameCount, pixil.frames.length, "Pixil project.frameCount");
  parseStrictCount(pixil.layerCount, pixil.layers.length, "Pixil project.layerCount");
  assertAllocationLimits(width, height, pixil.frames.length, pixil.layers.length);

  const frames = pixil.frames.map((frame, frameIndex) =>
    parseFrame(frame, frameIndex),
  );
  const layers = pixil.layers.map((layer, layerIndex) =>
    parseLayer(layer, layerIndex, frames.length, width, height),
  );

  return { frames, height, layers, width };
}

function rawCelToImageData(
  bytes: Uint8Array,
  width: number,
  height: number,
): ImageData {
  return {
    colorSpace: "srgb",
    data: new Uint8ClampedArray(bytes),
    height,
    width,
  };
}

function createProject(parsed: ParsedPixil): SpriteProject {
  return {
    colorMode: "rgba",
    frames: parsed.frames.map((frame, index) => ({
      index,
      durationMs: frame.durationMs,
    })),
    height: parsed.height,
    layers: parsed.layers.map((layer, layerIndex) => ({
      id: `pixil-layer-${layerIndex}`,
      name: layer.name,
      opacity: layer.opacity,
      visible: layer.visible,
      cels: layer.cels.map<SpriteCel>((cel) => ({
        frameIndex: cel.frameIndex,
        imageData: rawCelToImageData(cel.pixels, parsed.width, parsed.height),
        x: 0,
        y: 0,
      })),
    })),
    width: parsed.width,
  };
}

/** Parses the fixture-gated Pixil/Pixilart JSON subset locally. */
export function importPixilJson(json: string): SpriteProject {
  return createProject(parsePixilDocument(json));
}

/** Reads a browser-selected .pixil file without uploading or remotely fetching it. */
export async function importPixil(file: File): Promise<SpriteProject> {
  if (file.size > MAX_FILE_BYTES) {
    fail("file-too-large", `Pixil file exceeds the ${MAX_FILE_BYTES}-byte import limit.`);
  }

  let json: string;
  try {
    json = await file.text();
  } catch (error) {
    throw new PixilImportError(
      "file-read",
      "Could not read the selected Pixil file.",
      { cause: error },
    );
  }

  return importPixilJson(json);
}
