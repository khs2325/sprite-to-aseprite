import {
  normalizeFrameDurationMs,
  type SpriteCel,
  type SpriteProject,
} from "../../SpriteProject";

const MAX_FILE_BYTES = 96 * 1024 * 1024;
const MAX_DIMENSION = 1024;
const MAX_FRAMES = 512;
const MAX_LAYERS = 64;
const MAX_CELS = 4096;
const MAX_TOTAL_CEL_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_PNG_BYTES = 64 * 1024 * 1024;
const MAX_STRING_LENGTH = 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export type PixilImportErrorCode =
  | "allocation-limit"
  | "browser-image-decode"
  | "file-read"
  | "file-too-large"
  | "invalid-container"
  | "invalid-json"
  | "invalid-pixels"
  | "invalid-project"
  | "png-dimension-mismatch"
  | "unsupported-feature"
  | "unsupported-version";

export class PixilImportError extends Error {
  constructor(
    readonly code: PixilImportErrorCode,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "PixilImportError";
  }
}

export type PixilImportDependencies = {
  decodePng?: (pngBytes: Uint8Array) => Promise<ImageData>;
};

/** Returns importer-authored detail only; arbitrary thrown values stay private. */
export function getPixilImportDiagnostic(error: unknown): string | null {
  return error instanceof PixilImportError ? error.message : null;
}

type ParsedCel = { frameIndex: number; pngBytes: Uint8Array };
type ParsedLayer = {
  cels: ParsedCel[];
  id: string;
  name: string;
  opacity: number;
};
type ParsedPixil = {
  frames: { durationMs: number }[];
  height: number;
  layers: ParsedLayer[];
  width: number;
};

function fail(code: PixilImportErrorCode, message: string): never {
  throw new PixilImportError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function required(record: Record<string, unknown>, field: string, path: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(record, field)) {
    fail("invalid-project", `${path}.${field} is required.`);
  }
  return record[field];
}

function safeInteger(value: unknown, path: string): number {
  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string" && /^(?:0|[1-9]\d*)$/u.test(value)) {
    parsed = Number(value);
  } else {
    fail("invalid-project", `${path} must be a safe integer or canonical integer string.`);
  }
  if (!Number.isSafeInteger(parsed)) {
    fail("invalid-project", `${path} must be a safe integer or canonical integer string.`);
  }
  return parsed;
}

function dimension(value: unknown, path: string): number {
  const parsed = safeInteger(value, path);
  if (parsed < 1 || parsed > MAX_DIMENSION) {
    fail("allocation-limit", `${path} must be from 1 through ${MAX_DIMENSION}.`);
  }
  return parsed;
}

function nonEmptyString(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > MAX_STRING_LENGTH
  ) {
    fail("invalid-project", `${path} must be a non-empty string no longer than ${MAX_STRING_LENGTH} characters.`);
  }
  return value;
}

function opacity(value: unknown, path: string): number {
  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else if (
    typeof value === "string" &&
    /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/u.test(value)
  ) {
    parsed = Number(value);
  } else {
    fail("invalid-project", `${path} must be a number from 0 to 1 or a canonical numeric string.`);
  }
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    fail("invalid-project", `${path} must be from 0 to 1.`);
  }
  return Math.round(parsed * 255);
}

function strictBase64(payload: string, path: string): Uint8Array {
  if (payload.length === 0 || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(payload)) {
    fail("invalid-pixels", `${path} contains malformed base64 PNG data.`);
  }
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  if ((padding === 2 && payload.length >= 3 && (base64Value(payload.at(-3)!) & 15) !== 0) ||
      (padding === 1 && payload.length >= 2 && (base64Value(payload.at(-2)!) & 3) !== 0)) {
    fail("invalid-pixels", `${path} contains malformed base64 PNG data.`);
  }
  const length = payload.length / 4 * 3 - padding;
  const bytes = new Uint8Array(length);
  let output = 0;
  for (let index = 0; index < payload.length; index += 4) {
    const a = base64Value(payload[index]);
    const b = base64Value(payload[index + 1]);
    const c = payload[index + 2] === "=" ? 0 : base64Value(payload[index + 2]);
    const d = payload[index + 3] === "=" ? 0 : base64Value(payload[index + 3]);
    bytes[output++] = (a << 2) | (b >> 4);
    if (output < length) bytes[output++] = ((b & 15) << 4) | (c >> 2);
    if (output < length) bytes[output++] = ((c & 3) << 6) | d;
  }
  return bytes;
}

function base64Value(character: string): number {
  const code = character.charCodeAt(0);
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  return character === "+" ? 62 : character === "/" ? 63 : -1;
}

