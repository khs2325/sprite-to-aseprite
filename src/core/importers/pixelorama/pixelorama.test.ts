import { readFileSync } from "node:fs";
import { deflateRawSync, inflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  getPixeloramaImportDiagnostic,
  importPixelorama,
  importPixeloramaBytes,
  PixeloramaImportError,
  type PixeloramaImportErrorCode,
} from ".";

type JsonRecord = Record<string, unknown>;

type ZipTestEntry = {
  compressionMethod?: number;
  content: string | Uint8Array;
  name: string;
};

type PixeloramaFixtureName =
  | "ambiguous-metadata"
  | "missing-image-data"
  | "two-layers-two-frames"
  | "unsupported-blend-mode"
  | "unsupported-effects"
  | "unsupported-tilemap-layer";

const transparent = [0, 0, 0, 0];
const cyan = [17, 138, 178, 255];
const coral = [239, 71, 111, 255];
const yellow = [255, 209, 102, 255];

function fixture(name: PixeloramaFixtureName): Uint8Array {
  return new Uint8Array(
    readFileSync(
      new URL(
        `../../../../tests/fixtures/pixelorama/${name}.pxo`,
        import.meta.url,
      ),
    ),
  );
}

function createFile(name: string, bytes: Uint8Array): File {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return Object.assign(
    new Blob([buffer], { type: "application/x-pixelorama" }),
    {
      lastModified: 0,
      name,
    },
  ) as File;
}

async function inflateRaw(
  compressed: Uint8Array,
  maximumOutputBytes: number,
): Promise<Uint8Array> {
  const output = new Uint8Array(inflateRawSync(compressed));
  if (output.length > maximumOutputBytes) {
    throw new Error("inflated beyond requested maximum");
  }
  return output;
}

function dependencies() {
  return { inflateRaw };
}

function pixel(image: ImageData, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4;
  return [...image.data.slice(offset, offset + 4)];
}

async function expectPixeloramaError(
  operation: Promise<unknown>,
  code: PixeloramaImportErrorCode,
  message: string,
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(PixeloramaImportError);
    expect(error).toMatchObject({ code });
    expect(getPixeloramaImportDiagnostic(error)).toContain(message);
    return;
  }
  throw new Error(`Expected Pixelorama import to fail with ${code}.`);
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

function uint16LE(value: number): Buffer {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value);
  return bytes;
}

function uint32LE(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value >>> 0);
  return bytes;
}

function zipLocalHeader(entry: {
  compressedSize: number;
  compressionMethod: number;
  crc: number;
  name: Buffer;
  uncompressedSize: number;
}): Buffer {
  return Buffer.concat([
    uint32LE(0x04034b50),
    uint16LE(20),
    uint16LE(0x0800),
    uint16LE(entry.compressionMethod),
    uint16LE(0),
    uint16LE(0),
    uint32LE(entry.crc),
    uint32LE(entry.compressedSize),
    uint32LE(entry.uncompressedSize),
    uint16LE(entry.name.length),
    uint16LE(0),
  ]);
}

function zipCentralDirectoryHeader(entry: {
  compressedSize: number;
  compressionMethod: number;
  crc: number;
  localHeaderOffset: number;
  name: Buffer;
  uncompressedSize: number;
}): Buffer {
  return Buffer.concat([
    uint32LE(0x02014b50),
    uint16LE(20),
    uint16LE(20),
    uint16LE(0x0800),
    uint16LE(entry.compressionMethod),
    uint16LE(0),
    uint16LE(0),
    uint32LE(entry.crc),
    uint32LE(entry.compressedSize),
    uint32LE(entry.uncompressedSize),
    uint16LE(entry.name.length),
    uint16LE(0),
    uint16LE(0),
    uint16LE(0),
    uint16LE(0),
    uint32LE(0),
    uint32LE(entry.localHeaderOffset),
  ]);
}

function encodeZip(entries: readonly ZipTestEntry[]): Uint8Array {
  const localRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let localHeaderOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const source =
      typeof entry.content === "string"
        ? Buffer.from(entry.content, "utf8")
        : Buffer.from(entry.content);
    const compressionMethod = entry.compressionMethod ?? 8;
    const compressed =
      compressionMethod === 8 ? deflateRawSync(source, { level: 9 }) : source;
    const metadata = {
      compressedSize: compressed.length,
      compressionMethod,
      crc: crc32(source),
      localHeaderOffset,
      name,
      uncompressedSize: source.length,
    };
    const localHeader = zipLocalHeader(metadata);
    localRecords.push(localHeader, name, compressed);
    centralRecords.push(zipCentralDirectoryHeader(metadata), name);
    localHeaderOffset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralRecords);
  const end = Buffer.concat([
    uint32LE(0x06054b50),
    uint16LE(0),
    uint16LE(0),
    uint16LE(entries.length),
    uint16LE(entries.length),
    uint32LE(centralDirectory.length),
    uint32LE(localHeaderOffset),
    uint16LE(0),
  ]);
  return new Uint8Array(Buffer.concat([...localRecords, centralDirectory, end]));
}

