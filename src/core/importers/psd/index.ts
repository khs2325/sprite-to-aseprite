const DEFAULT_FRAME_DURATION_MS = 100;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_DIMENSION = 2048;
const MAX_LAYERS = 64;
const MAX_LAYER_PIXELS = 16_777_216;
const MAX_TOTAL_LAYER_PIXELS = 16_777_216;
const MAX_LAYER_NAME_LENGTH = 1024;
const PSD_HEADER_BYTES = 26;
const PSD_SIGNATURE = "8BPS";
const PSD_VERSION = 1;
const PSD_COLOR_MODE_RGB = 3;
const PSD_BITS_PER_CHANNEL = 8;
const AG_PSD_PACKAGE_NAME = "ag-psd";

const READ_OPTIONS = {
  skipCompositeImageData: true,
  skipLinkedFilesData: true,
  skipThumbnail: true,
  throwForMissingFeatures: true,
  useImageData: true,
} as const;

export type PsdParserAdapterErrorCode =
  | "allocation-limit"
  | "file-read"
  | "invalid-container"
  | "invalid-parser-output"
  | "parser-error"
  | "parser-unavailable"
  | "unsupported-feature";

export class PsdParserAdapterError extends Error {
  constructor(
    readonly code: PsdParserAdapterErrorCode,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "PsdParserAdapterError";
  }
}

/** Returns adapter-authored detail only; arbitrary parser errors stay private. */
export function getPsdParserDiagnostic(error: unknown): string | null {
  return error instanceof PsdParserAdapterError ? error.message : null;
}

export type PsdReadOptions = typeof READ_OPTIONS;

export type PsdParserModule = {
  readPsd: (
    bytes: Uint8Array,
    options: PsdReadOptions,
  ) => unknown | Promise<unknown>;
};

export type PsdParserAdapterDependencies = {
  loadParser?: () => Promise<PsdParserModule>;
  parser?: PsdParserModule;
};

export type PsdParserDocument = {
  bitsPerChannel: number;
  channels: number;
  colorMode: number;
  frames: [{ index: 0; durationMs: typeof DEFAULT_FRAME_DURATION_MS }];
  height: number;
  layers: PsdParserLayer[];
  width: number;
};

export type PsdParserLayer = {
  blendMode: string;
  bottom: number;
  children: PsdParserLayer[];
  clipping: boolean;
  hasEffects: boolean;
  hasImageData: boolean;
  hasMask: boolean;
  hasSmartObject: boolean;
  hasText: boolean;
  hasVectorMask: boolean;
  imageData?: ImageData;
  left: number;
  name: string;
  opacity: number;
  right: number;
  top: number;
  visible: boolean;
};

type PsdHeader = {
  bitsPerChannel: number;
  channels: number;
  colorMode: number;
  height: number;
  version: number;
  width: number;
};

type PsdMetadata = PsdHeader & {
  layerCount: number;
};

type RawPsdDocument = {
  bitsPerChannel?: unknown;
  channels?: unknown;
  children?: unknown;
  colorMode?: unknown;
  height?: unknown;
  width?: unknown;
};

type RawPsdLayer = {
  blendMode?: unknown;
  bottom?: unknown;
  canvas?: unknown;
  children?: unknown;
  clipping?: unknown;
  effects?: unknown;
  hidden?: unknown;
  imageData?: unknown;
  left?: unknown;
  mask?: unknown;
  name?: unknown;
  opacity?: unknown;
  placedLayer?: unknown;
  right?: unknown;
  sectionDivider?: unknown;
  smartObject?: unknown;
  text?: unknown;
  top?: unknown;
  vectorMask?: unknown;
};

function fail(code: PsdParserAdapterErrorCode, message: string): never {
  throw new PsdParserAdapterError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 0x100 + bytes[offset + 1];
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function readInt16BE(bytes: Uint8Array, offset: number): number {
  const value = readUint16BE(bytes, offset);
  return value > 0x7fff ? value - 0x10000 : value;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function validateRange(
  bytes: Uint8Array,
  offset: number,
  length: number,
  label: string,
): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > bytes.byteLength
  ) {
    fail("invalid-container", `${label} is truncated.`);
  }
}

function readUint32BEAt(bytes: Uint8Array, offset: number, label: string): number {
  validateRange(bytes, offset, 4, label);
  return readUint32BE(bytes, offset);
}

function readInt16BEAt(bytes: Uint8Array, offset: number, label: string): number {
  validateRange(bytes, offset, 2, label);
  return readInt16BE(bytes, offset);
}

