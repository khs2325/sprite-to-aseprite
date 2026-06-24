import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  GifImportError,
  getGifImportDiagnostic,
  importGif,
  importGifBytes,
} from ".";

const fixtureDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../tests/fixtures/gif",
);
const transparent = [0, 0, 0, 0];
const black = [0, 0, 0, 255];
const red = [230, 57, 70, 255];
const green = [42, 157, 143, 255];
const blue = [69, 123, 157, 255];

function fixture(name: string): Uint8Array {
  return readFileSync(join(fixtureDirectory, name));
}

function pixels(image: ImageData): number[][] {
  const result: number[][] = [];
  for (let offset = 0; offset < image.data.length; offset += 4) {
    result.push([...image.data.slice(offset, offset + 4)]);
  }
  return result;
}

function littleEndian(value: number): number[] {
  return [value & 0xff, value >> 8];
}

function packCodes(codes: number[], widths: number[]): number[] {
  const bytes: number[] = [];
  let bits = 0;
  let bitCount = 0;
  codes.forEach((code, index) => {
    bits |= code << bitCount;
    bitCount += widths[index];
    while (bitCount >= 8) {
      bytes.push(bits & 0xff);
      bits >>>= 8;
      bitCount -= 8;
    }
  });
  if (bitCount > 0) bytes.push(bits & 0xff);
  return bytes;
}

function colorTableSizeBits(table: number[]): number {
  return Math.log2(table.length / 3) - 1;
}

function syntheticGif({
  codes = [4, 1, 5],
  codeWidths = codes.map(() => 3),
  gcePacked,
  globalTable = [0, 0, 0, 230, 57, 70],
  height = 1,
  imagePacked = 0,
  localTable,
  width = 1,
}: {
  codes?: number[];
  codeWidths?: number[];
  gcePacked?: number;
  globalTable?: number[] | null;
  height?: number;
  imagePacked?: number;
  localTable?: number[];
  width?: number;
} = {}): Uint8Array {
  const data = packCodes(codes, codeWidths);
  const globalPacked =
    globalTable === null ? 0 : 0x80 | colorTableSizeBits(globalTable);
  const localPacked =
    localTable === undefined
      ? imagePacked
      : imagePacked | 0x80 | colorTableSizeBits(localTable);
  return new Uint8Array([
    ...Array.from("GIF89a", (character) => character.charCodeAt(0)),
    ...littleEndian(width),
    ...littleEndian(height),
    globalPacked,
    0,
    0,
    ...(globalTable ?? []),
    ...(gcePacked === undefined
      ? []
      : [0x21, 0xf9, 4, gcePacked, 0, 0, 0, 0]),
    0x2c,
    0,
    0,
    0,
    0,
    ...littleEndian(width),
    ...littleEndian(height),
    localPacked,
    ...(localTable ?? []),
    2,
    data.length,
    ...data,
    0,
    0x3b,
  ]);
}

function repeatSyntheticFrame(bytes: Uint8Array, frameCount: number): Uint8Array {
  const headerLength = 19;
  const frame = bytes.slice(headerLength, -1);
  const repeated = new Uint8Array(headerLength + frame.length * frameCount + 1);
  repeated.set(bytes.slice(0, headerLength));
  for (let index = 0; index < frameCount; index += 1) {
    repeated.set(frame, headerLength + frame.length * index);
  }
  repeated[repeated.length - 1] = 0x3b;
  return repeated;
}

