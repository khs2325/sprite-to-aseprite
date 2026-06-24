import type { SpriteProject } from "../../SpriteProject";

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_DIMENSION = 4096;
const MAX_CANVAS_PIXELS = 16_777_216;
const MAX_FRAMES = 1_000;
const MAX_OUTPUT_PIXELS = 67_108_864;
const ADLER_MODULUS = 65_521;

export type ApngImportErrorCode =
  | "allocation-limit"
  | "browser-unsupported"
  | "file-read"
  | "file-too-large"
  | "invalid-chunk"
  | "invalid-crc"
  | "invalid-frame"
  | "invalid-png"
  | "invalid-sequence"
  | "invalid-zlib"
  | "not-animated"
  | "trailing-data"
  | "truncated-data"
  | "unsupported-chunk"
  | "unsupported-format"
  | "unsupported-operation";

export class ApngImportError extends Error {
  constructor(
    readonly code: ApngImportErrorCode,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "ApngImportError";
  }
}

/** Returns importer-authored detail only; arbitrary thrown values stay private. */
export function getApngImportDiagnostic(error: unknown): string | null {
  return error instanceof ApngImportError ? error.message : null;
}

export type ApngImportDependencies = {
  inflateZlib?: (
    compressed: Uint8Array,
    maximumOutputBytes: number,
  ) => Promise<Uint8Array>;
};

type PngChunk = {
  data: Uint8Array;
  type: string;
};

type ParsedFrame = {
  blend: number;
  compressed: Uint8Array;
  delayDenominator: number;
  delayNumerator: number;
  dispose: number;
  height: number;
  left: number;
  top: number;
  width: number;
};

type ParsedApng = {
  frames: ParsedFrame[];
  height: number;
  plays: number;
  width: number;
};