function readLengthPrefixedSection(
  bytes: Uint8Array,
  offset: number,
  label: string,
): { length: number; nextOffset: number; start: number } {
  const length = readUint32BEAt(bytes, offset, `${label} length`);
  const start = offset + 4;
  validateRange(bytes, start, length, label);
  return { length, nextOffset: start + length, start };
}

function validateLayerCount(layerCount: number): void {
  if (layerCount < 1 || layerCount > MAX_LAYERS) {
    fail(
      "allocation-limit",
      `PSD layer count must be from 1 through ${MAX_LAYERS}.`,
    );
  }
}

function validateDecodedLayerAllocation(
  width: number,
  height: number,
  layerCount: number,
): void {
  const pixels = width * height * layerCount;
  if (!Number.isSafeInteger(pixels) || pixels > MAX_TOTAL_LAYER_PIXELS) {
    fail(
      "allocation-limit",
      `PSD decoded layer allocation exceeds the ${MAX_TOTAL_LAYER_PIXELS}-pixel adapter limit.`,
    );
  }
}

function validatePsdHeader(bytes: Uint8Array): PsdHeader {
  if (bytes.byteLength < PSD_HEADER_BYTES) {
    fail("invalid-container", "PSD header is truncated.");
  }
  if (readAscii(bytes, 0, 4) !== PSD_SIGNATURE) {
    fail("invalid-container", `PSD signature must be ${PSD_SIGNATURE}.`);
  }

  const version = readUint16BE(bytes, 4);
  if (version !== PSD_VERSION) {
    fail("unsupported-feature", "PSB/Large Document Format is unsupported.");
  }

  const channels = readUint16BE(bytes, 12);
  const height = readUint32BE(bytes, 14);
  const width = readUint32BE(bytes, 18);
  const bitsPerChannel = readUint16BE(bytes, 22);
  const colorMode = readUint16BE(bytes, 24);

  if (!Number.isSafeInteger(channels) || channels < 1 || channels > 56) {
    fail("invalid-container", "PSD channel count is outside the supported header range.");
  }
  if (width < 1 || width > MAX_DIMENSION || height < 1 || height > MAX_DIMENSION) {
    fail(
      "allocation-limit",
      `PSD dimensions must be from 1x1 through ${MAX_DIMENSION}x${MAX_DIMENSION}.`,
    );
  }
  if (bitsPerChannel !== PSD_BITS_PER_CHANNEL) {
    fail("unsupported-feature", "PSD channel depth must be 8 bits per channel.");
  }
  if (colorMode !== PSD_COLOR_MODE_RGB) {
    fail("unsupported-feature", "PSD color mode must be RGB for this importer subset.");
  }

  return { bitsPerChannel, channels, colorMode, height, version, width };
}

function readLayerCountFromLayerMaskSection(
  bytes: Uint8Array,
  sectionStart: number,
  sectionLength: number,
): number {
  if (sectionLength === 0) return 0;
  if (sectionLength < 4) {
    fail("invalid-container", "PSD layer and mask information section is truncated.");
  }

  const sectionEnd = sectionStart + sectionLength;
  const layerInfoLength = readUint32BEAt(
    bytes,
    sectionStart,
    "PSD layer info section length",
  );
  const layerInfoStart = sectionStart + 4;
  validateRange(bytes, layerInfoStart, layerInfoLength, "PSD layer info section");
  if (layerInfoStart + layerInfoLength > sectionEnd) {
    fail("invalid-container", "PSD layer info section exceeds its container.");
  }
  if (layerInfoLength === 0) return 0;
  if (layerInfoLength < 2) {
    fail("invalid-container", "PSD layer count is truncated.");
  }

  const rawLayerCount = readInt16BEAt(bytes, layerInfoStart, "PSD layer count");
  return Math.abs(rawLayerCount);
}

function validatePsdMetadata(bytes: Uint8Array): PsdMetadata {
  const header = validatePsdHeader(bytes);
  const colorModeData = readLengthPrefixedSection(
    bytes,
    PSD_HEADER_BYTES,
    "PSD color mode data section",
  );
  const imageResources = readLengthPrefixedSection(
    bytes,
    colorModeData.nextOffset,
    "PSD image resources section",
  );
  const layerMaskInfo = readLengthPrefixedSection(
    bytes,
    imageResources.nextOffset,
    "PSD layer and mask information section",
  );
  const layerCount = readLayerCountFromLayerMaskSection(
    bytes,
    layerMaskInfo.start,
    layerMaskInfo.length,
  );

  validateLayerCount(layerCount);
  validateDecodedLayerAllocation(header.width, header.height, layerCount);

  return { ...header, layerCount };
}

function expectInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    fail("invalid-parser-output", `${path} must be a safe integer.`);
  }
  return value;
}

function expectBoolean(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    fail("invalid-parser-output", `${path} must be a boolean.`);
  }
  return value;
}

function expectString(value: unknown, path: string, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length > MAX_LAYER_NAME_LENGTH) {
    fail(
      "invalid-parser-output",
      `${path} must be a string no longer than ${MAX_LAYER_NAME_LENGTH} characters.`,
    );
  }
  return value.trim().length > 0 ? value : fallback;
}

function parseOpacity(value: unknown, path: string): number {
  if (value === undefined) return 255;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail("invalid-parser-output", `${path} must be a finite number.`);
  }
  if (value >= 0 && value <= 1) {
    return Math.round(value * 255);
  }
  if (Number.isInteger(value) && value >= 0 && value <= 255) {
    return value;
  }
  fail("invalid-parser-output", `${path} must be in the range 0..1 or 0..255.`);
}

function isImageData(value: unknown): value is ImageData {
  if (!isRecord(value)) return false;
  const { data, height, width } = value;
  return (
    typeof width === "number" &&
    typeof height === "number" &&
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0 &&
    data instanceof Uint8ClampedArray &&
    data.length === width * height * 4
  );
}

function adaptImageData(value: unknown, path: string): ImageData | undefined {
  if (value === undefined) return undefined;
  if (!isImageData(value)) {
    fail("invalid-parser-output", `${path} must contain RGBA ImageData.`);
  }

  const pixels = value.width * value.height;
  if (pixels > MAX_LAYER_PIXELS) {
    fail(
      "allocation-limit",
      `PSD decoded layer pixels exceed the ${MAX_LAYER_PIXELS}-pixel adapter limit.`,
    );
  }
  return value;
}

function hasOwnValue(layer: RawPsdLayer, key: keyof RawPsdLayer): boolean {
  return layer[key] !== undefined && layer[key] !== null;
}

function adaptLayer(value: unknown, layerIndex: number, path: string): PsdParserLayer {
  if (!isRecord(value)) {
    fail("invalid-parser-output", `${path} must be an object.`);
  }
  const layer = value as RawPsdLayer;
  const fallbackName = `Layer ${layerIndex + 1}`;
  const top = expectInteger(layer.top, `${path}.top`);
  const left = expectInteger(layer.left, `${path}.left`);
  const bottom = expectInteger(layer.bottom, `${path}.bottom`);
  const right = expectInteger(layer.right, `${path}.right`);
  if (bottom < top || right < left) {
    fail("invalid-parser-output", `${path} bounds are inconsistent.`);
  }

  const imageData = adaptImageData(layer.imageData, `${path}.imageData`);
  const children = Array.isArray(layer.children)
    ? layer.children.map((child, index) =>
      adaptLayer(child, index, `${path}.children[${index}]`),
    )
    : [];
  if (layer.children !== undefined && !Array.isArray(layer.children)) {
    fail("invalid-parser-output", `${path}.children must be an array when present.`);
  }

  return {
    blendMode: expectString(layer.blendMode, `${path}.blendMode`, "normal"),
    bottom,
    children,
    clipping: expectBoolean(layer.clipping, `${path}.clipping`, false),
    hasEffects: hasOwnValue(layer, "effects"),
    hasImageData: imageData !== undefined,
    hasMask: hasOwnValue(layer, "mask"),
    hasSmartObject: hasOwnValue(layer, "smartObject") || hasOwnValue(layer, "placedLayer"),
    hasText: hasOwnValue(layer, "text"),
    hasVectorMask: hasOwnValue(layer, "vectorMask"),
    imageData,
    left,
    name: expectString(layer.name, `${path}.name`, fallbackName),
    opacity: parseOpacity(layer.opacity, `${path}.opacity`),
    right,
    top,
    visible: !expectBoolean(layer.hidden, `${path}.hidden`, false),
  };
}

function countParserLayers(layers: unknown[], path: string): number {
  let count = 0;
  for (let index = 0; index < layers.length; index += 1) {
    count += 1;
    validateLayerCount(count);

    const layer = layers[index];
    if (!isRecord(layer)) continue;
    if (layer.children === undefined) continue;
    if (!Array.isArray(layer.children)) {
      fail(
        "invalid-parser-output",
        `${path}[${index}].children must be an array when present.`,
      );
    }

    count += countParserLayers(layer.children, `${path}[${index}].children`);
    validateLayerCount(count);
  }
  return count;
}

