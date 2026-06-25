import type { SpriteProject } from "../../SpriteProject";

const OPENRASTER_MIMETYPE = "image/openraster";
const DEFAULT_FRAME_DURATION_MS = 100;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 4096;
const MAX_STACK_XML_BYTES = 1024 * 1024;
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_ARCHIVE_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_DIMENSION = 4096;
const MAX_CANVAS_PIXELS = 16_777_216;
const MAX_LAYERS = 256;
const MAX_TOTAL_LAYER_PIXELS = 67_108_864;
const MAX_PATH_LENGTH = 512;
const INT16_MIN = -0x8000;
const INT16_MAX = 0x7fff;
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_STORED = 0;
const ZIP_DEFLATED = 8;
const ZIP_FLAG_ENCRYPTED = 1;
const ZIP64_SENTINEL = 0xffffffff;
const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export type OpenRasterImportErrorCode =
  | "allocation-limit"
  | "browser-image-decode"
  | "browser-unsupported"
  | "file-read"
  | "file-too-large"
  | "invalid-container"
  | "invalid-mimetype"
  | "invalid-png"
  | "invalid-stack"
  | "missing-entry"
  | "unsafe-path"
  | "unsupported-feature"
  | "unsupported-zip";

export class OpenRasterImportError extends Error {
  constructor(
    readonly code: OpenRasterImportErrorCode,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "OpenRasterImportError";
  }
}

/** Returns importer-authored detail only; arbitrary thrown values stay private. */
export function getOpenRasterImportDiagnostic(error: unknown): string | null {
  return error instanceof OpenRasterImportError ? error.message : null;
}

export type OpenRasterImportDependencies = {
  decodePng?: (pngBytes: Uint8Array) => Promise<ImageData>;
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

type XmlElement = {
  attributes: Map<string, string>;
  children: XmlElement[];
  name: string;
};

type ParsedOpenRasterLayer = {
  name: string;
  opacity: number;
  src: string;
  visible: boolean;
  x: number;
  y: number;
};

type ParsedOpenRasterStack = {
  height: number;
  layers: ParsedOpenRasterLayer[];
  width: number;
};

function fail(code: OpenRasterImportErrorCode, message: string): never {
  throw new OpenRasterImportError(code, message);
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

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
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
    throw new OpenRasterImportError(
      "invalid-container",
      `${description} must be valid UTF-8.`,
      { cause: error },
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
      `OpenRaster ZIP entry ${JSON.stringify(path)} is not a safe relative archive path.`,
    );
  }
}

