import type { SpriteProject } from "../../SpriteProject";

const GIF89A = "GIF89a";
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_DIMENSION = 4096;
const MAX_CANVAS_PIXELS = 16_777_216;
const MAX_FRAMES = 1_000;
const MAX_OUTPUT_PIXELS = 67_108_864;
const MAX_LZW_CODE = 4095;

export type GifImportErrorCode =
  | "allocation-limit"
  | "ambiguous-stream"
  | "file-read"
  | "file-too-large"
  | "frame-limit"
  | "invalid-block"
  | "invalid-color-table"
  | "invalid-frame"
  | "invalid-lzw"
  | "invalid-palette-index"
  | "missing-trailer"
  | "trailing-data"
  | "truncated-data"
  | "unsupported-disposal"
  | "unsupported-extension"
  | "unsupported-interlacing"
  | "unsupported-pixel-aspect-ratio"
  | "unsupported-user-input"
  | "unsupported-version";

export class GifImportError extends Error {
  constructor(
    readonly code: GifImportErrorCode,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "GifImportError";
  }
}

/** Returns importer-authored detail only; arbitrary thrown values stay private. */
export function getGifImportDiagnostic(error: unknown): string | null {
  return error instanceof GifImportError ? error.message : null;
}

type ColorTable = {
  bytes: Uint8Array;
  entries: number;
};

type GraphicControl = {
  delayCentiseconds: number;
  disposal: number;
  transparentIndex: number | null;
};

type ParsedFrame = GraphicControl & {
  colorTable: ColorTable;
  height: number;
  left: number;
  lzwMinimumCodeSize: number;
  lzwSubBlocks: Uint8Array[];
  top: number;
  width: number;
};

type ParsedGif = {
  backgroundColorIndex: number;
  frames: ParsedFrame[];
  globalColorTable: ColorTable | null;
  height: number;
  loopCount: number | null;
  width: number;
};

function fail(code: GifImportErrorCode, message: string): never {
  throw new GifImportError(code, message);
}

class ByteReader {
  offset = 0;