function rawRgba(pixels: number[][]): Uint8Array {
  return new Uint8Array(pixels.flat());
}

function baseLayer(name = "Layer"): JsonRecord {
  return {
    name,
    visible: true,
    locked: false,
    blend_mode: 0,
    clipping_mask: false,
    opacity: 1,
    ui_color: "(0, 0, 0, 0)",
    parent: -1,
    effects: [],
    type: 0,
    new_cels_linked: false,
    metadata: {},
  };
}

function baseCel(): JsonRecord {
  return {
    opacity: 1,
    z_index: 0,
    ui_color: "(0, 0, 0, 0)",
    metadata: {},
  };
}

function baseFrame(duration = 1, layerCount = 1): JsonRecord {
  return {
    cels: Array.from({ length: layerCount }, baseCel),
    duration,
    metadata: {},
  };
}

function baseProject(): JsonRecord {
  return {
    pixelorama_version: "1.1.10",
    pxo_version: 6,
    size_x: 2,
    size_y: 2,
    color_mode: 5,
    tile_mode_x_basis_x: 2,
    tile_mode_x_basis_y: 0,
    tile_mode_y_basis_x: 0,
    tile_mode_y_basis_y: 2,
    layers: [baseLayer()],
    tags: [],
    guides: [],
    symmetry_points: [1, 1],
    frames: [baseFrame()],
    current_frame: 0,
    current_layer: 0,
    brushes: [],
    palettes: [],
    project_current_palette_name: "",
    reference_images: [],
    tilesets: [],
    vanishing_points: [],
    export_directory_path: "",
    export_file_name: "synthetic",
    export_file_format: 0,
    fps: 10,
    license: "",
    user_data: "",
    author_display_name: "",
    author_real_name: "",
    author_contact: "",
    author_company: "",
    metadata: {},
  };
}

function pxoWithData(
  data: JsonRecord | string,
  extraEntries: readonly ZipTestEntry[] = [],
): Uint8Array {
  return encodeZip([
    { name: "data.json", content: typeof data === "string" ? data : JSON.stringify(data) },
    { name: "mimetype", content: "application/x-pixelorama" },
    {
      name: "image_data/frames/1/layer_1",
      content: rawRgba([cyan, transparent, transparent, yellow]),
    },
    ...extraEntries,
  ]);
}

describe("Pixelorama importer", () => {
  it("imports the documented raw RGBA fixture with frames, layers, and timing", async () => {
    const project = await importPixeloramaBytes(
      fixture("two-layers-two-frames"),
      dependencies(),
    );

    expect(project).toMatchObject({
      colorMode: "rgba",
      width: 2,
      height: 2,
      frames: [
        { index: 0, durationMs: 100 },
        { index: 1, durationMs: 250 },
      ],
      layers: [
        {
          id: "pixelorama-layer-0",
          name: "Base visible half",
          visible: true,
          opacity: 128,
          cels: [
            { frameIndex: 0, x: 0, y: 0 },
            { frameIndex: 1, x: 0, y: 0 },
          ],
        },
        {
          id: "pixelorama-layer-1",
          name: "Hidden ink",
          visible: false,
          opacity: 255,
          cels: [
            { frameIndex: 0, x: 0, y: 0 },
            { frameIndex: 1, x: 0, y: 0 },
          ],
        },
      ],
    });
    expect(pixel(project.layers[0].cels[0].imageData, 0, 0)).toEqual(cyan);
    expect(pixel(project.layers[0].cels[0].imageData, 1, 1)).toEqual(yellow);
    expect(pixel(project.layers[0].cels[1].imageData, 0, 1)).toEqual(cyan);
    expect(pixel(project.layers[1].cels[0].imageData, 1, 0)).toEqual(coral);
    expect(pixel(project.layers[1].cels[1].imageData, 0, 1)).toEqual(yellow);
  });

  it("reads a local File without changing the browser-only import boundary", async () => {
    const project = await importPixelorama(
      createFile("fixture.pxo", fixture("two-layers-two-frames")),
      dependencies(),
    );

    expect(project).toMatchObject({ width: 2, height: 2 });
  });
});

