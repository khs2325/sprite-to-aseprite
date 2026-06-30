import {
  normalizeFrameDurationMs,
  type SpriteCel,
  type SpriteProject,
} from "../../SpriteProject";

const PIXELORAMA_MIMETYPE = "application/x-pixelorama";
const SUPPORTED_PXO_VERSION = 6;
const RGBA8_COLOR_MODE = 5;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_DATA_JSON_BYTES = 5 * 1024 * 1024;
const MAX_ARCHIVE_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 512;
const MAX_DIMENSION = 1024;
const MAX_FRAMES = 512;
const MAX_LAYERS = 64;
const MAX_CELS = 4096;
const MAX_TOTAL_CEL_BYTES = 64 * 1024 * 1024;
const MAX_STRING_LENGTH = 1024;
const MAX_PATH_LENGTH = 512;
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_STORED = 0;
const ZIP_DEFLATED = 8;
const ZIP_FLAG_ENCRYPTED = 1;
const ZIP_FLAG_DATA_DESCRIPTOR = 8;
const ZIP_FLAG_UTF8 = 0x0800;
const ZIP64_SENTINEL = 0xffffffff;

const PROJECT_FIELDS = new Set([
  "author_company",
  "author_contact",
  "author_display_name",
  "author_real_name",
  "brushes",
  "color_mode",
  "current_frame",
  "current_layer",
  "export_directory_path",
  "export_file_format",
  "export_file_name",
  "fps",
  "frames",
  "guides",
  "layers",
  "license",
  "metadata",
  "palettes",
  "pixelorama_version",
  "project_current_palette_name",
  "pxo_version",
  "reference_images",
  "size_x",
  "size_y",
  "symmetry_points",
  "tags",
  "tile_mode_x_basis_x",
  "tile_mode_x_basis_y",
  "tile_mode_y_basis_x",
  "tile_mode_y_basis_y",
  "tilesets",
  "user_data",
  "vanishing_points",
]);
const LAYER_FIELDS = new Set([
  "blend_mode",
  "clipping_mask",
  "effects",
  "locked",
  "metadata",
  "name",
  "new_cels_linked",
  "opacity",
  "parent",
  "type",
  "ui_color",
  "visible",
]);
const FRAME_FIELDS = new Set(["cels", "duration", "metadata", "user_data"]);
const CEL_FIELDS = new Set([
  "metadata",
  "opacity",
  "ui_color",
  "user_data",
  "z_index",
]);

export type PixeloramaImportErrorCode =
  | "allocation-limit"
  | "browser-unsupported"
  | "file-read"
  | "file-too-large"
  | "invalid-container"
  | "invalid-json"
  | "invalid-mimetype"
  | "invalid-project"
  | "missing-entry"
  | "unsafe-path"
  | "unsupported-feature"
  | "unsupported-version"
  | "unsupported-zip";

export class PixeloramaImportError extends Error {
  constructor(
    readonly code: PixeloramaImportErrorCode,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "PixeloramaImportError";
  }
}

/** Returns importer-authored detail only; arbitrary thrown values stay private. */
export function getPixeloramaImportDiagnostic(error: unknown): string | null {
  return error instanceof PixeloramaImportError ? error.message : null;
}

export type PixeloramaImportDependencies = {
  inflateRaw?: (
    compressed: Uint8Array,
    maximumOutputBytes: number,
  ) => Promise<Uint8Array>;
};

type ZipEntry = {
  compressionMethod: number;
  content: Uint8Array;
  isDirectory: boolean;
  name: string;
};

type CentralDirectoryEntry = {
  compressedSize: number;
  compressionMethod: number;
  crc: number;
  flags: number;
  localHeaderOffset: number;
  name: string;
  uncompressedSize: number;
};

type ParsedCentralDirectory = {
  centralDirectoryOffset: number;
  entries: CentralDirectoryEntry[];
};

type ParsedLayer = {
  name: string;
  opacity: number;
  visible: boolean;
};

