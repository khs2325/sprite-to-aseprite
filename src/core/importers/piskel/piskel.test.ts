import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

import { describe, expect, it, vi } from "vitest";

import {
  getPiskelImportDiagnostic,
  importPiskel,
  importPiskelJson,
  PiskelImportError,
  type PiskelImportErrorCode,
} from ".";

type JsonRecord = Record<string, unknown>;

type PiskelFixtureName =
  | "all-frames-hidden"
  | "bad-frame-coverage"
  | "bad-png-dimensions"
  | "duplicate-hidden-frames"
  | "empty-string-hidden-frames"
  | "extra-harmless-field"
  | "hidden-frames"
  | "hidden-multi-layer"
  | "legacy-base64png"
  | "multi-frame"
  | "multi-layer"
  | "multiple-hidden-frames"
  | "non-array-hidden-frames"
  | "numeric-string-hidden-frames"
  | "out-of-range-hidden-frame"
  | "unsupported-model-version";

function fixture(name: PiskelFixtureName): string {
  return readFileSync(
    new URL(`../../../../tests/fixtures/piskel/${name}.piskel`, import.meta.url),
    "utf8",
  );
}

async function expectPiskelError(
  operation: Promise<unknown>,
  code: PiskelImportErrorCode,
  message: string,
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(PiskelImportError);
    expect(error).toMatchObject({ code });
    expect(getPiskelImportDiagnostic(error)).toContain(message);
    return;
  }
  throw new Error(`Expected Piskel import to fail with ${code}.`);
}

function documentFixture(name: "multi-frame" | "multi-layer"): JsonRecord {
  return JSON.parse(fixture(name)) as JsonRecord;
}

function piskelObject(document: JsonRecord): JsonRecord {
  return document.piskel as JsonRecord;
}

function layerRecord(document: JsonRecord, index = 0): JsonRecord {
  const layers = piskelObject(document).layers as string[];
  return JSON.parse(layers[index]) as JsonRecord;
}