describe("GIF importer", () => {
  it("imports timing, transparency, offsets, order, and one generated layer", () => {
    const project = importGifBytes(fixture("timing-transparency-offsets.gif"));

    expect(project).toMatchObject({
      colorMode: "rgba",
      width: 3,
      height: 2,
      frames: [
        { index: 0, durationMs: 100 },
        { index: 1, durationMs: 20 },
        { index: 2, durationMs: 120 },
        { index: 3, durationMs: 65_535 },
      ],
      layers: [
        {
          id: "gif-layer-0",
          name: "GIF frames",
          visible: true,
          opacity: 255,
        },
      ],
    });
    expect(project.layers).toHaveLength(1);
    expect(project.layers[0].cels.map(({ frameIndex, x, y }) => ({ frameIndex, x, y })))
      .toEqual([
        { frameIndex: 0, x: 0, y: 0 },
        { frameIndex: 1, x: 0, y: 0 },
        { frameIndex: 2, x: 0, y: 0 },
        { frameIndex: 3, x: 0, y: 0 },
      ]);
    expect(project.layers[0].cels.map(({ imageData }) => pixels(imageData))).toEqual([
      [red, transparent, transparent, transparent, transparent, transparent],
      [red, transparent, green, transparent, transparent, transparent],
      [red, transparent, green, transparent, transparent, blue],
      [red, transparent, green, red, transparent, blue],
    ]);
  });

  it("clears disposal method 2 rectangles to the opaque global background", () => {
    const project = importGifBytes(fixture("disposal-background.gif"));

    expect(project.frames.map(({ durationMs }) => durationMs)).toEqual([50, 50, 50]);
    expect(project.layers[0].cels.map(({ imageData }) => pixels(imageData))).toEqual([
      [red, red, red, red, red, red],
      [red, green, red, red, red, red],
      [red, black, blue, red, red, red],
    ]);
  });

  it("clears disposal method 2 rectangles to transparency when requested", () => {
    const bytes = fixture("disposal-background.gif").slice();
    const controls: number[] = [];
    for (let index = 0; index < bytes.length - 2; index += 1) {
      if (bytes[index] === 0x21 && bytes[index + 1] === 0xf9) controls.push(index);
    }
    bytes[controls[1] + 3] = (2 << 2) | 1;
    bytes[controls[1] + 6] = 0;

    const project = importGifBytes(bytes);

    expect(pixels(project.layers[0].cels[2].imageData)).toEqual([
      red,
      transparent,
      blue,
      red,
      red,
      red,
    ]);
  });

  it("restores the pre-draw canvas for disposal method 3", () => {
    const project = importGifBytes(fixture("disposal-previous.gif"));

    expect(project.frames.map(({ durationMs }) => durationMs)).toEqual([70, 70, 70]);
    expect(project.layers[0].cels.map(({ imageData }) => pixels(imageData))).toEqual([
      [red, red, red, red, red, red],
      [red, green, red, red, green, red],
      [red, red, red, red, red, blue],
    ]);
  });

  it("uses a local color table instead of the global table", () => {
    const project = importGifBytes(
      syntheticGif({ localTable: [0, 0, 0, 69, 123, 157] }),
    );

    expect(pixels(project.layers[0].cels[0].imageData)).toEqual([blue]);
  });

  it("decodes dictionary entries across an LZW code-size transition", () => {
    const project = importGifBytes(
      syntheticGif({
        width: 6,
        codes: [4, 0, 1, 6, 6, 5],
        codeWidths: [3, 3, 3, 3, 4, 4],
      }),
    );

    expect(pixels(project.layers[0].cels[0].imageData)).toEqual([
      black,
      red,
      black,
      red,
      black,
      red,
    ]);
  });

  it("reads a local browser File without a decoder or network dependency", async () => {
    const file = Object.assign(
      new Blob([fixture("timing-transparency-offsets.gif")] as BlobPart[], {
        type: "image/gif",
      }),
      { lastModified: 0, name: "animation.gif" },
    ) as File;

    const project = await importGif(file);

    expect(project).toMatchObject({ width: 3, height: 2 });
    expect(project.frames).toHaveLength(4);
  });
});