function fail(code: ApngImportErrorCode, message: string): never {
  throw new ApngImportError(code, message);
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 0x100 + bytes[offset + 1];
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
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

function isAsciiLetter(value: number): boolean {
  return (
    (value >= 0x41 && value <= 0x5a) ||
    (value >= 0x61 && value <= 0x7a)
  );
}

function readChunks(bytes: Uint8Array): PngChunk[] {
  if (bytes.byteLength > MAX_FILE_BYTES) {
    fail(
      "file-too-large",
      `APNG file exceeds the ${MAX_FILE_BYTES}-byte import limit.`,
    );
  }
  if (bytes.byteLength < PNG_SIGNATURE.length) {
    fail("truncated-data", "APNG PNG signature is truncated.");
  }
  if (PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    fail("invalid-png", "APNG file does not have a valid PNG signature.");
  }

  const chunks: PngChunk[] = [];
  let offset = PNG_SIGNATURE.length;
  let sawIend = false;
  while (offset < bytes.length) {
    if (sawIend) {
      fail("trailing-data", "APNG file contains data after IEND.");
    }
    if (bytes.length - offset < 12) {
      fail("truncated-data", "APNG chunk header or CRC is truncated.");
    }
    const length = readUint32(bytes, offset);
    if (length > bytes.length - offset - 12) {
      fail("truncated-data", "APNG chunk data is truncated.");
    }

    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    if (
      !typeBytes.every(isAsciiLetter) ||
      typeBytes[2] < 0x41 ||
      typeBytes[2] > 0x5a
    ) {
      fail("invalid-chunk", "APNG contains an invalid PNG chunk type code.");
    }
    const type = String.fromCharCode(...typeBytes);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const expectedCrc = readUint32(bytes, dataEnd);
    if (crc32(bytes.subarray(offset + 4, dataEnd)) !== expectedCrc) {
      fail("invalid-crc", `APNG chunk ${type} has an invalid CRC.`);
    }
    chunks.push({ data: bytes.subarray(dataStart, dataEnd), type });
    offset = dataEnd + 4;
    sawIend = type === "IEND";
  }

  if (!sawIend) {
    fail("truncated-data", "APNG file is missing IEND.");
  }
  return chunks;
}

function expectLength(chunk: PngChunk, length: number): void {
  if (chunk.data.length !== length) {
    fail(
      "invalid-chunk",
      `APNG chunk ${chunk.type} has length ${chunk.data.length}; expected ${length}.`,
    );
  }
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function parseFrameControl(
  chunk: PngChunk,
  frameIndex: number,
  canvasWidth: number,
  canvasHeight: number,
): Omit<ParsedFrame, "compressed"> & { sequence: number } {
  expectLength(chunk, 26);
  const data = chunk.data;
  const frameNumber = frameIndex + 1;
  const width = readUint32(data, 4);
  const height = readUint32(data, 8);
  const left = readUint32(data, 12);
  const top = readUint32(data, 16);
  const dispose = data[24];
  const blend = data[25];

  if (width === 0 || height === 0) {
    fail("invalid-frame", `APNG frame ${frameNumber} has an empty rectangle.`);
  }
  if (
    width > canvasWidth ||
    height > canvasHeight ||
    left > canvasWidth - width ||
    top > canvasHeight - height
  ) {
    fail(
      "invalid-frame",
      `APNG frame ${frameNumber} rectangle exceeds the ${canvasWidth}x${canvasHeight} canvas.`,
    );
  }
  if (
    frameIndex === 0 &&
    (width !== canvasWidth ||
      height !== canvasHeight ||
      left !== 0 ||
      top !== 0)
  ) {
    fail(
      "invalid-frame",
      `APNG frame 1 must cover the complete ${canvasWidth}x${canvasHeight} canvas.`,
    );
  }
  if (dispose > 2) {
    fail(
      "unsupported-operation",
      `APNG frame ${frameNumber} uses unsupported disposal operation ${dispose}.`,
    );
  }
  if (frameIndex === 0 && dispose === 2) {
    fail(
      "unsupported-operation",
      "APNG frame 1 cannot use previous disposal.",
    );
  }
  if (blend > 1) {
    fail(
      "unsupported-operation",
      `APNG frame ${frameNumber} uses unsupported blend operation ${blend}.`,
    );
  }

  return {
    blend,
    delayDenominator: readUint16(data, 22),
    delayNumerator: readUint16(data, 20),
    dispose,
    height,
    left,
    sequence: readUint32(data, 0),
    top,
    width,
  };
}

function parseApng(bytes: Uint8Array): ParsedApng {
  const chunks = readChunks(bytes);
  if (chunks[0]?.type !== "IHDR") {
    fail("invalid-chunk", "APNG IHDR must be the first PNG chunk.");
  }
  expectLength(chunks[0], 13);
  if (chunks.at(-1)?.type !== "IEND") {
    fail("invalid-chunk", "APNG IEND must be the final PNG chunk.");
  }
  expectLength(chunks.at(-1)!, 0);

  const actlPositions = chunks
    .map((chunk, index) => (chunk.type === "acTL" ? index : -1))
    .filter((index) => index >= 0);
  if (actlPositions.length === 0) {
    if (chunks.some((chunk) => chunk.type === "fcTL" || chunk.type === "fdAT")) {
      fail(
        "invalid-chunk",
        "APNG animation chunks require an acTL animation control chunk.",
      );
    }
    fail("not-animated", "PNG file is not animated; APNG acTL is missing.");
  }
  if (actlPositions.length !== 1) {
    fail("invalid-chunk", "APNG contains duplicate acTL chunks.");
  }
  const unsupported = chunks.find(
    (chunk) =>
      !["IHDR", "acTL", "fcTL", "IDAT", "fdAT", "IEND"].includes(
        chunk.type,
      ),
  );
  if (unsupported !== undefined) {
    fail(
      "unsupported-chunk",
      `APNG chunk ${unsupported.type} is unsupported by the documented subset.`,
    );
  }

  const ihdr = chunks[0].data;
  const width = readUint32(ihdr, 0);
  const height = readUint32(ihdr, 4);
  if (
    width < 1 ||
    width > MAX_DIMENSION ||
    height < 1 ||
    height > MAX_DIMENSION
  ) {
    fail(
      "allocation-limit",
      `APNG canvas dimensions must be from 1x1 through ${MAX_DIMENSION}x${MAX_DIMENSION}.`,
    );
  }
  const canvasPixels = width * height;
  if (canvasPixels > MAX_CANVAS_PIXELS) {
    fail(
      "allocation-limit",
      `APNG canvas contains ${canvasPixels} pixels; the limit is ${MAX_CANVAS_PIXELS}.`,
    );
  }
  if (
    ihdr[8] !== 8 ||
    ihdr[9] !== 6 ||
    ihdr[10] !== 0 ||
    ihdr[11] !== 0 ||
    ihdr[12] !== 0
  ) {
    fail(
      "unsupported-format",
      "APNG importer supports only non-interlaced RGBA PNGs with 8 bits per channel.",
    );
  }

  if (chunks[1]?.type !== "acTL") {
    fail("invalid-chunk", "APNG acTL must appear immediately after IHDR.");
  }
  const actl = chunks[1];
  expectLength(actl, 8);
  const declaredFrames = readUint32(actl.data, 0);
  const plays = readUint32(actl.data, 4);
  if (declaredFrames < 1 || declaredFrames > MAX_FRAMES) {
    fail(
      "allocation-limit",
      `APNG acTL frame count must be from 1 through ${MAX_FRAMES}.`,
    );
  }
  if (canvasPixels * declaredFrames > MAX_OUTPUT_PIXELS) {
    fail(
      "allocation-limit",
      `APNG full-canvas frame output exceeds the ${MAX_OUTPUT_PIXELS}-pixel limit.`,
    );
  }
  if (chunks[2]?.type !== "fcTL") {
    fail(
      "invalid-chunk",
      chunks.some((chunk) => chunk.type === "IDAT")
        ? "APNG default image is separate from the animation; fcTL must precede IDAT."
        : "APNG frame 1 control chunk is missing.",
    );
  }

  let chunkIndex = 2;
  let expectedSequence = 0;
  const frames: ParsedFrame[] = [];
  while (chunkIndex < chunks.length - 1) {
    const controlChunk = chunks[chunkIndex];
    if (controlChunk.type !== "fcTL") {
      const code = ["IHDR", "acTL", "fcTL", "IDAT", "fdAT", "IEND"].includes(
        controlChunk.type,
      )
        ? "invalid-chunk"
        : "unsupported-chunk";
      fail(code, `APNG chunk ${controlChunk.type} is not allowed here.`);
    }
    const frameIndex = frames.length;
    if (frameIndex >= declaredFrames) {
      fail(
        "invalid-frame",
        `APNG contains more frames than acTL declares (${declaredFrames}).`,
      );
    }
    const control = parseFrameControl(
      controlChunk,
      frameIndex,
      width,
      height,
    );
    if (control.sequence !== expectedSequence) {
      fail(
        "invalid-sequence",
        `APNG sequence expected ${expectedSequence} but found ${control.sequence}.`,
      );
    }
    expectedSequence += 1;
    chunkIndex += 1;

    const dataType = frameIndex === 0 ? "IDAT" : "fdAT";
    const compressedParts: Uint8Array[] = [];
    while (chunks[chunkIndex]?.type === dataType) {
      const dataChunk = chunks[chunkIndex];
      if (dataType === "IDAT") {
        compressedParts.push(dataChunk.data);
      } else {
        if (dataChunk.data.length < 4) {
          fail("invalid-chunk", "APNG chunk fdAT is shorter than its sequence number.");
        }
        const sequence = readUint32(dataChunk.data, 0);
        if (sequence !== expectedSequence) {
          fail(
            "invalid-sequence",
            `APNG sequence expected ${expectedSequence} but found ${sequence}.`,
          );
        }
        expectedSequence += 1;
        compressedParts.push(dataChunk.data.subarray(4));
      }
      chunkIndex += 1;
    }
    if (compressedParts.length === 0) {
      fail(
        "invalid-frame",
        `APNG frame ${frameIndex + 1} is missing ${dataType} image data.`,
      );
    }
    frames.push({ ...control, compressed: concatenate(compressedParts) });

    const next = chunks[chunkIndex];
    if (next.type !== "fcTL" && next.type !== "IEND") {
      const code = ["IHDR", "acTL", "IDAT", "fdAT"].includes(next.type)
        ? "invalid-chunk"
        : "unsupported-chunk";
      fail(code, `APNG chunk ${next.type} is not allowed here.`);
    }
  }

  if (frames.length !== declaredFrames) {
    fail(
      "invalid-frame",
      `APNG acTL declares ${declaredFrames} frames but ${frames.length} were found.`,
    );
  }
  return { frames, height, plays, width };
}

class DeflateBitReader {
  bitOffset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  readBits(count: number): number {
    if (this.bitOffset + count > this.bytes.length * 8) {
      fail("invalid-zlib", "APNG frame zlib stream is truncated.");
    }
    let value = 0;
    for (let bit = 0; bit < count; bit += 1) {
      const absolute = this.bitOffset++;
      value |= ((this.bytes[absolute >>> 3] >>> (absolute & 7)) & 1) << bit;
    }
    return value;
  }

  alignToByte(): void {
    this.bitOffset = (this.bitOffset + 7) & ~7;
  }

  skipBytes(count: number): void {
    this.alignToByte();
    if (this.bitOffset / 8 + count > this.bytes.length) {
      fail("invalid-zlib", "APNG frame stored deflate block is truncated.");
    }
    this.bitOffset += count * 8;
  }
}

type HuffmanTable = Map<number, number>;

function reverseBits(value: number, length: number): number {
  let reversed = 0;
  for (let bit = 0; bit < length; bit += 1) {
    reversed = (reversed << 1) | ((value >>> bit) & 1);
  }
  return reversed;
}

function buildHuffmanTable(lengths: readonly number[]): HuffmanTable {
  const counts = new Uint16Array(16);
  for (const length of lengths) {
    if (length > 15) fail("invalid-zlib", "APNG frame has an invalid Huffman code length.");
    if (length > 0) counts[length] += 1;
  }
  if (counts.every((count) => count === 0)) {
    fail("invalid-zlib", "APNG frame has an empty Huffman table.");
  }
  let available = 1;
  for (let length = 1; length <= 15; length += 1) {
    available = available * 2 - counts[length];
    if (available < 0) {
      fail("invalid-zlib", "APNG frame has an oversubscribed Huffman table.");
    }
  }

  const nextCode = new Uint16Array(16);
  let code = 0;
  for (let length = 1; length <= 15; length += 1) {
    code = (code + counts[length - 1]) << 1;
    nextCode[length] = code;
  }
  const table: HuffmanTable = new Map();
  lengths.forEach((length, symbol) => {
    if (length === 0) return;
    const assigned = nextCode[length]++;
    table.set(length * 0x10000 + reverseBits(assigned, length), symbol);
  });
  return table;
}

function decodeHuffman(reader: DeflateBitReader, table: HuffmanTable): number {
  let code = 0;
  for (let length = 1; length <= 15; length += 1) {
    code |= reader.readBits(1) << (length - 1);
    const symbol = table.get(length * 0x10000 + code);
    if (symbol !== undefined) return symbol;
  }
  fail("invalid-zlib", "APNG frame contains an invalid Huffman code.");
}

const CODE_LENGTH_ORDER = [
  16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];
const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51,
  59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4,
  4, 4, 5, 5, 5, 5, 0,
];
const DISTANCE_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385,
  513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385,
  24577,
];
const DISTANCE_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9,
  10, 10, 11, 11, 12, 12, 13, 13,
];