function pngPayload(src: unknown, path: string): Uint8Array {
  if (typeof src !== "string") fail("invalid-pixels", `${path} must contain embedded base64 PNG data.`);
  const marker = "base64,";
  const markerIndex = src.indexOf(marker);
  if (markerIndex < 0) fail("invalid-pixels", `${path} must contain a base64, payload marker.`);
  const bytes = strictBase64(src.slice(markerIndex + marker.length), path);
  if (bytes.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    fail("invalid-pixels", `${path} payload is not a PNG image.`);
  }
  return bytes;
}

function layerIdentity(layer: Record<string, unknown>, path: string): string {
  if (Object.prototype.hasOwnProperty.call(layer, "unqid")) {
    return `unqid:${nonEmptyString(layer.unqid, `${path}.unqid`)}`;
  }
  const id = safeInteger(required(layer, "id", path), `${path}.id`);
  if (id < 0) fail("invalid-project", `${path}.id must be non-negative.`);
  return `id:${id}`;
}

function parsePixilDocument(json: string): ParsedPixil {
  if (json.length > MAX_FILE_BYTES) fail("file-too-large", `Pixil file exceeds the ${MAX_FILE_BYTES}-byte import limit.`);
  let document: unknown;
  try { document = JSON.parse(json) as unknown; } catch { fail("invalid-json", "Pixil file is not valid JSON."); }
  if (!isRecord(document)) fail("invalid-container", "Pixil document must be an object.");
  if (Object.prototype.hasOwnProperty.call(document, "pixil")) {
    fail("unsupported-version", "The repository-defined Pixil schemaVersion 1 fixture format is no longer supported; use a genuine Pixilart 2.7.0 project structure.");
  }
  if (document.application !== "pixil" || document.type !== ".pixil" || document.website !== "pixilart.com") {
    fail("invalid-container", "Pixil document must identify application pixil, type .pixil, and website pixilart.com.");
  }
  if (document.version !== "2.7.0") fail("unsupported-version", "Only the observed Pixilart version 2.7.0 project structure is supported.");
  const width = dimension(required(document, "width", "Pixil document"), "Pixil document.width");
  const height = dimension(required(document, "height", "Pixil document"), "Pixil document.height");
  const frameValues = required(document, "frames", "Pixil document");
  if (!Array.isArray(frameValues)) fail("invalid-project", "Pixil document.frames must be an array.");
  if (frameValues.length < 1 || frameValues.length > MAX_FRAMES) fail("allocation-limit", `Pixil frame count must be from 1 through ${MAX_FRAMES}.`);

  const frames: ParsedPixil["frames"] = [];
  const layersById = new Map<string, ParsedLayer>();
  let firstFrameOrder: string[] | undefined;
  let totalPngBytes = 0;
  for (const [frameIndex, frameValue] of frameValues.entries()) {
    const path = `Pixil frame ${frameIndex + 1}`;
    if (!isRecord(frameValue)) fail("invalid-project", `${path} must be an object.`);
    if (dimension(required(frameValue, "width", path), `${path}.width`) !== width ||
        dimension(required(frameValue, "height", path), `${path}.height`) !== height) {
      fail("invalid-project", `${path} dimensions must match the ${width}x${height} canvas.`);
    }
    const speed = safeInteger(required(frameValue, "speed", path), `${path}.speed`);
    if (speed < 1) fail("invalid-project", `${path}.speed must be greater than zero milliseconds.`);
    frames.push({ durationMs: normalizeFrameDurationMs(speed) });
    const layerValues = required(frameValue, "layers", path);
    if (!Array.isArray(layerValues)) fail("invalid-project", `${path}.layers must be an array.`);
    if (layerValues.length < 1 || layerValues.length > MAX_LAYERS) fail("allocation-limit", `${path} layer count must be from 1 through ${MAX_LAYERS}.`);
    const order: string[] = [];
    for (const [layerIndex, layerValue] of layerValues.entries()) {
      const layerPath = `${path} layer ${layerIndex + 1}`;
      if (!isRecord(layerValue)) fail("invalid-project", `${layerPath} must be an object.`);
      const id = layerIdentity(layerValue, layerPath);
      if (order.includes(id)) fail("invalid-project", `${layerPath} duplicates another layer identity in the frame.`);
      order.push(id);
      const options = required(layerValue, "options", layerPath);
      if (!isRecord(options)) fail("invalid-project", `${layerPath}.options must be an object.`);
      if (options.blend !== "source-over") fail("unsupported-feature", `${layerPath} uses unsupported blend mode ${JSON.stringify(options.blend)}.`);
      if (Object.prototype.hasOwnProperty.call(layerValue, "active") && typeof layerValue.active !== "boolean") fail("invalid-project", `${layerPath}.active must be a boolean when present.`);
      const name = nonEmptyString(required(layerValue, "name", layerPath), `${layerPath}.name`);
      const parsedOpacity = opacity(required(layerValue, "opacity", layerPath), `${layerPath}.opacity`);
      const bytes = pngPayload(required(layerValue, "src", layerPath), `${layerPath}.src`);
      totalPngBytes += bytes.length;
      if (!Number.isSafeInteger(totalPngBytes) || totalPngBytes > MAX_TOTAL_PNG_BYTES) fail("allocation-limit", `Pixil embedded PNG data exceeds the ${MAX_TOTAL_PNG_BYTES}-byte import limit.`);
      const existing = layersById.get(id);
      if (existing === undefined) layersById.set(id, { id, name, opacity: parsedOpacity, cels: [{ frameIndex, pngBytes: bytes }] });
      else {
        if (existing.name !== name || existing.opacity !== parsedOpacity) fail("invalid-project", `${layerPath} metadata conflicts with the same logical layer in another frame.`);
        existing.cels.push({ frameIndex, pngBytes: bytes });
      }
    }
    if (firstFrameOrder === undefined) firstFrameOrder = order;
    else if (order.length !== firstFrameOrder.length || order.some((id, index) => id !== firstFrameOrder![index])) {
      fail("invalid-project", `${path} layer identities and order must match the first frame.`);
    }
  }
  const layerCount = firstFrameOrder!.length;
  const celCount = frames.length * layerCount;
  if (celCount > MAX_CELS) fail("allocation-limit", `Pixil cel count must not exceed ${MAX_CELS}.`);
  const rawBytes = width * height * 4 * celCount;
  if (!Number.isSafeInteger(rawBytes) || rawBytes > MAX_TOTAL_CEL_BYTES) fail("allocation-limit", `Pixil decoded cel data exceeds the ${MAX_TOTAL_CEL_BYTES}-byte import limit.`);
  return { width, height, frames, layers: firstFrameOrder!.map((id) => layersById.get(id)!), };
}

