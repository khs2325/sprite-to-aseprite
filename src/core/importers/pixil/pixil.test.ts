import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  getPixilImportDiagnostic,
  importPixil,
  importPixilJson,
  PixilImportError,
  type PixilImportErrorCode,
} from ".";

type JsonRecord = Record<string, unknown>;

type PixilFixtureName =
  | "ambiguous-layer-index"
  | "external-image-url"
  | "missing-cel"
  | "two-layers-two-frames"
  | "unsupported-blend-mode";

const transparent = [0, 0, 0, 0];
const cyan = [17, 138, 178, 255];
const coral = [239, 71, 111, 255];
const yellow = [255, 209, 102, 255];

function fixture(name: PixilFixtureName): string {
  return readFileSync(
    new URL(`../../../../tests/fixtures/pixil/${name}.pixil`, import.meta.url),
    "utf8",
  );
}

function documentFixture(): JsonRecord {
  return JSON.parse(fixture("two-layers-two-frames")) as JsonRecord;
}

function pixilObject(document: JsonRecord): JsonRecord {
  return document.pixil as JsonRecord;
}

function frames(document: JsonRecord): JsonRecord[] {
  return pixilObject(document).frames as JsonRecord[];
}

function layers(document: JsonRecord): JsonRecord[] {
  return pixilObject(document).layers as JsonRecord[];
}

function cels(document: JsonRecord, layerIndex = 0): JsonRecord[] {
  return layers(document)[layerIndex].cels as JsonRecord[];
}

function pixel(image: ImageData, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4;
  return [...image.data.slice(offset, offset + 4)];
}

async function expectPixilError(
  operation: () => unknown,
  code: PixilImportErrorCode,
  message: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(PixilImportError);
    expect(error).toMatchObject({ code });
    expect(getPixilImportDiagnostic(error)).toContain(message);
    return;
  }
  throw new Error(`Expected Pixil import to fail with ${code}.`);
}

describe("Pixil importer", () => {
  it("imports the fixture-gated raw RGBA subset with frames, layers, and timing", () => {
    const project = importPixilJson(fixture("two-layers-two-frames"));

    expect(project).toMatchObject({
      colorMode: "rgba",
      width: 2,
      height: 2,
      frames: [
        { index: 0, durationMs: 120 },
        { index: 1, durationMs: 75 },
      ],
      layers: [
        {
          id: "pixil-layer-0",
          name: "Base visible half",
          visible: true,
          opacity: 128,
          cels: [
            { frameIndex: 0, x: 0, y: 0 },
            { frameIndex: 1, x: 0, y: 0 },
          ],
        },
        {
          id: "pixil-layer-1",
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
    expect(pixel(project.layers[0].cels[0].imageData, 1, 0)).toEqual(transparent);
    expect(pixel(project.layers[0].cels[1].imageData, 0, 1)).toEqual(cyan);
    expect(pixel(project.layers[1].cels[0].imageData, 1, 0)).toEqual(coral);
    expect(pixel(project.layers[1].cels[1].imageData, 0, 1)).toEqual(yellow);
  });

  it("reads a local File without changing the browser-only import boundary", async () => {
    const file = Object.assign(
      new Blob([fixture("two-layers-two-frames")] as BlobPart[], {
        type: "application/json",
      }),
      {
        lastModified: 0,
        name: "fixture.pixil",
      },
    ) as File;

    const project = await importPixil(file);

    expect(project).toMatchObject({ width: 2, height: 2 });
  });
});

describe("Pixil validation", () => {
  it.each([
    [
      "unsupported-blend-mode" as const,
      "unsupported-feature" as const,
      "unsupported blend mode",
    ],
    [
      "external-image-url" as const,
      "unsupported-feature" as const,
      "must not reference an external image URL",
    ],
    [
      "missing-cel" as const,
      "invalid-project" as const,
      "one full-canvas cel per frame",
    ],
    [
      "ambiguous-layer-index" as const,
      "invalid-project" as const,
      "layer 2.index must be 1",
    ],
  ])("rejects fixture %s deterministically", async (name, code, message) => {
    await expectPixilError(() => importPixilJson(fixture(name)), code, message);
  });

  it("keeps malformed JSON and arbitrary errors content-safe", async () => {
    await expectPixilError(
      () => importPixilJson('{"private pixels":'),
      "invalid-json",
      "not valid JSON",
    );
    expect(getPixilImportDiagnostic(new Error("private pixels"))).toBeNull();
  });

  it.each([
    [
      "unsupported schema",
      (document: JsonRecord) => {
        pixilObject(document).schemaVersion = 2;
      },
      "unsupported-version" as const,
      "expected integer 1",
    ],
    [
      "unsafe dimension",
      (document: JsonRecord) => {
        pixilObject(document).width = 0;
      },
      "allocation-limit" as const,
      "project.width",
    ],
    [
      "frame count mismatch",
      (document: JsonRecord) => {
        pixilObject(document).frameCount = 3;
      },
      "invalid-project" as const,
      "frameCount must equal 2",
    ],
    [
      "ambiguous frame order",
      (document: JsonRecord) => {
        frames(document)[1].index = 3;
      },
      "invalid-project" as const,
      "frame 2.index must be 1",
    ],
    [
      "invalid duration",
      (document: JsonRecord) => {
        frames(document)[0].durationMs = 0;
      },
      "invalid-project" as const,
      "durationMs",
    ],
    [
      "invalid opacity",
      (document: JsonRecord) => {
        layers(document)[0].opacity = 1.5;
      },
      "invalid-project" as const,
      "opacity",
    ],
    [
      "short pixel payload",
      (document: JsonRecord) => {
        cels(document)[0].rgbaBase64 = "AAAA";
      },
      "invalid-pixels" as const,
      "exactly 16 RGBA bytes",
    ],
    [
      "partial-canvas placement",
      (document: JsonRecord) => {
        cels(document)[0].x = 1;
      },
      "unsupported-feature" as const,
      "partial-canvas cel placement",
    ],
    [
      "unknown metadata",
      (document: JsonRecord) => {
        pixilObject(document).privateMetadata = true;
      },
      "unsupported-feature" as const,
      "unsupported field",
    ],
  ])("rejects %s before accepting unsafe pixels", async (_name, mutate, code, message) => {
    const document = documentFixture();
    mutate(document);

    await expectPixilError(
      () => importPixilJson(JSON.stringify(document)),
      code,
      message,
    );
  });
});