function fixedTables(): [HuffmanTable, HuffmanTable] {
  const literalLengths = new Array<number>(288).fill(0);
  literalLengths.fill(8, 0, 144);
  literalLengths.fill(9, 144, 256);
  literalLengths.fill(7, 256, 280);
  literalLengths.fill(8, 280);
  return [
    buildHuffmanTable(literalLengths),
    buildHuffmanTable(new Array<number>(32).fill(5)),
  ];
}

function dynamicTables(reader: DeflateBitReader): [HuffmanTable, HuffmanTable] {
  const literalCount = reader.readBits(5) + 257;
  const distanceCount = reader.readBits(5) + 1;
  const codeLengthCount = reader.readBits(4) + 4;
  const codeLengthLengths = new Array<number>(19).fill(0);
  for (let index = 0; index < codeLengthCount; index += 1) {
    codeLengthLengths[CODE_LENGTH_ORDER[index]] = reader.readBits(3);
  }
  const codeLengthTable = buildHuffmanTable(codeLengthLengths);
  const lengths: number[] = [];
  const total = literalCount + distanceCount;
  while (lengths.length < total) {
    const symbol = decodeHuffman(reader, codeLengthTable);
    if (symbol <= 15) {
      lengths.push(symbol);
      continue;
    }
    let repeat: number;
    let value = 0;
    if (symbol === 16) {
      if (lengths.length === 0) {
        fail("invalid-zlib", "APNG frame repeats a missing Huffman code length.");
      }
      value = lengths[lengths.length - 1];
      repeat = reader.readBits(2) + 3;
    } else if (symbol === 17) {
      repeat = reader.readBits(3) + 3;
    } else if (symbol === 18) {
      repeat = reader.readBits(7) + 11;
    } else {
      fail("invalid-zlib", "APNG frame has an invalid code-length symbol.");
    }
    if (lengths.length + repeat > total) {
      fail("invalid-zlib", "APNG frame Huffman code lengths overflow their table.");
    }
    lengths.push(...new Array<number>(repeat).fill(value));
  }

  const literalLengths = lengths.slice(0, literalCount);
  if (literalLengths[256] === 0) {
    fail("invalid-zlib", "APNG frame Huffman table is missing its end code.");
  }
  return [
    buildHuffmanTable(literalLengths),
    buildHuffmanTable(lengths.slice(literalCount)),
  ];
}