function adaptPsdDocument(value: unknown, metadata: PsdMetadata): PsdParserDocument {
  if (!isRecord(value)) {
    fail("invalid-parser-output", "PSD parser returned an invalid document.");
  }
  const parsed = value as RawPsdDocument;
  const width = expectInteger(parsed.width, "PSD document width");
  const height = expectInteger(parsed.height, "PSD document height");
  const channels = expectInteger(parsed.channels, "PSD document channels");
  const bitsPerChannel = expectInteger(
    parsed.bitsPerChannel,
    "PSD document bitsPerChannel",
  );
  const colorMode = expectInteger(parsed.colorMode, "PSD document colorMode");

  if (width !== metadata.width || height !== metadata.height) {
    fail("invalid-parser-output", "PSD parser dimensions do not match the file header.");
  }
  if (channels !== metadata.channels || bitsPerChannel !== metadata.bitsPerChannel) {
    fail("invalid-parser-output", "PSD parser channel metadata does not match the file header.");
  }
  if (colorMode !== metadata.colorMode) {
    fail("invalid-parser-output", "PSD parser color mode does not match the file header.");
  }
  if (!Array.isArray(parsed.children)) {
    fail("invalid-parser-output", "PSD parser output must contain a root layer array.");
  }
  const layerCount = countParserLayers(parsed.children, "PSD parser layers");
  validateLayerCount(layerCount);
  if (layerCount !== metadata.layerCount) {
    fail("invalid-parser-output", "PSD parser layer count does not match the file metadata.");
  }
  validateDecodedLayerAllocation(width, height, layerCount);

  return {
    bitsPerChannel,
    channels,
    colorMode,
    frames: [{ index: 0, durationMs: DEFAULT_FRAME_DURATION_MS }],
    height,
    layers: parsed.children.map((layer, index) =>
      adaptLayer(layer, index, `PSD layer ${index + 1}`),
    ),
    width,
  };
}

async function loadAgPsdParser(): Promise<PsdParserModule> {
  let module: unknown;
  try {
    module = await import(/* @vite-ignore */ AG_PSD_PACKAGE_NAME);
  } catch (error) {
    throw new PsdParserAdapterError(
      "parser-unavailable",
      "The PSD parser dependency is not available.",
      { cause: error },
    );
  }

  if (!isRecord(module) || typeof module.readPsd !== "function") {
    fail("parser-unavailable", "The PSD parser dependency has an unsupported API.");
  }
  return {
    readPsd: module.readPsd as PsdParserModule["readPsd"],
  };
}

async function getParser(
  dependencies: PsdParserAdapterDependencies,
): Promise<PsdParserModule> {
  if (dependencies.parser !== undefined) return dependencies.parser;
  try {
    return await (dependencies.loadParser ?? loadAgPsdParser)();
  } catch (error) {
    if (error instanceof PsdParserAdapterError) throw error;
    throw new PsdParserAdapterError(
      "parser-unavailable",
      "The PSD parser dependency is not available.",
      { cause: error },
    );
  }
}

/** Parses local PSD bytes through the isolated PSD parser adapter. */
export async function parsePsdBytes(
  bytes: Uint8Array,
  dependencies: PsdParserAdapterDependencies = {},
): Promise<PsdParserDocument> {
  if (bytes.byteLength > MAX_FILE_BYTES) {
    fail("allocation-limit", `PSD file exceeds the ${MAX_FILE_BYTES}-byte adapter limit.`);
  }

  const metadata = validatePsdMetadata(bytes);
  const parser = await getParser(dependencies);

  let parsed: unknown;
  try {
    parsed = await parser.readPsd(bytes, READ_OPTIONS);
  } catch (error) {
    if (error instanceof PsdParserAdapterError) throw error;
    throw new PsdParserAdapterError(
      "parser-error",
      "Could not parse the selected PSD file.",
      { cause: error },
    );
  }
  return adaptPsdDocument(parsed, metadata);
}

/** Reads a browser-selected .psd file without uploading or remotely fetching it. */
export async function parsePsdFile(
  file: File,
  dependencies: PsdParserAdapterDependencies = {},
): Promise<PsdParserDocument> {
  if (file.size > MAX_FILE_BYTES) {
    fail("allocation-limit", `PSD file exceeds the ${MAX_FILE_BYTES}-byte adapter limit.`);
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    throw new PsdParserAdapterError(
      "file-read",
      "Could not read the selected PSD file.",
      { cause: error },
    );
  }

  return parsePsdBytes(bytes, dependencies);
}
