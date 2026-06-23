import { validateSpriteProject } from "../core/validation";
import { getPiskelImportDiagnostic } from "../core/importers/piskel";

export const SUPPORTED_SOURCE_ACCEPT =
  ".png,.json,.piskel,image/png,application/json";

export type FileImportFormat =
  | "png-sequence"
  | "spritesheet-grid"
  | "spritesheet-json"
  | "piskel";

export type BrowserSourceFile =
  | {
      file: File;
      kind: "png";
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
  return null;
}

async function readSourceFile(
  file: File,
  kind: BrowserSourceFile["kind"],
): Promise<BrowserSourceFile> {
  if (kind === "png") {
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
): string | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const message = error.message.replace(/\s+/g, " ").trim();
  if (format === "piskel") {
    return message === "Piskel mode requires exactly one .piskel file."
      ? message
      : getPiskelImportDiagnostic(error);
  }
  return message.length > 0 ? message : null;
}

function getSelectionStatus(
  format: FileImportFormat | undefined,
  fileCount: number,
): string {
  if (format === "piskel") {
    return "Selected 1 Piskel file. Ready to convert browser-locally.";
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
          `Unsupported file "${file.name}". Choose PNG, JSON, or Piskel files only.`,
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
      const detail = getImporterMessage(error, dependencies.format);
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
    "Supported files: PNG images (.png), JSON metadata (.json), and Piskel projects (.piskel).";
  privacyNotice.textContent =
    "Your files stay in this browser and are never uploaded.";
  input.type = "file";
  input.multiple = true;
  input.accept = SUPPORTED_SOURCE_ACCEPT;
  input.setAttribute(
    "aria-label",
    "Choose PNG, JSON, or Piskel sprite source files",
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