function validateZlibStream(
  compressed: Uint8Array,
  expectedOutputBytes: number,
): number {
  if (compressed.length < 6) {
    fail("invalid-zlib", "APNG frame zlib stream is truncated.");
  }
  const cmf = compressed[0];
  const flags = compressed[1];
  if (
    (cmf & 0x0f) !== 8 ||
    (cmf >>> 4) > 7 ||
    ((cmf << 8) + flags) % 31 !== 0 ||
    (flags & 0x20) !== 0
  ) {
    fail("invalid-zlib", "APNG frame has an invalid or unsupported zlib header.");
  }

  const reader = new DeflateBitReader(compressed.subarray(2));
  let outputBytes = 0;
  let finalBlock = false;
  while (!finalBlock) {
    finalBlock = reader.readBits(1) === 1;
    const blockType = reader.readBits(2);
    if (blockType === 0) {
      reader.alignToByte();
      const length = reader.readBits(16);
      const complement = reader.readBits(16);
      if (((length ^ 0xffff) & 0xffff) !== complement) {
        fail("invalid-zlib", "APNG frame stored deflate block has an invalid length.");
      }
      outputBytes += length;
      if (outputBytes > expectedOutputBytes) {
        fail("invalid-zlib", "APNG frame inflates beyond its expected row data.");
      }
      reader.skipBytes(length);
      continue;
    }
    if (blockType === 3) {
      fail("invalid-zlib", "APNG frame uses a reserved deflate block type.");
    }

    const [literalTable, distanceTable] =
      blockType === 1 ? fixedTables() : dynamicTables(reader);
    while (true) {
      const symbol = decodeHuffman(reader, literalTable);
      if (symbol < 256) {
        outputBytes += 1;
      } else if (symbol === 256) {
        break;
      } else {
        if (symbol > 285) {
          fail("invalid-zlib", "APNG frame contains a reserved length symbol.");
        }
        const lengthIndex = symbol - 257;
        const length =
          LENGTH_BASE[lengthIndex] + reader.readBits(LENGTH_EXTRA[lengthIndex]);
        const distanceSymbol = decodeHuffman(reader, distanceTable);
        if (distanceSymbol > 29) {
          fail("invalid-zlib", "APNG frame contains a reserved distance symbol.");
        }
        const distance =
          DISTANCE_BASE[distanceSymbol] +
          reader.readBits(DISTANCE_EXTRA[distanceSymbol]);
        if (distance > outputBytes) {
          fail("invalid-zlib", "APNG frame deflate distance exceeds decoded data.");
        }
        outputBytes += length;
      }
      if (outputBytes > expectedOutputBytes) {
        fail("invalid-zlib", "APNG frame inflates beyond its expected row data.");
      }
    }
  }

  if (outputBytes !== expectedOutputBytes) {
    fail(
      "invalid-zlib",
      `APNG frame inflates to ${outputBytes} bytes; expected ${expectedOutputBytes}.`,
    );
  }
  const deflateBytes = Math.ceil(reader.bitOffset / 8);
  if (2 + deflateBytes + 4 !== compressed.length) {
    fail("invalid-zlib", "APNG frame zlib stream contains trailing compressed data.");
  }
  return readUint32(compressed, compressed.length - 4);
}

