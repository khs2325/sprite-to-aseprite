import type { FileImportFormat } from "./fileImport";

export const LARGE_SOURCE_SIZE_BYTES = 64 * 1024 * 1024;
export const LONG_SEQUENCE_FILE_COUNT = 100;

export const LARGE_FILE_WARNING =
  "Large-file warning: Very large sprites or long sequences may exceed browser memory limits. You can still continue, and files remain browser-local.";

type SourceFileSize = Pick<File, "size">;

export function getLargeFileWarning(
  mode: FileImportFormat,
  files: readonly SourceFileSize[],
): string | null {
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const isLongSequence =
    mode === "png-sequence" && files.length >= LONG_SEQUENCE_FILE_COUNT;
  const isLargeSelection = totalBytes >= LARGE_SOURCE_SIZE_BYTES;

  return isLongSequence || isLargeSelection ? LARGE_FILE_WARNING : null;
}

export function renderLargeFileWarning(
  output: HTMLElement,
  mode: FileImportFormat,
  files: readonly SourceFileSize[],
): void {
  const warning = getLargeFileWarning(mode, files);
  output.textContent = warning ?? "";
  output.hidden = warning === null;
}