function validImageData(image: ImageData, width: number, height: number): boolean {
  return image.width === width && image.height === height && image.data instanceof Uint8ClampedArray && image.data.length === width * height * 4;
}

async function decodePngInBrowser(pngBytes: Uint8Array): Promise<ImageData> {
  const owned = new Uint8Array(pngBytes);
  const bitmap = await createImageBitmap(new Blob([owned.buffer], { type: "image/png" }));
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("Canvas context unavailable.");
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally { bitmap.close(); }
}

/** Parses the observed genuine Pixilart 2.7.0 saved-project subset locally. */
export async function importPixilJson(json: string, dependencies: PixilImportDependencies = {}): Promise<SpriteProject> {
  const parsed = parsePixilDocument(json);
  const decodePng = dependencies.decodePng ?? decodePngInBrowser;
  const layers: SpriteProject["layers"] = [];
  for (const [layerIndex, layer] of parsed.layers.entries()) {
    const cels: SpriteCel[] = [];
    for (const cel of layer.cels) {
      let imageData: ImageData;
      try { imageData = await decodePng(cel.pngBytes); }
      catch (error) { throw new PixilImportError("browser-image-decode", `Could not decode PNG for Pixil layer ${layerIndex + 1}, frame ${cel.frameIndex + 1}.`, { cause: error }); }
      if (!validImageData(imageData, parsed.width, parsed.height)) fail("png-dimension-mismatch", `Decoded PNG for Pixil layer ${layerIndex + 1}, frame ${cel.frameIndex + 1} must be ${parsed.width}x${parsed.height} RGBA pixels.`);
      cels.push({ frameIndex: cel.frameIndex, imageData, x: 0, y: 0 });
    }
    layers.push({ id: `pixil-layer-${layerIndex}`, name: layer.name, opacity: layer.opacity, visible: true, cels });
  }
  return { colorMode: "rgba", width: parsed.width, height: parsed.height, frames: parsed.frames.map((frame, index) => ({ index, durationMs: frame.durationMs })), layers };
}

/** Reads a browser-selected .pixil file without uploading or remotely fetching it. */
export async function importPixil(file: File, dependencies: PixilImportDependencies = {}): Promise<SpriteProject> {
  if (file.size > MAX_FILE_BYTES) fail("file-too-large", `Pixil file exceeds the ${MAX_FILE_BYTES}-byte import limit.`);
  let json: string;
  try { json = await file.text(); }
  catch (error) { throw new PixilImportError("file-read", "Could not read the selected Pixil file.", { cause: error }); }
  return importPixilJson(json, dependencies);
}