function adler32(bytes: Uint8Array): number {
  let first = 1;
  let second = 0;
  for (const byte of bytes) {
    first = (first + byte) % ADLER_MODULUS;
    second = (second + first) % ADLER_MODULUS;
  }
  return (second * 0x10000 + first) >>> 0;
}

async function inflateZlibInBrowser(
  compressed: Uint8Array,
  maximumOutputBytes: number,
): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "function") {
    fail(
      "browser-unsupported",
      "This browser does not support local APNG zlib decompression.",
    );
  }
  const stream = new Blob([new Uint8Array(compressed)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  const reader = stream.getReader();
  const output = new Uint8Array(maximumOutputBytes);
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return output.subarray(0, length);
    if (length + value.length > maximumOutputBytes) {
      await reader.cancel();
      fail("invalid-zlib", "APNG frame inflates beyond its expected row data.");
    }
    output.set(value, length);
    length += value.length;
  }
}

function paeth(left: number, up: number, upperLeft: number): number {
  const prediction = left + up - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function reverseFilters(
  rows: Uint8Array,
  frame: ParsedFrame,
  frameNumber: number,
): Uint8ClampedArray {
  const rowBytes = frame.width * 4;
  const pixels = new Uint8ClampedArray(rowBytes * frame.height);
  for (let y = 0; y < frame.height; y += 1) {
    const sourceRow = y * (rowBytes + 1);
    const filter = rows[sourceRow];
    if (filter > 4) {
      fail(
        "invalid-frame",
        `APNG frame ${frameNumber} row ${y + 1} uses invalid PNG filter ${filter}.`,
      );
    }
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = rows[sourceRow + x + 1];
      const destination = y * rowBytes + x;
      const left = x < 4 ? 0 : pixels[destination - 4];
      const up = y === 0 ? 0 : pixels[destination - rowBytes];
      const upperLeft = x < 4 || y === 0 ? 0 : pixels[destination - rowBytes - 4];
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upperLeft);
      pixels[destination] = (raw + predictor) & 0xff;
    }
  }
  return pixels;
}