type ParsedPixelorama = {
  fps: number;
  frames: Array<{ duration: number }>;
  height: number;
  layers: ParsedLayer[];
  width: number;
};

function fail(code: PixeloramaImportErrorCode, message: string): never {
  throw new PixeloramaImportError(code, message);
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x10000 +
    bytes[offset + 3] * 0x1000000
  ) >>> 0;
}

function requireRange(
  bytes: Uint8Array,
  offset: number,
  length: number,
  message: string,
): void {
  if (offset < 0 || length < 0 || offset > bytes.length - length) {
    fail("invalid-container", message);
  }
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodeUtf8(bytes: Uint8Array, description: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new PixeloramaImportError(
      "invalid-container",
      `${description} must be valid UTF-8.`,
      { cause: error },
    );
  }
}

function bytesEqualText(bytes: Uint8Array, text: string): boolean {
  const expected = new TextEncoder().encode(text);
  return bytes.length === expected.length && expected.every(
    (byte, index) => byte === bytes[index],
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
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

function isUnsafePath(path: string, allowDirectory: boolean): boolean {
  if (
    path.length === 0 ||
    path.length > MAX_PATH_LENGTH ||
    path.includes("\0") ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(path)
  ) {
    return true;
  }

  if (!allowDirectory && path.endsWith("/")) {
    return true;
  }
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
  if (normalized.length === 0) {
    return true;
  }

  return normalized
    .split("/")
    .some((part) => part.length === 0 || part === "." || part === "..");
}

function assertSafeArchivePath(path: string): void {
  if (isUnsafePath(path, true)) {
    fail(
      "unsafe-path",
      `Pixelorama ZIP entry ${JSON.stringify(path)} is not a safe relative archive path.`,
    );
  }
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  if (bytes.length < 22) {
    fail("invalid-container", "Pixelorama ZIP end-of-central-directory record is missing.");
  }

  const minimumOffset = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (readUint32LE(bytes, offset) !== ZIP_END_OF_CENTRAL_DIRECTORY) {
      continue;
    }
    const commentLength = readUint16LE(bytes, offset + 20);
    if (offset + 22 + commentLength === bytes.length) {
      return offset;
    }
  }

  fail("invalid-container", "Pixelorama ZIP end-of-central-directory record is missing.");
}

function parseCentralDirectory(bytes: Uint8Array): ParsedCentralDirectory {
  const endOffset = findEndOfCentralDirectory(bytes);
  const diskNumber = readUint16LE(bytes, endOffset + 4);
  const centralDirectoryDisk = readUint16LE(bytes, endOffset + 6);
  const diskEntryCount = readUint16LE(bytes, endOffset + 8);
  const entryCount = readUint16LE(bytes, endOffset + 10);
  const centralDirectorySize = readUint32LE(bytes, endOffset + 12);
  const centralDirectoryOffset = readUint32LE(bytes, endOffset + 16);

  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || diskEntryCount !== entryCount) {
    fail("unsupported-zip", "Pixelorama ZIP archives must not use multi-disk layout.");
  }
  if (
    entryCount === 0xffff ||
    centralDirectorySize === ZIP64_SENTINEL ||
    centralDirectoryOffset === ZIP64_SENTINEL
  ) {
    fail("unsupported-zip", "Pixelorama ZIP64 archives are unsupported.");
  }
  if (entryCount === 0 || entryCount > MAX_ZIP_ENTRIES) {
    fail(
      "allocation-limit",
      `Pixelorama ZIP entry count must be from 1 through ${MAX_ZIP_ENTRIES}.`,
    );
  }
  if (
    centralDirectoryOffset > endOffset ||
    centralDirectorySize > endOffset - centralDirectoryOffset
  ) {
    fail("invalid-container", "Pixelorama ZIP central directory is outside the archive.");
  }

  const entries: CentralDirectoryEntry[] = [];
  const names = new Set<string>();
  let totalUncompressedBytes = 0;
  let offset = centralDirectoryOffset;
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;

  for (let index = 0; index < entryCount; index += 1) {
    requireRange(bytes, offset, 46, "Pixelorama ZIP central directory is truncated.");
    if (readUint32LE(bytes, offset) !== ZIP_CENTRAL_DIRECTORY_HEADER) {
      fail("invalid-container", "Pixelorama ZIP central directory is malformed.");
    }

    const flags = readUint16LE(bytes, offset + 8);
    const compressionMethod = readUint16LE(bytes, offset + 10);
    const crc = readUint32LE(bytes, offset + 16);
    const compressedSize = readUint32LE(bytes, offset + 20);
    const uncompressedSize = readUint32LE(bytes, offset + 24);
    const nameLength = readUint16LE(bytes, offset + 28);
    const extraLength = readUint16LE(bytes, offset + 30);
    const commentLength = readUint16LE(bytes, offset + 32);
    const localHeaderOffset = readUint32LE(bytes, offset + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    requireRange(bytes, offset, recordLength, "Pixelorama ZIP central directory is truncated.");

    if (
      compressedSize === ZIP64_SENTINEL ||
      uncompressedSize === ZIP64_SENTINEL ||
      localHeaderOffset === ZIP64_SENTINEL
    ) {
      fail("unsupported-zip", "Pixelorama ZIP64 entries are unsupported.");
    }
    if ((flags & ZIP_FLAG_ENCRYPTED) !== 0) {
      fail("unsupported-zip", "Encrypted Pixelorama ZIP entries are unsupported.");
    }
    if ((flags & ZIP_FLAG_DATA_DESCRIPTOR) !== 0) {
      fail("unsupported-zip", "Pixelorama ZIP data descriptors are unsupported.");
    }
    if ((flags & ~(ZIP_FLAG_UTF8)) !== 0) {
      fail("unsupported-zip", "Pixelorama ZIP entry uses unsupported general-purpose flags.");
    }
    if (compressionMethod !== ZIP_STORED && compressionMethod !== ZIP_DEFLATED) {
      fail(
        "unsupported-zip",
        `Pixelorama ZIP entry uses unsupported compression method ${compressionMethod}.`,
      );
    }

    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > MAX_ARCHIVE_OUTPUT_BYTES) {
      fail(
        "allocation-limit",
        `Pixelorama ZIP uncompressed data exceeds the ${MAX_ARCHIVE_OUTPUT_BYTES}-byte import limit.`,
      );
    }

    const name = decodeUtf8(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
      "Pixelorama ZIP entry name",
    );
    assertSafeArchivePath(name);
    const logicalName = name.endsWith("/") ? name.slice(0, -1) : name;
    if (names.has(logicalName)) {
      fail(
        "invalid-container",
        `Pixelorama ZIP contains duplicate entry ${JSON.stringify(logicalName)}.`,
      );
    }
    names.add(logicalName);

    entries.push({
      compressedSize,
      compressionMethod,
      crc,
      flags,
      localHeaderOffset,
      name,
      uncompressedSize,
    });
    offset += recordLength;
  }

  if (offset !== centralDirectoryEnd) {
    fail("invalid-container", "Pixelorama ZIP central directory size is inconsistent.");
  }

  return {
    centralDirectoryOffset,
    entries: entries.sort((left, right) => left.localHeaderOffset - right.localHeaderOffset),
  };
}

