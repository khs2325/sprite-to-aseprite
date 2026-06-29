import type { SpriteProject } from "../../SpriteProject";

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
const PSD_CHANNEL_RED = 0;
const PSD_CHANNEL_GREEN = 1;
const PSD_CHANNEL_BLUE = 2;
const PSD_CHANNEL_ALPHA = -1;
const PSD_COMPRESSION_RAW = 0;
const PSD_COMPRESSION_PACK_BITS = 1;
const AG_PSD_PACKAGE_NAME = "ag-psd";
const SUPPORTED_BLEND_MODE = "normal";
const PSD_NORMAL_BLEND_MODE_KEY = "norm";
const PSD_LAYER_HIDDEN_FLAG = 0x02;
const PSD_LAYER_SIGNATURE = "8BIM";
const PSD_LAYER_SIGNATURE_64 = "8B64";

const ADJUSTMENT_OR_FILL_LAYER_KEYS = [
  "brightnessContrast",
  "levels",
  "curves",
  "exposure",
  "vibrance",
  "hueSaturation",
  "colorBalance",
  "blackAndWhite",
  "photoFilter",
  "channelMixer",
  "colorLookup",
  "invert",
  "posterize",
  "threshold",
  "gradientMap",
  "selectiveColor",
  "solidColor",
  "gradientFill",
  "patternFill",
] as const;

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
  hasAdjustmentOrFill: boolean;
  hasEffects: boolean;
  hasImageData: boolean;
  hasMask: boolean;
  hasSmartObject: boolean;
  hasText: boolean;
  hasVectorMask: boolean;
  imageData?: ImageData;
  isGroup: boolean;
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
  layerMaskInfoLength: number;
  layerMaskInfoStart: number;
};

type NativePsdChannelRecord = {
  id: number;
  length: number;
};

type NativePsdLayerRecord = {
  blendMode: string;
  bottom: number;
  channelRecords: NativePsdChannelRecord[];
  clipping: boolean;
  hasAdjustmentOrFill: boolean;
  hasEffects: boolean;
  hasMask: boolean;
  hasSmartObject: boolean;
  hasText: boolean;
  hasVectorMask: boolean;
  isGroup: boolean;
  left: number;
  name: string;
  opacity: number;
  right: number;
  top: number;
  visible: boolean;
};

type RawPsdDocument = {
  bitsPerChannel?: unknown;
  channels?: unknown;
  children?: unknown;
  colorMode?: unknown;
  height?: unknown;
  width?: unknown;
};

type PsdAdjustmentOrFillLayerKey = typeof ADJUSTMENT_OR_FILL_LAYER_KEYS[number];