describe("Pixelorama validation", () => {
  it.each([
    [
      "unsupported-blend-mode" as const,
      "unsupported-feature" as const,
      "unsupported blend mode",
    ],
    [
      "unsupported-effects" as const,
      "unsupported-feature" as const,
      ".effects are unsupported",
    ],
    [
      "unsupported-tilemap-layer" as const,
      "unsupported-feature" as const,
      "tile sets",
    ],
    [
      "missing-image-data" as const,
      "missing-entry" as const,
      "image_data/frames/1/layer_1",
    ],
    [
      "ambiguous-metadata" as const,
      "unsupported-feature" as const,
      "project.metadata",
    ],
  ])("rejects fixture %s deterministically", async (name, code, message) => {
    await expectPixeloramaError(
      importPixeloramaBytes(fixture(name), dependencies()),
      code,
      message,
    );
  });

  it("keeps malformed JSON and arbitrary errors content-safe", async () => {
    await expectPixeloramaError(
      importPixeloramaBytes(pxoWithData('{"private pixels":'), dependencies()),
      "invalid-json",
      "not valid JSON",
    );
    expect(getPixeloramaImportDiagnostic(new Error("private pixels"))).toBeNull();
  });

  it.each([
    [
      "unsupported pxo version",
      (data: JsonRecord) => {
        data.pxo_version = 7;
      },
      "unsupported-version" as const,
      "expected integer 6",
    ],
    [
      "unsupported color mode",
      (data: JsonRecord) => {
        data.color_mode = -1;
      },
      "unsupported-feature" as const,
      "color_mode must be 5",
    ],
    [
      "unsafe dimension",
      (data: JsonRecord) => {
        data.size_x = 0;
      },
      "allocation-limit" as const,
      "size_x",
    ],
    [
      "too many frames",
      (data: JsonRecord) => {
        data.frames = Array.from({ length: 513 }, () => baseFrame());
      },
      "allocation-limit" as const,
      "frame count",
    ],
    [
      "too much raw cel allocation",
      (data: JsonRecord) => {
        data.size_x = 1024;
        data.size_y = 1024;
        data.frames = Array.from({ length: 17 }, () => baseFrame());
      },
      "allocation-limit" as const,
      "raw cel data",
    ],
    [
      "unknown required metadata",
      (data: JsonRecord) => {
        data.privateMetadata = true;
      },
      "unsupported-feature" as const,
      "unsupported field",
    ],
    [
      "layer hierarchy",
      (data: JsonRecord) => {
        (data.layers as JsonRecord[])[0].parent = 0;
      },
      "unsupported-feature" as const,
      "layer hierarchy",
    ],
    [
      "missing cel",
      (data: JsonRecord) => {
        ((data.frames as JsonRecord[])[0].cels as unknown[]).pop();
      },
      "invalid-project" as const,
      "one cel per layer",
    ],
    [
      "per-cel opacity",
      (data: JsonRecord) => {
        const frame = (data.frames as JsonRecord[])[0];
        const cel = (frame.cels as JsonRecord[])[0];
        cel.opacity = 0.5;
      },
      "unsupported-feature" as const,
      ".opacity is unsupported",
    ],
  ])("rejects %s before mapping unsafe pixels", async (_name, mutate, code, message) => {
    const data = baseProject();
    mutate(data);

    await expectPixeloramaError(
      importPixeloramaBytes(pxoWithData(data), dependencies()),
      code,
      message,
    );
  });

  it("rejects unsafe archive paths and unsupported ZIP compression", async () => {
    await expectPixeloramaError(
      importPixeloramaBytes(
        pxoWithData(baseProject(), [{ name: "../evil.txt", content: "nope" }]),
        dependencies(),
      ),
      "unsafe-path",
      "safe relative archive path",
    );

    await expectPixeloramaError(
      importPixeloramaBytes(
        pxoWithData(baseProject(), [
          {
            name: "image_data/frames/1/layer_2",
            content: rawRgba([coral, transparent, transparent, yellow]),
          },
        ]),
        dependencies(),
      ),
      "unsupported-feature",
      "out-of-range cel data",
    );

    await expectPixeloramaError(
      importPixeloramaBytes(
        encodeZip([
          { name: "data.json", content: JSON.stringify(baseProject()) },
          { name: "mimetype", content: "application/x-pixelorama" },
          {
            name: "image_data/frames/1/layer_1",
            content: rawRgba([cyan, transparent, transparent, yellow]),
            compressionMethod: 99,
          },
        ]),
        dependencies(),
      ),
      "unsupported-zip",
      "unsupported compression method 99",
    );
  });
});