async function inflateRawInBrowser(
  compressed: Uint8Array,
  maximumOutputBytes: number,
): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "function") {
    fail(
      "browser-unsupported",
      "This browser does not support local Pixelorama ZIP decompression.",
    );
  }

  const stream = new Blob([new Uint8Array(compressed)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const output = new Uint8Array(maximumOutputBytes);
  let length = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) return output.subarray(0, length);
    if (length + value.length > maximumOutputBytes) {
      await reader.cancel();
      fail("invalid-container", "Pixelorama ZIP entry inflates beyond its declared size.");
    }
    output.set(value, length);
    length += value.length;
  }
}

async function readZipArchive(
  bytes: Uint8Array,
  dependencies: PixeloramaImportDependencies,
): Promise<{ entries: Map<string, ZipEntry>; orderedEntries: ZipEntry[] }> {
  const { centralDirectoryOffset, entries: centralEntries } = parseCentralDirectory(bytes);
  const inflateRaw = dependencies.inflateRaw ?? inflateRawInBrowser;
  const entries = new Map<string, ZipEntry>();
  const orderedEntries: ZipEntry[] = [];

  for (const [index, entry] of centralEntries.entries()) {
    requireRange(
      bytes,
      entry.localHeaderOffset,
      30,
      "Pixelorama ZIP local file header is truncated.",
    );
    if (readUint32LE(bytes, entry.localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER) {
      fail("invalid-container", "Pixelorama ZIP local file header is malformed.");
    }

    const localFlags = readUint16LE(bytes, entry.localHeaderOffset + 6);
    const localCompressionMethod = readUint16LE(bytes, entry.localHeaderOffset + 8);
    const localNameLength = readUint16LE(bytes, entry.localHeaderOffset + 26);
    const localExtraLength = readUint16LE(bytes, entry.localHeaderOffset + 28);
    const nameOffset = entry.localHeaderOffset + 30;
    const dataOffset = nameOffset + localNameLength + localExtraLength;
    const dataEnd = dataOffset + entry.compressedSize;
    const nextHeaderOffset =
      centralEntries[index + 1]?.localHeaderOffset ?? centralDirectoryOffset;

    requireRange(bytes, nameOffset, localNameLength, "Pixelorama ZIP local file header is truncated.");
    requireRange(bytes, dataOffset, entry.compressedSize, "Pixelorama ZIP entry data is truncated.");
    if (dataEnd > nextHeaderOffset) {
      fail("invalid-container", "Pixelorama ZIP local entries overlap.");
    }
    if (localCompressionMethod !== entry.compressionMethod || localFlags !== entry.flags) {
      fail("invalid-container", "Pixelorama ZIP local and central metadata do not match.");
    }

    const localName = decodeUtf8(
      bytes.subarray(nameOffset, nameOffset + localNameLength),
      "Pixelorama ZIP local entry name",
    );
    if (localName !== entry.name) {
      fail("invalid-container", "Pixelorama ZIP local and central entry names do not match.");
    }

    const compressed = bytes.subarray(dataOffset, dataEnd);
    let content: Uint8Array;
    if (entry.compressionMethod === ZIP_STORED) {
      if (compressed.length !== entry.uncompressedSize) {
        fail(
          "invalid-container",
          `Pixelorama ZIP entry ${JSON.stringify(entry.name)} has an invalid stored size.`,
        );
      }
      content = compressed.slice();
    } else {
      try {
        content = await inflateRaw(compressed, entry.uncompressedSize);
      } catch (error) {
        if (error instanceof PixeloramaImportError) throw error;
        throw new PixeloramaImportError(
          "invalid-container",
          `Could not decompress Pixelorama ZIP entry ${JSON.stringify(entry.name)}.`,
          { cause: error },
        );
      }
    }

    if (!(content instanceof Uint8Array) || content.length !== entry.uncompressedSize) {
      fail(
        "invalid-container",
        `Pixelorama ZIP entry ${JSON.stringify(entry.name)} inflates to an unexpected size.`,
      );
    }
    if (crc32(content) !== entry.crc) {
      fail(
        "invalid-container",
        `Pixelorama ZIP entry ${JSON.stringify(entry.name)} has an invalid CRC.`,
      );
    }

    const zipEntry: ZipEntry = {
      compressionMethod: entry.compressionMethod,
      content,
      isDirectory: entry.name.endsWith("/"),
      name: entry.name,
    };
    entries.set(zipEntry.name, zipEntry);
    orderedEntries.push(zipEntry);
  }

  return { entries, orderedEntries };
}

function requireEntry(entries: Map<string, ZipEntry>, name: string): ZipEntry {
  const entry = entries.get(name);
  if (entry === undefined || entry.isDirectory) {
    fail("missing-entry", `Pixelorama ZIP is missing required entry ${JSON.stringify(name)}.`);
  }
  return entry;
}

function assertPixeloramaMimetype(entries: Map<string, ZipEntry>): void {
  const mimetype = requireEntry(entries, "mimetype");
  if (!bytesEqualText(mimetype.content, PIXELORAMA_MIMETYPE)) {
    fail(
      "invalid-mimetype",
      `Pixelorama mimetype must be exactly ${JSON.stringify(PIXELORAMA_MIMETYPE)}.`,
    );
  }
}

function expectEmptyRecord(value: unknown, path: string): void {
  if (!isRecord(value)) {
    fail("invalid-project", `${path} must be an object.`);
  }
  if (Object.keys(value).length !== 0) {
    fail("unsupported-feature", `${path} must be empty for the supported Pixelorama subset.`);
  }
}

function expectEmptyArray(value: unknown, path: string): void {
  if (!Array.isArray(value)) {
    fail("invalid-project", `${path} must be an array.`);
  }
  if (value.length !== 0) {
    fail("unsupported-feature", `${path} is unsupported and must be empty.`);
  }
}

function expectEmptyString(value: unknown, path: string): void {
  if (typeof value !== "string") {
    fail("invalid-project", `${path} must be a string.`);
  }
  if (value.length !== 0) {
    fail("unsupported-feature", `${path} is unsupported and must be empty.`);
  }
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length > MAX_STRING_LENGTH) {
    fail("invalid-project", `${path} must be a string no longer than ${MAX_STRING_LENGTH} characters.`);
  }
  return value;
}

function expectInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value)) {
    fail("invalid-project", `${path} must be a safe integer.`);
  }
  return value as number;
}

function parseDimension(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_DIMENSION) {
    fail(
      "allocation-limit",
      `${path} must be an integer from 1 through ${MAX_DIMENSION}.`,
    );
  }
  return value as number;
}

function parseProjectJson(json: string): ParsedPixelorama {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    fail("invalid-json", "Pixelorama data.json is not valid JSON.");
  }
  if (!isRecord(value)) {
    fail("invalid-project", "Pixelorama data.json must contain an object.");
  }
  assertAllowedFields(value, PROJECT_FIELDS, "Pixelorama project");
  for (const field of PROJECT_FIELDS) {
    assertRequiredField(value, field, "Pixelorama project");
  }

  if (value.pxo_version !== SUPPORTED_PXO_VERSION) {
    fail("unsupported-version", "Unsupported Pixelorama pxo_version; expected integer 6.");
  }
  if (value.color_mode !== RGBA8_COLOR_MODE) {
    fail("unsupported-feature", "Pixelorama color_mode must be 5 (RGBA8).");
  }
  const pixeloramaVersion = expectString(
    value.pixelorama_version,
    "Pixelorama project.pixelorama_version",
  );
  if (pixeloramaVersion.trim().length === 0) {
    fail("invalid-project", "Pixelorama project.pixelorama_version must be a non-empty string.");
  }

  const width = parseDimension(value.size_x, "Pixelorama project.size_x");
  const height = parseDimension(value.size_y, "Pixelorama project.size_y");
  if (
    typeof value.fps !== "number" ||
    !Number.isFinite(value.fps) ||
    value.fps <= 0
  ) {
    fail("invalid-project", "Pixelorama project.fps must be a finite number greater than zero.");
  }
  if (!Array.isArray(value.frames) || value.frames.length === 0) {
    fail("invalid-project", "Pixelorama project.frames must be a non-empty array.");
  }
  if (value.frames.length > MAX_FRAMES) {
    fail("allocation-limit", `Pixelorama frame count must be from 1 through ${MAX_FRAMES}.`);
  }
  if (!Array.isArray(value.layers) || value.layers.length === 0) {
    fail("invalid-project", "Pixelorama project.layers must be a non-empty array.");
  }
  if (value.layers.length > MAX_LAYERS) {
    fail("allocation-limit", `Pixelorama layer count must be from 1 through ${MAX_LAYERS}.`);
  }
  const celCount = value.frames.length * value.layers.length;
  if (!Number.isSafeInteger(celCount) || celCount > MAX_CELS) {
    fail("allocation-limit", `Pixelorama cel count must not exceed ${MAX_CELS}.`);
  }
  const rawCelByteLength = width * height * 4;
  const totalCelBytes = rawCelByteLength * celCount;
  if (
    !Number.isSafeInteger(rawCelByteLength) ||
    !Number.isSafeInteger(totalCelBytes) ||
    totalCelBytes > MAX_TOTAL_CEL_BYTES
  ) {
    fail(
      "allocation-limit",
      `Pixelorama raw cel data exceeds the ${MAX_TOTAL_CEL_BYTES}-byte import limit.`,
    );
  }

  expectEmptyRecord(value.metadata, "Pixelorama project.metadata");
  for (const field of [
    "author_company",
    "author_contact",
    "author_display_name",
    "author_real_name",
    "license",
    "project_current_palette_name",
    "user_data",
  ]) {
    expectEmptyString(value[field], `Pixelorama project.${field}`);
  }
  for (const field of [
    "brushes",
    "guides",
    "palettes",
    "reference_images",
    "tags",
    "tilesets",
    "vanishing_points",
  ]) {
    expectEmptyArray(value[field], `Pixelorama project.${field}`);
  }

  for (const field of [
    "current_frame",
    "current_layer",
    "export_file_format",
    "tile_mode_x_basis_x",
    "tile_mode_x_basis_y",
    "tile_mode_y_basis_x",
    "tile_mode_y_basis_y",
  ]) {
    expectInteger(value[field], `Pixelorama project.${field}`);
  }
  expectString(value.export_directory_path, "Pixelorama project.export_directory_path");
  expectString(value.export_file_name, "Pixelorama project.export_file_name");
  if (!Array.isArray(value.symmetry_points) || value.symmetry_points.length !== 2) {
    fail("invalid-project", "Pixelorama project.symmetry_points must be a two-number array.");
  }
  for (const [index, point] of value.symmetry_points.entries()) {
    if (typeof point !== "number" || !Number.isFinite(point)) {
      fail("invalid-project", `Pixelorama project.symmetry_points[${index}] must be a finite number.`);
    }
  }

  const layers = value.layers.map((layer, layerIndex) =>
    parseLayer(layer, layerIndex),
  );
  const frames = value.frames.map((frame, frameIndex) =>
    parseFrame(frame, frameIndex, layers.length),
  );

  return {
    fps: value.fps,
    frames,
    height,
    layers,
    width,
  };
}

