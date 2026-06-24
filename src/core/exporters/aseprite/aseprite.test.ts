import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import type { SpriteProject } from "../../SpriteProject";
import {
  BinaryWriter,
  exportAseprite,
  UnsupportedAsepriteFeatureError,
} from ".";

function createMinimalProject(): SpriteProject {
  return {
    width: 1,
    height: 1,
    colorMode: "rgba",
    frames: [{ index: 0, durationMs: 100 }],
    layers: [
      {
        id: "main",
        name: "Main",
        visible: true,
        opacity: 255,
        cels: [],
      },
    ],
  };
}

function createImageData(
  width: number,
  height: number,
  bytes: number[],
): ImageData {
  return {
    colorSpace: "srgb",
    data: new Uint8ClampedArray(bytes),
    height,
    width,
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

type ParsedChunk = {
  bytes: Uint8Array;
  type: number;
};

function parseFrame(
  bytes: Uint8Array,
  offset: number,
): { chunks: ParsedChunk[]; nextOffset: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frameSize = view.getUint32(offset, true);
  const oldChunkCount = view.getUint16(offset + 6, true);
  const chunkCount =
    oldChunkCount === 0xffff ? view.getUint32(offset + 12, true) : oldChunkCount;
  const chunks: ParsedChunk[] = [];
  let chunkOffset = offset + 16;

  for (let index = 0; index < chunkCount; index += 1) {
    const chunkSize = view.getUint32(chunkOffset, true);
    chunks.push({
      bytes: bytes.slice(chunkOffset, chunkOffset + chunkSize),
      type: view.getUint16(chunkOffset + 4, true),
    });
    chunkOffset += chunkSize;
  }

  expect(chunkOffset).toBe(offset + frameSize);
  return { chunks, nextOffset: offset + frameSize };
}

describe("BinaryWriter", () => {
  it("writes explicit unsigned values in little-endian order", () => {
    const writer = new BinaryWriter();

    writer.writeUint8(0x12);
    writer.writeUint16LE(0x3456);
    writer.writeUint32LE(0x789abcde);
    writer.writeBytes(new Uint8Array([0xf0, 0xff]));

    expect(writer.length).toBe(9);
    expect(writer.toUint8Array()).toEqual(
      new Uint8Array([0x12, 0x56, 0x34, 0xde, 0xbc, 0x9a, 0x78, 0xf0, 0xff]),
    );
  });

  it("rejects values that cannot be represented by the requested type", () => {
    const writer = new BinaryWriter();

    expect(() => writer.writeUint8(256)).toThrow(RangeError);
    expect(() => writer.writeUint16LE(-1)).toThrow(RangeError);
    expect(() => writer.writeUint32LE(1.5)).toThrow(RangeError);
    expect(writer.length).toBe(0);
  });
});

describe("exportAseprite", () => {
  it("writes deterministic bytes matching a known supported fixture", () => {
    const project: SpriteProject = {
      width: 1,
      height: 1,
      colorMode: "rgba",
      frames: [{ index: 0, durationMs: 0x1234 }],
      layers: [
        {
          id: "main",
          name: "Å",
          visible: false,
          opacity: 0x7f,
          cels: [
            {
              frameIndex: 0,
              x: -1,
              y: 2,
              imageData: createImageData(1, 1, [1, 2, 3, 4]),
            },
          ],
        },
      ],
    };
    const expectedHex = [
      // File header.
      "d3000000e0a50100010001002000010000000000",
      "00".repeat(8),
      "00",
      "00".repeat(3),
      "0000",
      "0101",
      "00".repeat(8),
      "00".repeat(84),
      // Frame header.
      "53000000faf102003412000000000000",
      // Invisible normal layer named Å with opacity 127.
      "1a00000004200200000000000000000000007f0000000200c385",
      // Compressed 1x1 RGBA cel at (-1, 2).
      "2900000005200000ffff0200ff02000000000000000001000100",
      "7801010400fbff010203040018000b",
    ].join("");

    const first = exportAseprite(project);
    const second = exportAseprite(project);

    expect(first).toEqual(second);
    expect(bytesToHex(first)).toBe(expectedHex);
  });

  it("writes the documented RGBA file header fields at their byte offsets", () => {
    const project = createMinimalProject();
    project.width = 0x1234;
    project.height = 0x5678;
    project.frames.push({ index: 1, durationMs: 250 });

    const bytes = exportAseprite(project);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(view.getUint32(0, true)).toBe(bytes.length);
    expect(view.getUint16(4, true)).toBe(0xa5e0);
    expect(view.getUint16(6, true)).toBe(2);
    expect(view.getUint16(8, true)).toBe(0x1234);
    expect(view.getUint16(10, true)).toBe(0x5678);
    expect(view.getUint16(12, true)).toBe(32);
    expect(view.getUint32(14, true)).toBe(1);
    expect(view.getUint16(18, true)).toBe(0);
    expect(view.getUint8(28)).toBe(0);
    expect(view.getUint16(32, true)).toBe(0);
    expect(view.getUint8(34)).toBe(1);
    expect(view.getUint8(35)).toBe(1);
    expect(view.getInt16(36, true)).toBe(0);
    expect(view.getInt16(38, true)).toBe(0);
    expect(view.getUint16(40, true)).toBe(0);
    expect(view.getUint16(42, true)).toBe(0);
    expect(bytes.slice(20, 28)).toEqual(new Uint8Array(8));
    expect(bytes.slice(29, 32)).toEqual(new Uint8Array(3));
    expect(bytes.slice(44, 128)).toEqual(new Uint8Array(84));
  });

  it("writes layer chunks in the first frame and preserves frame durations", () => {
    const project = createMinimalProject();
    project.frames.push({ index: 1, durationMs: 0x1234 });

    const bytes = exportAseprite(project);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const firstFrame = parseFrame(bytes, 128);
    const secondFrame = parseFrame(bytes, firstFrame.nextOffset);

    for (const [offset, duration, chunkCount] of [
      [128, 100, 1],
      [firstFrame.nextOffset, 0x1234, 0],
    ] as const) {
      expect(view.getUint16(offset + 4, true)).toBe(0xf1fa);
      expect(view.getUint16(offset + 6, true)).toBe(chunkCount);
      expect(view.getUint16(offset + 8, true)).toBe(duration);
      expect(bytes.slice(offset + 10, offset + 12)).toEqual(new Uint8Array(2));
      expect(view.getUint32(offset + 12, true)).toBe(0);
    }
    expect(firstFrame.chunks.map((chunk) => chunk.type)).toEqual([0x2004]);
    expect(secondFrame.chunks).toEqual([]);
    expect(secondFrame.nextOffset).toBe(bytes.length);
  });

  it("writes deterministic frame-tag bytes for all supported directions and Unicode names", () => {
    const project = createMinimalProject();
    project.frames.push(
      { index: 1, durationMs: 100 },
      { index: 2, durationMs: 100 },
    );
    project.frameTags = [
      { name: "Idle", from: 0, to: 0, direction: "forward" },
      { name: "돌아", from: 1, to: 2, direction: "reverse" },
      { name: "走る", from: 0, to: 2, direction: "ping-pong" },
    ];

    const first = exportAseprite(project);
    const second = exportAseprite(project);
    const firstFrame = parseFrame(first, 128);
    const tagsChunk = firstFrame.chunks[1];
    const expectedHex = [
      "590000001820", // Chunk size and type.
      "0300", // Three tags.
      "00".repeat(8), // Reserved chunk header bytes.
      "0000000000", // Frames 0..0, forward.
      "0000", // Repeat count not specified.
      "00".repeat(6), // Reserved tag bytes.
      "00".repeat(3), // Deprecated RGB tag color.
      "00", // Extra byte.
      "040049646c65", // Idle.
      "0100020001", // Frames 1..2, reverse.
      "0000",
      "00".repeat(6),
      "00".repeat(3),
      "00",
      "0600eb8f8cec9584", // 돌아.
      "0000020002", // Frames 0..2, ping-pong.
      "0000",
      "00".repeat(6),
      "00".repeat(3),
      "00",
      "0600e8b5b0e3828b", // 走る.
    ].join("");

    expect(first).toEqual(second);
    expect(firstFrame.chunks.map((chunk) => chunk.type)).toEqual([
      0x2004, 0x2018,
    ]);
    expect(tagsChunk.bytes.length).toBe(0x59);
    expect(bytesToHex(tagsChunk.bytes)).toBe(expectedHex);
  });

  it("keeps output byte-compatible when frame tags are absent or empty", () => {
    const withoutTags = createMinimalProject();
    const withEmptyTags = createMinimalProject();
    withEmptyTags.frameTags = [];

    expect(exportAseprite(withEmptyTags)).toEqual(exportAseprite(withoutTags));
  });

  it("writes byte-level normal layer and compressed cel data across frames", () => {
    const project: SpriteProject = {
      width: 4,
      height: 4,
      colorMode: "rgba",
      frames: [
        { index: 0, durationMs: 80 },
        { index: 1, durationMs: 125 },
      ],
      layers: [
        {
          id: "base",
          name: "Base",
          visible: true,
          opacity: 128,
          cels: [
            {
              frameIndex: 0,
              x: -2,
              y: 3,
              imageData: createImageData(1, 1, [1, 2, 3, 4]),
            },
          ],
        },
        {
          id: "ink",
          name: "Ink 線",
          visible: true,
          opacity: 255,
          cels: [
            {
              frameIndex: 0,
              x: 0,
              y: 1,
              imageData: createImageData(1, 1, [10, 20, 30, 40]),
            },
            {
              frameIndex: 1,
              x: 2,
              y: -1,
              imageData: createImageData(2, 1, [5, 6, 7, 8, 9, 10, 11, 12]),
            },
          ],
        },
      ],
    };

    const bytes = exportAseprite(project);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const frame0 = parseFrame(bytes, 128);
    const frame1 = parseFrame(bytes, frame0.nextOffset);

    expect(view.getUint32(0, true)).toBe(bytes.length);
    expect(view.getUint16(128 + 6, true)).toBe(4);
    expect(view.getUint16(128 + 8, true)).toBe(80);
    expect(view.getUint16(frame0.nextOffset + 6, true)).toBe(1);
    expect(view.getUint16(frame0.nextOffset + 8, true)).toBe(125);
    expect(frame0.chunks.map((chunk) => chunk.type)).toEqual([
      0x2004, 0x2004, 0x2005, 0x2005,
    ]);
    expect(frame1.chunks.map((chunk) => chunk.type)).toEqual([0x2005]);
    expect(frame1.nextOffset).toBe(bytes.length);

    const [baseLayer, inkLayer, baseCel, inkCel0] = frame0.chunks;
    const inkCel1 = frame1.chunks[0];
    const baseLayerView = new DataView(baseLayer.bytes.buffer);
    const inkLayerView = new DataView(inkLayer.bytes.buffer);

    expect(baseLayerView.getUint32(0, true)).toBe(baseLayer.bytes.length);
    expect(baseLayerView.getUint16(6, true)).toBe(3); // Visible and editable.
    expect(baseLayerView.getUint16(8, true)).toBe(0); // Normal layer.
    expect(baseLayerView.getUint16(10, true)).toBe(0); // Top-level layer.
    expect(baseLayerView.getUint16(16, true)).toBe(0); // Normal blend.
    expect(baseLayerView.getUint8(18)).toBe(128);
    expect(baseLayerView.getUint16(22, true)).toBe(4);
    expect(new TextDecoder().decode(baseLayer.bytes.slice(24))).toBe("Base");
    expect(inkLayerView.getUint16(22, true)).toBe(7);
    expect(new TextDecoder().decode(inkLayer.bytes.slice(24))).toBe("Ink 線");

    for (const [chunk, layerIndex, x, y, pixels] of [
      [baseCel, 0, -2, 3, [1, 2, 3, 4]],
      [inkCel0, 1, 0, 1, [10, 20, 30, 40]],
      [inkCel1, 1, 2, -1, [5, 6, 7, 8, 9, 10, 11, 12]],
    ] as const) {
      const chunkView = new DataView(chunk.bytes.buffer);
      expect(chunkView.getUint32(0, true)).toBe(chunk.bytes.length);
      expect(chunkView.getUint16(6, true)).toBe(layerIndex);
      expect(chunkView.getInt16(8, true)).toBe(x);
      expect(chunkView.getInt16(10, true)).toBe(y);
      expect(chunkView.getUint8(12)).toBe(255);
      expect(chunkView.getUint16(13, true)).toBe(2);
      expect(chunkView.getInt16(15, true)).toBe(0);
      expect(chunk.bytes.slice(17, 22)).toEqual(new Uint8Array(5));
      expect(Array.from(inflateSync(chunk.bytes.slice(26)))).toEqual(pixels);
    }
    expect(new DataView(baseCel.bytes.buffer).getUint16(22, true)).toBe(1);
    expect(new DataView(baseCel.bytes.buffer).getUint16(24, true)).toBe(1);
    expect(new DataView(inkCel1.bytes.buffer).getUint16(22, true)).toBe(2);
    expect(new DataView(inkCel1.bytes.buffer).getUint16(24, true)).toBe(1);
  });

  it.each([
    ["width", 0],
    ["width", 1.5],
    ["width", 0x10000],
    ["height", -1],
    ["height", 0x10000],
  ] as const)("rejects an unrepresentable %s of %s", (field, value) => {
    const project = createMinimalProject();
    project[field] = value;

    expect(() => exportAseprite(project)).toThrow(RangeError);
  });

  it("rejects frame counts outside the file header range", () => {
    const emptyProject = createMinimalProject();
    emptyProject.frames = [];

    const oversizedProject = createMinimalProject();
    oversizedProject.frames = new Array(0x10000).fill(
      oversizedProject.frames[0],
    );

    expect(() => exportAseprite(emptyProject)).toThrow(RangeError);
    expect(() => exportAseprite(oversizedProject)).toThrow(RangeError);
  });

  it("rejects frame durations that cannot be written as a WORD", () => {
    const project = createMinimalProject();
    project.frames[0].durationMs = 0x10000;

    expect(() => exportAseprite(project)).toThrow(RangeError);
  });

  it.each([
    ["a non-array value", "Loop", "must be an array"],
    ["a non-object tag", [null], "must be an object"],
    [
      "an empty name",
      [{ name: " ", from: 0, to: 0, direction: "forward" }],
      "must not be empty or whitespace",
    ],
    [
      "malformed Unicode",
      [{ name: "\ud800", from: 0, to: 0, direction: "forward" }],
      "must contain valid Unicode",
    ],
    [
      "an oversized UTF-8 name",
      [{ name: "é".repeat(32_768), from: 0, to: 0, direction: "forward" }],
      "at most 65535 UTF-8 bytes",
    ],
    [
      "a negative from frame",
      [{ name: "Loop", from: -1, to: 0, direction: "forward" }],
      "from frame must be an integer from 0 to 1",
    ],
    [
      "an out-of-range to frame",
      [{ name: "Loop", from: 0, to: 2, direction: "forward" }],
      "to frame must be an integer from 0 to 1",
    ],
    [
      "a descending frame range",
      [{ name: "Loop", from: 1, to: 0, direction: "forward" }],
      "from frame must be less than or equal",
    ],
    [
      "an unsupported direction",
      [{ name: "Loop", from: 0, to: 1, direction: "pingpong" }],
      'must be "forward", "reverse", or "ping-pong"',
    ],
    [
      "a duplicate name",
      [
        { name: "Loop", from: 0, to: 0, direction: "forward" },
        { name: "Loop", from: 1, to: 1, direction: "reverse" },
      ],
      "is duplicated",
    ],
  ])("rejects frame tags with %s", (_label, frameTags, message) => {
    const project = createMinimalProject();
    project.frames.push({ index: 1, durationMs: 100 });
    (project as unknown as { frameTags: unknown }).frameTags = frameTags;

    expect(() => exportAseprite(project)).toThrow(message);
  });

  it("rejects frame-tag counts that cannot be written as a WORD", () => {
    const project = createMinimalProject();
    const tag = { name: "Loop", from: 0, to: 0, direction: "forward" } as const;
    project.frameTags = new Array(0x10000).fill(tag);

    expect(() => exportAseprite(project)).toThrow(
      "Project must contain at most 65535 frame tags.",
    );
  });

  it("rejects invalid layer and cel fields instead of truncating them", () => {
    const project = createMinimalProject();
    project.layers[0].opacity = 256;

    expect(() => exportAseprite(project)).toThrow(RangeError);

    project.layers[0].opacity = 255;
    project.layers[0].cels = [
      {
        frameIndex: 0,
        x: 0x8000,
        y: 0,
        imageData: createImageData(1, 1, [0, 0, 0, 0]),
      },
    ];

    expect(() => exportAseprite(project)).toThrow(RangeError);
  });

  it.each(["indexed", "grayscale"])(
    "rejects the unsupported %s color mode with a typed error",
    (colorMode) => {
      const project = {
        ...createMinimalProject(),
        colorMode,
      } as unknown as SpriteProject;

      expect(() => exportAseprite(project)).toThrow(
        UnsupportedAsepriteFeatureError,
      );
      expect(() => exportAseprite(project)).toThrow(
        `Aseprite export does not support the ${colorMode} color mode.`,
      );

      try {
        exportAseprite(project);
      } catch (error) {
        expect(error).toMatchObject({
          feature: `the ${colorMode} color mode`,
          name: "UnsupportedAsepriteFeatureError",
        });
      }
    },
  );
});