function copyRectangle(
  canvas: Uint8ClampedArray,
  canvasWidth: number,
  frame: ParsedFrame,
): Uint8ClampedArray {
  const rectangle = new Uint8ClampedArray(frame.width * frame.height * 4);
  for (let y = 0; y < frame.height; y += 1) {
    const start = ((frame.top + y) * canvasWidth + frame.left) * 4;
    rectangle.set(
      canvas.subarray(start, start + frame.width * 4),
      y * frame.width * 4,
    );
  }
  return rectangle;
}

function compositeFrame(
  canvas: Uint8ClampedArray,
  canvasWidth: number,
  frame: ParsedFrame,
  pixels: Uint8ClampedArray,
): void {
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const source = (y * frame.width + x) * 4;
      const destination = ((frame.top + y) * canvasWidth + frame.left + x) * 4;
      if (frame.blend === 0) {
        canvas.set(pixels.subarray(source, source + 4), destination);
        continue;
      }
      const sourceAlpha = pixels[source + 3];
      const destinationAlpha = canvas[destination + 3];
      const alphaNumerator =
        sourceAlpha * 255 + destinationAlpha * (255 - sourceAlpha);
      if (alphaNumerator === 0) {
        canvas.fill(0, destination, destination + 4);
        continue;
      }
      for (let channel = 0; channel < 3; channel += 1) {
        const colorNumerator =
          pixels[source + channel] * sourceAlpha * 255 +
          canvas[destination + channel] *
            destinationAlpha *
            (255 - sourceAlpha);
        canvas[destination + channel] = Math.floor(
          colorNumerator / alphaNumerator + 0.5,
        );
      }
      canvas[destination + 3] = Math.floor(alphaNumerator / 255 + 0.5);
    }
  }
}

