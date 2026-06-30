import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync, inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { createPngSequenceProject } from "../../src/core/importers/pngSequence";
import { createSpritesheetGridProject } from "../../src/core/importers/spritesheetGrid";
import {
  createSpritesheetJsonProject,
  parseSpritesheetJsonMetadata,
} from "../../src/core/importers/spritesheetJson";

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

type PiskelChunkFixture = {
  layout: number[][];
  base64PNG: string;
};

type PiskelLayerFixture = {
  name: string;
  opacity: number;
  frameCount: number;
  chunks: PiskelChunkFixture[];
  visible?: boolean;
};

type PiskelFixture = {
  modelVersion: number;
  piskel: {
    name: string;
    description: string;
    fps: number;
    height: number;
    width: number;
    layers: string[];
    hiddenFrames: number[];
  };
};

type GifFrameFixtureMetadata = {
  delayCentiseconds: number;
  disposal: number;
  height: number;
  interlaced: boolean;
  left: number;
  lzwMinimumCodeSize: number;
  top: number;
  transparentIndex: number | null;
  width: number;
};

type GifFixtureMetadata = {
  backgroundColorIndex: number;
  frames: GifFrameFixtureMetadata[];
  height: number;
  loopCount: number | null;
  pixelAspectRatio: number;
  signature: string;
  width: number;
};

type ApngFrameFixtureMetadata = {
  blend: number;
  delayDenominator: number;
  delayNumerator: number;
  dispose: number;
  height: number;
  left: number;
  pixels: Buffer;
  sequence: number;
  top: number;
  width: number;
};

type ApngFixtureMetadata = {
  chunkTypes: string[];
  declaredFrames: number;
  frames: ApngFrameFixtureMetadata[];
  height: number;
  plays: number;
  sequenceNumbers: number[];
  width: number;
};

type ZipFixtureEntry = {
  compressionMethod: number;
  content: Buffer;
  name: string;
};

type OpenRasterLayerFixtureMetadata = {
  compositeOp?: string;
  name?: string;
  opacity?: string;
  src?: string;
  visibility?: string;
  x?: string;
  y?: string;
};

type OpenRasterFixtureMetadata = {
  image: {
    h?: string;
    version?: string;
    w?: string;
  };
  layers: OpenRasterLayerFixtureMetadata[];
};

type KritaLayerFixtureMetadata = {
  colorSpaceName?: string;
  compositeOp?: string;
  fileName?: string;
  name?: string;
  nodeType?: string;
  opacity?: string;
  visible?: string;
  x?: string;
  y?: string;
};

type KritaFixtureMetadata = {
  doc: {
    depth?: string;
    editor?: string;
    syntaxVersion?: string;
  };
  image: {
    colorSpaceName?: string;
    height?: string;
    mime?: string;
    name?: string;
    profile?: string;
    width?: string;
  };
  layers: KritaLayerFixtureMetadata[];
};

type PixeloramaCelFixture = {
  metadata: Record<string, unknown>;
  opacity: number;
  ui_color: string;
  z_index: number;
};

type PixeloramaFrameFixture = {
  cels: PixeloramaCelFixture[];
  duration: number;
  metadata: Record<string, unknown>;
};

type PixeloramaLayerFixture = {
  blend_mode: number;
  clipping_mask: boolean;
  effects: unknown[];
  locked: boolean;
  metadata: Record<string, unknown>;
  name: string;
  new_cels_linked?: boolean;
  opacity: number;
  parent: number;
  type: number;
  ui_color: string;
  visible: boolean;
};

type PixeloramaFixture = {
  author_company: string;
  author_contact: string;
  author_display_name: string;
  author_real_name: string;
  brushes: unknown[];
  color_mode: number;
  current_frame: number;
  current_layer: number;
  export_directory_path: string;
  export_file_format: number;
  export_file_name: string;
  fps: number;
  frames: PixeloramaFrameFixture[];
  guides: unknown[];
  layers: PixeloramaLayerFixture[];
  license: string;
  metadata: Record<string, unknown>;
  palettes: unknown[];
  pixelorama_version: string;
  project_current_palette_name: string;
  pxo_version: number;
  reference_images: unknown[];
  size_x: number;
  size_y: number;
  symmetry_points: number[];
  tags: unknown[];
  tile_mode_x_basis_x: number;
  tile_mode_x_basis_y: number;
  tile_mode_y_basis_x: number;
  tile_mode_y_basis_y: number;
  tilesets: unknown[];
  user_data: string;
  vanishing_points: unknown[];
};

type PsdChannelFixtureMetadata = {
  compression: number;
  id: number;
  length: number;
};

type PsdLayerFixtureMetadata = {
  blendModeKey: string;
  bottom: number;
  channels: PsdChannelFixtureMetadata[];
  hidden: boolean;
  left: number;
  name: string;
  opacity: number;
  right: number;
  top: number;
};

type PsdFixtureMetadata = {
  bitsPerChannel: number;
  channels: number;
  colorMode: number;
  height: number;
  layers: PsdLayerFixtureMetadata[];
  version: number;
  width: number;
};

function fixtureCrc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readPsdPascalString(bytes: Buffer, offset: number): {
  nextOffset: number;
  value: string;
} {
  const length = bytes[offset];
  const paddedLength = Math.ceil((length + 1) / 4) * 4;
  return {
    nextOffset: offset + paddedLength,
    value: bytes.toString("ascii", offset + 1, offset + 1 + length),
  };
}

function inspectPsdFixture(relativePath: string): PsdFixtureMetadata {
  const psd = readFileSync(join(fixtureDirectory, relativePath));
  expect(psd.toString("ascii", 0, 4)).toBe("8BPS");

  const metadata: PsdFixtureMetadata = {
    version: psd.readUInt16BE(4),
    channels: psd.readUInt16BE(12),
    height: psd.readUInt32BE(14),
    width: psd.readUInt32BE(18),
    bitsPerChannel: psd.readUInt16BE(22),
    colorMode: psd.readUInt16BE(24),
    layers: [],
  };

  let offset = 26;
  const colorModeDataLength = psd.readUInt32BE(offset);
  offset += 4;
  expect(colorModeDataLength).toBe(0);
  offset += colorModeDataLength;

  const imageResourcesLength = psd.readUInt32BE(offset);
  offset += 4;
  expect(imageResourcesLength).toBe(0);
  offset += imageResourcesLength;

  const layerMaskLength = psd.readUInt32BE(offset);
  offset += 4;
  const layerMaskStart = offset;
  const layerMaskEnd = layerMaskStart + layerMaskLength;
  const layerInfoLength = psd.readUInt32BE(layerMaskStart);
  let cursor = layerMaskStart + 4;
  const layerInfoEnd = cursor + layerInfoLength;
  const layerCount = psd.readInt16BE(cursor);
  cursor += 2;

  for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
    const top = psd.readInt32BE(cursor);
    const left = psd.readInt32BE(cursor + 4);
    const bottom = psd.readInt32BE(cursor + 8);
    const right = psd.readInt32BE(cursor + 12);
    const channelCount = psd.readUInt16BE(cursor + 16);
    cursor += 18;

    const channels: PsdChannelFixtureMetadata[] = [];
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      channels.push({
        id: psd.readInt16BE(cursor),
        length: psd.readUInt32BE(cursor + 2),
        compression: -1,
      });
      cursor += 6;
    }

    expect(psd.toString("ascii", cursor, cursor + 4)).toBe("8BIM");
    const blendModeKey = psd.toString("ascii", cursor + 4, cursor + 8);
    cursor += 8;
    const opacity = psd[cursor];
    const clipping = psd[cursor + 1];
    const flags = psd[cursor + 2];
    cursor += 4;
    expect(clipping).toBe(0);

    const extraLength = psd.readUInt32BE(cursor);
    cursor += 4;
    const extraEnd = cursor + extraLength;
    const maskLength = psd.readUInt32BE(cursor);
    cursor += 4;
    expect(maskLength).toBe(0);
    cursor += maskLength;
    const blendingRangesLength = psd.readUInt32BE(cursor);
    cursor += 4;
    expect(blendingRangesLength).toBe(0);
    cursor += blendingRangesLength;
    const name = readPsdPascalString(psd, cursor);
    cursor = name.nextOffset;
    expect(cursor).toBe(extraEnd);

    metadata.layers.push({
      blendModeKey,
      bottom,
      channels,
      hidden: (flags & 0x02) !== 0,
      left,
      name: name.value,
      opacity,
      right,
      top,
    });
  }

  for (const layer of metadata.layers) {
    for (const channel of layer.channels) {
      expect(channel.length).toBeGreaterThanOrEqual(2);
      channel.compression = psd.readUInt16BE(cursor);
      cursor += channel.length;
    }
  }

  expect(cursor).toBe(layerInfoEnd);
  expect(psd.readUInt32BE(layerInfoEnd)).toBe(0);
  expect(layerInfoEnd + 4).toBe(layerMaskEnd);
  offset = layerMaskEnd;
  expect(psd.readUInt16BE(offset)).toBe(0);
  expect(offset + 2).toBe(psd.length);

  return metadata;
}

