import type {
  SpriteCel,
  SpriteFrameTag,
  SpriteLayer,
  SpriteProject,
} from "../../SpriteProject";

import { BinaryWriter } from "./binaryWriter";

export { BinaryWriter } from "./binaryWriter";

const FILE_HEADER_SIZE = 128;
const FRAME_HEADER_SIZE = 16;
const FILE_MAGIC = 0xa5e0;
const FRAME_MAGIC = 0xf1fa;
const LAYER_CHUNK_TYPE = 0x2004;
const CEL_CHUNK_TYPE = 0x2005;
const FRAME_TAGS_CHUNK_TYPE = 0x2018;
const RGBA_COLOR_DEPTH = 32;
const LAYER_OPACITY_IS_VALID = 1;
const LAYER_VISIBLE = 1;
const LAYER_EDITABLE = 2;
const NORMAL_LAYER = 0;
const NORMAL_BLEND_MODE = 0;
const COMPRESSED_IMAGE_CEL = 2;
const UINT8_MAX = 0xff;
const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;
const INT16_MIN = -0x8000;
const INT16_MAX = 0x7fff;

type ValidatedFrameTag = Pick<SpriteFrameTag, "from" | "to"> & {
  direction: number;
  name: Uint8Array;
};

export class UnsupportedAsepriteFeatureError extends Error {
  readonly feature: string;

  constructor(feature: string) {
    super(`Aseprite export does not support ${feature}.`);
    this.name = "UnsupportedAsepriteFeatureError";
    this.feature = feature;
  }
}

function assertIntegerInRange(
  value: number,
  minimum: number,
  maximum: number,
  field: string,
): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `${field} must be an integer from ${minimum} to ${maximum}.`,
    );
  }
}

function assertPositiveUint16(value: number, field: string): void {
  assertIntegerInRange(value, 1, UINT16_MAX, field);
}

function writeInt16LE(writer: BinaryWriter, value: number): void {
  writer.writeUint16LE(value < 0 ? 0x10000 + value : value);
}