function disposeFrame(
  canvas: Uint8ClampedArray,
  canvasWidth: number,
  frame: ParsedFrame,
  previous: Uint8ClampedArray | null,
): void {
  if (frame.dispose === 0) return;
  for (let y = 0; y < frame.height; y += 1) {
    const destination = ((frame.top + y) * canvasWidth + frame.left) * 4;
    if (frame.dispose === 1) {
      canvas.fill(0, destination, destination + frame.width * 4);
    } else {
      canvas.set(
        previous!.subarray(y * frame.width * 4, (y + 1) * frame.width * 4),
        destination,
      );
    }
  }
}

function normalizeDelay(numerator: number, denominator: number): number {
  const effectiveDenominator = denominator === 0 ? 100 : denominator;
  const rounded = Math.floor((numerator * 1000) / effectiveDenominator + 0.5);
  return Math.max(1, Math.min(65_535, rounded));
}

async function createProject(
  parsed: ParsedApng,
  dependencies: ApngImportDependencies,
): Promise<SpriteProject> {
  const inflate = dependencies.inflateZlib ?? inflateZlibInBrowser;
  const canvas = new Uint8ClampedArray(parsed.width * parsed.height * 4);
  const cels = [];

  for (const [frameIndex, frame] of parsed.frames.entries()) {
    const expectedBytes = frame.height * (1 + frame.width * 4);
    const expectedAdler = validateZlibStream(frame.compressed, expectedBytes);
    let rows: Uint8Array;
    try {
      rows = await inflate(frame.compressed, expectedBytes);
    } catch (error) {
      if (error instanceof ApngImportError) throw error;
      throw new ApngImportError(
        "invalid-zlib",
        `Could not decompress APNG frame ${frameIndex + 1} zlib data.`,
        { cause: error },
      );
    }
    if (!(rows instanceof Uint8Array) || rows.length !== expectedBytes) {
      fail(
        "invalid-zlib",
        `APNG frame ${frameIndex + 1} inflates to ${rows instanceof Uint8Array ? rows.length : "invalid"} bytes; expected ${expectedBytes}.`,
      );
    }
    if (adler32(rows) !== expectedAdler) {
      fail("invalid-zlib", `APNG frame ${frameIndex + 1} has an invalid Adler-32 checksum.`);
    }

    const pixels = reverseFilters(rows, frame, frameIndex + 1);
    const previous =
      frame.dispose === 2
        ? copyRectangle(canvas, parsed.width, frame)
        : null;
    compositeFrame(canvas, parsed.width, frame, pixels);
    cels.push({
      frameIndex,
      imageData: {
        colorSpace: "srgb" as const,
        data: canvas.slice(),
        height: parsed.height,
        width: parsed.width,
      },
      x: 0,
      y: 0,
    });
    disposeFrame(canvas, parsed.width, frame, previous);
  }

  return {
    colorMode: "rgba",
    frames: parsed.frames.map((frame, index) => ({
      durationMs: normalizeDelay(frame.delayNumerator, frame.delayDenominator),
      index,
    })),
    height: parsed.height,
    layers: [
      {
        cels,
        id: "apng-layer-0",
        name: "APNG frames",
        opacity: 255,
        visible: true,
      },
    ],
    width: parsed.width,
  };
}

/** Parses, decodes, and composites the documented APNG subset locally. */
export async function importApngBytes(
  bytes: Uint8Array,
  dependencies: ApngImportDependencies = {},
): Promise<SpriteProject> {
  return createProject(parseApng(bytes), dependencies);
}

/** Reads a browser-selected APNG without uploading or remotely fetching it. */
export async function importApng(
  file: File,
  dependencies: ApngImportDependencies = {},
): Promise<SpriteProject> {
  if (file.size > MAX_FILE_BYTES) {
    fail(
      "file-too-large",
      `APNG file exceeds the ${MAX_FILE_BYTES}-byte import limit.`,
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    throw new ApngImportError(
      "file-read",
      "Could not read the selected APNG file.",
      { cause: error },
    );
  }
  return importApngBytes(bytes, dependencies);
}