function inspectZipFixture(relativePath: string): ZipFixtureEntry[] {
  const archive = readFileSync(join(fixtureDirectory, relativePath));
  expect(archive.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  expect(archive.readUInt32LE(archive.length - 22)).toBe(0x06054b50);

  const centralDirectoryOffset = archive.readUInt32LE(archive.length - 6);
  const expectedEntryCount = archive.readUInt16LE(archive.length - 12);
  const entries: ZipFixtureEntry[] = [];
  let offset = 0;

  while (offset < centralDirectoryOffset) {
    expect(archive.readUInt32LE(offset)).toBe(0x04034b50);
    const compressionMethod = archive.readUInt16LE(offset + 8);
    const crc = archive.readUInt32LE(offset + 14);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const uncompressedSize = archive.readUInt32LE(offset + 22);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLength;
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;
    expect(dataEnd).toBeLessThanOrEqual(archive.length);

    const compressed = archive.subarray(dataStart, dataEnd);
    const content = compressionMethod === 0
      ? Buffer.from(compressed)
      : inflateRawSync(compressed);
    expect(content).toHaveLength(uncompressedSize);
    expect(fixtureCrc32(content)).toBe(crc);

    entries.push({
      compressionMethod,
      content,
      name: archive.toString("utf8", nameStart, nameEnd),
    });
    offset = dataEnd;
  }

  expect(entries).toHaveLength(expectedEntryCount);
  return entries;
}

function zipEntryMap(entries: ZipFixtureEntry[]): Map<string, ZipFixtureEntry> {
  return new Map(entries.map((entry) => [entry.name, entry]));
}

function parseXmlAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributePattern = /([A-Za-z_:][\w:.-]*)="([^"]*)"/g;
  for (const match of source.matchAll(attributePattern)) {
    attributes[match[1]] = match[2];
  }
  return attributes;
}

function parseOpenRasterFixtureMetadata(
  stackXml: string,
): OpenRasterFixtureMetadata {
  const imageMatch = stackXml.match(/<image\s+([^>]*)>/);
  if (imageMatch === null) {
    throw new Error("Fixture stack.xml is missing image metadata.");
  }

  return {
    image: parseXmlAttributes(imageMatch[1]),
    layers: [...stackXml.matchAll(/<layer\s+([^>]*)\/>/g)].map(
      (match) => {
        const attributes = parseXmlAttributes(match[1]);
        return {
          compositeOp: attributes["composite-op"],
          name: attributes.name,
          opacity: attributes.opacity,
          src: attributes.src,
          visibility: attributes.visibility,
          x: attributes.x,
          y: attributes.y,
        };
      },
    ),
  };
}

function parseKritaFixtureMetadata(maindocXml: string): KritaFixtureMetadata {
  const docMatch = maindocXml.match(/<DOC\s+([^>]*)>/);
  const imageMatch = maindocXml.match(/<IMAGE\s+([^>]*)>/);
  if (docMatch === null || imageMatch === null) {
    throw new Error("Fixture maindoc.xml is missing Krita document metadata.");
  }

  const doc = parseXmlAttributes(docMatch[1]);
  const image = parseXmlAttributes(imageMatch[1]);
  return {
    doc: {
      depth: doc.depth,
      editor: doc.editor,
      syntaxVersion: doc.syntaxVersion,
    },
    image: {
      colorSpaceName: image.colorspacename,
      height: image.height,
      mime: image.mime,
      name: image.name,
      profile: image.profile,
      width: image.width,
    },
    layers: [...maindocXml.matchAll(/<layer\s+([^>]*)\/>/g)].map(
      (match) => {
        const attributes = parseXmlAttributes(match[1]);
        return {
          colorSpaceName: attributes.colorspacename,
          compositeOp: attributes.compositeop,
          fileName: attributes.filename,
          name: attributes.name,
          nodeType: attributes.nodetype,
          opacity: attributes.opacity,
          visible: attributes.visible,
          x: attributes.x,
          y: attributes.y,
        };
      },
    ),
  };
}

function parsePixeloramaFixture(relativePath: string): {
  data: PixeloramaFixture;
  entries: ZipFixtureEntry[];
  entryMap: Map<string, ZipFixtureEntry>;
} {
  const entries = inspectZipFixture(relativePath);
  const entryMap = zipEntryMap(entries);
  const dataJson = entryMap.get("data.json")?.content.toString("utf8") ?? "";
  return {
    data: JSON.parse(dataJson) as PixeloramaFixture,
    entries,
    entryMap,
  };
}

function pixeloramaRawPixel(
  bytes: Buffer,
  width: number,
  x: number,
  y: number,
): number[] {
  const offset = (y * width + x) * 4;
  return [...bytes.subarray(offset, offset + 4)];
}

function inspectKritaNativeTile(bytes: Buffer): {
  dataSize: number;
  rawBgraTile: Buffer;
  tileHeader: string;
  versionHeader: string[];
} {
  let offset = 0;
  const lines: string[] = [];
  for (let lineIndex = 0; lineIndex < 6; lineIndex += 1) {
    const next = bytes.indexOf(0x0a, offset);
    expect(next).toBeGreaterThanOrEqual(0);
    lines.push(bytes.toString("utf8", offset, next));
    offset = next + 1;
  }

  expect(lines.slice(0, 5)).toEqual([
    "VERSION 2",
    "TILEWIDTH 64",
    "TILEHEIGHT 64",
    "PIXELSIZE 4",
    "DATA 1",
  ]);
  const [x, y, compression, size] = lines[5].split(",");
  expect([x, y, compression]).toEqual(["0", "0", "LZF"]);
  const dataSize = Number(size);
  expect(Number.isSafeInteger(dataSize)).toBe(true);
  expect(bytes[offset]).toBe(0);
  expect(bytes.subarray(offset + 1, offset + dataSize)).toHaveLength(64 * 64 * 4);

  return {
    dataSize,
    rawBgraTile: bytes.subarray(offset + 1, offset + dataSize),
    tileHeader: lines[5],
    versionHeader: lines.slice(0, 5),
  };
}