function encodeString(value: string, field: string): Uint8Array {
  if (typeof value !== "string") {
    throw new TypeError(`${field} must be a string.`);
  }

  const bytes = new TextEncoder().encode(value);
  if (bytes.length > UINT16_MAX) {
    throw new RangeError(
      `${field} must contain at most ${UINT16_MAX} UTF-8 bytes.`,
    );
  }
  return bytes;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (!(nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff)) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function encodeFrameTagDirection(direction: unknown, field: string): number {
  switch (direction) {
    case "forward":
      return 0;
    case "reverse":
      return 1;
    case "ping-pong":
      return 2;
    default:
      throw new RangeError(
        `${field} must be "forward", "reverse", or "ping-pong".`,
      );
  }
}

function validateFrameTags(
  frameTags: unknown,
  frameCount: number,
): ValidatedFrameTag[] {
  if (frameTags === undefined) {
    return [];
  }
  if (!Array.isArray(frameTags)) {
    throw new TypeError("Project frame tags must be an array when provided.");
  }
  if (frameTags.length > UINT16_MAX) {
    throw new RangeError(
      `Project must contain at most ${UINT16_MAX} frame tags.`,
    );
  }

  const names = new Set<string>();
  let chunkSize = 6 + 2 + 8;
  const validated = frameTags.map((frameTag, index): ValidatedFrameTag => {
    const field = `Frame tag ${index}`;
    if (typeof frameTag !== "object" || frameTag === null) {
      throw new TypeError(`${field} must be an object.`);
    }

    const { direction, from, name, to } = frameTag as Record<string, unknown>;
    if (typeof name !== "string") {
      throw new TypeError(`${field} name must be a string.`);
    }
    if (name.trim().length === 0) {
      throw new RangeError(`${field} name must not be empty or whitespace.`);
    }
    if (!isWellFormedUnicode(name)) {
      throw new RangeError(`${field} name must contain valid Unicode.`);
    }
    if (names.has(name)) {
      throw new RangeError(`${field} name "${name}" is duplicated.`);
    }
    names.add(name);

    const encodedName = encodeString(name, `${field} name`);
    assertIntegerInRange(
      from as number,
      0,
      frameCount - 1,
      `${field} from frame`,
    );
    assertIntegerInRange(
      to as number,
      0,
      frameCount - 1,
      `${field} to frame`,
    );
    if ((from as number) > (to as number)) {
      throw new RangeError(
        `${field} from frame must be less than or equal to its to frame.`,
      );
    }

    chunkSize += 19 + encodedName.length;
    return {
      direction: encodeFrameTagDirection(direction, `${field} direction`),
      from: from as number,
      name: encodedName,
      to: to as number,
    };
  });

  if (chunkSize > UINT32_MAX) {
    throw new RangeError("Aseprite frame-tags chunk exceeds the DWORD range.");
  }
  return validated;
}

function validateCel(
  cel: SpriteCel,
  layerIndex: number,
  celIndex: number,
  frameCount: number,
): void {
  const field = `Layer ${layerIndex} cel ${celIndex}`;
  assertIntegerInRange(cel.frameIndex, 0, frameCount - 1, `${field} frame index`);
  assertIntegerInRange(cel.x, INT16_MIN, INT16_MAX, `${field} x position`);
  assertIntegerInRange(cel.y, INT16_MIN, INT16_MAX, `${field} y position`);

  const imageData = cel.imageData;
  if (
    typeof imageData !== "object" ||
    imageData === null ||
    !(imageData.data instanceof Uint8ClampedArray)
  ) {
    throw new TypeError(`${field} image data must contain RGBA bytes.`);
  }

  assertPositiveUint16(imageData.width, `${field} image width`);
  assertPositiveUint16(imageData.height, `${field} image height`);
  if (imageData.data.length !== imageData.width * imageData.height * 4) {
    throw new RangeError(
      `${field} image data length must equal width x height x 4 RGBA bytes.`,
    );
  }
}

function validateProjectFields(project: SpriteProject): ValidatedFrameTag[] {
  assertPositiveUint16(project.width, "Project width");
  assertPositiveUint16(project.height, "Project height");
  assertPositiveUint16(project.frames.length, "Project frame count");

  project.frames.forEach((frame, index) => {
    if (frame.index !== index) {
      throw new RangeError(`Frame ${index} index must be ${index}.`);
    }
    assertPositiveUint16(frame.durationMs, `Frame ${index} duration`);
  });

  if (!Array.isArray(project.layers) || project.layers.length < 1) {
    throw new RangeError("Project must contain at least one layer.");
  }
  if (project.layers.length > UINT16_MAX + 1) {
    throw new RangeError(
      `Project must contain at most ${UINT16_MAX + 1} layers.`,
    );
  }

  project.layers.forEach((layer, layerIndex) => {
    if (typeof layer.visible !== "boolean") {
      throw new TypeError(`Layer ${layerIndex} visibility must be a boolean.`);
    }
    assertIntegerInRange(
      layer.opacity,
      0,
      UINT8_MAX,
      `Layer ${layerIndex} opacity`,
    );
    encodeString(layer.name, `Layer ${layerIndex} name`);
    if (!Array.isArray(layer.cels)) {
      throw new TypeError(`Layer ${layerIndex} cels must be an array.`);
    }

    const frameIndexes = new Set<number>();
    layer.cels.forEach((cel, celIndex) => {
      validateCel(cel, layerIndex, celIndex, project.frames.length);
      if (frameIndexes.has(cel.frameIndex)) {
        throw new RangeError(
          `Layer ${layerIndex} cannot contain multiple cels for frame ${cel.frameIndex}.`,
        );
      }
      frameIndexes.add(cel.frameIndex);
    });
  });

  return validateFrameTags(project.frameTags, project.frames.length);
}

function writeFileHeader(
  writer: BinaryWriter,
  project: SpriteProject,
  fileSize: number,
): void {
  writer.writeUint32LE(fileSize);
  writer.writeUint16LE(FILE_MAGIC);
  writer.writeUint16LE(project.frames.length);
  writer.writeUint16LE(project.width);
  writer.writeUint16LE(project.height);
  writer.writeUint16LE(RGBA_COLOR_DEPTH);
  writer.writeUint32LE(LAYER_OPACITY_IS_VALID);
  writer.writeUint16LE(0); // Deprecated frame speed.
  writer.writeUint32LE(0);
  writer.writeUint32LE(0);
  writer.writeUint8(0); // Transparent palette index; unused for RGBA.
  writer.writeBytes(new Uint8Array(3));
  writer.writeUint16LE(0); // Number of colors; unused for RGBA.
  writer.writeUint8(1);
  writer.writeUint8(1);
  writer.writeUint16LE(0); // Grid X position.
  writer.writeUint16LE(0); // Grid Y position.
  writer.writeUint16LE(0); // No grid width.
  writer.writeUint16LE(0); // No grid height.
  writer.writeBytes(new Uint8Array(84));
}

function createChunk(type: number, data: Uint8Array): Uint8Array {
  const writer = new BinaryWriter();
  writer.writeUint32LE(6 + data.length);
  writer.writeUint16LE(type);
  writer.writeBytes(data);
  return writer.toUint8Array();
}

function createLayerChunk(layer: SpriteLayer): Uint8Array {
  const name = encodeString(layer.name, "Layer name");
  const data = new BinaryWriter();
  data.writeUint16LE((layer.visible ? LAYER_VISIBLE : 0) | LAYER_EDITABLE);
  data.writeUint16LE(NORMAL_LAYER);
  data.writeUint16LE(0); // No parent group.
  data.writeUint16LE(0); // Ignored default width.
  data.writeUint16LE(0); // Ignored default height.
  data.writeUint16LE(NORMAL_BLEND_MODE);
  data.writeUint8(layer.opacity);
  data.writeBytes(new Uint8Array(3));
  data.writeUint16LE(name.length);
  data.writeBytes(name);
  return createChunk(LAYER_CHUNK_TYPE, data.toUint8Array());
}

function createFrameTagsChunk(frameTags: ValidatedFrameTag[]): Uint8Array {
  const data = new BinaryWriter();
  data.writeUint16LE(frameTags.length);
  data.writeBytes(new Uint8Array(8));

  frameTags.forEach((frameTag) => {
    data.writeUint16LE(frameTag.from);
    data.writeUint16LE(frameTag.to);
    data.writeUint8(frameTag.direction);
    data.writeUint16LE(0); // No repeat count specified.
    data.writeBytes(new Uint8Array(6));
    data.writeBytes(new Uint8Array(3)); // Deprecated tag color.
    data.writeUint8(0);
    data.writeUint16LE(frameTag.name.length);
    data.writeBytes(frameTag.name);
  });

  return createChunk(FRAME_TAGS_CHUNK_TYPE, data.toUint8Array());
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function zlibStore(bytes: Uint8Array): Uint8Array {
  const writer = new BinaryWriter();
  writer.writeUint8(0x78); // Deflate with a 32 KiB window.
  writer.writeUint8(0x01); // No preset dictionary, fastest compression level.

  for (let offset = 0; offset < bytes.length; ) {
    const length = Math.min(UINT16_MAX, bytes.length - offset);
    const isFinal = offset + length === bytes.length;
    writer.writeUint8(isFinal ? 1 : 0); // Stored DEFLATE block.
    writer.writeUint16LE(length);
    writer.writeUint16LE(UINT16_MAX - length);
    writer.writeBytes(bytes.slice(offset, offset + length));
    offset += length;
  }

  const checksum = adler32(bytes);
  writer.writeBytes(
    new Uint8Array([
      (checksum >>> 24) & UINT8_MAX,
      (checksum >>> 16) & UINT8_MAX,
      (checksum >>> 8) & UINT8_MAX,
      checksum & UINT8_MAX,
    ]),
  );
  return writer.toUint8Array();
}

function createCelChunk(cel: SpriteCel, layerIndex: number): Uint8Array {
  const data = new BinaryWriter();
  data.writeUint16LE(layerIndex);
  writeInt16LE(data, cel.x);
  writeInt16LE(data, cel.y);
  data.writeUint8(UINT8_MAX); // SpriteProject has no per-cel opacity.
  data.writeUint16LE(COMPRESSED_IMAGE_CEL);
  data.writeUint16LE(0); // Default z-index.
  data.writeBytes(new Uint8Array(5));
  data.writeUint16LE(cel.imageData.width);
  data.writeUint16LE(cel.imageData.height);
  data.writeBytes(
    zlibStore(
      new Uint8Array(
        cel.imageData.data.buffer,
        cel.imageData.data.byteOffset,
        cel.imageData.data.byteLength,
      ),
    ),
  );
  return createChunk(CEL_CHUNK_TYPE, data.toUint8Array());
}

function writeFrame(
  writer: BinaryWriter,
  durationMs: number,
  chunks: Uint8Array[],
): void {
  const frameSize =
    FRAME_HEADER_SIZE +
    chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (frameSize > UINT32_MAX) {
    throw new RangeError("Aseprite frame size exceeds the DWORD range.");
  }

  writer.writeUint32LE(frameSize);
  writer.writeUint16LE(FRAME_MAGIC);
  writer.writeUint16LE(Math.min(chunks.length, UINT16_MAX));
  writer.writeUint16LE(durationMs);
  writer.writeUint16LE(0);
  writer.writeUint32LE(chunks.length >= UINT16_MAX ? chunks.length : 0);
  chunks.forEach((chunk) => writer.writeBytes(chunk));
}

export function exportAseprite(project: SpriteProject): Uint8Array {
  if (project.colorMode !== "rgba") {
    throw new UnsupportedAsepriteFeatureError(
      `the ${String(project.colorMode)} color mode`,
    );
  }

  const frameTags = validateProjectFields(project);

  const frameChunks = project.frames.map(() => [] as Uint8Array[]);
  project.layers.forEach((layer) => {
    frameChunks[0].push(createLayerChunk(layer));
  });
  if (frameTags.length > 0) {
    frameChunks[0].push(createFrameTagsChunk(frameTags));
  }
  project.layers.forEach((layer, layerIndex) => {
    layer.cels.forEach((cel) => {
      frameChunks[cel.frameIndex].push(createCelChunk(cel, layerIndex));
    });
  });

  const fileSize =
    FILE_HEADER_SIZE +
    project.frames.reduce(
      (sum, _frame, index) =>
        sum +
        FRAME_HEADER_SIZE +
        frameChunks[index].reduce(
          (chunkSum, chunk) => chunkSum + chunk.length,
          0,
        ),
      0,
    );
  if (fileSize > UINT32_MAX) {
    throw new RangeError("Aseprite file size exceeds the DWORD range.");
  }

  const writer = new BinaryWriter();
  writeFileHeader(writer, project, fileSize);
  project.frames.forEach((frame, index) => {
    writeFrame(writer, frame.durationMs, frameChunks[index]);
  });

  return writer.toUint8Array();
}