function replaceLayer(
  document: JsonRecord,
  layer: JsonRecord,
  index = 0,
): void {
  const layers = piskelObject(document).layers as string[];
  layers[index] = JSON.stringify(layer);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function decodeFixturePng(bytes: Uint8Array): ImageData {
  let offset = 8;
  let width = 0;
  let height = 0;
  const compressed: Uint8Array[] = [];

  while (offset < bytes.length) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;

    if (type === "IHDR") {
      width = readUint32(data, 0);
      height = readUint32(data, 4);
    } else if (type === "IDAT") {
      compressed.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  const rows = inflateSync(Buffer.concat(compressed.map((part) => Buffer.from(part))));
  const data = new Uint8ClampedArray(width * height * 4);
  const rowLength = width * 4;
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = row * (rowLength + 1);
    if (rows[sourceOffset] !== 0) {
      throw new Error("Test decoder only supports unfiltered fixture rows.");
    }
    data.set(
      rows.subarray(sourceOffset + 1, sourceOffset + 1 + rowLength),
      row * rowLength,
    );
  }

  return { colorSpace: "srgb", data, width, height };
}

function fixtureDecoder() {
  return vi.fn<(bytes: Uint8Array) => Promise<ImageData>>(async (bytes) =>
    decodeFixturePng(bytes),
  );
}

function pixel(image: ImageData, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4;
  return [...image.data.slice(offset, offset + 4)];
}

describe("Piskel importer", () => {
  it("imports multiple chunks into ordered frames with RGBA transparency and timing", async () => {
    const decodePng = fixtureDecoder();
    const project = await importPiskelJson(fixture("multi-frame"), { decodePng });

    expect(project).toMatchObject({
      width: 2,
      height: 2,
      colorMode: "rgba",
      frames: [
        { index: 0, durationMs: 83 },
        { index: 1, durationMs: 83 },
        { index: 2, durationMs: 83 },
      ],
      layers: [
        {
          id: "piskel-layer-0",
          name: "Motion",
          visible: true,
          opacity: 255,
          cels: [
            { frameIndex: 0, x: 0, y: 0 },
            { frameIndex: 1, x: 0, y: 0 },
            { frameIndex: 2, x: 0, y: 0 },
          ],
        },
      ],
    });
    expect(decodePng).toHaveBeenCalledTimes(2);
    expect(pixel(project.layers[0].cels[0].imageData, 0, 0)).toEqual([
      230, 57, 70, 255,
    ]);
    expect(pixel(project.layers[0].cels[0].imageData, 1, 0)).toEqual([
      0, 0, 0, 0,
    ]);
    expect(pixel(project.layers[0].cels[1].imageData, 1, 0)).toEqual([
      42, 157, 143, 255,
    ]);
    expect(pixel(project.layers[0].cels[2].imageData, 0, 1)).toEqual([
      69, 123, 157, 255,
    ]);
  });

  it("preserves source layer order, names, opacity, and explicit visibility", async () => {
    const document = documentFixture("multi-layer");
    const accent = layerRecord(document, 1);
    accent.visible = false;
    replaceLayer(document, accent, 1);

    const project = await importPiskelJson(JSON.stringify(document), {
      decodePng: fixtureDecoder(),
    });

    expect(project.frames.map(({ durationMs }) => durationMs)).toEqual([50, 50]);
    expect(
      project.layers.map(({ id, name, opacity, visible }) => ({
        id,
        name,
        opacity,
        visible,
      })),
    ).toEqual([
      {
        id: "piskel-layer-0",
        name: "Background",
        opacity: 128,
        visible: true,
      },
      {
        id: "piskel-layer-1",
        name: "Accent",
        opacity: 255,
        visible: false,
      },
    ]);
    expect(pixel(project.layers[0].cels[0].imageData, 0, 0)).toEqual([
      69, 123, 157, 255,
    ]);
    expect(pixel(project.layers[1].cels[1].imageData, 1, 0)).toEqual([
      42, 157, 143, 255,
    ]);
  });

  it("accepts harmless expanded state and Piskel's legacy base64PNG layer form", async () => {
    const expanded = await importPiskelJson(fixture("extra-harmless-field"), {
      decodePng: fixtureDecoder(),
    });
    const legacy = await importPiskelJson(fixture("legacy-base64png"), {
      decodePng: fixtureDecoder(),
    });

    expect(expanded).toMatchObject({ width: 2, height: 2 });
    expect(legacy).toMatchObject({
      width: 2,
      height: 2,
      frames: [{ index: 0 }, { index: 1 }],
      layers: [{ name: "Diagnostic", opacity: 255, visible: true }],
    });
    expect(legacy.layers[0].cels.map(({ frameIndex }) => frameIndex)).toEqual([
      0, 1,
    ]);
  });

  it("imports normally when hiddenFrames is absent, empty, or an empty string", async () => {
    const absent = documentFixture("multi-frame");
    delete piskelObject(absent).hiddenFrames;

    const absentProject = await importPiskelJson(JSON.stringify(absent), {
      decodePng: fixtureDecoder(),
    });
    const emptyProject = await importPiskelJson(fixture("multi-frame"), {
      decodePng: fixtureDecoder(),
    });
    const emptyStringProject = await importPiskelJson(
      fixture("empty-string-hidden-frames"),
      { decodePng: fixtureDecoder() },
    );

    expect(absentProject.frames.map(({ index }) => index)).toEqual([0, 1, 2]);
    expect(emptyProject.frames.map(({ index }) => index)).toEqual([0, 1, 2]);
    expect(emptyStringProject.frames.map(({ index }) => index)).toEqual([
      0, 1,
    ]);
    expect(absentProject.layers[0].cels.map(({ frameIndex }) => frameIndex)).toEqual([
      0, 1, 2,
    ]);
    expect(
      emptyStringProject.layers[0].cels.map(({ frameIndex }) => frameIndex),
    ).toEqual([0, 1]);
  });

  it.each([[[""]], [["", ""]]])(
    "treats empty array sentinels %j as no hidden frames",
    async (hiddenFrames) => {
      const document = documentFixture("multi-frame");
      piskelObject(document).hiddenFrames = hiddenFrames;

      const project = await importPiskelJson(JSON.stringify(document), {
        decodePng: fixtureDecoder(),
      });

      expect(project.frames.map(({ index }) => index)).toEqual([0, 1, 2]);
      expect(project.layers[0].cels.map(({ frameIndex }) => frameIndex)).toEqual([
        0, 1, 2,
      ]);
    },
  );

  it("skips one hidden frame and reindexes visible cels contiguously", async () => {
    const project = await importPiskelJson(fixture("hidden-frames"), {
      decodePng: fixtureDecoder(),
    });

    expect(project.frames).toEqual([{ index: 0, durationMs: 83 }]);
    expect(project.layers[0].cels).toHaveLength(1);
    expect(project.layers[0].cels[0].frameIndex).toBe(0);
    expect(pixel(project.layers[0].cels[0].imageData, 0, 0)).toEqual([
      230, 57, 70, 255,
    ]);
  });

  it("skips multiple hidden frames while preserving visible-frame order", async () => {
    const project = await importPiskelJson(fixture("multiple-hidden-frames"), {
      decodePng: fixtureDecoder(),
    });

    expect(project.frames).toEqual([{ index: 0, durationMs: 83 }]);
    expect(project.layers[0].cels.map(({ frameIndex }) => frameIndex)).toEqual([0]);
    expect(pixel(project.layers[0].cels[0].imageData, 1, 0)).toEqual([
      42, 157, 143, 255,
    ]);
  });

  it("accepts strict numeric-string indexes and reindexes visible frames", async () => {
    const project = await importPiskelJson(
      fixture("numeric-string-hidden-frames"),
      { decodePng: fixtureDecoder() },
    );

    expect(project.frames).toEqual([{ index: 0, durationMs: 83 }]);
    expect(project.layers[0].cels.map(({ frameIndex }) => frameIndex)).toEqual([
      0,
    ]);
    expect(pixel(project.layers[0].cels[0].imageData, 1, 0)).toEqual([
      42, 157, 143, 255,
    ]);
  });

  it("preserves layer metadata and visible cel pixels while skipping hidden frames", async () => {
    const document = JSON.parse(fixture("hidden-multi-layer")) as JsonRecord;
    const accent = layerRecord(document, 1);
    accent.visible = false;
    replaceLayer(document, accent, 1);

    const project = await importPiskelJson(JSON.stringify(document), {
      decodePng: fixtureDecoder(),
    });

    expect(project.frames).toEqual([{ index: 0, durationMs: 50 }]);
    expect(project.layers.map(({ name, opacity, visible }) => ({
      name,
      opacity,
      visible,
    }))).toEqual([
      { name: "Background", opacity: 128, visible: true },
      { name: "Accent", opacity: 255, visible: false },
    ]);
    expect(project.layers.every(({ cels }) =>
      cels.length === 1 && cels[0].frameIndex === 0,
    )).toBe(true);
    expect(pixel(project.layers[0].cels[0].imageData, 0, 0)).toEqual([
      69, 123, 157, 255,
    ]);
    expect(pixel(project.layers[1].cels[0].imageData, 0, 0)).toEqual([
      230, 57, 70, 255,
    ]);
  });

  it("maps rectangular layout[column][row] cells to sorted frame cels", async () => {
    const document = documentFixture("multi-frame");
    const piskel = piskelObject(document);
    piskel.width = 2;
    piskel.height = 1;
    const layer = layerRecord(document);
    const chunks = layer.chunks as JsonRecord[];
    layer.frameCount = 4;
    layer.chunks = [
      {
        ...chunks[0],
        layout: [
          [2, 0],
          [3, 1],
        ],
      },
    ];
    replaceLayer(document, layer);

    const project = await importPiskelJson(JSON.stringify(document), {
      decodePng: fixtureDecoder(),
    });

    expect(project.layers[0].cels.map(({ frameIndex }) => frameIndex)).toEqual([
      0, 1, 2, 3,
    ]);
    expect(
      project.layers[0].cels.map(({ imageData }) => [
        pixel(imageData, 0, 0),
        pixel(imageData, 1, 0),
      ]),
    ).toEqual([
      [
        [0, 0, 0, 0],
        [255, 209, 102, 255],
      ],
      [
        [255, 209, 102, 255],
        [0, 0, 0, 0],
      ],
      [
        [230, 57, 70, 255],
        [0, 0, 0, 0],
      ],
      [
        [0, 0, 0, 0],
        [42, 157, 143, 255],
      ],
    ]);
  });

  it.each([
    [1000, 1],
    [0.0001, 65_535],
  ])("clamps %s FPS to %s ms", async (fps, expectedDuration) => {
    const document = documentFixture("multi-frame");
    piskelObject(document).fps = fps;

    const project = await importPiskelJson(JSON.stringify(document), {
      decodePng: fixtureDecoder(),
    });

    expect(project.frames.every(({ durationMs }) => durationMs === expectedDuration)).toBe(
      true,
    );
  });

  it("reads a local File without changing the browser-only import boundary", async () => {
    const file = Object.assign(new Blob([fixture("multi-frame")] as BlobPart[]), {
      name: "motion.piskel",
      lastModified: 0,
    }) as File;

    const project = await importPiskel(file, { decodePng: fixtureDecoder() });

    expect(project).toMatchObject({ width: 2, height: 2 });
  });
});

describe("Piskel validation", () => {
  it("rejects malformed outer and string-encoded layer JSON with content-safe errors", async () => {
    const decodePng = fixtureDecoder();
    await expect(
      importPiskelJson('{"private artwork":', { decodePng }),
    ).rejects.toThrow("Piskel file is not valid JSON.");

    const document = documentFixture("multi-frame");
    (piskelObject(document).layers as string[])[0] = '{"private pixels":';
    await expect(
      importPiskelJson(JSON.stringify(document), { decodePng }),
    ).rejects.toThrow("Piskel layer 1 is not valid JSON.");
    expect(decodePng).not.toHaveBeenCalled();
  });

  it("classifies representative failures for safe UI diagnostics", async () => {
    await expectPiskelError(
      importPiskelJson("not-json"),
      "invalid-json",
      "not valid JSON",
    );
    await expectPiskelError(
      importPiskelJson(fixture("unsupported-model-version")),
      "unsupported-model-version",
      "expected integer 2",
    );
    await expectPiskelError(
      importPiskelJson(fixture("bad-frame-coverage")),
      "frame-coverage",
      "frame coverage is incomplete",
    );
    await expectPiskelError(
      importPiskelJson(fixture("bad-png-dimensions")),
      "png-dimension-mismatch",
      "PNG dimensions must be",
    );
    await expectPiskelError(
      importPiskelJson(fixture("multi-frame"), {
        decodePng: async () => {
          throw new Error("private decoder detail");
        },
      }),
      "browser-image-decode",
      "Could not decode PNG for Piskel layer 1, chunk 1",
    );
    expect(getPiskelImportDiagnostic(new Error("private pixels"))).toBeNull();
  });

  it.each([undefined, 1, 3, "2"])(
    "rejects unsupported model version %s",
    async (modelVersion) => {
      const document = documentFixture("multi-frame");
      if (modelVersion === undefined) {
        delete document.modelVersion;
        await expect(importPiskelJson(JSON.stringify(document))).rejects.toThrow(
          "Piskel document.modelVersion is required.",
        );
      } else {
        document.modelVersion = modelVersion;
        await expect(importPiskelJson(JSON.stringify(document))).rejects.toThrow(
          "Unsupported Piskel modelVersion; expected integer 2.",
        );
      }
    },
  );

  it("requires a non-empty string-encoded layer array and required layer fields", async () => {
    const empty = documentFixture("multi-frame");
    piskelObject(empty).layers = [];
    await expect(importPiskelJson(JSON.stringify(empty))).rejects.toThrow(
      "Piskel object.layers must be a non-empty array.",
    );

    const directObject = documentFixture("multi-frame");
    piskelObject(directObject).layers = [layerRecord(directObject)];
    await expect(importPiskelJson(JSON.stringify(directObject))).rejects.toThrow(
      "Piskel layer 1 must be a string-encoded JSON record.",
    );

    const missingName = documentFixture("multi-frame");
    const missingNameLayer = layerRecord(missingName);
    delete missingNameLayer.name;
    replaceLayer(missingName, missingNameLayer);
    await expect(importPiskelJson(JSON.stringify(missingName))).rejects.toThrow(
      "Piskel layer 1.name is required.",
    );
  });

  it.each([
    ["https://example.invalid/sprite.png", "must be an embedded PNG data URL"],
    ["data:image/png;base64,not base64", "must contain strict base64 PNG data"],
    ["data:image/png;base64,bm90LXBuZw==", "does not contain valid PNG bytes"],
  ])("rejects invalid PNG data URL %#", async (base64PNG, message) => {
    const document = documentFixture("multi-frame");
    const layer = layerRecord(document);
    const chunks = layer.chunks as JsonRecord[];
    chunks[0].base64PNG = base64PNG;
    replaceLayer(document, layer);
    const decodePng = fixtureDecoder();

    await expect(
      importPiskelJson(JSON.stringify(document), { decodePng }),
    ).rejects.toThrow(message);
    expect(decodePng).not.toHaveBeenCalled();
  });

  it.each([
    ["width", 0, "Piskel object.width must be an integer from 1 to 1024."],
    ["width", 1025, "Piskel object.width must be an integer from 1 to 1024."],
    ["height", 1.5, "Piskel object.height must be an integer from 1 to 1024."],
  ])("rejects invalid project dimension %#", async (field, value, message) => {
    const document = documentFixture("multi-frame");
    piskelObject(document)[field] = value;

    await expect(importPiskelJson(JSON.stringify(document))).rejects.toThrow(message);
  });

  it("validates PNG header and decoded dimensions before copying pixels", async () => {
    const headerMismatch = documentFixture("multi-frame");
    piskelObject(headerMismatch).width = 1;
    const decodePng = fixtureDecoder();

    await expect(
      importPiskelJson(JSON.stringify(headerMismatch), { decodePng }),
    ).rejects.toThrow("PNG dimensions must be 2x2.");
    expect(decodePng).not.toHaveBeenCalled();

    const wrongDecodedSize = vi.fn(async (): Promise<ImageData> => ({
      colorSpace: "srgb",
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
    }));
    await expect(
      importPiskelJson(fixture("multi-frame"), { decodePng: wrongDecodedSize }),
    ).rejects.toThrow("must contain 4x2 RGBA pixels.");
  });

  it("rejects duplicate, out-of-range, and incomplete frame mappings before decode", async () => {
    const duplicate = documentFixture("multi-frame");
    const duplicateLayer = layerRecord(duplicate);
    const duplicateChunks = duplicateLayer.chunks as JsonRecord[];
    duplicateChunks[1].layout = [[1]];
    replaceLayer(duplicate, duplicateLayer);

    const outOfRange = documentFixture("multi-frame");
    const outOfRangeLayer = layerRecord(outOfRange);
    const outOfRangeChunks = outOfRangeLayer.chunks as JsonRecord[];
    outOfRangeChunks[1].layout = [[3]];
    replaceLayer(outOfRange, outOfRangeLayer);

    const incomplete = documentFixture("multi-frame");
    const incompleteLayer = layerRecord(incomplete);
    incompleteLayer.frameCount = 4;
    replaceLayer(incomplete, incompleteLayer);

    const decodePng = fixtureDecoder();
    await expect(
      importPiskelJson(JSON.stringify(duplicate), { decodePng }),
    ).rejects.toThrow("layout contains a duplicate frame index.");
    await expect(
      importPiskelJson(JSON.stringify(outOfRange), { decodePng }),
    ).rejects.toThrow("layout contains an out-of-range frame index.");
    await expect(
      importPiskelJson(JSON.stringify(incomplete), { decodePng }),
    ).rejects.toThrow("Piskel layer 1 frame coverage is incomplete.");
    expect(decodePng).not.toHaveBeenCalled();
  });

  it("rejects ragged chunk layouts and inconsistent layer frame counts", async () => {
    const ragged = documentFixture("multi-frame");
    const raggedLayer = layerRecord(ragged);
    const raggedChunks = raggedLayer.chunks as JsonRecord[];
    raggedChunks[0].layout = [[0, 1], [2]];
    replaceLayer(ragged, raggedLayer);

    await expect(importPiskelJson(JSON.stringify(ragged))).rejects.toThrow(
      "layout must be rectangular.",
    );

    const inconsistent = documentFixture("multi-layer");
    const secondLayer = layerRecord(inconsistent, 1);
    secondLayer.frameCount = 3;
    replaceLayer(inconsistent, secondLayer, 1);

    await expect(importPiskelJson(JSON.stringify(inconsistent))).rejects.toThrow(
      "All Piskel layers must have the same frameCount.",
    );
  });

  it("rejects unsupported fields and ambiguous legacy layers", async () => {
    const unsupported = documentFixture("multi-frame");
    piskelObject(unsupported).unsupportedMetadata = true;
    await expect(importPiskelJson(JSON.stringify(unsupported))).rejects.toThrow(
      'Piskel object contains unsupported field "unsupportedMetadata".',
    );

    const ambiguousLegacy = documentFixture("multi-frame");
    const ambiguousLayer = layerRecord(ambiguousLegacy);
    const chunks = ambiguousLayer.chunks as JsonRecord[];
    ambiguousLayer.base64PNG = chunks[0].base64PNG;
    replaceLayer(ambiguousLegacy, ambiguousLayer);
    await expect(importPiskelJson(JSON.stringify(ambiguousLegacy))).rejects.toThrow(
      "cannot contain both chunks and a legacy base64PNG field.",
    );

  });

  it.each([
    [
      "non-array-hidden-frames" as const,
      "Piskel object.hiddenFrames must be an array or an empty string when present.",
    ],
    [
      "duplicate-hidden-frames" as const,
      "Piskel object.hiddenFrames contains a duplicate frame index.",
    ],
    [
      "out-of-range-hidden-frame" as const,
      "Piskel object.hiddenFrames contains an out-of-range frame index.",
    ],
    [
      "all-frames-hidden" as const,
      "Piskel file must contain at least one visible frame.",
    ],
  ])("rejects invalid hidden-frame fixture %s", async (name, message) => {
    await expectPiskelError(
      importPiskelJson(fixture(name)),
      "hidden-frames",
      message,
    );
  });

  it.each(["1", "1,3"])(
    "rejects unsupported top-level hiddenFrames string %s",
    async (hiddenFrames) => {
      const document = documentFixture("multi-frame");
      piskelObject(document).hiddenFrames = hiddenFrames;

      await expect(importPiskelJson(JSON.stringify(document))).rejects.toThrow(
        "Piskel object.hiddenFrames may be an empty string for compatibility, but non-empty strings are unsupported.",
      );
    },
  );

  it.each([1.5, " ", "01", "+1", "-1", "1.0", "1,3", "hidden", null])(
    "rejects invalid hidden frame array index %s",
    async (frameIndex) => {
      const document = documentFixture("multi-frame");
      piskelObject(document).hiddenFrames = [frameIndex];

      await expect(importPiskelJson(JSON.stringify(document))).rejects.toThrow(
        "Piskel object.hiddenFrames must contain safe integer frame indexes or strict decimal index strings.",
      );
    },
  );

  it.each([0, -1, "12"])("rejects invalid FPS %s", async (fps) => {
    const document = documentFixture("multi-frame");
    piskelObject(document).fps = fps;

    await expect(importPiskelJson(JSON.stringify(document))).rejects.toThrow(
      "Piskel object.fps must be a finite number greater than zero.",
    );
  });
});