function assertSafeLayerPath(path: string, layerNumber: number): void {
  if (isUnsafePath(path, false)) {
    fail(
      "unsafe-path",
      `OpenRaster layer ${layerNumber} src must be a normalized relative archive path.`,
    );
  }
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  if (bytes.length < 22) {
    fail("invalid-container", "OpenRaster ZIP end-of-central-directory record is missing.");
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

  fail("invalid-container", "OpenRaster ZIP end-of-central-directory record is missing.");
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
    fail("unsupported-zip", "OpenRaster ZIP archives must not use multi-disk layout.");
  }
  if (entryCount === 0xffff || centralDirectorySize === ZIP64_SENTINEL) {
    fail("unsupported-zip", "OpenRaster ZIP64 archives are unsupported.");
  }
  if (entryCount === 0 || entryCount > MAX_ZIP_ENTRIES) {
    fail(
      "allocation-limit",
      `OpenRaster ZIP entry count must be from 1 through ${MAX_ZIP_ENTRIES}.`,
    );
  }
  if (centralDirectoryOffset > endOffset || centralDirectorySize > endOffset - centralDirectoryOffset) {
    fail("invalid-container", "OpenRaster ZIP central directory is outside the archive.");
  }

  const entries: CentralDirectoryEntry[] = [];
  const names = new Set<string>();
  let totalUncompressedBytes = 0;
  let offset = centralDirectoryOffset;
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;

  for (let index = 0; index < entryCount; index += 1) {
    requireRange(bytes, offset, 46, "OpenRaster ZIP central directory is truncated.");
    if (readUint32LE(bytes, offset) !== ZIP_CENTRAL_DIRECTORY_HEADER) {
      fail("invalid-container", "OpenRaster ZIP central directory is malformed.");
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
    requireRange(bytes, offset, recordLength, "OpenRaster ZIP central directory is truncated.");

    if (
      compressedSize === ZIP64_SENTINEL ||
      uncompressedSize === ZIP64_SENTINEL ||
      localHeaderOffset === ZIP64_SENTINEL
    ) {
      fail("unsupported-zip", "OpenRaster ZIP64 entries are unsupported.");
    }
    if ((flags & ZIP_FLAG_ENCRYPTED) !== 0) {
      fail("unsupported-zip", "Encrypted OpenRaster ZIP entries are unsupported.");
    }
    if (compressionMethod !== ZIP_STORED && compressionMethod !== ZIP_DEFLATED) {
      fail(
        "unsupported-zip",
        `OpenRaster ZIP entry uses unsupported compression method ${compressionMethod}.`,
      );
    }
    if (uncompressedSize > MAX_ENTRY_BYTES) {
      fail(
        "allocation-limit",
        `OpenRaster ZIP entry exceeds the ${MAX_ENTRY_BYTES}-byte import limit.`,
      );
    }
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > MAX_ARCHIVE_OUTPUT_BYTES) {
      fail(
        "allocation-limit",
        `OpenRaster ZIP uncompressed data exceeds the ${MAX_ARCHIVE_OUTPUT_BYTES}-byte import limit.`,
      );
    }

    const name = decodeUtf8(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
      "OpenRaster ZIP entry name",
    );
    assertSafeArchivePath(name);
    if (names.has(name)) {
      fail("invalid-container", `OpenRaster ZIP contains duplicate entry ${JSON.stringify(name)}.`);
    }
    names.add(name);

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
    fail("invalid-container", "OpenRaster ZIP central directory size is inconsistent.");
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
      "This browser does not support local OpenRaster ZIP decompression.",
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
      fail("invalid-container", "OpenRaster ZIP entry inflates beyond its declared size.");
    }
    output.set(value, length);
    length += value.length;
  }
}

