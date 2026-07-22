import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { getPixilImportDiagnostic, importPixil, importPixilJson, PixilImportError, type PixilImportErrorCode } from ".";

type JsonRecord = Record<string, unknown>;
type FixtureName = "ambiguous-layer-index" | "external-image-url" | "missing-cel" | "two-layers-two-frames" | "unsupported-blend-mode";

function fixture(name: FixtureName): string {
  return readFileSync(new URL(`../../../../tests/fixtures/pixil/${name}.pixil`, import.meta.url), "utf8");
}
function documentFixture(): JsonRecord { return JSON.parse(fixture("two-layers-two-frames")) as JsonRecord; }
function frames(document: JsonRecord): JsonRecord[] { return document.frames as JsonRecord[]; }
function layers(document: JsonRecord, frame = 0): JsonRecord[] { return frames(document)[frame].layers as JsonRecord[]; }
function uint32(bytes: Uint8Array, offset: number): number { return bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3]; }
function decodeFixturePng(bytes: Uint8Array): Promise<ImageData> {
  let offset = 8; let width = 0; let height = 0; const compressed: Uint8Array[] = [];
  while (offset < bytes.length) {
    const length = uint32(bytes, offset); const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length); offset += length + 12;
    if (type === "IHDR") { width = uint32(data, 0); height = uint32(data, 4); }
    else if (type === "IDAT") compressed.push(data);
    else if (type === "IEND") break;
  }
  const packed = new Uint8Array(compressed.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0; for (const part of compressed) { packed.set(part, cursor); cursor += part.length; }
  const raw = new Uint8Array(inflateSync(packed)); const pixels = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) { expect(raw[row * (width * 4 + 1)]).toBe(0); pixels.set(raw.subarray(row * (width * 4 + 1) + 1, (row + 1) * (width * 4 + 1)), row * width * 4); }
  return Promise.resolve({ colorSpace: "srgb", data: pixels, width, height });
}
const dependencies = { decodePng: decodeFixturePng };
function pixel(image: ImageData, x: number, y: number): number[] { const offset = (y * image.width + x) * 4; return [...image.data.slice(offset, offset + 4)]; }
async function expectError(operation: () => unknown, code: PixilImportErrorCode, message: string): Promise<void> {
  try { await operation(); } catch (error) { expect(error).toBeInstanceOf(PixilImportError); expect(error).toMatchObject({ code }); expect(getPixilImportDiagnostic(error)).toContain(message); return; }
  throw new Error(`Expected Pixil import to fail with ${code}.`);
}

describe("Pixilart 2.7 importer", () => {
  it("reconstructs two logical layers across two frames from embedded PNGs", async () => {
    const project = await importPixilJson(fixture("two-layers-two-frames"), dependencies);
    expect(project).toMatchObject({ colorMode: "rgba", width: 2, height: 2, frames: [{ index: 0, durationMs: 120 }, { index: 1, durationMs: 75 }], layers: [
      { id: "pixil-layer-0", name: "Base visible half", visible: true, opacity: 128, cels: [{ frameIndex: 0 }, { frameIndex: 1 }] },
      { id: "pixil-layer-1", name: "Hidden ink", visible: true, opacity: 255, cels: [{ frameIndex: 0 }, { frameIndex: 1 }] },
    ] });
    expect(pixel(project.layers[0].cels[0].imageData, 0, 0)).toEqual([17, 138, 178, 255]);
    expect(pixel(project.layers[0].cels[1].imageData, 0, 1)).toEqual([17, 138, 178, 255]);
    expect(pixel(project.layers[1].cels[0].imageData, 1, 0)).toEqual([239, 71, 111, 255]);
    expect(pixel(project.layers[1].cels[1].imageData, 0, 1)).toEqual([255, 209, 102, 255]);
  });

  it("reads a local File using the same browser-only boundary", async () => {
    const file = Object.assign(new Blob([fixture("two-layers-two-frames")], { type: "application/json" }), { lastModified: 0, name: "fixture.pixil" }) as File;
    await expect(importPixil(file, dependencies)).resolves.toMatchObject({ width: 2, height: 2 });
  });

  it.each([
    ["unsupported-blend-mode", "unsupported-feature", "unsupported blend mode"],
    ["external-image-url", "invalid-pixels", "base64, payload marker"],
    ["missing-cel", "invalid-project", "identities and order"],
    ["ambiguous-layer-index", "invalid-project", "duplicates another layer identity"],
  ] as const)("rejects fixture %s safely", async (name, code, message) => expectError(() => importPixilJson(fixture(name), dependencies), code, message));
});