function parseLayer(value: unknown, layerIndex: number): ParsedLayer {
  const path = `Pixelorama layer ${layerIndex + 1}`;
  if (!isRecord(value)) {
    fail("invalid-project", `${path} must be an object.`);
  }
  assertAllowedFields(value, LAYER_FIELDS, path);
  for (const field of LAYER_FIELDS) {
    assertRequiredField(value, field, path);
  }

  if (value.type !== 0) {
    fail(
      "unsupported-feature",
      `${path} uses unsupported layer type ${JSON.stringify(value.type)}; only pixel layers are supported.`,
    );
  }
  if (value.blend_mode !== 0) {
    fail("unsupported-feature", `${path} uses unsupported blend mode ${JSON.stringify(value.blend_mode)}.`);
  }
  if (value.clipping_mask !== false) {
    fail("unsupported-feature", `${path}.clipping_mask is unsupported and must be false.`);
  }
  if (value.parent !== -1) {
    fail("unsupported-feature", `${path} layer hierarchy is unsupported.`);
  }
  if (!Array.isArray(value.effects)) {
    fail("invalid-project", `${path}.effects must be an array.`);
  }
  if (value.effects.length !== 0) {
    fail("unsupported-feature", `${path}.effects are unsupported and must be empty.`);
  }
  expectEmptyRecord(value.metadata, `${path}.metadata`);
  if (value.new_cels_linked !== false) {
    fail("unsupported-feature", `${path}.new_cels_linked is unsupported and must be false.`);
  }

  const name = expectString(value.name, `${path}.name`);
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
  if (typeof value.locked !== "boolean") {
    fail("invalid-project", `${path}.locked must be a boolean.`);
  }
  expectString(value.ui_color, `${path}.ui_color`);

  return {
    name,
    opacity: Math.round(value.opacity * 255),
    visible: value.visible,
  };
}