type RawPsdLayer = Partial<Record<PsdAdjustmentOrFillLayerKey, unknown>> & {
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

function readInt32BE(bytes: Uint8Array, offset: number): number {
  const value = readUint32BE(bytes, offset);
  return value > 0x7fffffff ? value - 0x100000000 : value;
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

function readUint16BEAt(bytes: Uint8Array, offset: number, label: string): number {
  validateRange(bytes, offset, 2, label);
  return readUint16BE(bytes, offset);
}

function readInt16BEAt(bytes: Uint8Array, offset: number, label: string): number {
  validateRange(bytes, offset, 2, label);
  return readInt16BE(bytes, offset);
}

function readInt32BEAt(bytes: Uint8Array, offset: number, label: string): number {
  validateRange(bytes, offset, 4, label);
  return readInt32BE(bytes, offset);
}

function readUint8At(bytes: Uint8Array, offset: number, label: string): number {
  validateRange(bytes, offset, 1, label);
  return bytes[offset];
}

function validateContainedRange(
  bytes: Uint8Array,
  offset: number,
  length: number,
  containerEnd: number,
  label: string,
): void {
  validateRange(bytes, offset, length, label);
  if (offset + length > containerEnd) {
    fail("invalid-container", `${label} exceeds the PSD layer info section.`);
  }
}

function readAsciiAt(
  bytes: Uint8Array,
  offset: number,
  length: number,
  containerEnd: number,
  label: string,
): string {
  validateContainedRange(bytes, offset, length, containerEnd, label);
  return readAscii(bytes, offset, length);
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
  if (channels < 3 || channels > 4) {
    fail(
      "unsupported-feature",
      "PSD RGB documents must contain 3 channels plus optional transparency.",
    );
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

  return {
    ...header,
    layerCount,
    layerMaskInfoLength: layerMaskInfo.length,
    layerMaskInfoStart: layerMaskInfo.start,
  };
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

function hasAnyOwnValue(
  layer: RawPsdLayer,
  keys: readonly (keyof RawPsdLayer)[],
): boolean {
  return keys.some((key) => hasOwnValue(layer, key));
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
  const hasChildrenProperty = layer.children !== undefined;
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
    hasAdjustmentOrFill: hasAnyOwnValue(layer, ADJUSTMENT_OR_FILL_LAYER_KEYS),
    hasEffects: hasOwnValue(layer, "effects"),
    hasImageData: imageData !== undefined,
    hasMask: hasOwnValue(layer, "mask"),
    hasSmartObject: hasOwnValue(layer, "smartObject") || hasOwnValue(layer, "placedLayer"),
    hasText: hasOwnValue(layer, "text"),
    hasVectorMask: hasOwnValue(layer, "vectorMask"),
    imageData,
    isGroup: hasChildrenProperty || hasOwnValue(layer, "sectionDivider"),
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

function normalizeLayerName(value: string | undefined, fallback: string, path: string): string {
  if (value === undefined || value.trim().length === 0) return fallback;
  if (value.length > MAX_LAYER_NAME_LENGTH) {
    fail(
      "invalid-container",
      `${path} must be no longer than ${MAX_LAYER_NAME_LENGTH} characters.`,
    );
  }
  return value;
}

function readPaddedPascalString(
  bytes: Uint8Array,
  offset: number,
  containerEnd: number,
  path: string,
): { nextOffset: number; value: string } {
  const length = readUint8At(bytes, offset, `${path} length`);
  const contentOffset = offset + 1;
  const paddedLength = Math.ceil((length + 1) / 4) * 4;
  validateContainedRange(bytes, contentOffset, length, containerEnd, path);
  validateContainedRange(bytes, offset, paddedLength, containerEnd, path);

  return {
    nextOffset: offset + paddedLength,
    value: readAscii(bytes, contentOffset, length),
  };
}

function readUnicodeLayerName(
  bytes: Uint8Array,
  offset: number,
  length: number,
  path: string,
): string {
  validateRange(bytes, offset, length, path);
  if (length < 4) {
    fail("invalid-container", `${path} Unicode layer name is truncated.`);
  }

  const characterCount = readUint32BE(bytes, offset);
  const byteLength = characterCount * 2;
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength > length - 4 ||
    characterCount > MAX_LAYER_NAME_LENGTH
  ) {
    fail("invalid-container", `${path} Unicode layer name length is invalid.`);
  }

  const codeUnits: number[] = [];
  for (let index = 0; index < characterCount; index += 1) {
    codeUnits.push(readUint16BE(bytes, offset + 4 + index * 2));
  }
  return String.fromCharCode(...codeUnits);
}

function parseLayerAdditionalInfo(
  bytes: Uint8Array,
  offset: number,
  extraEnd: number,
  layerName: string,
): {
  hasAdjustmentOrFill: boolean;
  hasEffects: boolean;
  hasSmartObject: boolean;
  hasText: boolean;
  hasVectorMask: boolean;
  isGroup: boolean;
  name: string;
} {
  let cursor = offset;
  let name = layerName;
  let hasAdjustmentOrFill = false;
  let hasEffects = false;
  let hasSmartObject = false;
  let hasText = false;
  let hasVectorMask = false;
  let isGroup = false;

  while (cursor < extraEnd) {
    if (extraEnd - cursor < 12) {
      const remaining = bytes.subarray(cursor, extraEnd);
      if (remaining.every((byte) => byte === 0)) break;
      fail("invalid-container", "PSD layer additional information is truncated.");
    }

    const signature = readAsciiAt(
      bytes,
      cursor,
      4,
      extraEnd,
      "PSD layer additional information signature",
    );
    const key = readAsciiAt(
      bytes,
      cursor + 4,
      4,
      extraEnd,
      "PSD layer additional information key",
    );
    const length = readUint32BEAt(
      bytes,
      cursor + 8,
      "PSD layer additional information length",
    );
    const dataOffset = cursor + 12;
    const paddedLength = length + (length % 2);
    validateContainedRange(
      bytes,
      dataOffset,
      paddedLength,
      extraEnd,
      `PSD layer additional information ${key}`,
    );

    if (signature !== PSD_LAYER_SIGNATURE && signature !== PSD_LAYER_SIGNATURE_64) {
      fail("invalid-container", "PSD layer additional information signature is invalid.");
    }
    if (key === "luni") {
      name = readUnicodeLayerName(
        bytes,
        dataOffset,
        length,
        "PSD layer additional information",
      );
    } else if (key === "lsct" || key === "lsdk") {
      isGroup = true;
    } else if (key === "TySh" || key === "tySh") {
      hasText = true;
    } else if (
      key === "SoLd" ||
      key === "PlLd" ||
      key === "lnk2" ||
      key === "lnk3" ||
      key === "lnkD" ||
      key === "lnkE"
    ) {
      hasSmartObject = true;
    } else if (key === "lfx2" || key === "lrFX") {
      hasEffects = true;
    } else if (key === "vmsk" || key === "vsms") {
      hasVectorMask = true;
    } else if (
      key === "brit" ||
      key === "levl" ||
      key === "curv" ||
      key === "expA" ||
      key === "vibA" ||
      key === "hue2" ||
      key === "blnc" ||
      key === "blwh" ||
      key === "phfl" ||
      key === "mixr" ||
      key === "clrL" ||
      key === "nvrt" ||
      key === "post" ||
      key === "thrs" ||
      key === "grdm" ||
      key === "selc" ||
      key === "SoCo" ||
      key === "GdFl" ||
      key === "PtFl"
    ) {
      hasAdjustmentOrFill = true;
    } else {
      fail(
        "unsupported-feature",
        `PSD layer metadata block ${JSON.stringify(key)} is not supported.`,
      );
    }

    cursor = dataOffset + paddedLength;
  }

  return {
    hasAdjustmentOrFill,
    hasEffects,
    hasSmartObject,
    hasText,
    hasVectorMask,
    isGroup,
    name,
  };
}

function parseNativeLayerExtraData(
  bytes: Uint8Array,
  offset: number,
  length: number,
  fallbackName: string,
  layerLabel: string,
): {
  hasAdjustmentOrFill: boolean;
  hasEffects: boolean;
  hasMask: boolean;
  hasSmartObject: boolean;
  hasText: boolean;
  hasVectorMask: boolean;
  isGroup: boolean;
  name: string;
} {
  const extraEnd = offset + length;
  validateContainedRange(bytes, offset, length, extraEnd, `${layerLabel} extra data`);

  const maskLength = readUint32BEAt(bytes, offset, `${layerLabel} mask data length`);
  let cursor = offset + 4;
  validateContainedRange(bytes, cursor, maskLength, extraEnd, `${layerLabel} mask data`);
  cursor += maskLength;

  const blendingRangesLength = readUint32BEAt(
    bytes,
    cursor,
    `${layerLabel} blending ranges length`,
  );
  cursor += 4;
  validateContainedRange(
    bytes,
    cursor,
    blendingRangesLength,
    extraEnd,
    `${layerLabel} blending ranges`,
  );
  if (blendingRangesLength !== 0) {
    fail(
      "unsupported-feature",
      `${layerLabel} uses layer blending ranges, which are not supported.`,
    );
  }
  cursor += blendingRangesLength;

  const pascalName = readPaddedPascalString(
    bytes,
    cursor,
    extraEnd,
    `${layerLabel} name`,
  );
  cursor = pascalName.nextOffset;
  const additionalInfo = parseLayerAdditionalInfo(
    bytes,
    cursor,
    extraEnd,
    pascalName.value,
  );

  return {
    ...additionalInfo,
    hasMask: maskLength !== 0,
    name: normalizeLayerName(additionalInfo.name, fallbackName, `${layerLabel} name`),
  };
}

function validateNativeLayerBounds(
  layer: Pick<NativePsdLayerRecord, "bottom" | "left" | "right" | "top">,
  metadata: PsdMetadata,
  layerLabel: string,
): void {
  const width = layer.right - layer.left;
  const height = layer.bottom - layer.top;
  if (width < 1 || height < 1) {
    fail("invalid-container", `${layerLabel} raster bounds must be positive.`);
  }
  if (
    layer.left < 0 ||
    layer.top < 0 ||
    layer.right > metadata.width ||
    layer.bottom > metadata.height
  ) {
    fail("invalid-container", `${layerLabel} raster bounds must fit within the PSD canvas.`);
  }
  if (width * height > MAX_LAYER_PIXELS) {
    fail(
      "allocation-limit",
      `PSD decoded layer pixels exceed the ${MAX_LAYER_PIXELS}-pixel adapter limit.`,
    );
  }
}

function parseNativeLayerRecord(
  bytes: Uint8Array,
  offset: number,
  layerInfoEnd: number,
  metadata: PsdMetadata,
  layerIndex: number,
): { nextOffset: number; record: NativePsdLayerRecord } {
  const layerLabel = `PSD layer ${layerIndex + 1}`;
  const top = readInt32BEAt(bytes, offset, `${layerLabel} top`);
  const left = readInt32BEAt(bytes, offset + 4, `${layerLabel} left`);
  const bottom = readInt32BEAt(bytes, offset + 8, `${layerLabel} bottom`);
  const right = readInt32BEAt(bytes, offset + 12, `${layerLabel} right`);
  const channelCount = readUint16BEAt(bytes, offset + 16, `${layerLabel} channel count`);
  let cursor = offset + 18;

  validateNativeLayerBounds({ bottom, left, right, top }, metadata, layerLabel);
  if (channelCount < 3 || channelCount > 4) {
    fail(
      "unsupported-feature",
      `${layerLabel} must contain 3 RGB channels and optional transparency.`,
    );
  }

  const channelRecords: NativePsdChannelRecord[] = [];
  for (let index = 0; index < channelCount; index += 1) {
    channelRecords.push({
      id: readInt16BEAt(bytes, cursor, `${layerLabel} channel id`),
      length: readUint32BEAt(bytes, cursor + 2, `${layerLabel} channel data length`),
    });
    cursor += 6;
  }

  const signature = readAsciiAt(
    bytes,
    cursor,
    4,
    layerInfoEnd,
    `${layerLabel} blend mode signature`,
  );
  const blendModeKey = readAsciiAt(
    bytes,
    cursor + 4,
    4,
    layerInfoEnd,
    `${layerLabel} blend mode key`,
  );
  if (signature !== PSD_LAYER_SIGNATURE && signature !== PSD_LAYER_SIGNATURE_64) {
    fail("invalid-container", `${layerLabel} blend mode signature is invalid.`);
  }
  cursor += 8;

  const opacity = readUint8At(bytes, cursor, `${layerLabel} opacity`);
  const clipping = readUint8At(bytes, cursor + 1, `${layerLabel} clipping`) !== 0;
  const flags = readUint8At(bytes, cursor + 2, `${layerLabel} flags`);
  cursor += 4;

  const extraLength = readUint32BEAt(bytes, cursor, `${layerLabel} extra data length`);
  cursor += 4;
  validateContainedRange(bytes, cursor, extraLength, layerInfoEnd, `${layerLabel} extra data`);
  const extra = parseNativeLayerExtraData(
    bytes,
    cursor,
    extraLength,
    `Layer ${layerIndex + 1}`,
    layerLabel,
  );

  return {
    nextOffset: cursor + extraLength,
    record: {
      ...extra,
      blendMode: blendModeKey === PSD_NORMAL_BLEND_MODE_KEY ? SUPPORTED_BLEND_MODE : blendModeKey,
      bottom,
      channelRecords,
      clipping,
      left,
      opacity,
      right,
      top,
      visible: (flags & PSD_LAYER_HIDDEN_FLAG) === 0,
    },
  };
}

function decodePackBitsRow(
  bytes: Uint8Array,
  offset: number,
  length: number,
  output: Uint8Array,
  outputOffset: number,
  expectedLength: number,
  path: string,
): void {
  const sourceEnd = offset + length;
  const outputEnd = outputOffset + expectedLength;
  let source = offset;
  let destination = outputOffset;

  while (source < sourceEnd) {
    const header = bytes[source];
    source += 1;

    if (header <= 127) {
      const count = header + 1;
      if (source + count > sourceEnd || destination + count > outputEnd) {
        fail("invalid-container", `${path} PackBits literal run is invalid.`);
      }
      output.set(bytes.subarray(source, source + count), destination);
      source += count;
      destination += count;
    } else if (header >= 129) {
      const count = 257 - header;
      if (source >= sourceEnd || destination + count > outputEnd) {
        fail("invalid-container", `${path} PackBits repeat run is invalid.`);
      }
      output.fill(bytes[source], destination, destination + count);
      source += 1;
      destination += count;
    }
  }

  if (destination !== outputEnd) {
    fail("invalid-container", `${path} PackBits row decoded to the wrong length.`);
  }
}

function decodePackBitsChannel(
  bytes: Uint8Array,
  offset: number,
  length: number,
  width: number,
  height: number,
  path: string,
): Uint8Array {
  const dataEnd = offset + length;
  const rowByteCountsLength = height * 2;
  validateRange(bytes, offset, rowByteCountsLength, `${path} PackBits row lengths`);
  if (rowByteCountsLength > length) {
    fail("invalid-container", `${path} PackBits row lengths are truncated.`);
  }

  const rowByteCounts: number[] = [];
  let rowCountsOffset = offset;
  for (let row = 0; row < height; row += 1) {
    rowByteCounts.push(readUint16BE(bytes, rowCountsOffset));
    rowCountsOffset += 2;
  }

  const output = new Uint8Array(width * height);
  let cursor = offset + rowByteCountsLength;
  for (let row = 0; row < height; row += 1) {
    const rowByteCount = rowByteCounts[row];
    validateRange(bytes, cursor, rowByteCount, `${path} PackBits row ${row + 1}`);
    if (cursor + rowByteCount > dataEnd) {
      fail("invalid-container", `${path} PackBits row exceeds its channel data.`);
    }
    decodePackBitsRow(
      bytes,
      cursor,
      rowByteCount,
      output,
      row * width,
      width,
      `${path} row ${row + 1}`,
    );
    cursor += rowByteCount;
  }

  if (cursor !== dataEnd) {
    fail("invalid-container", `${path} PackBits channel has trailing bytes.`);
  }
  return output;
}

function decodeNativeChannelData(
  bytes: Uint8Array,
  offset: number,
  length: number,
  width: number,
  height: number,
  path: string,
): Uint8Array {
  if (length < 2) {
    fail("invalid-container", `${path} channel data is truncated.`);
  }

  const compression = readUint16BEAt(bytes, offset, `${path} compression`);
  const dataOffset = offset + 2;
  const dataLength = length - 2;
  const expectedLength = width * height;

  if (compression === PSD_COMPRESSION_RAW) {
    if (dataLength !== expectedLength) {
      fail("invalid-container", `${path} raw channel byte count must match layer bounds.`);
    }
    return bytes.slice(dataOffset, dataOffset + dataLength);
  }
  if (compression === PSD_COMPRESSION_PACK_BITS) {
    return decodePackBitsChannel(bytes, dataOffset, dataLength, width, height, path);
  }

  fail("unsupported-feature", `${path} uses unsupported PSD channel compression.`);
}

function decodeNativeLayerImageData(
  bytes: Uint8Array,
  offset: number,
  layerInfoEnd: number,
  record: NativePsdLayerRecord,
  layerIndex: number,
): { imageData: ImageData; nextOffset: number } {
  const width = record.right - record.left;
  const height = record.bottom - record.top;
  const channels = new Map<number, Uint8Array>();
  let cursor = offset;

  for (const channelRecord of record.channelRecords) {
    const path = `PSD layer ${layerIndex + 1} channel ${channelRecord.id}`;
    if (
      channelRecord.id !== PSD_CHANNEL_RED &&
      channelRecord.id !== PSD_CHANNEL_GREEN &&
      channelRecord.id !== PSD_CHANNEL_BLUE &&
      channelRecord.id !== PSD_CHANNEL_ALPHA
    ) {
      fail("unsupported-feature", `${path} is not supported.`);
    }
    if (channels.has(channelRecord.id)) {
      fail("invalid-container", `${path} is duplicated.`);
    }
    validateContainedRange(bytes, cursor, channelRecord.length, layerInfoEnd, path);
    channels.set(
      channelRecord.id,
      decodeNativeChannelData(
        bytes,
        cursor,
        channelRecord.length,
        width,
        height,
        path,
      ),
    );
    cursor += channelRecord.length;
  }

  const red = channels.get(PSD_CHANNEL_RED);
  const green = channels.get(PSD_CHANNEL_GREEN);
  const blue = channels.get(PSD_CHANNEL_BLUE);
  const alpha = channels.get(PSD_CHANNEL_ALPHA);
  if (red === undefined || green === undefined || blue === undefined) {
    fail("invalid-container", `PSD layer ${layerIndex + 1} is missing required RGB channels.`);
  }

  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    const outputOffset = pixelIndex * 4;
    data[outputOffset] = red[pixelIndex];
    data[outputOffset + 1] = green[pixelIndex];
    data[outputOffset + 2] = blue[pixelIndex];
    data[outputOffset + 3] = alpha?.[pixelIndex] ?? 255;
  }

  return {
    imageData: { colorSpace: "srgb", data, height, width },
    nextOffset: cursor,
  };
}

function parseNativePsdDocument(
  bytes: Uint8Array,
  metadata: PsdMetadata,
): PsdParserDocument {
  const sectionEnd = metadata.layerMaskInfoStart + metadata.layerMaskInfoLength;
  const layerInfoLength = readUint32BEAt(
    bytes,
    metadata.layerMaskInfoStart,
    "PSD layer info section length",
  );
  const layerInfoStart = metadata.layerMaskInfoStart + 4;
  validateContainedRange(
    bytes,
    layerInfoStart,
    layerInfoLength,
    sectionEnd,
    "PSD layer info section",
  );
  const layerInfoEnd = layerInfoStart + layerInfoLength;
  const rawLayerCount = readInt16BEAt(bytes, layerInfoStart, "PSD layer count");
  const layerCount = Math.abs(rawLayerCount);
  if (layerCount !== metadata.layerCount) {
    fail("invalid-container", "PSD layer count changed during raster decoding.");
  }

  const records: NativePsdLayerRecord[] = [];
  let cursor = layerInfoStart + 2;
  for (let index = 0; index < layerCount; index += 1) {
    const parsed = parseNativeLayerRecord(bytes, cursor, layerInfoEnd, metadata, index);
    records.push(parsed.record);
    cursor = parsed.nextOffset;
  }

  const layers: PsdParserLayer[] = [];
  for (const [index, record] of records.entries()) {
    const decoded = decodeNativeLayerImageData(bytes, cursor, layerInfoEnd, record, index);
    cursor = decoded.nextOffset;
    layers.push({
      ...record,
      children: [],
      hasImageData: true,
      imageData: decoded.imageData,
    });
  }

  if (cursor < layerInfoEnd) {
    const trailing = bytes.subarray(cursor, layerInfoEnd);
    if (!trailing.every((byte) => byte === 0)) {
      fail("invalid-container", "PSD layer image data has trailing bytes.");
    }
  }

  return {
    bitsPerChannel: metadata.bitsPerChannel,
    channels: metadata.channels,
    colorMode: metadata.colorMode,
    frames: [{ index: 0, durationMs: DEFAULT_FRAME_DURATION_MS }],
    height: metadata.height,
    layers,
    width: metadata.width,
  };
}

function psdLayerLabel(layer: PsdParserLayer, sourceLayerIndex: number): string {
  return `PSD layer ${sourceLayerIndex + 1} (${JSON.stringify(layer.name)})`;
}

type SupportedPsdRasterLayer = PsdParserLayer & {
  imageData: ImageData;
};

function isSupportedRasterLayer(
  layer: PsdParserLayer,
  sourceLayerIndex: number,
  document: PsdParserDocument,
): layer is SupportedPsdRasterLayer {
  const label = psdLayerLabel(layer, sourceLayerIndex);
  if (layer.isGroup || layer.children.length > 0) {
    fail("unsupported-feature", `${label} is a group. PSD groups are not supported.`);
  }
  if (layer.hasText) {
    fail("unsupported-feature", `${label} is a text layer. PSD text layers are not supported.`);
  }
  if (layer.hasSmartObject) {
    fail(
      "unsupported-feature",
      `${label} is a smart object. PSD smart objects are not supported.`,
    );
  }
  if (layer.hasAdjustmentOrFill) {
    fail(
      "unsupported-feature",
      `${label} is an adjustment or fill layer. PSD adjustment and fill layers are not supported.`,
    );
  }
  if (layer.hasMask || layer.hasVectorMask) {
    fail("unsupported-feature", `${label} uses a mask. PSD layer masks are not supported.`);
  }
  if (layer.hasEffects) {
    fail("unsupported-feature", `${label} uses layer effects. PSD layer effects are not supported.`);
  }
  if (layer.clipping) {
    fail("unsupported-feature", `${label} is a clipping layer. PSD clipping masks are not supported.`);
  }
  if (layer.blendMode !== SUPPORTED_BLEND_MODE) {
    fail(
      "unsupported-feature",
      `${label} uses blend mode ${JSON.stringify(layer.blendMode)}. Only normal PSD raster layers are supported.`,
    );
  }
  if (!layer.hasImageData || layer.imageData === undefined) {
    fail("unsupported-feature", `${label} is not a supported PSD raster layer.`);
  }

  const width = layer.right - layer.left;
  const height = layer.bottom - layer.top;
  if (width < 1 || height < 1) {
    fail("invalid-parser-output", `${label} raster bounds must be positive.`);
  }
  if (
    layer.left < 0 ||
    layer.top < 0 ||
    layer.right > document.width ||
    layer.bottom > document.height
  ) {
    fail("invalid-parser-output", `${label} raster bounds must fit within the PSD canvas.`);
  }
  if (layer.imageData.width !== width || layer.imageData.height !== height) {
    fail("invalid-parser-output", `${label} ImageData dimensions must match raster bounds.`);
  }

  return true;
}

function renderLayerToFullCanvasImageData(
  layer: SupportedPsdRasterLayer,
  document: PsdParserDocument,
): ImageData {
  const layerWidth = layer.right - layer.left;
  const layerHeight = layer.bottom - layer.top;
  const data = new Uint8ClampedArray(document.width * document.height * 4);

  for (let row = 0; row < layerHeight; row += 1) {
    const sourceOffset = row * layerWidth * 4;
    const destinationOffset = ((layer.top + row) * document.width + layer.left) * 4;
    data.set(
      layer.imageData.data.subarray(sourceOffset, sourceOffset + layerWidth * 4),
      destinationOffset,
    );
  }

  return {
    colorSpace: "srgb",
    data,
    height: document.height,
    width: document.width,
  };
}

function convertPsdDocumentToSpriteProject(document: PsdParserDocument): SpriteProject {
  const layers: SpriteProject["layers"] = [];

  for (const [sourceLayerIndex, layer] of document.layers.entries()) {
    if (!isSupportedRasterLayer(layer, sourceLayerIndex, document)) continue;

    layers.push({
      id: `psd-layer-${sourceLayerIndex}`,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      cels: [
        {
          frameIndex: 0,
          x: 0,
          y: 0,
          imageData: renderLayerToFullCanvasImageData(layer, document),
        },
      ],
    });
  }

  if (layers.length === 0) {
    fail("unsupported-feature", "PSD contains no supported raster layers.");
  }

  return {
    width: document.width,
    height: document.height,
    colorMode: "rgba",
    frames: document.frames.map((frame) => ({ ...frame })),
    layers,
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
  if (dependencies.parser === undefined && dependencies.loadParser === undefined) {
    return parseNativePsdDocument(bytes, metadata);
  }

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

/** Imports local PSD bytes into the internal one-frame sprite model. */
export async function importPsdBytes(
  bytes: Uint8Array,
  dependencies: PsdParserAdapterDependencies = {},
): Promise<SpriteProject> {
  return convertPsdDocumentToSpriteProject(await parsePsdBytes(bytes, dependencies));
}

/** Reads a browser-selected .psd file and converts supported raster layers locally. */
export async function importPsd(
  file: File,
  dependencies: PsdParserAdapterDependencies = {},
): Promise<SpriteProject> {
  return convertPsdDocumentToSpriteProject(await parsePsdFile(file, dependencies));
}
