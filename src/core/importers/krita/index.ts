import type { SpriteProject } from "../../SpriteProject";

const KRITA_MIMETYPE = "application/x-krita";
const KRITA_IMAGE_MIME = "application/x-kra";
const SUPPORTED_PROFILE = "sRGB-elle-V2-srgbtrc.icc";
const DEFAULT_FRAME_DURATION_MS = 100;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_MAINDOC_XML_BYTES = 5 * 1024 * 1024;
const MAX_ARCHIVE_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_DECODED_PIXEL_BYTES = 64 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 512;
const MAX_DIMENSION = 1024;
const MAX_LAYERS = 64;
const MAX_TILE_RECORDS = 1024;
const MAX_STRING_LENGTH = 1024;
const MAX_PATH_LENGTH = 1024;
const TILE_WIDTH = 64;
const TILE_HEIGHT = 64;
const PIXEL_SIZE = 4;
const RAW_TILE_PAYLOAD_BYTES = 1 + TILE_WIDTH * TILE_HEIGHT * PIXEL_SIZE;
const INT16_MIN = -0x8000;
const INT16_MAX = 0x7fff;
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_STORED = 0;
const ZIP_DEFLATED = 8;
const ZIP_FLAG_ENCRYPTED = 1;
const ZIP_FLAG_DATA_DESCRIPTOR = 8;
const ZIP_FLAG_UTF8 = 0x0800;
const ZIP64_SENTINEL = 0xffffffff;

export type KritaImportErrorCode =
  | "allocation-limit"
  | "browser-unsupported"
  | "file-read"
  | "file-too-large"
  | "invalid-container"
  | "invalid-maindoc"
  | "invalid-mimetype"
  | "invalid-layer-data"
  | "missing-entry"
  | "unsafe-path"
  | "unsupported-feature"
  | "unsupported-zip";

export class KritaImportError extends Error {
  constructor(
    readonly code: KritaImportErrorCode,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "KritaImportError";
  }
}

/** Returns importer-authored detail only; arbitrary thrown values stay private. */
export function getKritaImportDiagnostic(error: unknown): string | null {
  return error instanceof KritaImportError ? error.message : null;
}

export type KritaImportDependencies = {
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
  selfClosing: boolean;
};

type ParsedKritaLayer = {
  filename: string;
  name: string;
  opacity: number;
  visible: boolean;
  x: number;
  y: number;
};

type ParsedKritaDocument = {
  height: number;
  imageName: string;
  layers: ParsedKritaLayer[];
  width: number;
};