describe("GIF validation", () => {
  it("rejects an out-of-bounds fixture with a precise frame error", () => {
    expect(() => importGifBytes(fixture("invalid-frame-bounds.gif"))).toThrow(
      "GIF frame 2 rectangle exceeds the 3x2 logical screen.",
    );
  });

  it("rejects unsupported versions, disposal, user-input timing, and interlacing", () => {
    const oldVersion = syntheticGif();
    oldVersion[4] = "7".charCodeAt(0);

    expect(() => importGifBytes(oldVersion)).toThrow(
      "Unsupported GIF87a version; expected GIF89a.",
    );
    expect(() => importGifBytes(syntheticGif({ gcePacked: 5 << 2 }))).toThrow(
      "GIF frame 1 uses unsupported disposal method 5.",
    );
    expect(() => importGifBytes(syntheticGif({ gcePacked: 0x02 }))).toThrow(
      "GIF frame 1 requests unsupported user-input timing.",
    );
    expect(() => importGifBytes(syntheticGif({ imagePacked: 0x40 }))).toThrow(
      "GIF frame 1 uses unsupported interlacing.",
    );
  });

  it("enforces dimension, frame-count, and full-canvas allocation limits while scanning", () => {
    const zeroWidth = syntheticGif();
    zeroWidth[6] = 0;
    zeroWidth[7] = 0;

    expect(() => importGifBytes(zeroWidth)).toThrow(
      "GIF logical screen dimensions must be from 1x1 through 4096x4096.",
    );
    expect(() =>
      importGifBytes(repeatSyntheticFrame(syntheticGif(), 1_001)),
    ).toThrow("GIF contains more than 1000 image frames.");
    expect(() =>
      importGifBytes(
        repeatSyntheticFrame(syntheticGif({ width: 4096, height: 4096 }), 5),
      ),
    ).toThrow(
      "GIF full-canvas frame output exceeds the 67108864-pixel limit.",
    );
  });

  it("rejects ambiguous duplicate graphic control extensions", () => {
    const source = syntheticGif({ gcePacked: 0 });
    const headerLength = 19;
    const control = source.slice(headerLength, headerLength + 8);
    const duplicate = new Uint8Array([
      ...source.slice(0, headerLength),
      ...control,
      ...source.slice(headerLength),
    ]);

    expect(() => importGifBytes(duplicate)).toThrow(
      "GIF frame 1 has multiple graphic control extensions.",
    );
  });

  it("rejects missing clear/end codes, invalid codes, and overlong output", () => {
    expect(() =>
      importGifBytes(syntheticGif({ codes: [1, 5], codeWidths: [3, 3] })),
    ).toThrow("GIF frame 1 LZW data must begin with a clear code.");
    expect(() =>
      importGifBytes(syntheticGif({ codes: [4, 1], codeWidths: [3, 3] })),
    ).toThrow("GIF frame 1 LZW data is truncated before its end code.");
    expect(() =>
      importGifBytes(syntheticGif({ codes: [4, 7, 5], codeWidths: [3, 3, 3] })),
    ).toThrow("GIF frame 1 contains invalid LZW code 7.");
    expect(() =>
      importGifBytes(syntheticGif({ codes: [4, 1, 1, 5], codeWidths: [3, 3, 3, 4] })),
    ).toThrow("GIF frame 1 LZW data decodes more than 1 indexes.");
  });

  it("rejects palette indexes and non-padding bits after the LZW end code", () => {
    expect(() =>
      importGifBytes(syntheticGif({ codes: [4, 2, 5] })),
    ).toThrow(
      "GIF frame 1 decoded palette index 2 outside its 2-entry color table.",
    );
    expect(() =>
      importGifBytes(
        syntheticGif({
          codes: [4, 1, 5, 1],
          codeWidths: [3, 3, 3, 3],
        }),
      ),
    ).toThrow("GIF frame 1 LZW data continues after its end code.");
  });

  it("rejects truncated sub-block chains, missing trailers, and trailing data", () => {
    const truncated = syntheticGif().slice(0, -2);
    const missingTrailer = syntheticGif().slice(0, -1);
    const trailing = new Uint8Array([...syntheticGif(), 1]);

    expect(() => importGifBytes(truncated)).toThrow(
      "GIF frame 1 image data sub-block chain is truncated.",
    );
    expect(() => importGifBytes(missingTrailer)).toThrow(
      "GIF stream is missing its trailer.",
    );
    expect(() => importGifBytes(trailing)).toThrow(
      "GIF stream contains non-padding data after its trailer.",
    );
  });

  it("classifies safe diagnostics without exposing arbitrary errors", () => {
    try {
      importGifBytes(fixture("invalid-frame-bounds.gif"));
      throw new Error("expected import to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(GifImportError);
      expect((error as GifImportError).code).toBe("invalid-frame");
      expect(getGifImportDiagnostic(error)).toBe(
        "GIF frame 2 rectangle exceeds the 3x2 logical screen.",
      );
    }
    expect(getGifImportDiagnostic(new Error("private pixel details"))).toBeNull();
  });
});
