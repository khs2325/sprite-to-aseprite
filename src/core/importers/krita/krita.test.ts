import { readFileSync } from "node:fs";
import { deflateRawSync, inflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  getKritaImportDiagnostic,
  importKrita,
  importKritaBytes,
  KritaImportError,
  type KritaImportErrorCode,
} from ".";

type ZipTestEntry = {
  compressionMethod?: number;
  content: string | Uint8Array;
  name: string;
};

type KritaFixtureName =
  | "flattened-preview-only"
  | "missing-layer-data"
  | "two-paint-layers"
  | "unsupported-color-depth"
  | "unsupported-vector-layer";

const transparent = [0, 0, 0, 0];
const cyan = [17, 138, 178, 255];
const coral = [239, 71, 111, 255];
const yellow = [255, 209, 102, 255];

function fixture(name: KritaFixtureName): Uint8Array {
  return new Uint8Array(
    readFileSync(
      new URL(`../../../../tests/fixtures/krita/${name}.kra`, import.meta.url),
    ),
  );
}

function createFile(name: string, bytes: Uint8Array): File {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return Object.assign(new Blob([buffer], { type: "application/x-krita" }), {
    lastModified: 0,
    name,
  }) as File;
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

async function expectKritaError(
  operation: Promise<unknown>,
  code: KritaImportErrorCode,
  message: string,
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(KritaImportError);
    expect(error).toMatchObject({ code });
    expect(getKritaImportDiagnostic(error)).toContain(message);
    return;
  }
  throw new Error(`Expected Krita import to fail with ${code}.`);
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

function rgbaToBgra([red, green, blue, alpha]: number[]): number[] {
  return [blue, green, red, alpha];
}

function encodeKritaPaintDevice(
  pixels: number[][][],
  rawFlag = 0,
): Uint8Array {
  const tileBytes = Buffer.alloc(64 * 64 * 4);
  for (let y = 0; y < pixels.length; y += 1) {
    for (let x = 0; x < pixels[y].length; x += 1) {
      Buffer.from(rgbaToBgra(pixels[y][x])).copy(tileBytes, (y * 64 + x) * 4);
    }
  }
  const payload = Buffer.concat([Buffer.from([rawFlag]), tileBytes]);
  return new Uint8Array(Buffer.concat([
    Buffer.from(
      `VERSION 2\nTILEWIDTH 64\nTILEHEIGHT 64\nPIXELSIZE 4\nDATA 1\n0,0,LZF,${payload.length}\n`,
      "utf8",
    ),
    payload,
  ]));
}

function layerXml(attributes: Record<string, string>): string {
  return Object.entries(attributes)
    .map(([name, value]) => `${name}="${value}"`)
    .join(" ");
}

function mainDoc(layerMarkup: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<DOC editor="krita" depth="8" syntaxVersion="2.0">
  <IMAGE mime="application/x-kra" name="Synthetic Krita" width="2" height="2" colorspacename="RGBA" profile="sRGB-elle-V2-srgbtrc.icc">
    <LAYERS>
${layerMarkup}
    </LAYERS>
  </IMAGE>
</DOC>
`;
}

function minimalLayer(overrides: Record<string, string> = {}): string {
  return `    <layer ${layerXml({
    nodetype: "paintlayer",
    filename: "layer1",
    opacity: "255",
    colorspacename: "RGBA",
    ...overrides,
  })} />`;
}

function kraWith(
  layerMarkup: string,
  extraEntries: readonly ZipTestEntry[] = [],
): Uint8Array {
  return encodeZip([
    { name: "mimetype", content: "application/x-krita", compressionMethod: 0 },
    { name: "maindoc.xml", content: mainDoc(layerMarkup) },
    { name: "preview.png", content: "flattened preview placeholder" },
    { name: "mergedimage.png", content: "flattened merged placeholder" },
    {
      name: "Synthetic Krita/layers/layer1",
      content: encodeKritaPaintDevice([
        [coral, transparent],
        [transparent, yellow],
      ]),
    },
    {
      name: "Synthetic Krita/layers/layer1.defaultpixel",
      content: new Uint8Array([0, 0, 0, 0]),
    },
    ...extraEntries,
  ]);
}

describe("Krita importer", () => {
  it("imports the documented native paint-layer fixture into one SpriteProject frame", async () => {
    const project = await importKritaBytes(fixture("two-paint-layers"), dependencies());

    expect(project).toMatchObject({
      colorMode: "rgba",
      width: 2,
      height: 2,
      frames: [{ index: 0, durationMs: 100 }],
      layers: [
        {
          id: "krita-layer-0",
          name: "Top hidden half",
          opacity: 128,
          visible: false,
          cels: [{ frameIndex: 0, x: 1, y: -1 }],
        },
        {
          id: "krita-layer-1",
          name: "Base visible",
          opacity: 255,
          visible: true,
          cels: [{ frameIndex: 0, x: 0, y: 0 }],
        },
      ],
    });
    expect(pixel(project.layers[0].cels[0].imageData, 0, 0)).toEqual(transparent);
    expect(pixel(project.layers[0].cels[0].imageData, 1, 0)).toEqual(yellow);
    expect(pixel(project.layers[0].cels[0].imageData, 0, 1)).toEqual(coral);
    expect(pixel(project.layers[0].cels[0].imageData, 1, 1)).toEqual(cyan);
    expect(pixel(project.layers[1].cels[0].imageData, 0, 0)).toEqual(cyan);
    expect(pixel(project.layers[1].cels[0].imageData, 1, 1)).toEqual(yellow);
  });

  it("uses deterministic defaults for optional paint-layer metadata", async () => {
    const project = await importKritaBytes(kraWith(minimalLayer()), dependencies());

    expect(project.layers).toMatchObject([
      {
        id: "krita-layer-0",
        name: "Layer 1",
        opacity: 255,
        visible: true,
        cels: [{ frameIndex: 0, x: 0, y: 0 }],
      },
    ]);
    expect(pixel(project.layers[0].cels[0].imageData, 0, 0)).toEqual(coral);
    expect(pixel(project.layers[0].cels[0].imageData, 1, 1)).toEqual(yellow);
  });

  it("reads a local File without changing the browser-only import boundary", async () => {
    const project = await importKrita(
      createFile("two-paint-layers.kra", fixture("two-paint-layers")),
      dependencies(),
    );

    expect(project).toMatchObject({ width: 2, height: 2 });
  });
});

describe("Krita validation", () => {
  it.each([
    [
      "unsupported-vector-layer" as const,
      "unsupported-feature" as const,
      "unsupported layer type",
    ],
    [
      "unsupported-color-depth" as const,
      "unsupported-feature" as const,
      "colorspacename must be RGBA",
    ],
    [
      "missing-layer-data" as const,
      "missing-entry" as const,
      "Synthetic Krita/layers/layer1",
    ],
    [
      "flattened-preview-only" as const,
      "unsupported-feature" as const,
      "flattened previews do not contain recoverable source layers",
    ],
  ])("rejects fixture %s deterministically", async (name, code, message) => {
    await expectKritaError(
      importKritaBytes(fixture(name), dependencies()),
      code,
      message,
    );
  });

  it("keeps arbitrary errors out of user-facing diagnostics", async () => {
    await expectKritaError(
      importKritaBytes(new Uint8Array([1, 2, 3]), dependencies()),
      "invalid-container",
      "end-of-central-directory",
    );
    expect(getKritaImportDiagnostic(new Error("private artwork bytes"))).toBeNull();
  });

  it.each([
    [
      "mask child",
      `    <layer ${layerXml({
        nodetype: "paintlayer",
        filename: "layer1",
        opacity: "255",
        colorspacename: "RGBA",
      })}><mask /></layer>`,
      "unsupported-feature" as const,
      "masks, effects",
    ],
    [
      "non-normal composite",
      minimalLayer({ compositeop: "multiply" }),
      "unsupported-feature" as const,
      "unsupported compositeop",
    ],
    [
      "unsafe offset integer",
      minimalLayer({ x: "32768" }),
      "invalid-maindoc" as const,
      "integer from -32768 through 32767",
    ],
    [
      "unsupported profile",
      minimalLayer({ profile: "DisplayP3.icc" }),
      "unsupported-feature" as const,
      "unsupported color profile",
    ],
  ])("rejects %s before mapping unsafe pixels", async (_name, layerMarkup, code, message) => {
    await expectKritaError(
      importKritaBytes(kraWith(layerMarkup), dependencies()),
      code,
      message,
    );
  });

  it("rejects compressed native tiles and non-transparent default pixels", async () => {
    await expectKritaError(
      importKritaBytes(
        encodeZip([
          { name: "mimetype", content: "application/x-krita", compressionMethod: 0 },
          { name: "maindoc.xml", content: mainDoc(minimalLayer()) },
          { name: "preview.png", content: "preview" },
          { name: "mergedimage.png", content: "merged" },
          {
            name: "Synthetic Krita/layers/layer1",
            content: encodeKritaPaintDevice([[coral]], 1),
          },
          {
            name: "Synthetic Krita/layers/layer1.defaultpixel",
            content: new Uint8Array([0, 0, 0, 0]),
          },
        ]),
        dependencies(),
      ),
      "unsupported-feature",
      "LZF-compressed tile data",
    );

    await expectKritaError(
      importKritaBytes(
        encodeZip([
          { name: "mimetype", content: "application/x-krita", compressionMethod: 0 },
          { name: "maindoc.xml", content: mainDoc(minimalLayer()) },
          { name: "preview.png", content: "preview" },
          { name: "mergedimage.png", content: "merged" },
          {
            name: "Synthetic Krita/layers/layer1",
            content: encodeKritaPaintDevice([[coral]]),
          },
          {
            name: "Synthetic Krita/layers/layer1.defaultpixel",
            content: new Uint8Array([0, 0, 1, 0]),
          },
        ]),
        dependencies(),
      ),
      "unsupported-feature",
      "default pixel",
    );
  });

  it("rejects unsafe archive paths and unsupported extra layer payloads", async () => {
    await expectKritaError(
      importKritaBytes(
        encodeZip([
          { name: "mimetype", content: "application/x-krita", compressionMethod: 0 },
          { name: "../evil.txt", content: "nope" },
          { name: "maindoc.xml", content: mainDoc(minimalLayer()) },
          { name: "preview.png", content: "preview" },
          { name: "mergedimage.png", content: "merged" },
        ]),
        dependencies(),
      ),
      "unsafe-path",
      "safe relative archive path",
    );

    await expectKritaError(
      importKritaBytes(
        kraWith(minimalLayer(), [
          {
            name: "Synthetic Krita/layers/unreferenced",
            content: encodeKritaPaintDevice([[cyan]]),
          },
        ]),
        dependencies(),
      ),
      "unsupported-feature",
      "not a supported paint-layer payload",
    );
  });
});