function fail(code: KritaImportErrorCode, message: string): never {
  throw new KritaImportError(code, message);
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
    throw new KritaImportError(
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

function isUnsafePathComponent(value: string): boolean {
  return (
    value.length === 0 ||
    value.length > MAX_STRING_LENGTH ||
    value.includes("\0") ||
    value.includes("/") ||
    value.includes("\\") ||
    value === "." ||
    value === ".." ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)
  );
}

function assertSafeArchivePath(path: string): void {
  if (isUnsafePath(path, true)) {
    fail(
      "unsafe-path",
      `Krita ZIP entry ${JSON.stringify(path)} is not a safe relative archive path.`,
    );
  }
}

function assertSafeImageName(name: string): void {
  if (isUnsafePathComponent(name)) {
    fail(
      "unsafe-path",
      "Krita IMAGE.name must be a safe archive path component.",
    );
  }
}

function assertSafeLayerFilename(filename: string, layerNumber: number): void {
  if (isUnsafePathComponent(filename)) {
    fail(
      "unsafe-path",
      `Krita layer ${layerNumber}.filename must be a safe archive path component.`,
    );
  }
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  if (bytes.length < 22) {
    fail("invalid-container", "Krita ZIP end-of-central-directory record is missing.");
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

  fail("invalid-container", "Krita ZIP end-of-central-directory record is missing.");
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
    fail("unsupported-zip", "Krita ZIP archives must not use multi-disk layout.");
  }
  if (
    entryCount === 0xffff ||
    centralDirectorySize === ZIP64_SENTINEL ||
    centralDirectoryOffset === ZIP64_SENTINEL
  ) {
    fail("unsupported-zip", "Krita ZIP64 archives are unsupported.");
  }
  if (entryCount === 0 || entryCount > MAX_ZIP_ENTRIES) {
    fail(
      "allocation-limit",
      `Krita ZIP entry count must be from 1 through ${MAX_ZIP_ENTRIES}.`,
    );
  }
  if (
    centralDirectoryOffset > endOffset ||
    centralDirectorySize > endOffset - centralDirectoryOffset
  ) {
    fail("invalid-container", "Krita ZIP central directory is outside the archive.");
  }

  const entries: CentralDirectoryEntry[] = [];
  const names = new Set<string>();
  let totalUncompressedBytes = 0;
  let offset = centralDirectoryOffset;
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;

  for (let index = 0; index < entryCount; index += 1) {
    requireRange(bytes, offset, 46, "Krita ZIP central directory is truncated.");
    if (readUint32LE(bytes, offset) !== ZIP_CENTRAL_DIRECTORY_HEADER) {
      fail("invalid-container", "Krita ZIP central directory is malformed.");
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
    requireRange(bytes, offset, recordLength, "Krita ZIP central directory is truncated.");

    if (
      compressedSize === ZIP64_SENTINEL ||
      uncompressedSize === ZIP64_SENTINEL ||
      localHeaderOffset === ZIP64_SENTINEL
    ) {
      fail("unsupported-zip", "Krita ZIP64 entries are unsupported.");
    }
    if ((flags & ZIP_FLAG_ENCRYPTED) !== 0) {
      fail("unsupported-zip", "Encrypted Krita ZIP entries are unsupported.");
    }
    if ((flags & ZIP_FLAG_DATA_DESCRIPTOR) !== 0) {
      fail("unsupported-zip", "Krita ZIP data descriptors are unsupported.");
    }
    if ((flags & ~(ZIP_FLAG_UTF8)) !== 0) {
      fail("unsupported-zip", "Krita ZIP entry uses unsupported general-purpose flags.");
    }
    if (compressionMethod !== ZIP_STORED && compressionMethod !== ZIP_DEFLATED) {
      fail(
        "unsupported-zip",
        `Krita ZIP entry uses unsupported compression method ${compressionMethod}.`,
      );
    }

    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > MAX_ARCHIVE_OUTPUT_BYTES) {
      fail(
        "allocation-limit",
        `Krita ZIP uncompressed data exceeds the ${MAX_ARCHIVE_OUTPUT_BYTES}-byte import limit.`,
      );
    }

    const name = decodeUtf8(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
      "Krita ZIP entry name",
    );
    assertSafeArchivePath(name);
    const logicalName = name.endsWith("/") ? name.slice(0, -1) : name;
    if (names.has(logicalName)) {
      fail("invalid-container", `Krita ZIP contains duplicate entry ${JSON.stringify(logicalName)}.`);
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
    fail("invalid-container", "Krita ZIP central directory size is inconsistent.");
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
      "This browser does not support local Krita ZIP decompression.",
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
      fail("invalid-container", "Krita ZIP entry inflates beyond its declared size.");
    }
    output.set(value, length);
    length += value.length;
  }
}

async function readZipArchive(
  bytes: Uint8Array,
  dependencies: KritaImportDependencies,
): Promise<{ entries: Map<string, ZipEntry>; orderedEntries: ZipEntry[] }> {
  const { centralDirectoryOffset, entries: centralEntries } = parseCentralDirectory(bytes);
  const inflateRaw = dependencies.inflateRaw ?? inflateRawInBrowser;
  const entries = new Map<string, ZipEntry>();
  const orderedEntries: ZipEntry[] = [];

  for (const [index, entry] of centralEntries.entries()) {
    requireRange(bytes, entry.localHeaderOffset, 30, "Krita ZIP local file header is truncated.");
    if (readUint32LE(bytes, entry.localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER) {
      fail("invalid-container", "Krita ZIP local file header is malformed.");
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

    requireRange(bytes, nameOffset, localNameLength, "Krita ZIP local file header is truncated.");
    requireRange(bytes, dataOffset, entry.compressedSize, "Krita ZIP entry data is truncated.");
    if (dataEnd > nextHeaderOffset) {
      fail("invalid-container", "Krita ZIP local entries overlap.");
    }
    if (localCompressionMethod !== entry.compressionMethod || localFlags !== entry.flags) {
      fail("invalid-container", "Krita ZIP local and central metadata do not match.");
    }

    const localName = decodeUtf8(
      bytes.subarray(nameOffset, nameOffset + localNameLength),
      "Krita ZIP local entry name",
    );
    if (localName !== entry.name) {
      fail("invalid-container", "Krita ZIP local and central entry names do not match.");
    }

    const compressed = bytes.subarray(dataOffset, dataEnd);
    let content: Uint8Array;
    if (entry.compressionMethod === ZIP_STORED) {
      if (compressed.length !== entry.uncompressedSize) {
        fail("invalid-container", `Krita ZIP entry ${JSON.stringify(entry.name)} has an invalid stored size.`);
      }
      content = compressed.slice();
    } else {
      try {
        content = await inflateRaw(compressed, entry.uncompressedSize);
      } catch (error) {
        if (error instanceof KritaImportError) throw error;
        throw new KritaImportError(
          "invalid-container",
          `Could not decompress Krita ZIP entry ${JSON.stringify(entry.name)}.`,
          { cause: error },
        );
      }
    }

    if (!(content instanceof Uint8Array) || content.length !== entry.uncompressedSize) {
      fail(
        "invalid-container",
        `Krita ZIP entry ${JSON.stringify(entry.name)} inflates to an unexpected size.`,
      );
    }
    if (crc32(content) !== entry.crc) {
      fail("invalid-container", `Krita ZIP entry ${JSON.stringify(entry.name)} has an invalid CRC.`);
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
    fail("missing-entry", `Krita ZIP is missing required entry ${JSON.stringify(name)}.`);
  }
  return entry;
}

function assertKritaMimetype(orderedEntries: readonly ZipEntry[]): void {
  const first = orderedEntries[0];
  if (first === undefined || first.name !== "mimetype") {
    fail("invalid-mimetype", "Krita ZIP must start with an uncompressed mimetype entry.");
  }
  if (first.compressionMethod !== ZIP_STORED) {
    fail("invalid-mimetype", "Krita mimetype entry must be stored without compression.");
  }
  if (!bytesEqualText(first.content, KRITA_MIMETYPE)) {
    fail(
      "invalid-mimetype",
      `Krita mimetype must be exactly ${JSON.stringify(KRITA_MIMETYPE)}.`,
    );
  }
}

function xmlError(message = "Krita maindoc.xml is malformed XML."): never {
  fail("invalid-maindoc", message);
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
    else if (entity.startsWith("#x")) decoded += decodeXmlNumericEntity(entity.slice(2), 16);
    else if (entity.startsWith("#")) decoded += decodeXmlNumericEntity(entity.slice(1), 10);
    else xmlError();
    offset = entityEnd + 1;
  }
  return decoded;
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
    if (attributes.has(parsedName.name)) xmlError();

    const decoded = decodeXmlAttributeValue(source.slice(valueStart, valueEnd));
    if (decoded.length > MAX_STRING_LENGTH) {
      fail(
        "invalid-maindoc",
        `Krita XML attribute ${JSON.stringify(parsedName.name)} exceeds ${MAX_STRING_LENGTH} characters.`,
      );
    }
    attributes.set(parsedName.name, decoded);
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
        "invalid-maindoc",
        "Krita maindoc.xml must not contain DTD, entity, or external declarations.",
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
      selfClosing,
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
    fail("invalid-maindoc", "Krita maindoc.xml must contain a root <DOC> element.");
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
    normalized === "keyframes" ||
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
      fail("unsupported-feature", "Krita animation timelines are unsupported.");
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
    fail("invalid-maindoc", `${path} must be a positive integer.`);
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
    fail("invalid-maindoc", `${path} must be a signed integer.`);
  }
  const parsed = Number(source);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail("invalid-maindoc", `${path} must be an integer from ${minimum} through ${maximum}.`);
  }
  return parsed;
}

function parseByteInteger(value: string | undefined, path: string): number {
  if (value === undefined || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    fail("invalid-maindoc", `${path} must be an integer from 0 through 255.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 255) {
    fail("invalid-maindoc", `${path} must be an integer from 0 through 255.`);
  }
  return parsed;
}

function parseVisibility(value: string | undefined, path: string): boolean {
  if (value === undefined || value === "1") return true;
  if (value === "0") return false;
  fail("invalid-maindoc", `${path} must be "0" or "1".`);
}

function assertSupportedProfile(value: string | undefined, path: string): void {
  if (value !== undefined && value !== SUPPORTED_PROFILE) {
    fail(
      "unsupported-feature",
      `${path} uses unsupported color profile ${JSON.stringify(value)}.`,
    );
  }
}

function assertOptionalZero(value: string | undefined, path: string): void {
  if (value !== undefined && value !== "0") {
    fail("unsupported-feature", `${path} is unsupported and must be "0".`);
  }
}

function assertOptionalValue(
  value: string | undefined,
  expected: string,
  path: string,
  message: string,
): void {
  if (value !== undefined && value !== expected) {
    fail("unsupported-feature", message);
  }
}

function parseKritaLayer(element: XmlElement, layerIndex: number): ParsedKritaLayer {
  const layerNumber = layerIndex + 1;
  const path = `Krita layer ${layerNumber}`;
  assertAllowedAttributes(
    element,
    new Set([
      "channelflags",
      "channellockflags",
      "collapsed",
      "colorlabel",
      "colorspacename",
      "compositeop",
      "filename",
      "intimeline",
      "locked",
      "name",
      "nodetype",
      "onionskin",
      "opacity",
      "profile",
      "uuid",
      "visible",
      "x",
      "y",
    ]),
    path,
  );

  if (element.children.length > 0) {
    fail(
      "unsupported-feature",
      "Krita masks, effects, and nested layer content are unsupported.",
    );
  }
  if (!element.selfClosing) {
    fail("invalid-maindoc", "Krita paint layers must be direct self-closing <layer> elements.");
  }

  const nodeType = element.attributes.get("nodetype");
  if (nodeType !== "paintlayer") {
    fail(
      "unsupported-feature",
      `${path} uses unsupported layer type ${JSON.stringify(nodeType)}; only paintlayer is supported.`,
    );
  }

  const colorSpaceName = element.attributes.get("colorspacename");
  if (colorSpaceName !== "RGBA") {
    fail("unsupported-feature", `${path}.colorspacename must be RGBA (8-bit).`);
  }
  assertSupportedProfile(element.attributes.get("profile"), `${path}.profile`);

  const compositeOp = element.attributes.get("compositeop");
  if (compositeOp !== undefined && compositeOp !== "normal") {
    fail("unsupported-feature", `${path} uses unsupported compositeop ${JSON.stringify(compositeOp)}.`);
  }

  assertOptionalValue(
    element.attributes.get("channelflags"),
    "OOOO",
    `${path}.channelflags`,
    `${path}.channelflags contains unsupported disabled channels.`,
  );
  assertOptionalValue(
    element.attributes.get("channellockflags"),
    "OOOO",
    `${path}.channellockflags`,
    `${path}.channellockflags contains unsupported locked channels.`,
  );
  assertOptionalZero(element.attributes.get("locked"), `${path}.locked`);
  assertOptionalZero(element.attributes.get("collapsed"), `${path}.collapsed`);
  assertOptionalZero(element.attributes.get("colorlabel"), `${path}.colorlabel`);
  assertOptionalZero(element.attributes.get("intimeline"), `${path}.intimeline`);
  assertOptionalZero(element.attributes.get("onionskin"), `${path}.onionskin`);

  const filename = element.attributes.get("filename");
  if (filename === undefined) {
    fail("invalid-maindoc", `${path}.filename is required.`);
  }
  assertSafeLayerFilename(filename, layerNumber);

  const name = element.attributes.get("name") ?? `Layer ${layerNumber}`;
  if (name.trim().length === 0) {
    fail("invalid-maindoc", `${path}.name must not be empty.`);
  }

  return {
    filename,
    name,
    opacity: parseByteInteger(element.attributes.get("opacity"), `${path}.opacity`),
    visible: parseVisibility(element.attributes.get("visible"), `${path}.visible`),
    x: parseSignedInteger(element.attributes.get("x"), `${path}.x`, INT16_MIN, INT16_MAX),
    y: parseSignedInteger(element.attributes.get("y"), `${path}.y`, INT16_MIN, INT16_MAX),
  };
}

function parseKritaMaindocXml(maindocXml: string): ParsedKritaDocument {
  const root = parseXmlDocument(maindocXml);
  if (root.name !== "DOC") {
    fail("invalid-maindoc", "Krita maindoc.xml root must be <DOC>.");
  }
  assertAllowedAttributes(root, new Set(["depth", "editor", "syntaxVersion"]), "Krita DOC");
  if (root.attributes.get("editor") !== "krita") {
    fail("invalid-maindoc", "Krita DOC.editor must be \"krita\".");
  }
  if (root.attributes.get("syntaxVersion") !== "2.0") {
    fail("unsupported-feature", "Krita syntaxVersion must be 2.0 for this importer subset.");
  }
  if (root.attributes.get("depth") !== undefined && root.attributes.get("depth") !== "8") {
    fail("unsupported-feature", "Krita DOC.depth must be 8 for this importer subset.");
  }
  if (root.children.length !== 1 || root.children[0].name !== "IMAGE") {
    fail("invalid-maindoc", "Krita maindoc.xml must contain exactly one <IMAGE> child.");
  }

  const image = root.children[0];
  assertAllowedAttributes(
    image,
    new Set(["colorspacename", "height", "mime", "name", "profile", "width", "x-res", "y-res"]),
    "Krita IMAGE",
  );
  if (image.attributes.get("mime") !== KRITA_IMAGE_MIME) {
    fail("invalid-maindoc", `Krita IMAGE.mime must be ${JSON.stringify(KRITA_IMAGE_MIME)}.`);
  }
  const imageName = image.attributes.get("name");
  if (imageName === undefined) {
    fail("invalid-maindoc", "Krita IMAGE.name is required.");
  }
  assertSafeImageName(imageName);

  if (image.attributes.get("colorspacename") !== "RGBA") {
    fail("unsupported-feature", "Krita IMAGE.colorspacename must be RGBA (8-bit).");
  }
  assertSupportedProfile(image.attributes.get("profile"), "Krita IMAGE.profile");

  const width = parsePositiveInteger(image.attributes.get("width"), "Krita IMAGE.width", MAX_DIMENSION);
  const height = parsePositiveInteger(image.attributes.get("height"), "Krita IMAGE.height", MAX_DIMENSION);

  if (image.children.length !== 1 || image.children[0].name !== "LAYERS") {
    fail("invalid-maindoc", "Krita IMAGE must contain exactly one direct <LAYERS> child.");
  }
  const layersElement = image.children[0];
  assertAllowedAttributes(layersElement, new Set(), "Krita LAYERS");
  if (layersElement.children.length === 0) {
    fail(
      "unsupported-feature",
      "Krita flattened previews do not contain recoverable source layers; supported paint-layer payloads are required.",
    );
  }
  if (layersElement.children.length > MAX_LAYERS) {
    fail("allocation-limit", `Krita layer count must be from 1 through ${MAX_LAYERS}.`);
  }

  const layers = layersElement.children.map((child, index) => {
    if (isAnimationMetadataName(child.name)) {
      fail("unsupported-feature", "Krita animation timelines are unsupported.");
    }
    if (child.name === "LAYERS") {
      fail("unsupported-feature", "Krita nested layer groups are unsupported.");
    }
    if (child.name !== "layer") {
      fail(
        "unsupported-feature",
        `Krita LAYERS contains unsupported element <${child.name}>.`,
      );
    }
    return parseKritaLayer(child, index);
  });

  const decodedBytes = width * height * PIXEL_SIZE * layers.length;
  if (!Number.isSafeInteger(decodedBytes) || decodedBytes > MAX_DECODED_PIXEL_BYTES) {
    fail(
      "allocation-limit",
      `Krita decoded layer pixels exceed the ${MAX_DECODED_PIXEL_BYTES}-byte import limit.`,
    );
  }

  return { height, imageName, layers, width };
}

function assertArchiveEntriesMatchProject(
  entries: Map<string, ZipEntry>,
  parsed: ParsedKritaDocument,
): void {
  const allowed = new Set([
    "mimetype",
    "maindoc.xml",
    "documentinfo.xml",
    "preview.png",
    "mergedimage.png",
    "META-INF/manifest.xml",
  ]);
  for (const layer of parsed.layers) {
    const path = `${parsed.imageName}/layers/${layer.filename}`;
    allowed.add(path);
    allowed.add(`${path}.defaultpixel`);
  }

  for (const [name, entry] of entries) {
    if (entry.isDirectory) continue;
    if (allowed.has(name)) continue;

    const normalized = name.toLowerCase();
    if (
      normalized.includes("keyframe") ||
      normalized.includes("timeline") ||
      normalized.includes("animation")
    ) {
      fail("unsupported-feature", "Krita animation timelines are unsupported.");
    }
    if (normalized.includes("mask")) {
      fail("unsupported-feature", "Krita masks are unsupported.");
    }
    if (name.startsWith(`${parsed.imageName}/layers/`)) {
      fail(
        "unsupported-feature",
        `Krita ZIP entry ${JSON.stringify(name)} is not a supported paint-layer payload.`,
      );
    }
    fail(
      "unsupported-feature",
      `Krita ZIP entry ${JSON.stringify(name)} is unsupported by this importer subset.`,
    );
  }
}

function readAsciiLine(
  bytes: Uint8Array,
  offset: number,
  path: string,
): { line: string; offset: number } {
  const lineEnd = bytes.indexOf(0x0a, offset);
  if (lineEnd === -1) {
    fail("invalid-layer-data", `${path} native tile data is missing a header line.`);
  }
  const lineBytes = bytes.subarray(offset, lineEnd);
  for (const byte of lineBytes) {
    if (byte < 0x20 || byte > 0x7e) {
      fail("invalid-layer-data", `${path} native tile header must be ASCII text.`);
    }
  }
  return {
    line: String.fromCharCode(...lineBytes),
    offset: lineEnd + 1,
  };
}

function parseTileInteger(value: string, path: string): number {
  if (!/^-?(?:0|[1-9]\d*)$/u.test(value)) {
    fail("invalid-layer-data", `${path} tile coordinate must be a safe integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    fail("invalid-layer-data", `${path} tile coordinate must be a safe integer.`);
  }
  return parsed;
}

function parseTileSize(value: string, path: string): number {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    fail("invalid-layer-data", `${path} tile payload size must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    fail("invalid-layer-data", `${path} tile payload size must be a positive integer.`);
  }
  return parsed;
}

function tileLimitForDimension(dimension: number): number {
  return Math.ceil(dimension / TILE_WIDTH);
}

function decodeKritaPaintDevice(
  bytes: Uint8Array,
  width: number,
  height: number,
  path: string,
): ImageData {
  let offset = 0;
  const expectedHeaders = [
    "VERSION 2",
    `TILEWIDTH ${TILE_WIDTH}`,
    `TILEHEIGHT ${TILE_HEIGHT}`,
    `PIXELSIZE ${PIXEL_SIZE}`,
  ];
  for (const expected of expectedHeaders) {
    const line = readAsciiLine(bytes, offset, path);
    if (line.line !== expected) {
      fail("unsupported-feature", `${path} uses unsupported native tile header; expected ${expected}.`);
    }
    offset = line.offset;
  }

  const dataLine = readAsciiLine(bytes, offset, path);
  const dataMatch = /^DATA (0|[1-9]\d*)$/u.exec(dataLine.line);
  if (dataMatch === null) {
    fail("invalid-layer-data", `${path} native tile DATA header is invalid.`);
  }
  const tileRecordCount = Number(dataMatch[1]);
  if (
    !Number.isSafeInteger(tileRecordCount) ||
    tileRecordCount < 1 ||
    tileRecordCount > MAX_TILE_RECORDS
  ) {
    fail("allocation-limit", `${path} tile record count must be from 1 through ${MAX_TILE_RECORDS}.`);
  }
  offset = dataLine.offset;

  const output = new Uint8ClampedArray(width * height * PIXEL_SIZE);
  const seenTiles = new Set<string>();
  const maxTileX = tileLimitForDimension(width);
  const maxTileY = tileLimitForDimension(height);

  for (let tileIndex = 0; tileIndex < tileRecordCount; tileIndex += 1) {
    const tileHeader = readAsciiLine(bytes, offset, path);
    const parts = tileHeader.line.split(",");
    if (parts.length !== 4 || parts[2] !== "LZF") {
      fail("invalid-layer-data", `${path} tile record header is invalid.`);
    }
    const tileX = parseTileInteger(parts[0], path);
    const tileY = parseTileInteger(parts[1], path);
    const payloadSize = parseTileSize(parts[3], path);
    offset = tileHeader.offset;

    if (tileX < 0 || tileY < 0 || tileX >= maxTileX || tileY >= maxTileY) {
      fail("invalid-layer-data", `${path} tile coordinate is outside the document bounds.`);
    }
    const tileKey = `${tileX},${tileY}`;
    if (seenTiles.has(tileKey)) {
      fail("invalid-layer-data", `${path} contains duplicate tile ${tileKey}.`);
    }
    seenTiles.add(tileKey);

    if (payloadSize !== RAW_TILE_PAYLOAD_BYTES) {
      fail(
        "invalid-layer-data",
        `${path} raw tile payload must be ${RAW_TILE_PAYLOAD_BYTES} bytes.`,
      );
    }
    requireRange(bytes, offset, payloadSize, `${path} tile payload is truncated.`);

    const rawFlag = bytes[offset];
    if (rawFlag === 1) {
      fail(
        "unsupported-feature",
        `${path} uses LZF-compressed tile data, which is unsupported.`,
      );
    }
    if (rawFlag !== 0) {
      fail("invalid-layer-data", `${path} tile payload has an unknown compression flag.`);
    }

    const tileOriginX = tileX * TILE_WIDTH;
    const tileOriginY = tileY * TILE_HEIGHT;
    const payloadOffset = offset + 1;
    for (let row = 0; row < TILE_HEIGHT; row += 1) {
      const destinationY = tileOriginY + row;
      if (destinationY >= height) continue;
      for (let column = 0; column < TILE_WIDTH; column += 1) {
        const destinationX = tileOriginX + column;
        if (destinationX >= width) continue;

        const sourceOffset = payloadOffset + (row * TILE_WIDTH + column) * PIXEL_SIZE;
        const destinationOffset = (destinationY * width + destinationX) * PIXEL_SIZE;
        output[destinationOffset] = bytes[sourceOffset + 2];
        output[destinationOffset + 1] = bytes[sourceOffset + 1];
        output[destinationOffset + 2] = bytes[sourceOffset];
        output[destinationOffset + 3] = bytes[sourceOffset + 3];
      }
    }

    offset += payloadSize;
  }

  if (offset !== bytes.length) {
    fail("invalid-layer-data", `${path} native tile data has trailing bytes.`);
  }

  return {
    colorSpace: "srgb",
    data: output,
    height,
    width,
  };
}

function assertTransparentDefaultPixel(bytes: Uint8Array, path: string): void {
  if (
    bytes.length !== PIXEL_SIZE ||
    bytes[0] !== 0 ||
    bytes[1] !== 0 ||
    bytes[2] !== 0 ||
    bytes[3] !== 0
  ) {
    fail(
      "unsupported-feature",
      `${path} default pixel must be exactly four transparent BGRA bytes.`,
    );
  }
}

function createProjectFromParsed(
  parsed: ParsedKritaDocument,
  entries: Map<string, ZipEntry>,
): SpriteProject {
  const layers = parsed.layers.map((layer, layerIndex) => {
    const layerPath = `${parsed.imageName}/layers/${layer.filename}`;
    const defaultPixelPath = `${layerPath}.defaultpixel`;
    assertTransparentDefaultPixel(
      requireEntry(entries, defaultPixelPath).content,
      defaultPixelPath,
    );
    const imageData = decodeKritaPaintDevice(
      requireEntry(entries, layerPath).content,
      parsed.width,
      parsed.height,
      layerPath,
    );

    return {
      cels: [
        {
          frameIndex: 0,
          imageData,
          x: layer.x,
          y: layer.y,
        },
      ],
      id: `krita-layer-${layerIndex}`,
      name: layer.name,
      opacity: layer.opacity,
      visible: layer.visible,
    };
  });

  return {
    colorMode: "rgba",
    frames: [{ index: 0, durationMs: DEFAULT_FRAME_DURATION_MS }],
    height: parsed.height,
    layers,
    width: parsed.width,
  };
}

/** Parses the documented single-frame Krita .kra raster subset locally. */
export async function importKritaBytes(
  bytes: Uint8Array,
  dependencies: KritaImportDependencies = {},
): Promise<SpriteProject> {
  if (bytes.byteLength > MAX_FILE_BYTES) {
    fail("file-too-large", `Krita file exceeds the ${MAX_FILE_BYTES}-byte import limit.`);
  }

  const { entries, orderedEntries } = await readZipArchive(bytes, dependencies);
  assertKritaMimetype(orderedEntries);
  requireEntry(entries, "preview.png");
  requireEntry(entries, "mergedimage.png");

  const maindocEntry = requireEntry(entries, "maindoc.xml");
  if (maindocEntry.content.length > MAX_MAINDOC_XML_BYTES) {
    fail(
      "allocation-limit",
      `Krita maindoc.xml exceeds the ${MAX_MAINDOC_XML_BYTES}-byte import limit.`,
    );
  }

  const parsed = parseKritaMaindocXml(
    decodeUtf8(maindocEntry.content, "Krita maindoc.xml"),
  );
  assertArchiveEntriesMatchProject(entries, parsed);
  return createProjectFromParsed(parsed, entries);
}

/** Reads a browser-selected .kra file without uploading or remotely fetching it. */
export async function importKrita(
  file: File,
  dependencies: KritaImportDependencies = {},
): Promise<SpriteProject> {
  if (file.size > MAX_FILE_BYTES) {
    fail("file-too-large", `Krita file exceeds the ${MAX_FILE_BYTES}-byte import limit.`);
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    throw new KritaImportError(
      "file-read",
      "Could not read the selected Krita file.",
      { cause: error },
    );
  }

  return importKritaBytes(bytes, dependencies);
}