function kritaBgraPixel(
  tileBytes: Buffer,
  x: number,
  y: number,
): number[] {
  const offset = (y * 64 + x) * 4;
  return [...tileBytes.subarray(offset, offset + 4)];
}

function inspectApngFixture(relativePath: string): ApngFixtureMetadata {
  const png = readFileSync(join(fixtureDirectory, relativePath));
  expect(png.subarray(0, 8)).toEqual(pngSignature);

  let offset = 8;
  let width = 0;
  let height = 0;
  let declaredFrames = 0;
  let plays = 0;
  let currentFrame: (Omit<ApngFrameFixtureMetadata, "pixels"> & {
    compressed: Buffer[];
  }) | undefined;
  const chunkTypes: string[] = [];
  const sequenceNumbers: number[] = [];
  const encodedFrames: Array<NonNullable<typeof currentFrame>> = [];

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    expect(dataEnd + 4).toBeLessThanOrEqual(png.length);
    const data = png.subarray(dataStart, dataEnd);
    const crcPayload = png.subarray(offset + 4, dataEnd);
    expect(png.readUInt32BE(dataEnd)).toBe(fixtureCrc32(crcPayload));
    chunkTypes.push(type);
    offset = dataEnd + 4;

    if (type === "IHDR") {
      expect(data).toHaveLength(13);
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect([...data.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
    } else if (type === "acTL") {
      expect(data).toHaveLength(8);
      declaredFrames = data.readUInt32BE(0);
      plays = data.readUInt32BE(4);
    } else if (type === "fcTL") {
      expect(data).toHaveLength(26);
      currentFrame = {
        sequence: data.readUInt32BE(0),
        width: data.readUInt32BE(4),
        height: data.readUInt32BE(8),
        left: data.readUInt32BE(12),
        top: data.readUInt32BE(16),
        delayNumerator: data.readUInt16BE(20),
        delayDenominator: data.readUInt16BE(22),
        dispose: data[24],
        blend: data[25],
        compressed: [],
      };
      encodedFrames.push(currentFrame);
      sequenceNumbers.push(currentFrame.sequence);
    } else if (type === "IDAT") {
      if (currentFrame === undefined) {
        throw new Error("Fixture IDAT is missing fcTL.");
      }
      currentFrame.compressed.push(Buffer.from(data));
    } else if (type === "fdAT") {
      if (currentFrame === undefined) {
        throw new Error("Fixture fdAT is missing fcTL.");
      }
      const sequence = data.readUInt32BE(0);
      sequenceNumbers.push(sequence);
      currentFrame.compressed.push(Buffer.from(data.subarray(4)));
    } else if (type === "IEND") {
      expect(data).toHaveLength(0);
      break;
    }
  }

  expect(offset).toBe(png.length);
  const frames = encodedFrames.map(({ compressed, ...frame }) => {
    const rows = inflateSync(Buffer.concat(compressed));
    const rowLength = frame.width * 4;
    expect(rows).toHaveLength(frame.height * (rowLength + 1));
    const pixels = Buffer.alloc(frame.width * frame.height * 4);
    for (let y = 0; y < frame.height; y += 1) {
      const rowOffset = y * (rowLength + 1);
      expect(rows[rowOffset]).toBe(0);
      rows.copy(pixels, y * rowLength, rowOffset + 1, rowOffset + 1 + rowLength);
    }
    return { ...frame, pixels };
  });
  expect(frames).toHaveLength(declaredFrames);

  return {
    chunkTypes,
    declaredFrames,
    frames,
    height,
    plays,
    sequenceNumbers,
    width,
  };
}

function normalizeApngFixtureDelay(numerator: number, denominator: number): number {
  const effectiveDenominator = denominator === 0 ? 100 : denominator;
  return Math.max(
    1,
    Math.min(65_535, Math.round((numerator * 1000) / effectiveDenominator)),
  );
}

function compositeApngFixture(
  fixture: ApngFixtureMetadata,
): Uint8ClampedArray[] {
  let canvas = new Uint8ClampedArray(fixture.width * fixture.height * 4);
  const snapshots: Uint8ClampedArray[] = [];

  for (const frame of fixture.frames) {
    const before = canvas.slice();
    for (let y = 0; y < frame.height; y += 1) {
      for (let x = 0; x < frame.width; x += 1) {
        const sourceOffset = (y * frame.width + x) * 4;
        const destinationOffset = (
          (frame.top + y) * fixture.width + frame.left + x
        ) * 4;
        if (frame.blend === 0) {
          canvas.set(
            frame.pixels.subarray(sourceOffset, sourceOffset + 4),
            destinationOffset,
          );
          continue;
        }

        const sourceAlpha = frame.pixels[sourceOffset + 3] / 255;
        const destinationAlpha = canvas[destinationOffset + 3] / 255;
        const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
        if (outputAlpha === 0) {
          canvas.fill(0, destinationOffset, destinationOffset + 4);
          continue;
        }
        for (let channel = 0; channel < 3; channel += 1) {
          canvas[destinationOffset + channel] = Math.round((
            frame.pixels[sourceOffset + channel] * sourceAlpha
            + canvas[destinationOffset + channel]
              * destinationAlpha * (1 - sourceAlpha)
          ) / outputAlpha);
        }
        canvas[destinationOffset + 3] = Math.round(outputAlpha * 255);
      }
    }
    snapshots.push(canvas.slice());

    if (frame.dispose === 1) {
      for (let y = 0; y < frame.height; y += 1) {
        const start = ((frame.top + y) * fixture.width + frame.left) * 4;
        canvas.fill(0, start, start + frame.width * 4);
      }
    } else if (frame.dispose === 2) {
      canvas = before;
    }
  }
  return snapshots;
}

function apngPixel(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): number[] {
  const offset = (y * width + x) * 4;
  return [...pixels.slice(offset, offset + 4)];
}

function inspectGifFixture(relativePath: string): GifFixtureMetadata {
  const gif = readFileSync(join(fixtureDirectory, relativePath));
  const signature = gif.toString("ascii", 0, 6);
  expect(signature).toBe("GIF89a");

  const width = gif.readUInt16LE(6);
  const height = gif.readUInt16LE(8);
  const logicalScreenPacked = gif[10];
  const backgroundColorIndex = gif[11];
  const pixelAspectRatio = gif[12];
  expect(logicalScreenPacked & 0x80).toBe(0x80);

  const globalColorTableEntries = 1 << ((logicalScreenPacked & 0x07) + 1);
  let offset = 13 + globalColorTableEntries * 3;
  let loopCount: number | null = null;
  let pendingControl: Pick<
    GifFrameFixtureMetadata,
    "delayCentiseconds" | "disposal" | "transparentIndex"
  > | null = null;
  const frames: GifFrameFixtureMetadata[] = [];

  const readSubBlocks = (): Buffer => {
    const blocks: Buffer[] = [];
    while (true) {
      const length = gif[offset];
      offset += 1;
      expect(length).toBeDefined();
      if (length === 0) {
        return Buffer.concat(blocks);
      }
      expect(offset + length).toBeLessThanOrEqual(gif.length);
      blocks.push(gif.subarray(offset, offset + length));
      offset += length;
    }
  };

  while (gif[offset] !== 0x3b) {
    expect(offset).toBeLessThan(gif.length);
    const introducer = gif[offset];

    if (introducer === 0x21 && gif[offset + 1] === 0xf9) {
      expect(gif[offset + 2]).toBe(4);
      const packed = gif[offset + 3];
      pendingControl = {
        delayCentiseconds: gif.readUInt16LE(offset + 4),
        disposal: (packed >> 2) & 0x07,
        transparentIndex: (packed & 0x01) === 0 ? null : gif[offset + 6],
      };
      expect(gif[offset + 7]).toBe(0);
      offset += 8;
      continue;
    }

    if (introducer === 0x21 && gif[offset + 1] === 0xff) {
      expect(gif[offset + 2]).toBe(11);
      const identifier = gif.toString("ascii", offset + 3, offset + 14);
      offset += 14;
      const applicationData = readSubBlocks();
      if (identifier === "NETSCAPE2.0") {
        expect([...applicationData.subarray(0, 1)]).toEqual([1]);
        expect(applicationData).toHaveLength(3);
        loopCount = applicationData.readUInt16LE(1);
      }
      continue;
    }

    expect(introducer).toBe(0x2c);
    const left = gif.readUInt16LE(offset + 1);
    const top = gif.readUInt16LE(offset + 3);
    const frameWidth = gif.readUInt16LE(offset + 5);
    const frameHeight = gif.readUInt16LE(offset + 7);
    const imagePacked = gif[offset + 9];
    offset += 10;
    if ((imagePacked & 0x80) !== 0) {
      offset += (1 << ((imagePacked & 0x07) + 1)) * 3;
    }
    const lzwMinimumCodeSize = gif[offset];
    offset += 1;
    expect(readSubBlocks().length).toBeGreaterThan(0);

    frames.push({
      delayCentiseconds: pendingControl?.delayCentiseconds ?? 0,
      disposal: pendingControl?.disposal ?? 0,
      height: frameHeight,
      interlaced: (imagePacked & 0x40) !== 0,
      left,
      lzwMinimumCodeSize,
      top,
      transparentIndex: pendingControl?.transparentIndex ?? null,
      width: frameWidth,
    });
    pendingControl = null;
  }

  expect(gif[offset]).toBe(0x3b);
  expect(offset).toBe(gif.length - 1);
  return {
    backgroundColorIndex,
    frames,
    height,
    loopCount,
    pixelAspectRatio,
    signature,
    width,
  };
}

function normalizeGifFixtureDelay(delayCentiseconds: number): number {
  if (delayCentiseconds === 0) {
    return 100;
  }
  return Math.max(20, Math.min(65_535, delayCentiseconds * 10));
}

function decodePng(png: Buffer): ImageData {
  expect(png.subarray(0, 8)).toEqual(pngSignature);

  let offset = 8;
  let width = 0;
  let height = 0;
  const compressedData: Buffer[] = [];

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect([...data.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
    } else if (type === "IDAT") {
      compressedData.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  const rows = inflateSync(Buffer.concat(compressedData));
  const pixels = new Uint8ClampedArray(width * height * 4);
  const rowLength = width * 4;

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (rowLength + 1);
    expect(rows[rowOffset]).toBe(0);
    pixels.set(rows.subarray(rowOffset + 1, rowOffset + 1 + rowLength), y * rowLength);
  }

  return { colorSpace: "srgb", data: pixels, height, width };
}

function decodeFixturePng(relativePath: string): ImageData {
  return decodePng(readFileSync(join(fixtureDirectory, relativePath)));
}

function parsePiskelFixture(relativePath: string): {
  fixture: PiskelFixture;
  layers: PiskelLayerFixture[];
} {
  const fixture = JSON.parse(
    readFileSync(join(fixtureDirectory, relativePath), "utf8"),
  ) as PiskelFixture;
  return {
    fixture,
    layers: fixture.piskel.layers.map(
      (layer) => JSON.parse(layer) as PiskelLayerFixture,
    ),
  };
}

function decodePiskelChunk(chunk: PiskelChunkFixture): ImageData {
  const prefix = "data:image/png;base64,";
  expect(chunk.base64PNG.startsWith(prefix)).toBe(true);
  const payload = chunk.base64PNG.slice(prefix.length);
  expect(payload).toMatch(
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
  );
  const png = Buffer.from(payload, "base64");
  expect(png.toString("base64")).toBe(payload);
  return decodePng(png);
}

function expectPiskelFixtureShape(
  fixture: PiskelFixture,
  layers: PiskelLayerFixture[],
): void {
  expect(Object.keys(fixture).sort()).toEqual(["modelVersion", "piskel"]);
  expect(Object.keys(fixture.piskel).sort()).toEqual([
    "description",
    "fps",
    "height",
    "hiddenFrames",
    "layers",
    "name",
    "width",
  ]);
  expect(fixture.piskel.layers).toHaveLength(layers.length);
  expect(
    fixture.piskel.layers.every((layer) => typeof layer === "string"),
  ).toBe(true);

  const frameCount = layers[0].frameCount;
  for (const layer of layers) {
    expect(Object.keys(layer).sort()).toEqual([
      "chunks",
      "frameCount",
      "name",
      "opacity",
    ]);
    expect(layer.frameCount).toBe(frameCount);
    expect(layer.chunks.length).toBeGreaterThan(0);
    const frameIndexes: number[] = [];

    for (const chunk of layer.chunks) {
      expect(Object.keys(chunk).sort()).toEqual(["base64PNG", "layout"]);
      expect(chunk.layout.length).toBeGreaterThan(0);
      const rowCount = chunk.layout[0].length;
      expect(rowCount).toBeGreaterThan(0);
      expect(
        chunk.layout.every((column) => column.length === rowCount),
      ).toBe(true);
      frameIndexes.push(...chunk.layout.flat());

      const image = decodePiskelChunk(chunk);
      expect(image.width).toBe(fixture.piskel.width * chunk.layout.length);
      expect(image.height).toBe(fixture.piskel.height * rowCount);
    }

    expect(frameIndexes.sort((left, right) => left - right)).toEqual(
      Array.from({ length: frameCount }, (_, index) => index),
    );
  }
}

function pixel(image: ImageData, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4;
  return [...image.data.slice(offset, offset + 4)];
}

describe("synthetic sprite fixtures", () => {
  it("provides a Krita ZIP with native paint-layer tile data", () => {
    const entries = inspectZipFixture("krita/two-paint-layers.kra");
    const entryMap = zipEntryMap(entries);

    expect(entries.map(({ name }) => name)).toEqual([
      "mimetype",
      "maindoc.xml",
      "documentinfo.xml",
      "preview.png",
      "Synthetic Krita/layers/layer1",
      "Synthetic Krita/layers/layer1.defaultpixel",
      "Synthetic Krita/layers/layer2",
      "Synthetic Krita/layers/layer2.defaultpixel",
      "mergedimage.png",
    ]);
    expect(entries[0]).toMatchObject({
      name: "mimetype",
      compressionMethod: 0,
    });
    expect(entries[0].content.toString("utf8")).toBe("application/x-krita");

    const metadata = parseKritaFixtureMetadata(
      entryMap.get("maindoc.xml")?.content.toString("utf8") ?? "",
    );
    expect(metadata).toMatchObject({
      doc: { editor: "krita", depth: "8", syntaxVersion: "2.0" },
      image: {
        mime: "application/x-kra",
        name: "Synthetic Krita",
        width: "2",
        height: "2",
        colorSpaceName: "RGBA",
        profile: "sRGB-elle-V2-srgbtrc.icc",
      },
    });
    expect(metadata.layers).toEqual([
      {
        name: "Top hidden half",
        nodeType: "paintlayer",
        fileName: "layer1",
        x: "1",
        y: "-1",
        opacity: "128",
        visible: "0",
        compositeOp: "normal",
        colorSpaceName: "RGBA",
      },
      {
        name: "Base visible",
        nodeType: "paintlayer",
        fileName: "layer2",
        x: "0",
        y: "0",
        opacity: "255",
        visible: "1",
        compositeOp: "normal",
        colorSpaceName: "RGBA",
      },
    ]);
    expect(decodePng(entryMap.get("preview.png")?.content ?? Buffer.alloc(0)))
      .toMatchObject({ width: 2, height: 2 });
    expect(decodePng(entryMap.get("mergedimage.png")?.content ?? Buffer.alloc(0)))
      .toMatchObject({ width: 2, height: 2 });

    const topTile = inspectKritaNativeTile(
      entryMap.get("Synthetic Krita/layers/layer1")?.content ?? Buffer.alloc(0),
    );
    const baseTile = inspectKritaNativeTile(
      entryMap.get("Synthetic Krita/layers/layer2")?.content ?? Buffer.alloc(0),
    );
    expect(topTile.tileHeader).toBe("0,0,LZF,16385");
    expect(baseTile.dataSize).toBe(16_385);
    expect(entryMap.get("Synthetic Krita/layers/layer1.defaultpixel")?.content)
      .toEqual(Buffer.from([0, 0, 0, 0]));
    expect(kritaBgraPixel(topTile.rawBgraTile, 1, 0))
      .toEqual([102, 209, 255, 255]);
    expect(kritaBgraPixel(topTile.rawBgraTile, 0, 1))
      .toEqual([111, 71, 239, 255]);
    expect(kritaBgraPixel(baseTile.rawBgraTile, 0, 0))
      .toEqual([178, 138, 17, 255]);
    expect(kritaBgraPixel(baseTile.rawBgraTile, 1, 1))
      .toEqual([102, 209, 255, 255]);
  });

  it("provides Krita rejection fixtures for unsupported semantics", () => {
    const vector = zipEntryMap(inspectZipFixture("krita/unsupported-vector-layer.kra"));
    const vectorMetadata = parseKritaFixtureMetadata(
      vector.get("maindoc.xml")?.content.toString("utf8") ?? "",
    );
    expect(vectorMetadata.layers[0]).toMatchObject({
      name: "Vector unsupported",
      nodeType: "shapelayer",
    });

    const colorDepth = zipEntryMap(inspectZipFixture("krita/unsupported-color-depth.kra"));
    const colorDepthMetadata = parseKritaFixtureMetadata(
      colorDepth.get("maindoc.xml")?.content.toString("utf8") ?? "",
    );
    expect(colorDepthMetadata.image).toMatchObject({
      colorSpaceName: "RGBA16",
      width: "2",
      height: "2",
    });
    expect(colorDepthMetadata.layers[0]).toMatchObject({
      colorSpaceName: "RGBA16",
      nodeType: "paintlayer",
    });

    const missing = zipEntryMap(inspectZipFixture("krita/missing-layer-data.kra"));
    const missingMetadata = parseKritaFixtureMetadata(
      missing.get("maindoc.xml")?.content.toString("utf8") ?? "",
    );
    expect(missingMetadata.layers.map(({ fileName }) => fileName))
      .toEqual(["layer1", "layer2"]);
    expect(missing.has("Synthetic Krita/layers/layer1")).toBe(false);
    expect(missing.has("Synthetic Krita/layers/layer2")).toBe(false);

    const flattened = zipEntryMap(inspectZipFixture("krita/flattened-preview-only.kra"));
    const flattenedMetadata = parseKritaFixtureMetadata(
      flattened.get("maindoc.xml")?.content.toString("utf8") ?? "",
    );
    expect(flattenedMetadata.layers).toHaveLength(0);
    expect(decodePng(flattened.get("mergedimage.png")?.content ?? Buffer.alloc(0)))
      .toMatchObject({ width: 2, height: 2 });
  });

  it("provides a minimal OpenRaster ZIP with two PNG-backed layers", () => {
    const entries = inspectZipFixture("openraster/two-layers.ora");
    const entryMap = zipEntryMap(entries);

    expect(entries.map(({ name }) => name)).toEqual([
      "mimetype",
      "stack.xml",
      "data/base-visible.png",
      "data/top-hidden.png",
      "Thumbnails/thumbnail.png",
      "mergedimage.png",
    ]);
    expect(entries[0]).toMatchObject({
      name: "mimetype",
      compressionMethod: 0,
    });
    expect(entries[0].content.toString("utf8")).toBe("image/openraster");

    const stackXml = entryMap.get("stack.xml")?.content.toString("utf8") ?? "";
    const metadata = parseOpenRasterFixtureMetadata(stackXml);
    expect(metadata.image).toMatchObject({
      version: "0.0.6",
      w: "4",
      h: "3",
    });
    expect(metadata.layers).toEqual([
      {
        name: "Top hidden half",
        src: "data/top-hidden.png",
        x: "1",
        y: "-1",
        opacity: "0.5",
        visibility: "hidden",
        compositeOp: "svg:src-over",
      },
      {
        name: "Base visible",
        src: "data/base-visible.png",
        x: "0",
        y: "1",
        opacity: undefined,
        visibility: undefined,
        compositeOp: undefined,
      },
    ]);

    for (const { src } of metadata.layers) {
      const png = entryMap.get(src ?? "")?.content;
      expect(png?.subarray(0, 8)).toEqual(pngSignature);
      expect(decodePng(png ?? Buffer.alloc(0))).toMatchObject({
        width: 2,
        height: 2,
      });
    }
    expect(decodePng(entryMap.get("Thumbnails/thumbnail.png")?.content ?? Buffer.alloc(0)))
      .toMatchObject({ width: 2, height: 2 });
    expect(decodePng(entryMap.get("mergedimage.png")?.content ?? Buffer.alloc(0)))
      .toMatchObject({ width: 4, height: 3 });
  });

  it("provides OpenRaster rejection fixtures for importer diagnostics", () => {
    const unsupportedBlend = zipEntryMap(
      inspectZipFixture("openraster/unsupported-blend-mode.ora"),
    );
    const blendStackXml = unsupportedBlend.get("stack.xml")?.content.toString("utf8") ?? "";
    expect(parseOpenRasterFixtureMetadata(blendStackXml).layers[0])
      .toMatchObject({ compositeOp: "svg:multiply" });

    const missingData = zipEntryMap(
      inspectZipFixture("openraster/missing-layer-data.ora"),
    );
    const missingStackXml = missingData.get("stack.xml")?.content.toString("utf8") ?? "";
    const missingMetadata = parseOpenRasterFixtureMetadata(missingStackXml);
    expect(missingMetadata.layers.map(({ src }) => src)).toEqual([
      "data/top-hidden.png",
      "data/base-visible.png",
    ]);
    expect(missingData.has("data/base-visible.png")).toBe(true);
    expect(missingData.has("data/top-hidden.png")).toBe(false);

    const malformed = zipEntryMap(
      inspectZipFixture("openraster/malformed-stack.ora"),
    );
    const malformedStackXml = malformed.get("stack.xml")?.content.toString("utf8") ?? "";
    expect(malformedStackXml).toContain("<layer name=\"Broken\"");
    expect(parseOpenRasterFixtureMetadata(malformedStackXml).layers).toHaveLength(0);
  });

  it("provides a Pixelorama ZIP with raw pixel layers and frame timing", () => {
    const { data, entries, entryMap } = parsePixeloramaFixture(
      "pixelorama/two-layers-two-frames.pxo",
    );

    expect(entries.map(({ name }) => name)).toEqual([
      "data.json",
      "mimetype",
      "preview.png",
      "image_data/frames/1/layer_1",
      "image_data/frames/1/indices_layer_1",
      "image_data/frames/1/layer_2",
      "image_data/frames/1/indices_layer_2",
      "image_data/frames/2/layer_1",
      "image_data/frames/2/indices_layer_1",
      "image_data/frames/2/layer_2",
      "image_data/frames/2/indices_layer_2",
    ]);
    expect(entryMap.get("mimetype")?.content.toString("utf8"))
      .toBe("application/x-pixelorama");
    expect(decodePng(entryMap.get("preview.png")?.content ?? Buffer.alloc(0)))
      .toMatchObject({ width: 2, height: 2 });

    expect(data).toMatchObject({
      pixelorama_version: "1.1.10",
      pxo_version: 6,
      size_x: 2,
      size_y: 2,
      color_mode: 5,
      fps: 10,
      metadata: {},
    });
    expect(data.layers.map((layer) => ({
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      blendMode: layer.blend_mode,
      type: layer.type,
      effects: layer.effects,
      parent: layer.parent,
    }))).toEqual([
      {
        name: "Base visible half",
        visible: true,
        opacity: 0.5,
        blendMode: 0,
        type: 0,
        effects: [],
        parent: -1,
      },
      {
        name: "Hidden ink",
        visible: false,
        opacity: 1,
        blendMode: 0,
        type: 0,
        effects: [],
        parent: -1,
      },
    ]);
    expect(data.frames.map(({ duration }) =>
      Math.max(1, Math.min(65_535, Math.round((duration * 1000) / data.fps)))))
      .toEqual([100, 250]);
    expect(data.frames.every(({ cels }) => cels.length === data.layers.length))
      .toBe(true);
    expect(data.frames.flatMap(({ cels }) => cels).every((cel) =>
      cel.opacity === 1 && cel.z_index === 0 && Object.keys(cel.metadata).length === 0))
      .toBe(true);

    const firstBase = entryMap.get("image_data/frames/1/layer_1")?.content
      ?? Buffer.alloc(0);
    const firstInk = entryMap.get("image_data/frames/1/layer_2")?.content
      ?? Buffer.alloc(0);
    const secondInk = entryMap.get("image_data/frames/2/layer_2")?.content
      ?? Buffer.alloc(0);
    for (const [path, entry] of entryMap) {
      if (path.includes("/layer_")) {
        expect(entry.content).toHaveLength(data.size_x * data.size_y * 4);
      } else if (path.includes("/indices_layer_")) {
        expect(entry.content).toEqual(Buffer.from([0]));
      }
    }
    expect(pixeloramaRawPixel(firstBase, data.size_x, 0, 0))
      .toEqual([17, 138, 178, 255]);
    expect(pixeloramaRawPixel(firstBase, data.size_x, 1, 1))
      .toEqual([255, 209, 102, 255]);
    expect(pixeloramaRawPixel(firstInk, data.size_x, 1, 0))
      .toEqual([239, 71, 111, 255]);
    expect(pixeloramaRawPixel(secondInk, data.size_x, 0, 1))
      .toEqual([255, 209, 102, 255]);
  });

  it("provides Pixelorama rejection fixtures for unsupported semantics", () => {
    const unsupportedBlend = parsePixeloramaFixture(
      "pixelorama/unsupported-blend-mode.pxo",
    );
    expect(unsupportedBlend.data.layers[0]).toMatchObject({
      name: "Multiply unsupported",
      blend_mode: 3,
      type: 0,
    });

    const unsupportedEffects = parsePixeloramaFixture(
      "pixelorama/unsupported-effects.pxo",
    );
    expect(unsupportedEffects.data.layers[0].effects).toEqual([
      { enabled: true, name: "Outline" },
    ]);

    const tilemap = parsePixeloramaFixture(
      "pixelorama/unsupported-tilemap-layer.pxo",
    );
    expect(tilemap.data.layers[0]).toMatchObject({
      name: "Tilemap unsupported",
      type: 3,
    });
    expect(tilemap.data.tilesets).toEqual([{ tile_size: "(2, 2)", tile_amount: 1 }]);
    expect(tilemap.entryMap.has("tilesets/0/0")).toBe(true);

    const missingImageData = parsePixeloramaFixture(
      "pixelorama/missing-image-data.pxo",
    );
    expect(missingImageData.data.frames).toHaveLength(1);
    expect(missingImageData.entryMap.has("image_data/frames/1/layer_1"))
      .toBe(false);

    const ambiguousMetadata = parsePixeloramaFixture(
      "pixelorama/ambiguous-metadata.pxo",
    );
    expect(ambiguousMetadata.data.metadata).toEqual({
      fixture_note: "reject ambiguous project metadata",
    });
  });

  it("provides tiny PSD fixtures with deterministic raster layer metadata", () => {
    const oneLayer = inspectPsdFixture("psd/one-layer.psd");
    const twoLayers = inspectPsdFixture("psd/two-layers.psd");

    expect(oneLayer).toMatchObject({
      version: 1,
      channels: 4,
      height: 2,
      width: 2,
      bitsPerChannel: 8,
      colorMode: 3,
      layers: [
        {
          name: "Single visible",
          top: 0,
          left: 0,
          bottom: 2,
          right: 2,
          blendModeKey: "norm",
          opacity: 255,
          hidden: false,
        },
      ],
    });
    expect(oneLayer.layers[0].channels).toEqual([
      { id: 0, length: 6, compression: 0 },
      { id: 1, length: 6, compression: 0 },
      { id: 2, length: 6, compression: 0 },
      { id: -1, length: 6, compression: 0 },
    ]);

    expect(twoLayers).toMatchObject({
      version: 1,
      channels: 4,
      height: 3,
      width: 4,
      bitsPerChannel: 8,
      colorMode: 3,
      layers: [
        {
          name: "Top hidden half",
          top: 0,
          left: 1,
          bottom: 2,
          right: 3,
          blendModeKey: "norm",
          opacity: 128,
          hidden: true,
        },
        {
          name: "Base visible",
          top: 1,
          left: 0,
          bottom: 3,
          right: 2,
          blendModeKey: "norm",
          opacity: 255,
          hidden: false,
        },
      ],
    });
    expect(twoLayers.layers.every((layer) =>
      layer.channels.map(({ id }) => id).join(",") === "0,1,2,-1"))
      .toBe(true);
  });

  it("provides PSD rejection fixtures for unsupported and malformed data", () => {
    const unsupportedBlend = inspectPsdFixture("psd/unsupported-blend-mode.psd");
    const malformed = inspectPsdFixture("psd/malformed-channel-length.psd");

    expect(unsupportedBlend.layers[0]).toMatchObject({
      name: "Multiply unsupported",
      blendModeKey: "mul ",
      hidden: false,
    });
    expect(malformed.layers[0]).toMatchObject({
      name: "Single visible",
      blendModeKey: "norm",
    });
    expect(malformed.layers[0].channels[0]).toEqual({
      id: 0,
      length: 5,
      compression: 0,
    });
    expect(malformed.layers[0].channels.slice(1)).toEqual([
      { id: 1, length: 6, compression: 0 },
      { id: 2, length: 6, compression: 0 },
      { id: -1, length: 6, compression: 0 },
    ]);
  });

  it("provides APNG chunk sequences, offsets, and normalized timing", () => {
    const apng = inspectApngFixture("apng/timing-offsets.apng");

    expect(apng).toMatchObject({
      width: 3,
      height: 2,
      declaredFrames: 4,
      plays: 0,
    });
    expect(apng.chunkTypes).toEqual([
      "IHDR", "acTL", "fcTL", "IDAT", "fcTL", "fdAT",
      "fcTL", "fdAT", "fcTL", "fdAT", "IEND",
    ]);
    expect(apng.sequenceNumbers).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(apng.frames.map((frame) => ({
      rectangle: [frame.left, frame.top, frame.width, frame.height],
      delay: [frame.delayNumerator, frame.delayDenominator],
      dispose: frame.dispose,
      blend: frame.blend,
    }))).toEqual([
      { rectangle: [0, 0, 3, 2], delay: [0, 100], dispose: 0, blend: 0 },
      { rectangle: [1, 0, 2, 1], delay: [1, 60], dispose: 0, blend: 0 },
      { rectangle: [2, 1, 1, 1], delay: [1, 0], dispose: 0, blend: 0 },
      { rectangle: [0, 1, 1, 1], delay: [65_535, 1], dispose: 0, blend: 0 },
    ]);
    expect(apng.frames.map(({ delayNumerator, delayDenominator }) =>
      normalizeApngFixtureDelay(delayNumerator, delayDenominator)))
      .toEqual([1, 17, 10, 65_535]);
  });

  it("provides distinct APNG source and over alpha blending", () => {
    const apng = inspectApngFixture("apng/blend.apng");
    const snapshots = compositeApngFixture(apng);

    expect(apng.frames.map(({ blend }) => blend)).toEqual([0, 0, 1]);
    expect(apngPixel(snapshots[0], apng.width, 0, 0))
      .toEqual([255, 0, 0, 255]);
    expect(apngPixel(snapshots[1], apng.width, 0, 0))
      .toEqual([0, 0, 255, 128]);
    expect(apngPixel(snapshots[2], apng.width, 1, 0))
      .toEqual([128, 127, 0, 255]);
  });

  it("provides APNG none, background, and previous disposal behavior", () => {
    const apng = inspectApngFixture("apng/disposal.apng");
    const snapshots = compositeApngFixture(apng);

    expect(apng.frames.map(({ dispose }) => dispose)).toEqual([0, 1, 2, 0]);
    expect(snapshots.map((snapshot) => [0, 1, 2].map(
      (x) => apngPixel(snapshot, apng.width, x, 0),
    ))).toEqual([
      [[255, 0, 0, 255], [255, 0, 0, 255], [255, 0, 0, 255]],
      [[255, 0, 0, 255], [0, 255, 0, 255], [255, 0, 0, 255]],
      [[255, 0, 0, 255], [0, 0, 0, 0], [0, 0, 255, 255]],
      [[255, 209, 102, 255], [0, 0, 0, 0], [255, 0, 0, 255]],
    ]);
  });

  it("provides GIF89a timing, transparency, offsets, and loop metadata", () => {
    const gif = inspectGifFixture("gif/timing-transparency-offsets.gif");

    expect(gif).toMatchObject({
      signature: "GIF89a",
      width: 3,
      height: 2,
      backgroundColorIndex: 0,
      pixelAspectRatio: 0,
      loopCount: 0,
    });
    expect(gif.frames.map((frame) => ({
      rectangle: [frame.left, frame.top, frame.width, frame.height],
      delay: frame.delayCentiseconds,
      disposal: frame.disposal,
      transparentIndex: frame.transparentIndex,
      interlaced: frame.interlaced,
      lzwMinimumCodeSize: frame.lzwMinimumCodeSize,
    }))).toEqual([
      { rectangle: [0, 0, 3, 2], delay: 0, disposal: 1, transparentIndex: 0, interlaced: false, lzwMinimumCodeSize: 2 },
      { rectangle: [1, 0, 2, 1], delay: 1, disposal: 1, transparentIndex: 0, interlaced: false, lzwMinimumCodeSize: 2 },
      { rectangle: [2, 1, 1, 1], delay: 12, disposal: 1, transparentIndex: 0, interlaced: false, lzwMinimumCodeSize: 2 },
      { rectangle: [0, 1, 1, 1], delay: 65_535, disposal: 1, transparentIndex: 0, interlaced: false, lzwMinimumCodeSize: 2 },
    ]);
    expect(gif.frames.map(({ delayCentiseconds }) =>
      normalizeGifFixtureDelay(delayCentiseconds)))
      .toEqual([100, 20, 120, 65_535]);
  });

  it("provides GIF89a background and previous disposal sequences", () => {
    const background = inspectGifFixture("gif/disposal-background.gif");
    const previous = inspectGifFixture("gif/disposal-previous.gif");

    expect(background.frames.map(({ left, top, width, height, disposal }) => ({
      rectangle: [left, top, width, height],
      disposal,
    }))).toEqual([
      { rectangle: [0, 0, 3, 2], disposal: 1 },
      { rectangle: [1, 0, 1, 1], disposal: 2 },
      { rectangle: [2, 0, 1, 1], disposal: 1 },
    ]);
    expect(previous.frames.map(({ left, top, width, height, disposal }) => ({
      rectangle: [left, top, width, height],
      disposal,
    }))).toEqual([
      { rectangle: [0, 0, 3, 2], disposal: 1 },
      { rectangle: [1, 0, 1, 2], disposal: 3 },
      { rectangle: [2, 1, 1, 1], disposal: 1 },
    ]);
    expect(background.frames.every(({ delayCentiseconds }) =>
      delayCentiseconds === 5)).toBe(true);
    expect(previous.frames.every(({ delayCentiseconds }) =>
      delayCentiseconds === 7)).toBe(true);
  });

  it("provides an intentionally out-of-bounds GIF frame", () => {
    const gif = inspectGifFixture("gif/invalid-frame-bounds.gif");
    const invalidFrame = gif.frames[1];

    expect(gif.frames).toHaveLength(2);
    expect([invalidFrame.left, invalidFrame.top, invalidFrame.width, invalidFrame.height])
      .toEqual([2, 1, 2, 1]);
    expect(invalidFrame.left + invalidFrame.width).toBeGreaterThan(gif.width);
  });

  it("provides a two-frame 4x4 PNG sequence with known RGBA pixels", () => {
    const frames = [
      decodeFixturePng("png-sequence/spark-01.png"),
      decodeFixturePng("png-sequence/spark-02.png"),
    ];
    const project = createPngSequenceProject(frames, { frameDurationMs: 100 });

    expect(project.frames).toHaveLength(2);
    expect(project).toMatchObject({ width: 4, height: 4 });
    expect(pixel(frames[0], 1, 1)).toEqual([255, 209, 102, 255]);
    expect(pixel(frames[0], 1, 0)).toEqual([239, 71, 111, 255]);
    expect(pixel(frames[1], 2, 0)).toEqual([17, 138, 178, 255]);
    expect(pixel(frames[1], 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("provides one 8x4 sheet compatible with grid and JSON geometry", () => {
    const sheet = decodeFixturePng("spritesheet/spark-sheet.png");
    const gridProject = createSpritesheetGridProject(sheet, {
      frameWidth: 4,
      frameHeight: 4,
      rows: 1,
      columns: 2,
      frameOrder: "row-major",
    });
    const metadata = parseSpritesheetJsonMetadata(
      readFileSync(join(fixtureDirectory, "spritesheet/spark-sheet.json"), "utf8"),
    );
    const jsonProject = createSpritesheetJsonProject(sheet, metadata);

    expect(gridProject.frames).toHaveLength(2);
    expect(gridProject.layers[0].cels.map((cel) => pixel(cel.imageData, 1, 0))).toEqual([
      [239, 71, 111, 255],
      [0, 0, 0, 0],
    ]);
    expect(jsonProject).toMatchObject({ width: 4, height: 4 });
    expect(jsonProject.frames.map((frame) => frame.durationMs)).toEqual([80, 120]);
    expect(jsonProject.layers[0].cels.map((cel) => pixel(cel.imageData, 2, 0))).toEqual([
      [0, 0, 0, 0],
      [17, 138, 178, 255],
    ]);
  });

  it("provides a trimmed atlas with deterministic placement and timing", () => {
    const sheet = decodeFixturePng("spritesheet/trimmed-atlas.png");
    const metadata = parseSpritesheetJsonMetadata(
      readFileSync(
        join(fixtureDirectory, "spritesheet/trimmed-atlas.json"),
        "utf8",
      ),
    );
    const project = createSpritesheetJsonProject(sheet, metadata);
    const [topRight, leftColumn] = project.layers[0].cels.map(
      ({ imageData }) => imageData,
    );

    expect(sheet).toMatchObject({ width: 3, height: 2 });
    expect(project).toMatchObject({ width: 4, height: 4 });
    expect(project.frames.map(({ durationMs }) => durationMs))
      .toEqual([125, 75]);
    expect(pixel(topRight, 2, 0)).toEqual([255, 209, 102, 255]);
    expect(pixel(topRight, 3, 0)).toEqual([17, 138, 178, 255]);
    expect(pixel(topRight, 1, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(topRight, 2, 1)).toEqual([0, 0, 0, 0]);
    expect(pixel(leftColumn, 1, 1)).toEqual([239, 71, 111, 255]);
    expect(pixel(leftColumn, 1, 2)).toEqual([17, 138, 178, 255]);
    expect(pixel(leftColumn, 0, 1)).toEqual([0, 0, 0, 0]);
    expect(pixel(leftColumn, 1, 0)).toEqual([0, 0, 0, 0]);
  });

  it("provides asymmetric rotated atlas frames with and without trimming", () => {
    const sheet = decodeFixturePng("spritesheet/rotated-atlas.png");
    const metadata = parseSpritesheetJsonMetadata(
      readFileSync(
        join(fixtureDirectory, "spritesheet/rotated-atlas.json"),
        "utf8",
      ),
    );
    const project = createSpritesheetJsonProject(sheet, metadata);
    const [untrimmed, trimmed] = project.layers[0].cels.map(
      ({ imageData }) => imageData,
    );

    expect(sheet).toMatchObject({ width: 3, height: 3 });
    expect(project).toMatchObject({ width: 3, height: 2 });
    expect(project.frames.map(({ durationMs }) => durationMs))
      .toEqual([110, 65]);
    expect([
      pixel(untrimmed, 0, 0),
      pixel(untrimmed, 1, 0),
      pixel(untrimmed, 2, 0),
      pixel(untrimmed, 0, 1),
      pixel(untrimmed, 1, 1),
      pixel(untrimmed, 2, 1),
    ]).toEqual([
      [239, 71, 111, 255],
      [255, 209, 102, 255],
      [0, 0, 0, 0],
      [17, 138, 178, 255],
      [230, 57, 70, 255],
      [42, 157, 143, 255],
    ]);
    expect(pixel(trimmed, 1, 1)).toEqual([69, 123, 157, 255]);
    expect(pixel(trimmed, 2, 1)).toEqual([255, 255, 255, 255]);
    expect(pixel(trimmed, 0, 1)).toEqual([0, 0, 0, 0]);
    expect(pixel(trimmed, 1, 0)).toEqual([0, 0, 0, 0]);
  });

  it("provides unsupported numeric rotation metadata for rejection coverage", () => {
    const metadata = readFileSync(
      join(
        fixtureDirectory,
        "spritesheet/rotated-atlas-unsupported.json",
      ),
      "utf8",
    );

    expect(() => parseSpritesheetJsonMetadata(metadata)).toThrow(
      "frames[0].rotated must be a boolean; true uses TexturePacker's 90-degree clockwise atlas convention.",
    );
  });

  it("provides invalid trimmed metadata without placement geometry", () => {
    const metadata = readFileSync(
      join(
        fixtureDirectory,
        "spritesheet/trimmed-atlas-missing-placement.json",
      ),
      "utf8",
    );

    expect(() => parseSpritesheetJsonMetadata(metadata)).toThrow(
      "frames[0].spriteSourceSize must be an object when trimmed is true.",
    );
  });

  it("provides a chunked model-version-2 Piskel fixture with three distinct frames", () => {
    const { fixture, layers } = parsePiskelFixture("piskel/multi-frame.piskel");

    expect(fixture).toMatchObject({
      modelVersion: 2,
      piskel: {
        fps: 12,
        height: 2,
        hiddenFrames: [],
        name: "Synthetic motion",
        width: 2,
      },
    });
    expectPiskelFixtureShape(fixture, layers);
    expect(
      Math.max(1, Math.min(65_535, Math.round(1000 / fixture.piskel.fps))),
    ).toBe(83);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({
      name: "Motion",
      opacity: 1,
      frameCount: 3,
    });
    expect(layers[0].visible).toBeUndefined();
    expect(layers[0].chunks.map(({ layout }) => layout)).toEqual([
      [[0], [1]],
      [[2]],
    ]);
    expect("base64PNG" in layers[0]).toBe(false);

    const chunks = layers[0].chunks.map(decodePiskelChunk);
    expect(chunks.map(({ width, height }) => [width, height])).toEqual([
      [4, 2],
      [2, 2],
    ]);
    expect(pixel(chunks[0], 0, 0)).toEqual([230, 57, 70, 255]);
    expect(pixel(chunks[0], 3, 0)).toEqual([42, 157, 143, 255]);
    expect(pixel(chunks[1], 1, 0)).toEqual([255, 255, 255, 255]);
    expect(pixel(chunks[1], 0, 1)).toEqual([69, 123, 157, 255]);
  });

  it("provides ordered Piskel layers with names, opacity, and distinct pixels", () => {
    const { fixture, layers } = parsePiskelFixture("piskel/multi-layer.piskel");

    expect(fixture).toMatchObject({
      modelVersion: 2,
      piskel: { fps: 20, height: 2, name: "Synthetic layers", width: 2 },
    });
    expectPiskelFixtureShape(fixture, layers);
    expect(
      layers.map(({ name, opacity, frameCount }) => ({
        name,
        opacity,
        frameCount,
      })),
    ).toEqual([
        { name: "Background", opacity: 0.5, frameCount: 2 },
        { name: "Accent", opacity: 1, frameCount: 2 },
      ]);
    expect(layers.every(({ visible }) => visible === undefined)).toBe(true);
    expect(layers.map(({ chunks }) => chunks[0].layout)).toEqual([
      [[0], [1]],
      [[0], [1]],
    ]);

    const background = decodePiskelChunk(layers[0].chunks[0]);
    const accent = decodePiskelChunk(layers[1].chunks[0]);
    expect(pixel(background, 0, 0)).toEqual([69, 123, 157, 255]);
    expect(pixel(background, 2, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(accent, 0, 0)).toEqual([230, 57, 70, 255]);
    expect(pixel(accent, 3, 0)).toEqual([42, 157, 143, 255]);
  });

  it("matches deterministic generator output without writing fixtures", () => {
    expect(() =>
      execFileSync(process.execPath, [
        join(fixtureDirectory, "generate.mjs"),
        "--check",
      ]),
    ).not.toThrow();
  });
});