async function readZipArchive(
  bytes: Uint8Array,
  dependencies: OpenRasterImportDependencies,
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
      "OpenRaster ZIP local file header is truncated.",
    );
    if (readUint32LE(bytes, entry.localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER) {
      fail("invalid-container", "OpenRaster ZIP local file header is malformed.");
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

    requireRange(bytes, nameOffset, localNameLength, "OpenRaster ZIP local file header is truncated.");
    requireRange(bytes, dataOffset, entry.compressedSize, "OpenRaster ZIP entry data is truncated.");
    if (dataEnd > nextHeaderOffset) {
      fail("invalid-container", "OpenRaster ZIP local entries overlap.");
    }
    if (localCompressionMethod !== entry.compressionMethod || localFlags !== entry.flags) {
      fail("invalid-container", "OpenRaster ZIP local and central metadata do not match.");
    }

    const localName = decodeUtf8(
      bytes.subarray(nameOffset, nameOffset + localNameLength),
      "OpenRaster ZIP local entry name",
    );
    if (localName !== entry.name) {
      fail("invalid-container", "OpenRaster ZIP local and central entry names do not match.");
    }

    const compressed = bytes.subarray(dataOffset, dataEnd);
    let content: Uint8Array;
    if (entry.compressionMethod === ZIP_STORED) {
      if (compressed.length !== entry.uncompressedSize) {
        fail("invalid-container", `OpenRaster ZIP entry ${JSON.stringify(entry.name)} has an invalid stored size.`);
      }
      content = compressed.slice();
    } else {
      try {
        content = await inflateRaw(compressed, entry.uncompressedSize);
      } catch (error) {
        if (error instanceof OpenRasterImportError) throw error;
        throw new OpenRasterImportError(
          "invalid-container",
          `Could not decompress OpenRaster ZIP entry ${JSON.stringify(entry.name)}.`,
          { cause: error },
        );
      }
    }

    if (!(content instanceof Uint8Array) || content.length !== entry.uncompressedSize) {
      fail(
        "invalid-container",
        `OpenRaster ZIP entry ${JSON.stringify(entry.name)} inflates to an unexpected size.`,
      );
    }
    if (crc32(content) !== entry.crc) {
      fail("invalid-container", `OpenRaster ZIP entry ${JSON.stringify(entry.name)} has an invalid CRC.`);
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

function bytesEqualText(bytes: Uint8Array, text: string): boolean {
  const expected = new TextEncoder().encode(text);
  return bytes.length === expected.length && expected.every((byte, index) => byte === bytes[index]);
}

function assertOpenRasterMimetype(orderedEntries: readonly ZipEntry[]): void {
  const first = orderedEntries[0];
  if (first === undefined || first.name !== "mimetype") {
    fail("invalid-mimetype", "OpenRaster ZIP must start with an uncompressed mimetype entry.");
  }
  if (first.compressionMethod !== ZIP_STORED) {
    fail("invalid-mimetype", "OpenRaster mimetype entry must be stored without compression.");
  }
  if (!bytesEqualText(first.content, OPENRASTER_MIMETYPE)) {
    fail("invalid-mimetype", `OpenRaster mimetype must be exactly ${JSON.stringify(OPENRASTER_MIMETYPE)}.`);
  }
}

function xmlError(message = "OpenRaster stack.xml is malformed XML."): never {
  fail("invalid-stack", message);
}

function isNameStart(character: string): boolean {
  return /[A-Za-z_:]/u.test(character);
}

function isNameCharacter(character: string): boolean {
  return /[A-Za-z0-9_.:-]/u.test(character);
}

function readXmlName(source: string, offset: number): { name: string; offset: number } {
  if (!isNameStart(source[offset] ?? "")) {
    xmlError();
  }
  let end = offset + 1;
  while (end < source.length && isNameCharacter(source[end])) {
    end += 1;
  }
  return { name: source.slice(offset, end), offset: end };
}

function decodeXmlAttributeValue(value: string): string {
  if (value.includes("<")) {
    xmlError();
  }

  let decoded = "";
  let offset = 0;
  while (offset < value.length) {
    const entityStart = value.indexOf("&", offset);
    if (entityStart === -1) {
      decoded += value.slice(offset);
      break;
    }
    decoded += value.slice(offset, entityStart);
    const entityEnd = value.indexOf(";", entityStart + 1);
    if (entityEnd === -1) {
      xmlError();
    }
    const entity = value.slice(entityStart + 1, entityEnd);
    if (entity === "amp") decoded += "&";
    else if (entity === "lt") decoded += "<";
    else if (entity === "gt") decoded += ">";
    else if (entity === "quot") decoded += "\"";
    else if (entity === "apos") decoded += "'";
    else if (entity.startsWith("#x")) {
      decoded += decodeXmlNumericEntity(entity.slice(2), 16);
    } else if (entity.startsWith("#")) {
      decoded += decodeXmlNumericEntity(entity.slice(1), 10);
    } else {
      xmlError();
    }
    offset = entityEnd + 1;
  }
  return decoded;
}

function decodeXmlNumericEntity(source: string, radix: 10 | 16): string {
  if (!/^[0-9A-Fa-f]+$/u.test(source)) {
    xmlError();
  }
  const codePoint = Number.parseInt(source, radix);
  if (
    !Number.isInteger(codePoint) ||
    codePoint <= 0 ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    xmlError();
  }
  return String.fromCodePoint(codePoint);
}

function parseXmlAttributes(source: string, offset: number): Map<string, string> {
  const attributes = new Map<string, string>();
  let position = offset;

  while (position < source.length) {
    while (/\s/u.test(source[position] ?? "")) position += 1;
    if (position >= source.length) break;

    const parsedName = readXmlName(source, position);
    position = parsedName.offset;
    while (/\s/u.test(source[position] ?? "")) position += 1;
    if (source[position] !== "=") xmlError();
    position += 1;
    while (/\s/u.test(source[position] ?? "")) position += 1;

    const quote = source[position];
    if (quote !== "\"" && quote !== "'") xmlError();
    const valueStart = position + 1;
    const valueEnd = source.indexOf(quote, valueStart);
    if (valueEnd === -1) xmlError();
    if (attributes.has(parsedName.name)) {
      xmlError();
    }
    attributes.set(
      parsedName.name,
      decodeXmlAttributeValue(source.slice(valueStart, valueEnd)),
    );
    position = valueEnd + 1;
  }

  return attributes;
}

function findTagEnd(source: string, offset: number): number {
  let quote: string | null = null;
  for (let index = offset; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  xmlError();
}

function parseXmlDocument(source: string): XmlElement {
  let root: XmlElement | undefined;
  const stack: XmlElement[] = [];
  let offset = 0;

  while (offset < source.length) {
    const nextTag = source.indexOf("<", offset);
    if (nextTag === -1) {
      if (source.slice(offset).trim().length !== 0) xmlError();
      break;
    }
    if (source.slice(offset, nextTag).trim().length !== 0) xmlError();
    offset = nextTag;

    if (source.startsWith("<!--", offset)) {
      const end = source.indexOf("-->", offset + 4);
      if (end === -1) xmlError();
      offset = end + 3;
      continue;
    }
    if (source.startsWith("<?", offset)) {
      const end = source.indexOf("?>", offset + 2);
      if (end === -1) xmlError();
      offset = end + 2;
      continue;
    }
    if (source.startsWith("<!", offset)) {
      fail(
        "invalid-stack",
        "OpenRaster stack.xml must not contain DTD, entity, or external declarations.",
      );
    }
    if (source.startsWith("</", offset)) {
      const end = source.indexOf(">", offset + 2);
      if (end === -1) xmlError();
      const closeName = source.slice(offset + 2, end).trim();
      if (closeName.length === 0 || /\s/u.test(closeName)) xmlError();
      const open = stack.pop();
      if (open === undefined || open.name !== closeName) xmlError();
      offset = end + 1;
      continue;
    }

    const tagEnd = findTagEnd(source, offset + 1);
    let tag = source.slice(offset + 1, tagEnd).trim();
    const selfClosing = tag.endsWith("/");
    if (selfClosing) {
      tag = tag.slice(0, -1).trimEnd();
    }
    const parsedName = readXmlName(tag, 0);
    const element: XmlElement = {
      attributes: parseXmlAttributes(tag, parsedName.offset),
      children: [],
      name: parsedName.name,
    };

    if (stack.length === 0) {
      if (root !== undefined) xmlError();
      root = element;
    } else {
      stack[stack.length - 1].children.push(element);
    }
    if (!selfClosing) {
      stack.push(element);
    }
    offset = tagEnd + 1;
  }

  if (stack.length !== 0) xmlError();
  if (root === undefined) {
    fail("invalid-stack", "OpenRaster stack.xml must contain a root <image> element.");
  }
  return root;
}

function isAnimationMetadataName(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    normalized === "animation" ||
    normalized === "animations" ||
    normalized === "frame" ||
    normalized === "frames" ||
    normalized === "keyframe" ||
    normalized === "timeline"
  );
}

function assertAllowedAttributes(
  element: XmlElement,
  allowedAttributes: ReadonlySet<string>,
  path: string,
): void {
  for (const attribute of element.attributes.keys()) {
    if (allowedAttributes.has(attribute)) continue;
    if (isAnimationMetadataName(attribute) || attribute === "duration") {
      fail(
        "unsupported-feature",
        "OpenRaster animation metadata is unsupported by this single-frame importer.",
      );
    }
    fail(
      "unsupported-feature",
      `${path} contains unsupported attribute ${JSON.stringify(attribute)}.`,
    );
  }
}

function parsePositiveInteger(
  value: string | undefined,
  path: string,
  maximum: number,
): number {
  if (value === undefined || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    fail("invalid-stack", `${path} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    fail("allocation-limit", `${path} must be an integer from 1 through ${maximum}.`);
  }
  return parsed;
}

function parseSignedInteger(
  value: string | undefined,
  path: string,
  minimum: number,
  maximum: number,
): number {
  const source = value ?? "0";
  if (!/^-?(?:0|[1-9]\d*)$/u.test(source)) {
    fail("invalid-stack", `${path} must be a signed integer.`);
  }
  const parsed = Number(source);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail("invalid-stack", `${path} must be an integer from ${minimum} through ${maximum}.`);
  }
  return parsed;
}

function parseOpacity(value: string | undefined, path: string): number {
  if (value === undefined) return 255;
  if (!/^(?:0|0\.\d+|1|1\.0+)$/u.test(value)) {
    fail("invalid-stack", `${path} must be a number from 0.0 through 1.0.`);
  }
  return Math.round(Number(value) * 255);
}

function parseVisibility(value: string | undefined, path: string): boolean {
  if (value === undefined || value === "visible") return true;
  if (value === "hidden") return false;
  fail("invalid-stack", `${path} must be "visible" or "hidden".`);
}

function parseOpenRasterLayer(
  element: XmlElement,
  layerIndex: number,
): ParsedOpenRasterLayer {
  const layerNumber = layerIndex + 1;
  const path = `OpenRaster layer ${layerNumber}`;
  assertAllowedAttributes(
    element,
    new Set(["composite-op", "name", "opacity", "src", "visibility", "x", "y"]),
    path,
  );

  if (element.children.length > 0) {
    fail(
      "unsupported-feature",
      "OpenRaster layer masks, effects, and nested layer content are unsupported.",
    );
  }

  const compositeOp = element.attributes.get("composite-op");
  if (compositeOp !== undefined && compositeOp !== "svg:src-over") {
    fail(
      "unsupported-feature",
      `OpenRaster layer ${layerNumber} uses unsupported blend mode ${JSON.stringify(compositeOp)}.`,
    );
  }

  const src = element.attributes.get("src");
  if (src === undefined) {
    fail("invalid-stack", `${path}.src is required.`);
  }
  assertSafeLayerPath(src, layerNumber);

  const name = element.attributes.get("name") ?? `Layer ${layerNumber}`;
  if (name.trim().length === 0) {
    fail("invalid-stack", `${path}.name must not be empty.`);
  }

  return {
    name,
    opacity: parseOpacity(element.attributes.get("opacity"), `${path}.opacity`),
    src,
    visible: parseVisibility(element.attributes.get("visibility"), `${path}.visibility`),
    x: parseSignedInteger(element.attributes.get("x"), `${path}.x`, INT16_MIN, INT16_MAX),
    y: parseSignedInteger(element.attributes.get("y"), `${path}.y`, INT16_MIN, INT16_MAX),
  };
}

function parseStackXml(stackXml: string): ParsedOpenRasterStack {
  const root = parseXmlDocument(stackXml);
  if (root.name !== "image") {
    fail("invalid-stack", "OpenRaster stack.xml root must be <image>.");
  }
  assertAllowedAttributes(
    root,
    new Set(["h", "version", "w", "xres", "yres"]),
    "OpenRaster image",
  );

  const width = parsePositiveInteger(root.attributes.get("w"), "OpenRaster image.w", MAX_DIMENSION);
  const height = parsePositiveInteger(root.attributes.get("h"), "OpenRaster image.h", MAX_DIMENSION);
  const canvasPixels = width * height;
  if (canvasPixels > MAX_CANVAS_PIXELS) {
    fail(
      "allocation-limit",
      `OpenRaster canvas contains ${canvasPixels} pixels; the limit is ${MAX_CANVAS_PIXELS}.`,
    );
  }

  const animationChild = root.children.find((child) => isAnimationMetadataName(child.name));
  if (animationChild !== undefined) {
    fail(
      "unsupported-feature",
      "OpenRaster animation metadata is unsupported by this single-frame importer.",
    );
  }
  if (root.children.length !== 1 || root.children[0].name !== "stack") {
    fail("invalid-stack", "OpenRaster stack.xml must contain exactly one root <stack>.");
  }

  const rootStack = root.children[0];
  assertAllowedAttributes(rootStack, new Set(["name"]), "OpenRaster root stack");
  if (rootStack.children.length === 0) {
    fail("invalid-stack", "OpenRaster root stack must contain at least one layer.");
  }
  if (rootStack.children.length > MAX_LAYERS) {
    fail(
      "allocation-limit",
      `OpenRaster layer count must be from 1 through ${MAX_LAYERS}.`,
    );
  }

  const layers = rootStack.children.map((child, index) => {
    if (isAnimationMetadataName(child.name)) {
      fail(
        "unsupported-feature",
        "OpenRaster animation metadata is unsupported by this single-frame importer.",
      );
    }
    if (child.name === "stack") {
      fail("unsupported-feature", "OpenRaster nested stacks and layer groups are unsupported.");
    }
    if (child.name !== "layer") {
      fail(
        "unsupported-feature",
        `OpenRaster root stack contains unsupported element <${child.name}>.`,
      );
    }
    return parseOpenRasterLayer(child, index);
  });

  return { height, layers, width };
}

function readPngMetadata(bytes: Uint8Array, path: string): { height: number; width: number } {
  if (
    bytes.length < 33 ||
    PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)
  ) {
    fail("invalid-png", `${path} is not a PNG file.`);
  }

  let offset = PNG_SIGNATURE.length;
  let width: number | undefined;
  let height: number | undefined;
  let sawIend = false;

  while (offset < bytes.length) {
    if (bytes.length - offset < 12) {
      fail("invalid-png", `${path} contains a truncated PNG chunk.`);
    }
    const length = readUint32BE(bytes, offset);
    const dataOffset = offset + 8;
    if (length > bytes.length - dataOffset - 4) {
      fail("invalid-png", `${path} contains a truncated PNG chunk.`);
    }
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );

    if (offset === PNG_SIGNATURE.length) {
      if (type !== "IHDR" || length !== 13) {
        fail("invalid-png", `${path} PNG IHDR chunk is invalid.`);
      }
      width = readUint32BE(bytes, dataOffset);
      height = readUint32BE(bytes, dataOffset + 4);
      if (width < 1 || width > MAX_DIMENSION || height < 1 || height > MAX_DIMENSION) {
        fail(
          "allocation-limit",
          `${path} PNG dimensions must be from 1x1 through ${MAX_DIMENSION}x${MAX_DIMENSION}.`,
        );
      }
      const pixels = width * height;
      if (pixels > MAX_CANVAS_PIXELS) {
        fail(
          "allocation-limit",
          `${path} PNG contains ${pixels} pixels; the limit is ${MAX_CANVAS_PIXELS}.`,
        );
      }
    } else if (type === "IHDR") {
      fail("invalid-png", `${path} contains duplicate PNG IHDR chunks.`);
    } else if (type === "acTL") {
      fail(
        "unsupported-feature",
        "Animated PNG layer data is unsupported by the OpenRaster importer.",
      );
    }

    offset = dataOffset + length + 4;
    if (type === "IEND") {
      if (length !== 0 || offset !== bytes.length) {
        fail("invalid-png", `${path} PNG IEND chunk is invalid.`);
      }
      sawIend = true;
      break;
    }
  }

  if (!sawIend || width === undefined || height === undefined) {
    fail("invalid-png", `${path} is missing PNG image data.`);
  }
  return { height, width };
}

function isValidDecodedImage(
  image: unknown,
  expectedWidth: number,
  expectedHeight: number,
): image is ImageData {
  if (typeof image !== "object" || image === null) return false;
  const candidate = image as Partial<ImageData>;
  return (
    candidate.width === expectedWidth &&
    candidate.height === expectedHeight &&
    (candidate.colorSpace === "srgb" || candidate.colorSpace === "display-p3") &&
    candidate.data instanceof Uint8ClampedArray &&
    candidate.data.length === expectedWidth * expectedHeight * 4
  );
}

async function decodePngInBrowser(pngBytes: Uint8Array): Promise<ImageData> {
  const bitmap = await createImageBitmap(
    new Blob([new Uint8Array(pngBytes)], { type: "image/png" }),
  );

  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) {
      throw new Error("A browser canvas context is required to decode OpenRaster PNG data.");
    }
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

function requireEntry(entries: Map<string, ZipEntry>, name: string): ZipEntry {
  const entry = entries.get(name);
  if (entry === undefined || entry.isDirectory) {
    fail("missing-entry", `OpenRaster ZIP is missing required entry ${JSON.stringify(name)}.`);
  }
  return entry;
}

/** Parses and decodes the documented single-frame OpenRaster subset locally. */
export async function importOpenRasterBytes(
  bytes: Uint8Array,
  dependencies: OpenRasterImportDependencies = {},
): Promise<SpriteProject> {
  if (bytes.byteLength > MAX_FILE_BYTES) {
    fail(
      "file-too-large",
      `OpenRaster file exceeds the ${MAX_FILE_BYTES}-byte import limit.`,
    );
  }

  const { entries, orderedEntries } = await readZipArchive(bytes, dependencies);
  assertOpenRasterMimetype(orderedEntries);
  const stackEntry = requireEntry(entries, "stack.xml");
  if (stackEntry.content.length > MAX_STACK_XML_BYTES) {
    fail(
      "allocation-limit",
      `OpenRaster stack.xml exceeds the ${MAX_STACK_XML_BYTES}-byte import limit.`,
    );
  }

  const parsed = parseStackXml(decodeUtf8(stackEntry.content, "OpenRaster stack.xml"));
  const decodePng = dependencies.decodePng ?? decodePngInBrowser;
  const layers: SpriteProject["layers"] = [];
  let totalLayerPixels = 0;

  for (const [layerIndex, layer] of parsed.layers.entries()) {
    const layerEntry = requireEntry(entries, layer.src);
    const pngMetadata = readPngMetadata(layerEntry.content, layer.src);
    totalLayerPixels += pngMetadata.width * pngMetadata.height;
    if (totalLayerPixels > MAX_TOTAL_LAYER_PIXELS) {
      fail(
        "allocation-limit",
        `OpenRaster decoded layer pixels exceed the ${MAX_TOTAL_LAYER_PIXELS}-pixel import limit.`,
      );
    }

    let imageData: ImageData;
    try {
      imageData = await decodePng(layerEntry.content);
    } catch (error) {
      throw new OpenRasterImportError(
        "browser-image-decode",
        `Could not decode PNG data for OpenRaster layer ${layerIndex + 1} (${layer.src}).`,
        { cause: error },
      );
    }
    if (!isValidDecodedImage(imageData, pngMetadata.width, pngMetadata.height)) {
      fail(
        "invalid-png",
        `Decoded PNG for OpenRaster layer ${layerIndex + 1} must contain ` +
          `${pngMetadata.width}x${pngMetadata.height} RGBA pixels.`,
      );
    }

    layers.push({
      cels: [
        {
          frameIndex: 0,
          imageData,
          x: layer.x,
          y: layer.y,
        },
      ],
      id: `openraster-layer-${layerIndex}`,
      name: layer.name,
      opacity: layer.opacity,
      visible: layer.visible,
    });
  }

  return {
    colorMode: "rgba",
    frames: [{ index: 0, durationMs: DEFAULT_FRAME_DURATION_MS }],
    height: parsed.height,
    layers,
    width: parsed.width,
  };
}

/** Reads a browser-selected .ora file without uploading or remotely fetching it. */
export async function importOpenRaster(
  file: File,
  dependencies: OpenRasterImportDependencies = {},
): Promise<SpriteProject> {
  if (file.size > MAX_FILE_BYTES) {
    fail(
      "file-too-large",
      `OpenRaster file exceeds the ${MAX_FILE_BYTES}-byte import limit.`,
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    throw new OpenRasterImportError(
      "file-read",
      "Could not read the selected OpenRaster file.",
      { cause: error },
    );
  }

  return importOpenRasterBytes(bytes, dependencies);
}