function parseFrame(
  value: unknown,
  frameIndex: number,
  layerCount: number,
): { duration: number } {
  const path = `Pixelorama frame ${frameIndex + 1}`;
  if (!isRecord(value)) {
    fail("invalid-project", `${path} must be an object.`);
  }
  assertAllowedFields(value, FRAME_FIELDS, path);
  assertRequiredField(value, "cels", path);
  assertRequiredField(value, "duration", path);
  assertRequiredField(value, "metadata", path);
  expectEmptyRecord(value.metadata, `${path}.metadata`);
  if (value.user_data !== undefined) {
    expectEmptyString(value.user_data, `${path}.user_data`);
  }
  if (
    typeof value.duration !== "number" ||
    !Number.isFinite(value.duration) ||
    value.duration <= 0
  ) {
    fail("invalid-project", `${path}.duration must be a finite number greater than zero.`);
  }
  if (!Array.isArray(value.cels) || value.cels.length !== layerCount) {
    fail("invalid-project", `${path}.cels must contain exactly one cel per layer.`);
  }
  value.cels.forEach((cel, celIndex) => parseCel(cel, frameIndex, celIndex));

  return { duration: value.duration };
}

function parseCel(value: unknown, frameIndex: number, celIndex: number): void {
  const path = `Pixelorama frame ${frameIndex + 1} cel ${celIndex + 1}`;
  if (!isRecord(value)) {
    fail("invalid-project", `${path} must be an object.`);
  }
  assertAllowedFields(value, CEL_FIELDS, path);
  for (const field of ["metadata", "opacity", "ui_color", "z_index"]) {
    assertRequiredField(value, field, path);
  }
  expectEmptyRecord(value.metadata, `${path}.metadata`);
  if (value.user_data !== undefined) {
    expectEmptyString(value.user_data, `${path}.user_data`);
  }
  if (value.opacity !== 1) {
    fail("unsupported-feature", `${path}.opacity is unsupported and must be 1.`);
  }
  if (value.z_index !== 0) {
    fail("unsupported-feature", `${path}.z_index is unsupported and must be 0.`);
  }
  expectString(value.ui_color, `${path}.ui_color`);
}

