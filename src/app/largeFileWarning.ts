import type { FileImportFormat } from "./fileImport";

export const LARGE_SOURCE_SIZE_BYTES = 64 * 1024 * 1024;
export const LARGE_DECODED_RGBA_SIZE_BYTES = 64 * 1024 * 1024;
export const LONG_SEQUENCE_FILE_COUNT = 100;

export const LARGE_FILE_WARNING =
  "Large-file warning: This is advisory and does not block conversion; large sprites, layered projects, or long animations may exceed browser memory.";

type SourceFileSize = Pick<File, "size">;

export type DecodedRgbaEstimate = {
  width: number;
  height: number;
  frames?: number;
  layers?: number;
};

export type LargeFileWarningContext = {
  decodedRgbaEstimate?: DecodedRgbaEstimate | null;
};

const BYTES_PER_RGBA_PIXEL = 4;

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function multiplySafe(values: readonly number[]): number | null {
  let product = 1;
  for (const value of values) {
    if (
      !isPositiveSafeInteger(value) ||
      product > Number.MAX_SAFE_INTEGER / value
    ) {
      return null;
    }
    product *= value;
  }
  return product;
}

export function estimateDecodedRgbaBytes(
  estimate: DecodedRgbaEstimate,
): number | null {
  return multiplySafe([
    estimate.width,
    estimate.height,
    BYTES_PER_RGBA_PIXEL,
    estimate.frames ?? 1,
    estimate.layers ?? 1,
  ]);
}

function formatByteSize(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  if (mib >= 1) {
    return `${Number.isInteger(mib) ? mib : mib.toFixed(1)} MiB`;
  }
  return `${Math.ceil(bytes / 1024)} KiB`;
}

function formatDecodedRgbaEstimate(
  estimate: DecodedRgbaEstimate,
): string | null {
  const bytes = estimateDecodedRgbaBytes(estimate);
  if (bytes === null) {
    return null;
  }

  const factors = [
    String(estimate.width),
    String(estimate.height),
    `${BYTES_PER_RGBA_PIXEL} bytes`,
  ];
  if ((estimate.frames ?? 1) > 1) {
    factors.push(`${estimate.frames} frames`);
  }
  if ((estimate.layers ?? 1) > 1) {
    factors.push(`${estimate.layers} layers`);
  }

  return (
    `Estimated decoded RGBA pixel data: about ${formatByteSize(bytes)} ` +
    `(${factors.join(" x ")}).`
  );
}

export function getLargeFileWarning(
  mode: FileImportFormat,
  files: readonly SourceFileSize[],
  context: LargeFileWarningContext = {},
): string | null {
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const isLongSequence =
    mode === "png-sequence" && files.length >= LONG_SEQUENCE_FILE_COUNT;
  const isLargeSelection = totalBytes >= LARGE_SOURCE_SIZE_BYTES;
  const decodedBytes =
    context.decodedRgbaEstimate === undefined ||
    context.decodedRgbaEstimate === null
      ? null
      : estimateDecodedRgbaBytes(context.decodedRgbaEstimate);
  const isLargeDecoded =
    decodedBytes !== null && decodedBytes >= LARGE_DECODED_RGBA_SIZE_BYTES;

  if (!isLongSequence && !isLargeSelection && !isLargeDecoded) {
    return null;
  }

  const decodedEstimate =
    context.decodedRgbaEstimate === undefined ||
    context.decodedRgbaEstimate === null
      ? null
      : formatDecodedRgbaEstimate(context.decodedRgbaEstimate);

  return [
    LARGE_FILE_WARNING,
    decodedEstimate ??
      "Compressed source size is only a rough risk signal; decoded RGBA memory depends on dimensions.",
    "Frames and supported source layers, when the source format contains layer data, multiply memory use; previews and export buffers add more.",
    "Files remain browser-local, are not uploaded for estimation, and no telemetry is collected.",
  ].join(" ");
}

export function renderLargeFileWarning(
  output: HTMLElement,
  mode: FileImportFormat,
  files: readonly SourceFileSize[],
  context: LargeFileWarningContext = {},
): void {
  const warning = getLargeFileWarning(mode, files, context);
  output.textContent = warning ?? "";
  output.hidden = warning === null;
}