  constructor(readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  require(length: number, message: string): void {
    if (length > this.remaining) {
      fail("truncated-data", message);
    }
  }

  readByte(message: string): number {
    this.require(1, message);
    return this.bytes[this.offset++];
  }

  readUint16(message: string): number {
    this.require(2, message);
    const value = this.bytes[this.offset] | (this.bytes[this.offset + 1] << 8);
    this.offset += 2;
    return value;
  }

  readBytes(length: number, message: string): Uint8Array {
    this.require(length, message);
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
}

function ascii(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return value;
}

function readColorTable(
  reader: ByteReader,
  sizeBits: number,
  description: string,
): ColorTable {
  const entries = 1 << (sizeBits + 1);
  return {
    bytes: reader.readBytes(
      entries * 3,
      `GIF ${description} color table is truncated.`,
    ),
    entries,
  };
}

function readSubBlocks(reader: ByteReader, description: string): Uint8Array[] {
  const blocks: Uint8Array[] = [];
  while (true) {
    const length = reader.readByte(
      `GIF ${description} sub-block chain is truncated.`,
    );
    if (length === 0) return blocks;
    blocks.push(
      reader.readBytes(
        length,
        `GIF ${description} sub-block chain is truncated.`,
      ),
    );
  }
}

function parseGraphicControl(
  reader: ByteReader,
  frameNumber: number,
): GraphicControl {
  const blockSize = reader.readByte("GIF graphic control extension is truncated.");
  if (blockSize !== 4) {
    fail(
      "invalid-block",
      `GIF graphic control extension has invalid block size ${blockSize}; expected 4.`,
    );
  }
  const packed = reader.readByte("GIF graphic control extension is truncated.");
  const delayCentiseconds = reader.readUint16(
    "GIF graphic control extension is truncated.",
  );
  const transparentIndex = reader.readByte(
    "GIF graphic control extension is truncated.",
  );
  const terminator = reader.readByte(
    "GIF graphic control extension is truncated.",
  );
  if (terminator !== 0) {
    fail("invalid-block", "GIF graphic control extension is missing its terminator.");
  }
  if ((packed & 0xe0) !== 0) {
    fail("invalid-block", "GIF graphic control extension has non-zero reserved bits.");
  }
  if ((packed & 0x02) !== 0) {
    fail(
      "unsupported-user-input",
      `GIF frame ${frameNumber} requests unsupported user-input timing.`,
    );
  }

  const disposal = (packed >> 2) & 0x07;
  if (disposal >= 4) {
    fail(
      "unsupported-disposal",
      `GIF frame ${frameNumber} uses unsupported disposal method ${disposal}.`,
    );
  }
  return {
    delayCentiseconds,
    disposal,
    transparentIndex: (packed & 0x01) === 0 ? null : transparentIndex,
  };
}

function parseGif(bytes: Uint8Array): ParsedGif {
  if (bytes.byteLength > MAX_FILE_BYTES) {
    fail(
      "file-too-large",
      `GIF file exceeds the ${MAX_FILE_BYTES}-byte import limit.`,
    );
  }

  const reader = new ByteReader(bytes);
  const signature = ascii(reader.readBytes(6, "GIF header is truncated."));
  if (signature !== GIF89A) {
    fail(
      "unsupported-version",
      signature === "GIF87a"
        ? "Unsupported GIF87a version; expected GIF89a."
        : "GIF header is not a supported GIF89a signature.",
    );
  }

  const width = reader.readUint16("GIF logical screen descriptor is truncated.");
  const height = reader.readUint16("GIF logical screen descriptor is truncated.");
  const packed = reader.readByte("GIF logical screen descriptor is truncated.");
  const backgroundColorIndex = reader.readByte(
    "GIF logical screen descriptor is truncated.",
  );
  const pixelAspectRatio = reader.readByte(
    "GIF logical screen descriptor is truncated.",
  );
  if (
    width < 1 ||
    width > MAX_DIMENSION ||
    height < 1 ||
    height > MAX_DIMENSION
  ) {
    fail(
      "allocation-limit",
      `GIF logical screen dimensions must be from 1x1 through ${MAX_DIMENSION}x${MAX_DIMENSION}.`,
    );
  }
  const canvasPixels = width * height;
  if (canvasPixels > MAX_CANVAS_PIXELS) {
    fail(
      "allocation-limit",
      `GIF logical screen contains ${canvasPixels} pixels; the limit is ${MAX_CANVAS_PIXELS}.`,
    );
  }
  if (pixelAspectRatio !== 0) {
    fail(
      "unsupported-pixel-aspect-ratio",
      `GIF logical screen uses unsupported pixel aspect ratio byte ${pixelAspectRatio}.`,
    );
  }

  const globalColorTable =
    (packed & 0x80) === 0
      ? null
      : readColorTable(reader, packed & 0x07, "global");
  const frames: ParsedFrame[] = [];
  let pendingControl: GraphicControl | null = null;
  let loopCount: number | null = null;
  let sawLoopExtension = false;

  while (true) {
    if (reader.remaining === 0) {
      fail("missing-trailer", "GIF stream is missing its trailer.");
    }
    const introducer = reader.readByte("GIF block stream is truncated.");

    if (introducer === 0x3b) {
      if (pendingControl !== null) {
        fail(
          "ambiguous-stream",
          "GIF stream ends with a graphic control extension that has no image.",
        );
      }
      for (const byte of reader.bytes.subarray(reader.offset)) {
        if (byte !== 0) {
          fail("trailing-data", "GIF stream contains non-padding data after its trailer.");
        }
      }
      break;
    }

    if (introducer === 0x21) {
      const label = reader.readByte("GIF extension label is truncated.");
      if (label === 0xf9) {
        if (pendingControl !== null) {
          fail(
            "ambiguous-stream",
            `GIF frame ${frames.length + 1} has multiple graphic control extensions.`,
          );
        }
        pendingControl = parseGraphicControl(reader, frames.length + 1);
      } else if (label === 0xfe) {
        readSubBlocks(reader, "comment extension");
      } else if (label === 0xff) {
        const blockSize = reader.readByte("GIF application extension is truncated.");
        if (blockSize !== 11) {
          fail(
            "invalid-block",
            `GIF application extension has invalid block size ${blockSize}; expected 11.`,
          );
        }
        const identifier = ascii(
          reader.readBytes(11, "GIF application extension is truncated."),
        );
        const blocks = readSubBlocks(reader, "application extension");
        if (identifier === "NETSCAPE2.0" || identifier === "ANIMEXTS1.0") {
          if (sawLoopExtension) {
            fail(
              "ambiguous-stream",
              "GIF stream contains duplicate or conflicting loop extensions.",
            );
          }
          sawLoopExtension = true;
          if (
            blocks.length !== 1 ||
            blocks[0].length !== 3 ||
            blocks[0][0] !== 1
          ) {
            fail("invalid-block", "GIF loop extension is malformed.");
          }
          loopCount = blocks[0][1] | (blocks[0][2] << 8);
        }
      } else if (label === 0x01) {
        fail(
          "unsupported-extension",
          "GIF plain text extensions are unsupported.",
        );
      } else {
        fail(
          "unsupported-extension",
          `GIF extension label 0x${label.toString(16).padStart(2, "0")} is unsupported.`,
        );
      }
      continue;
    }

    if (introducer !== 0x2c) {
      fail(
        "invalid-block",
        `GIF block stream contains invalid introducer 0x${introducer
          .toString(16)
          .padStart(2, "0")}.`,
      );
    }

    const frameNumber = frames.length + 1;
    if (frameNumber > MAX_FRAMES) {
      fail("frame-limit", `GIF contains more than ${MAX_FRAMES} image frames.`);
    }
    if (canvasPixels * frameNumber > MAX_OUTPUT_PIXELS) {
      fail(
        "allocation-limit",
        `GIF full-canvas frame output exceeds the ${MAX_OUTPUT_PIXELS}-pixel limit.`,
      );
    }

    const left = reader.readUint16(`GIF frame ${frameNumber} descriptor is truncated.`);
    const top = reader.readUint16(`GIF frame ${frameNumber} descriptor is truncated.`);
    const frameWidth = reader.readUint16(
      `GIF frame ${frameNumber} descriptor is truncated.`,
    );
    const frameHeight = reader.readUint16(
      `GIF frame ${frameNumber} descriptor is truncated.`,
    );
    const imagePacked = reader.readByte(
      `GIF frame ${frameNumber} descriptor is truncated.`,
    );
    if (frameWidth === 0 || frameHeight === 0) {
      fail("invalid-frame", `GIF frame ${frameNumber} has an empty image rectangle.`);
    }
    if (left + frameWidth > width || top + frameHeight > height) {
      fail(
        "invalid-frame",
        `GIF frame ${frameNumber} rectangle exceeds the ${width}x${height} logical screen.`,
      );
    }
    if (
      frameNumber === 1 &&
      (left !== 0 || top !== 0 || frameWidth !== width || frameHeight !== height)
    ) {
      fail(
        "invalid-frame",
        `GIF frame 1 must cover the complete ${width}x${height} logical screen.`,
      );
    }
    if ((imagePacked & 0x18) !== 0) {
      fail("invalid-block", `GIF frame ${frameNumber} descriptor has non-zero reserved bits.`);
    }
    if ((imagePacked & 0x40) !== 0) {
      fail(
        "unsupported-interlacing",
        `GIF frame ${frameNumber} uses unsupported interlacing.`,
      );
    }

    const localColorTable =
      (imagePacked & 0x80) === 0
        ? null
        : readColorTable(reader, imagePacked & 0x07, `frame ${frameNumber} local`);
    const colorTable = localColorTable ?? globalColorTable;
    if (colorTable === null) {
      fail(
        "invalid-color-table",
        `GIF frame ${frameNumber} has no applicable color table.`,
      );
    }

    const control: GraphicControl = pendingControl ?? {
      delayCentiseconds: 0,
      disposal: 0,
      transparentIndex: null,
    };
    if (
      control.transparentIndex !== null &&
      control.transparentIndex >= colorTable.entries
    ) {
      fail(
        "invalid-palette-index",
        `GIF frame ${frameNumber} transparent index ${control.transparentIndex} is outside its ${colorTable.entries}-entry color table.`,
      );
    }
    if (control.disposal === 2 && control.transparentIndex === null) {
      if (
        globalColorTable === null ||
        backgroundColorIndex >= globalColorTable.entries
      ) {
        fail(
          "invalid-palette-index",
          `GIF frame ${frameNumber} disposal requires a valid global background color.`,
        );
      }
    }

    const lzwMinimumCodeSize = reader.readByte(
      `GIF frame ${frameNumber} image data is truncated.`,
    );
    if (lzwMinimumCodeSize < 2 || lzwMinimumCodeSize > 8) {
      fail(
        "invalid-lzw",
        `GIF frame ${frameNumber} LZW minimum code size must be from 2 through 8.`,
      );
    }
    const lzwSubBlocks = readSubBlocks(reader, `frame ${frameNumber} image data`);
    frames.push({
      ...control,
      colorTable,
      height: frameHeight,
      left,
      lzwMinimumCodeSize,
      lzwSubBlocks,
      top,
      width: frameWidth,
    });
    pendingControl = null;
  }

  if (frames.length === 0) {
    fail("invalid-frame", "GIF stream does not contain an image frame.");
  }
  return {
    backgroundColorIndex,
    frames,
    globalColorTable,
    height,
    loopCount,
    width,
  };
}

class LzwBitReader {
  private blockIndex = 0;
  private byteIndex = 0;
  private bitBuffer = 0;
  private bufferedBits = 0;
  bitsRead = 0;
  readonly totalBits: number;

  constructor(private readonly blocks: readonly Uint8Array[]) {
    this.totalBits =
      blocks.reduce((total, block) => total + block.length, 0) * 8;
  }

  read(codeSize: number): number | null {
    while (this.bufferedBits < codeSize) {
      while (
        this.blockIndex < this.blocks.length &&
        this.byteIndex >= this.blocks[this.blockIndex].length
      ) {
        this.blockIndex += 1;
        this.byteIndex = 0;
      }
      if (this.blockIndex >= this.blocks.length) return null;
      this.bitBuffer |=
        this.blocks[this.blockIndex][this.byteIndex++] << this.bufferedBits;
      this.bufferedBits += 8;
    }
    const code = this.bitBuffer & ((1 << codeSize) - 1);
    this.bitBuffer >>>= codeSize;
    this.bufferedBits -= codeSize;
    this.bitsRead += codeSize;
    return code;
  }

  remainingBitsAreZero(): boolean {
    if (this.bitBuffer !== 0) return false;
    for (let block = this.blockIndex; block < this.blocks.length; block += 1) {
      const start = block === this.blockIndex ? this.byteIndex : 0;
      for (let index = start; index < this.blocks[block].length; index += 1) {
        if (this.blocks[block][index] !== 0) return false;
      }
    }
    return true;
  }
}

function decodeLzw(frame: ParsedFrame, frameNumber: number): Uint8Array {
  const expectedLength = frame.width * frame.height;
  const output = new Uint8Array(expectedLength);
  const prefix = new Uint16Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4096);
  const clearCode = 1 << frame.lzwMinimumCodeSize;
  const endCode = clearCode + 1;
  const bits = new LzwBitReader(frame.lzwSubBlocks);
  let codeSize = frame.lzwMinimumCodeSize + 1;
  let nextCode = endCode + 1;
  let previousCode = -1;
  let firstByte = 0;
  let outputLength = 0;
  let sawClear = false;
  let sawEnd = false;

  while (true) {
    const code = bits.read(codeSize);
    if (code === null) break;
    if (!sawClear && code !== clearCode) {
      fail("invalid-lzw", `GIF frame ${frameNumber} LZW data must begin with a clear code.`);
    }
    if (code === clearCode) {
      sawClear = true;
      codeSize = frame.lzwMinimumCodeSize + 1;
      nextCode = endCode + 1;
      previousCode = -1;
      continue;
    }
    if (code === endCode) {
      sawEnd = true;
      break;
    }
    if (code > nextCode || code > MAX_LZW_CODE || previousCode < 0 && code >= clearCode) {
      fail("invalid-lzw", `GIF frame ${frameNumber} contains invalid LZW code ${code}.`);
    }

    let stackLength = 0;
    let currentCode = code;
    if (currentCode === nextCode) {
      stack[stackLength++] = firstByte;
      currentCode = previousCode;
    }
    let chainLength = 0;
    while (currentCode >= clearCode) {
      if (currentCode >= nextCode || chainLength++ >= 4096) {
        fail("invalid-lzw", `GIF frame ${frameNumber} contains an invalid LZW dictionary chain.`);
      }
      stack[stackLength++] = suffix[currentCode];
      currentCode = prefix[currentCode];
    }
    firstByte = currentCode;
    stack[stackLength++] = firstByte;

    if (outputLength + stackLength > expectedLength) {
      fail(
        "invalid-lzw",
        `GIF frame ${frameNumber} LZW data decodes more than ${expectedLength} indexes.`,
      );
    }
    while (stackLength > 0) output[outputLength++] = stack[--stackLength];

    if (previousCode >= 0 && nextCode <= MAX_LZW_CODE) {
      prefix[nextCode] = previousCode;
      suffix[nextCode] = firstByte;
      nextCode += 1;
      if (nextCode === 1 << codeSize && codeSize < 12) codeSize += 1;
    }
    previousCode = code;
  }

  if (!sawClear) {
    fail("invalid-lzw", `GIF frame ${frameNumber} LZW data is missing a clear code.`);
  }
  if (!sawEnd) {
    fail("invalid-lzw", `GIF frame ${frameNumber} LZW data is truncated before its end code.`);
  }
  if (outputLength !== expectedLength) {
    fail(
      "invalid-lzw",
      `GIF frame ${frameNumber} LZW data decodes ${outputLength} indexes; expected ${expectedLength}.`,
    );
  }
  const remainingBits = bits.totalBits - bits.bitsRead;
  if (remainingBits > 7 || !bits.remainingBitsAreZero()) {
    fail("invalid-lzw", `GIF frame ${frameNumber} LZW data continues after its end code.`);
  }
  return output;
}

function normalizeDelay(delayCentiseconds: number): number {
  if (delayCentiseconds === 0) return 100;
  return Math.max(20, Math.min(65_535, delayCentiseconds * 10));
}

function paletteColor(table: ColorTable, index: number): Uint8Array {
  return table.bytes.subarray(index * 3, index * 3 + 3);
}

function clearRectangle(
  canvas: Uint8ClampedArray,
  canvasWidth: number,
  frame: ParsedFrame,
  color: Uint8Array | null,
): void {
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const destination = ((frame.top + y) * canvasWidth + frame.left + x) * 4;
      if (color === null) {
        canvas.fill(0, destination, destination + 4);
      } else {
        canvas[destination] = color[0];
        canvas[destination + 1] = color[1];
        canvas[destination + 2] = color[2];
        canvas[destination + 3] = 255;
      }
    }
  }
}