function frameDurationMs(duration: number, fps: number): number {
  return normalizeFrameDurationMs((duration * 1000) / fps);
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

function assertNoUnsupportedImageData(entries: Map<string, ZipEntry>): void {
  for (const [name, entry] of entries) {
    if (entry.isDirectory) continue;
    if (name.startsWith("tilesets/")) {
      fail("unsupported-feature", "Pixelorama tile sets and tilemap data are unsupported.");
    }
    if (name.includes("tilemap") || name.includes("tile_mask")) {
      fail("unsupported-feature", `Pixelorama ZIP entry ${JSON.stringify(name)} contains unsupported tilemap data.`);
    }
  }
}

function parseStrictPositiveInteger(source: string): number | null {
  if (!/^(?:0|[1-9]\d*)$/u.test(source)) {
    return null;
  }
  const parsed = Number(source);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function assertArchiveEntriesMatchProject(
  entries: Map<string, ZipEntry>,
  parsed: ParsedPixelorama,
): void {
  for (const [name, entry] of entries) {
    if (entry.isDirectory) {
      fail(
        "unsupported-feature",
        `Pixelorama ZIP entry ${JSON.stringify(name)} is an unsupported directory entry.`,
      );
    }
    if (name === "data.json" || name === "mimetype" || name === "preview.png") {
      continue;
    }
    if (name.startsWith("image_data/final_images/")) {
      continue;
    }

    const celMatch = /^image_data\/frames\/([^/]+)\/(indices_)?layer_([^/]+)$/u
      .exec(name);
    if (celMatch !== null) {
      const frameNumber = parseStrictPositiveInteger(celMatch[1]);
      const layerNumber = parseStrictPositiveInteger(celMatch[3]);
      if (
        frameNumber !== null &&
        layerNumber !== null &&
        frameNumber >= 1 &&
        frameNumber <= parsed.frames.length &&
        layerNumber >= 1 &&
        layerNumber <= parsed.layers.length
      ) {
        continue;
      }
      fail(
        "unsupported-feature",
        `Pixelorama ZIP entry ${JSON.stringify(name)} contains out-of-range cel data.`,
      );
    }

    fail(
      "unsupported-feature",
      `Pixelorama ZIP entry ${JSON.stringify(name)} is unsupported by this importer subset.`,
    );
  }
}

function createProjectFromParsed(
  parsed: ParsedPixelorama,
  entries: Map<string, ZipEntry>,
): SpriteProject {
  const rawCelByteLength = parsed.width * parsed.height * 4;
  const frames = parsed.frames.map((frame, index) => ({
    index,
    durationMs: frameDurationMs(frame.duration, parsed.fps),
  }));
  const layers = parsed.layers.map((layer, layerIndex) => {
    const cels: SpriteCel[] = parsed.frames.map((_frame, frameIndex) => {
      const path = `image_data/frames/${frameIndex + 1}/layer_${layerIndex + 1}`;
      const entry = requireEntry(entries, path);
      if (entry.content.length !== rawCelByteLength) {
        fail(
          "invalid-container",
          `Pixelorama ZIP entry ${JSON.stringify(path)} must contain exactly ${rawCelByteLength} RGBA bytes.`,
        );
      }
      return {
        frameIndex,
        imageData: rawCelToImageData(entry.content, parsed.width, parsed.height),
        x: 0,
        y: 0,
      };
    });

    return {
      cels,
      id: `pixelorama-layer-${layerIndex}`,
      name: layer.name,
      opacity: layer.opacity,
      visible: layer.visible,
    };
  });

  return {
    colorMode: "rgba",
    frames,
    height: parsed.height,
    layers,
    width: parsed.width,
  };
}

/** Parses the documented Pixelorama .pxo ZIP subset locally. */
export async function importPixeloramaBytes(
  bytes: Uint8Array,
  dependencies: PixeloramaImportDependencies = {},
): Promise<SpriteProject> {
  if (bytes.byteLength > MAX_FILE_BYTES) {
    fail(
      "file-too-large",
      `Pixelorama file exceeds the ${MAX_FILE_BYTES}-byte import limit.`,
    );
  }

  const { entries } = await readZipArchive(bytes, dependencies);
  assertPixeloramaMimetype(entries);
  assertNoUnsupportedImageData(entries);

  const dataJsonEntry = requireEntry(entries, "data.json");
  if (dataJsonEntry.content.length > MAX_DATA_JSON_BYTES) {
    fail(
      "allocation-limit",
      `Pixelorama data.json exceeds the ${MAX_DATA_JSON_BYTES}-byte import limit.`,
    );
  }

  const parsed = parseProjectJson(
    decodeUtf8(dataJsonEntry.content, "Pixelorama data.json"),
  );
  assertArchiveEntriesMatchProject(entries, parsed);
  return createProjectFromParsed(parsed, entries);
}

/** Reads a browser-selected .pxo file without uploading or remotely fetching it. */
export async function importPixelorama(
  file: File,
  dependencies: PixeloramaImportDependencies = {},
): Promise<SpriteProject> {
  if (file.size > MAX_FILE_BYTES) {
    fail(
      "file-too-large",
      `Pixelorama file exceeds the ${MAX_FILE_BYTES}-byte import limit.`,
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    throw new PixeloramaImportError(
      "file-read",
      "Could not read the selected Pixelorama file.",
      { cause: error },
    );
  }

  return importPixeloramaBytes(bytes, dependencies);
}
