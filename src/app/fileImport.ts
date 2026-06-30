import { validateSpriteProject } from "../core/validation";
import { getApngImportDiagnostic } from "../core/importers/apng";
import { getGifImportDiagnostic } from "../core/importers/gif";
import { getKritaImportDiagnostic } from "../core/importers/krita";
import { getOpenRasterImportDiagnostic } from "../core/importers/openraster";
import { getPixeloramaImportDiagnostic } from "../core/importers/pixelorama";
import { getPiskelImportDiagnostic } from "../core/importers/piskel";
import { getPsdParserDiagnostic } from "../core/importers/psd";
import { getSpritesheetJsonImportDiagnostic } from "../core/importers/spritesheetJson";

export const SUPPORTED_SOURCE_ACCEPT =
  ".png,.json,.piskel,.gif,.apng,.ora,.pxo,.kra,.psd,image/png,image/gif,image/apng,image/openraster,application/x-pixelorama,application/x-krita,application/x-kra,image/vnd.adobe.photoshop,image/x-photoshop,image/psd,application/x-photoshop,application/photoshop,application/psd,application/json";

export type FileImportFormat =
  | "png-sequence"
  | "spritesheet-grid"
  | "spritesheet-json"
  | "piskel"
  | "gif"
  | "apng"
  | "openraster"
  | "pixelorama"
  | "krita"
  | "psd";

export type BrowserSourceFile =
  | {
      file: File;
      kind: "png" | "gif" | "apng" | "ora" | "pxo" | "kra" | "psd";
      bytes: ArrayBuffer;
    }
  | {
      file: File;
      kind: "json";
      text: string;
    }
  | {
      file: File;
      kind: "piskel";
      text: string;
    };

export type SourceFilePresentation = {
  fileName: string;
  fileSize: string;
  kind: BrowserSourceFile["kind"];
  typeLabel:
    | "PNG image"
    | "JSON metadata"
    | "Piskel project"
    | "GIF animation"
    | "APNG animation"
    | "OpenRaster project"
    | "Pixelorama project"
    | "Krita project"
    | "PSD project";
};

export type SourcePreviewUrlStore = {
  clear(): void;
  get(file: File): string;
  retain(files: readonly File[]): void;
};

type ObjectUrlApi = Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;

const SOURCE_TYPE_LABELS: Record<
  BrowserSourceFile["kind"],
  SourceFilePresentation["typeLabel"]
> = {
  png: "PNG image",
  json: "JSON metadata",
  piskel: "Piskel project",
  gif: "GIF animation",
  apng: "APNG animation",
  ora: "OpenRaster project",
  pxo: "Pixelorama project",
  kra: "Krita project",
  psd: "PSD project",
};