describe("Pixilart 2.7 validation", () => {
  it("rejects the retired repository-defined schema with a migration diagnostic", async () => {
    await expectError(() => importPixilJson('{"pixil":{"schemaVersion":1}}', dependencies), "unsupported-version", "repository-defined Pixil schemaVersion 1");
  });

  it.each([
    ["fractional dimension", (d: JsonRecord) => { d.width = "1.5"; }, "invalid-project", "safe integer"],
    ["zero dimension", (d: JsonRecord) => { d.height = "0"; }, "allocation-limit", "document.height"],
    ["oversized dimension", (d: JsonRecord) => { d.width = "1025"; }, "allocation-limit", "document.width"],
    ["unsafe dimension", (d: JsonRecord) => { d.width = "9007199254740993"; }, "invalid-project", "safe integer"],
    ["invalid frame size", (d: JsonRecord) => { frames(d)[0].width = "1"; }, "invalid-project", "dimensions must match"],
    ["invalid speed", (d: JsonRecord) => { frames(d)[0].speed = 0; }, "invalid-project", "greater than zero"],
    ["invalid opacity", (d: JsonRecord) => { layers(d)[0].opacity = "1.5"; }, "invalid-project", "opacity"],
    ["malformed base64", (d: JsonRecord) => { layers(d)[0].src = "anything;base64,%%%="; }, "invalid-pixels", "malformed base64"],
    ["non PNG", (d: JsonRecord) => { layers(d)[0].src = "anything;base64,QUJDRA=="; }, "invalid-pixels", "not a PNG"],
    ["unsupported version", (d: JsonRecord) => { d.version = "2.8.0"; }, "unsupported-version", "version 2.7.0"],
  ] as const)("rejects %s", async (_name, mutate, code, message) => { const document = documentFixture(); mutate(document); await expectError(() => importPixilJson(JSON.stringify(document), dependencies), code, message); });

  it("supports a validated numeric id fallback and marker variants", async () => {
    const document = documentFixture();
    for (const frame of frames(document)) for (const layer of frame.layers as JsonRecord[]) { delete layer.unqid; layer.src = (layer.src as string).replace("data:image/png;base64,", "data:image/png;fixture/base64,"); }
    const project = await importPixilJson(JSON.stringify(document), dependencies);
    expect(project.layers).toHaveLength(2);
  });

  it("validates decoded PNG dimensions and keeps arbitrary errors private", async () => {
    await expectError(() => importPixilJson(fixture("two-layers-two-frames"), { decodePng: async () => ({ colorSpace: "srgb", data: new Uint8ClampedArray(4), width: 1, height: 1 }) }), "png-dimension-mismatch", "must be 2x2");
    expect(getPixilImportDiagnostic(new Error("private pixels"))).toBeNull();
  });

  it("enforces frame, layer, cel, and decoded allocation limits", async () => {
    const tooManyFrames = documentFixture(); tooManyFrames.frames = Array.from({ length: 513 }, () => frames(documentFixture())[0]);
    await expectError(() => importPixilJson(JSON.stringify(tooManyFrames), dependencies), "allocation-limit", "frame count");
    const tooManyLayers = documentFixture(); frames(tooManyLayers)[0].layers = Array.from({ length: 65 }, () => layers(documentFixture())[0]);
    await expectError(() => importPixilJson(JSON.stringify(tooManyLayers), dependencies), "allocation-limit", "layer count");
    const tooMuchDecoded = documentFixture(); tooMuchDecoded.width = "1024"; tooMuchDecoded.height = "1024";
    for (const frame of frames(tooMuchDecoded)) {
      frame.width = "1024"; frame.height = "1024";
      const template = (frame.layers as JsonRecord[])[0];
      frame.layers = Array.from({ length: 17 }, (_, id) => ({ ...template, id, unqid: `large-${id}` }));
    }
    await expectError(() => importPixilJson(JSON.stringify(tooMuchDecoded), dependencies), "allocation-limit", "decoded cel data");
  });
});