function createProject(parsed: ParsedGif): SpriteProject {
  const canvas = new Uint8ClampedArray(parsed.width * parsed.height * 4);
  const cels = parsed.frames.map((frame, frameIndex) => {
    const indexes = decodeLzw(frame, frameIndex + 1);
    const previous = frame.disposal === 3 ? canvas.slice() : null;

    for (let y = 0; y < frame.height; y += 1) {
      for (let x = 0; x < frame.width; x += 1) {
        const index = indexes[y * frame.width + x];
        if (index >= frame.colorTable.entries) {
          fail(
            "invalid-palette-index",
            `GIF frame ${frameIndex + 1} decoded palette index ${index} outside its ${frame.colorTable.entries}-entry color table.`,
          );
        }
        if (index === frame.transparentIndex) continue;
        const source = index * 3;
        const destination =
          ((frame.top + y) * parsed.width + frame.left + x) * 4;
        canvas[destination] = frame.colorTable.bytes[source];
        canvas[destination + 1] = frame.colorTable.bytes[source + 1];
        canvas[destination + 2] = frame.colorTable.bytes[source + 2];
        canvas[destination + 3] = 255;
      }
    }

    const imageData: ImageData = {
      colorSpace: "srgb",
      data: canvas.slice(),
      height: parsed.height,
      width: parsed.width,
    };
    if (frame.disposal === 2) {
      const clearColor =
        frame.transparentIndex !== null
          ? null
          : paletteColor(parsed.globalColorTable!, parsed.backgroundColorIndex);
      clearRectangle(canvas, parsed.width, frame, clearColor);
    } else if (frame.disposal === 3) {
      canvas.set(previous!);
    }
    return { frameIndex, imageData, x: 0, y: 0 };
  });

  return {
    colorMode: "rgba",
    frames: parsed.frames.map((frame, index) => ({
      durationMs: normalizeDelay(frame.delayCentiseconds),
      index,
    })),
    height: parsed.height,
    layers: [
      {
        cels,
        id: "gif-layer-0",
        name: "GIF frames",
        opacity: 255,
        visible: true,
      },
    ],
    width: parsed.width,
  };
}

/** Parses, decodes, and composites a supported GIF89a byte stream locally. */
export function importGifBytes(bytes: Uint8Array): SpriteProject {
  return createProject(parseGif(bytes));
}

/** Reads a browser-selected GIF without uploading or remotely fetching it. */
export async function importGif(file: File): Promise<SpriteProject> {
  if (file.size > MAX_FILE_BYTES) {
    fail(
      "file-too-large",
      `GIF file exceeds the ${MAX_FILE_BYTES}-byte import limit.`,
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    throw new GifImportError("file-read", "Could not read the selected GIF file.", {
      cause: error,
    });
  }
  return importGifBytes(bytes);
}