export function formatFileSize(byteCount: number): string {
  if (byteCount < 1024) {
    return `${byteCount} ${byteCount === 1 ? "byte" : "bytes"}`;
  }
  const units = ["KB", "MB", "GB"] as const;
  let value = byteCount / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 10 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function getSourceFilePresentation(
  source: BrowserSourceFile,
  format?: FileImportFormat,
): SourceFilePresentation {
  return {
    fileName: source.file.name,
    fileSize: formatFileSize(source.file.size),
    kind: source.kind,
    typeLabel:
      format === "apng" && source.kind === "png"
        ? "APNG animation"
        : SOURCE_TYPE_LABELS[source.kind],
  };
}

export function createSourcePreviewUrlStore(
  urlApi: ObjectUrlApi = URL,
): SourcePreviewUrlStore {
  const urls = new Map<File, string>();

  const revoke = (file: File): void => {
    const url = urls.get(file);
    if (url !== undefined) {
      urlApi.revokeObjectURL(url);
      urls.delete(file);
    }
  };

  return {
    clear(): void {
      for (const file of [...urls.keys()]) {
        revoke(file);
      }
    },
    get(file: File): string {
      let url = urls.get(file);
      if (url === undefined) {
        url = urlApi.createObjectURL(file);
        urls.set(file, url);
      }
      return url;
    },
    retain(files: readonly File[]): void {
      const retained = new Set(files);
      for (const file of [...urls.keys()]) {
        if (!retained.has(file)) {
          revoke(file);
        }
      }
    },
  };
}

export type FileImportDependencies = {
  format?: FileImportFormat;
  onFilesImported?: (
    files: readonly BrowserSourceFile[],
  ) => unknown | Promise<unknown>;
};

export type FileImportControl = {
  destroy(): void;
  selectFiles(files: Iterable<File>): Promise<boolean>;
};

export type FileImportUi = FileImportControl & {
  element: HTMLElement;
};

export function getSourceKind(
  file: Pick<File, "name" | "type">,
): BrowserSourceFile["kind"] | null {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();

  if (extension === ".png") {
    return "png";
  }
  if (extension === ".json") {
    return "json";
  }
  if (extension === ".piskel") {
    return "piskel";
  }
  if (extension === ".gif") {
    return "gif";
  }
  if (extension === ".apng") {
    return "apng";
  }
  if (extension === ".ora") {
    return "ora";
  }
  if (extension === ".pxo") {
    return "pxo";
  }
  if (extension === ".kra") {
    return "kra";
  }
  if (extension === ".psd") {
    return "psd";
  }
  const mimeType = file.type.toLowerCase();
  if (mimeType === "image/gif") {
    return "gif";
  }
  if (mimeType === "image/apng") {
    return "apng";
  }
  if (mimeType === "image/openraster") {
    return "ora";
  }
  if (mimeType === "application/x-pixelorama") {
    return "pxo";
  }
  if (mimeType === "application/x-krita" || mimeType === "application/x-kra") {
    return "kra";
  }
  if (
    mimeType === "image/vnd.adobe.photoshop" ||
    mimeType === "image/x-photoshop" ||
    mimeType === "image/psd" ||
    mimeType === "application/x-photoshop" ||
    mimeType === "application/photoshop" ||
    mimeType === "application/psd"
  ) {
    return "psd";
  }
  if (mimeType === "image/png") {
    return "png";
  }
  return null;
}

async function readSourceFile(
  file: File,
  kind: BrowserSourceFile["kind"],
): Promise<BrowserSourceFile> {
  if (
    kind === "png" ||
    kind === "gif" ||
    kind === "apng" ||
    kind === "ora" ||
    kind === "pxo" ||
    kind === "kra" ||
    kind === "psd"
  ) {
    return { file, kind, bytes: await file.arrayBuffer() };
  }
  return { file, kind, text: await file.text() };
}

type FormatHelp = {
  label: string;
  suggestion: string;
};

const FORMAT_HELP: Record<FileImportFormat, FormatHelp> = {
  "png-sequence": {
    label: "PNG sequence",
    suggestion:
      "Check that every frame is a valid PNG with matching dimensions.",
  },
  "spritesheet-grid": {
    label: "Spritesheet grid",
    suggestion:
      "Check the PNG dimensions and the configured frame grid values.",
  },
  "spritesheet-json": {
    label: "Spritesheet PNG + JSON",
    suggestion:
      "Check that the JSON frame data is valid and fits inside the PNG.",
  },
  piskel: {
    label: "Piskel",
    suggestion:
      "Check that the file is a supported model-version-2 .piskel file.",
  },
  gif: {
    label: "GIF animation",
    suggestion: "Check that the file uses the supported GIF subset.",
  },
  apng: {
    label: "APNG animation",
    suggestion: "Check that the file uses the supported APNG subset.",
  },
  openraster: {
    label: "OpenRaster project",
    suggestion:
      "Check that the .ora file contains supported normal PNG-backed raster layer data.",
  },
  pixelorama: {
    label: "Pixelorama project",
    suggestion:
      "Check that the .pxo file contains supported raster pixel layer data.",
  },
  krita: {
    label: "Krita project",
    suggestion:
      "Check that the .kra file contains documented minimal 8-bit RGBA paint-layer data.",
  },
  psd: {
    label: "PSD project",
    suggestion:
      "Check that the .psd file contains supported RGB 8-bit raster layers from the documented subset.",
  },
};

function getFormatHelp(
  format: FileImportFormat | undefined,
  files: readonly BrowserSourceFile[],
): FormatHelp {
  if (format !== undefined) {
    return FORMAT_HELP[format];
  }
  if (files.some((file) => file.kind === "piskel")) {
    return FORMAT_HELP.piskel;
  }
  if (files.some((file) => file.kind === "gif")) {
    return FORMAT_HELP.gif;
  }
  if (files.some((file) => file.kind === "apng")) {
    return FORMAT_HELP.apng;
  }
  if (files.some((file) => file.kind === "ora")) {
    return FORMAT_HELP.openraster;
  }
  if (files.some((file) => file.kind === "pxo")) {
    return FORMAT_HELP.pixelorama;
  }
  if (files.some((file) => file.kind === "kra")) {
    return FORMAT_HELP.krita;
  }
  if (files.some((file) => file.kind === "psd")) {
    return FORMAT_HELP.psd;
  }
  if (files.some((file) => file.kind === "json")) {
    return FORMAT_HELP["spritesheet-json"];
  }
  if (files.length > 1) {
    return FORMAT_HELP["png-sequence"];
  }
  return {
    label: "PNG",
    suggestion: "Check that the selected file is a valid PNG image.",
  };
}

function getImporterMessage(
  error: unknown,
  format: FileImportFormat | undefined,
  files: readonly BrowserSourceFile[],
): string | null {
  if (format === "piskel") {
    const message = error instanceof Error
      ? error.message.replace(/\s+/g, " ").trim()
      : "";
    return message === "Piskel mode requires exactly one .piskel file."
      ? message
      : getPiskelImportDiagnostic(error);
  }
  if (format === "gif") {
    return getGifImportDiagnostic(error);
  }
  if (format === "apng") {
    return getApngImportDiagnostic(error);
  }
  if (format === "openraster") {
    const message = error instanceof Error
      ? error.message.replace(/\s+/g, " ").trim()
      : "";
    return message === "OpenRaster mode requires exactly one .ora file."
      ? message
      : getOpenRasterImportDiagnostic(error);
  }
  if (format === "pixelorama") {
    const message = error instanceof Error
      ? error.message.replace(/\s+/g, " ").trim()
      : "";
    return message === "Pixelorama mode requires exactly one .pxo file."
      ? message
      : getPixeloramaImportDiagnostic(error);
  }
  if (format === "krita") {
    const message = error instanceof Error
      ? error.message.replace(/\s+/g, " ").trim()
      : "";
    return message === "Krita mode requires exactly one .kra file."
      ? message
      : getKritaImportDiagnostic(error);
  }
  if (format === "psd") {
    const message = error instanceof Error
      ? error.message.replace(/\s+/g, " ").trim()
      : "";
    return message === "PSD mode requires exactly one .psd file."
      ? message
      : getPsdParserDiagnostic(error);
  }
  if (
    format === "spritesheet-json" ||
    (format === undefined && files.some((file) => file.kind === "json"))
  ) {
    return getSpritesheetJsonImportDiagnostic(error);
  }
  if (!(error instanceof Error)) {
    return null;
  }
  const message = error.message.replace(/\s+/g, " ").trim();
  return message.length > 0 ? message : null;
}

function getSelectionStatus(
  format: FileImportFormat | undefined,
  fileCount: number,
): string {
  if (format === "piskel") {
    return "Selected 1 Piskel file. Ready to convert browser-locally.";
  }
  if (format === "gif") {
    return "Selected 1 GIF animation. Ready to convert browser-locally.";
  }
  if (format === "apng") {
    return "Selected 1 APNG animation. Ready to convert browser-locally.";
  }
  if (format === "openraster") {
    return "Selected 1 OpenRaster project. Ready to convert browser-locally.";
  }
  if (format === "pixelorama") {
    return "Selected 1 Pixelorama project. Ready to convert browser-locally.";
  }
  if (format === "krita") {
    return "Selected 1 Krita project. Ready to convert browser-locally.";
  }
  if (format === "psd") {
    return "Selected 1 PSD project. The supported RGB 8-bit raster-layer subset will be checked browser-locally.";
  }
  const noun = fileCount === 1 ? "file" : "files";
  return `Selected ${fileCount} supported ${noun}.`;
}

export function bindFileImportControl(
  input: HTMLInputElement,
  errorOutput: HTMLElement,
  statusOutput: HTMLElement,
  dependencies: FileImportDependencies = {},
  dropTarget?: HTMLElement,
): FileImportControl {
  const clearMessages = (): void => {
    errorOutput.hidden = true;
    errorOutput.textContent = "";
    statusOutput.hidden = true;
    statusOutput.textContent = "";
  };

  const showError = (message: string): void => {
    errorOutput.textContent = message;
    errorOutput.hidden = false;
  };

  const selectFiles = async (files: Iterable<File>): Promise<boolean> => {
    clearMessages();
    const selectedFiles = Array.from(files);

    if (selectedFiles.length === 0) {
      return false;
    }

    const classifiedFiles: Array<{
      file: File;
      kind: BrowserSourceFile["kind"];
    }> = [];
    for (const file of selectedFiles) {
      const kind = getSourceKind(file);
      if (kind === null) {
        input.value = "";
        showError(
          `Unsupported file "${file.name}". Choose PNG, JSON, Piskel, GIF, APNG, OpenRaster, Pixelorama, Krita, or PSD files only.`,
        );
        return false;
      }
      classifiedFiles.push({ file, kind });
    }

    let importedFiles: BrowserSourceFile[];
    try {
      importedFiles = await Promise.all(
        classifiedFiles.map(({ file, kind }) => readSourceFile(file, kind)),
      );
    } catch {
      input.value = "";
      showError("Could not read the selected files in this browser.");
      return false;
    }

    const formatHelp = getFormatHelp(dependencies.format, importedFiles);
    let project: unknown;
    try {
      project = await dependencies.onFilesImported?.(importedFiles);
    } catch (error) {
      input.value = "";
      const detail = getImporterMessage(
        error,
        dependencies.format,
        importedFiles,
      );
      showError(
        [
          `${formatHelp.label} import failed.`,
          detail,
          formatHelp.suggestion,
        ]
          .filter((part): part is string => part !== null)
          .join(" "),
      );
      return false;
    }

    if (project !== undefined) {
      const validationErrors = validateSpriteProject(project);
      if (validationErrors.length > 0) {
        input.value = "";
        const issues = validationErrors
          .map(({ path, message }) => `${path}: ${message}`)
          .join("; ");
        showError(
          `${formatHelp.label} import produced an invalid sprite project. ` +
            `${issues} ${formatHelp.suggestion}`,
        );
        return false;
      }
    }

    statusOutput.textContent = getSelectionStatus(
      dependencies.format,
      importedFiles.length,
    );
    statusOutput.hidden = false;
    return true;
  };

  const handleChange = (): void => {
    void selectFiles(input.files ?? []);
  };

  const handleDragOver = (event: DragEvent): void => {
    event.preventDefault();
    if (event.dataTransfer !== null) {
      event.dataTransfer.dropEffect = "copy";
    }
  };

  const handleDrop = (event: DragEvent): void => {
    event.preventDefault();
    void selectFiles(event.dataTransfer?.files ?? []);
  };

  clearMessages();
  input.addEventListener("change", handleChange);
  dropTarget?.addEventListener("dragover", handleDragOver);
  dropTarget?.addEventListener("drop", handleDrop);

  return {
    destroy(): void {
      input.removeEventListener("change", handleChange);
      dropTarget?.removeEventListener("dragover", handleDragOver);
      dropTarget?.removeEventListener("drop", handleDrop);
    },
    selectFiles,
  };
}

export function mountFileImportUi(
  container: HTMLElement,
  dependencies: FileImportDependencies = {},
): FileImportUi {
  const document = container.ownerDocument;
  const element = document.createElement("section");
  const heading = document.createElement("h2");
  const dropInstructions = document.createElement("p");
  const supportedTypes = document.createElement("p");
  const privacyNotice = document.createElement("p");
  const input = document.createElement("input");
  const errorOutput = document.createElement("p");
  const statusOutput = document.createElement("p");

  element.setAttribute("aria-label", "Sprite source import");
  heading.textContent = "Import sprite source files";
  dropInstructions.textContent =
    "Drag and drop files here, or choose files with the control below.";
  supportedTypes.textContent =
    "Supported files: PNG images (.png), JSON metadata (.json), Piskel projects (.piskel), GIF animations (.gif), APNG animations (.apng or .png), OpenRaster projects (.ora), Pixelorama projects (.pxo), Krita projects (.kra, documented minimal raster subset), and PSD projects (.psd, RGB 8-bit raster-layer subset).";
  privacyNotice.textContent =
    "Your files stay in this browser and are never uploaded.";
  input.type = "file";
  input.multiple = true;
  input.accept = SUPPORTED_SOURCE_ACCEPT;
  input.setAttribute(
    "aria-label",
    "Choose PNG, JSON, Piskel, GIF, APNG, OpenRaster, Pixelorama, Krita, or PSD sprite source files",
  );
  errorOutput.setAttribute("role", "alert");
  errorOutput.setAttribute("aria-live", "assertive");
  statusOutput.setAttribute("role", "status");
  statusOutput.setAttribute("aria-live", "polite");
  element.append(
    heading,
    dropInstructions,
    supportedTypes,
    privacyNotice,
    input,
    errorOutput,
    statusOutput,
  );
  container.append(element);

  const control = bindFileImportControl(
    input,
    errorOutput,
    statusOutput,
    dependencies,
    element,
  );

  return { ...control, element };
}
