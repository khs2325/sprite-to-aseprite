import type { SpriteProject } from "../core/SpriteProject";
import { importPngSequence } from "../core/importers/pngSequence";
import {
  getPiskelImportDiagnostic,
  importPiskel,
  PiskelImportError,
} from "../core/importers/piskel";
import {
  importSpritesheetGrid,
  type SpritesheetGridImportOptions,
} from "../core/importers/spritesheetGrid";
import { importSpritesheetJson } from "../core/importers/spritesheetJson";
import { mountExportDownloadUi } from "./exportDownload";
import {
  bindFileImportControl,
  SUPPORTED_SOURCE_ACCEPT,
  type BrowserSourceFile,
  type FileImportDependencies,
  type FileImportFormat,
} from "./fileImport";
import { mountLayerNamingUi } from "./layerNaming";
import { renderLargeFileWarning } from "./largeFileWarning";
import { mountPreviewTimelineUi } from "./previewTimeline";

type ConverterImporters = {
  importPngSequence: typeof importPngSequence;
  importPiskel: typeof importPiskel;
  importSpritesheetGrid: typeof importSpritesheetGrid;
  importSpritesheetJson: typeof importSpritesheetJson;
};

export type ConverterUi = {
  destroy(): void;
};

type ConversionUiElements = {
  activityControl: HTMLElement;
  progress: HTMLElement;
  status: HTMLElement;
  error: HTMLElement;
  sourceControls: readonly (HTMLInputElement | HTMLSelectElement)[];
  dropZone: HTMLElement;
  convertButton: HTMLButtonElement;
};

export type ConversionUiState = {
  isWorking: boolean;
  canConvert: boolean;
  status: string;
  error?: string;
};

const DEFAULT_IMPORTERS: ConverterImporters = {
  importPngSequence,
  importPiskel,
  importSpritesheetGrid,
  importSpritesheetJson,
};

const MODE_LABELS: Record<FileImportFormat, string> = {
  "png-sequence": "PNG sequence",
  "spritesheet-grid": "Spritesheet grid",
  "spritesheet-json": "Spritesheet PNG + JSON",
  piskel: "Piskel project",
};

export function renderConversionState(
  elements: ConversionUiElements,
  state: ConversionUiState,
): void {
  elements.activityControl.setAttribute("aria-busy", String(state.isWorking));
  elements.progress.hidden = !state.isWorking;
  elements.status.textContent = state.status;
  elements.error.textContent = state.error ?? "";
  elements.error.hidden = state.error === undefined;
  elements.convertButton.disabled = state.isWorking || !state.canConvert;
  elements.dropZone.inert = state.isWorking;
  elements.dropZone.setAttribute("aria-disabled", String(state.isWorking));
  for (const control of elements.sourceControls) {
    control.disabled = state.isWorking;
  }
}

export function getSourceSelectionError(
  mode: FileImportFormat,
  files: readonly BrowserSourceFile[],
): string | null {
  const pngCount = files.filter((file) => file.kind === "png").length;
  const jsonCount = files.filter((file) => file.kind === "json").length;
  const piskelCount = files.filter((file) => file.kind === "piskel").length;

  if (mode === "png-sequence") {
    return pngCount > 0 && jsonCount === 0 && piskelCount === 0
      ? null
      : "PNG sequence mode requires one or more PNG files and no JSON file.";
  }
  if (mode === "spritesheet-grid") {
    return pngCount === 1 && files.length === 1
      ? null
      : "Spritesheet grid mode requires exactly one PNG file.";
  }
  if (mode === "spritesheet-json") {
    return pngCount === 1 && jsonCount === 1 && files.length === 2
      ? null
      : "Spritesheet PNG + JSON mode requires exactly one PNG and one JSON file.";
  }
  return piskelCount === 1 && files.length === 1
    ? null
    : "Piskel mode requires exactly one .piskel file.";
}

export async function convertSourceFiles(
  mode: FileImportFormat,
  files: readonly BrowserSourceFile[],
  gridOptions: SpritesheetGridImportOptions,
  importers: ConverterImporters = DEFAULT_IMPORTERS,
): Promise<SpriteProject> {
  const selectionError = getSourceSelectionError(mode, files);
  if (selectionError !== null) {
    throw new Error(selectionError);
  }

  const pngFiles = files
    .filter((file) => file.kind === "png")
    .map((file) => file.file);

  if (mode === "png-sequence") {
    return importers.importPngSequence(pngFiles);
  }
  if (mode === "spritesheet-grid") {
    return importers.importSpritesheetGrid(pngFiles[0], gridOptions);
  }
  if (mode === "piskel") {
    const piskelFile = files.find((file) => file.kind === "piskel");
    if (piskelFile === undefined) {
      throw new Error("Piskel source file is missing.");
    }
    return importers.importPiskel(piskelFile.file);
  }

  const jsonFile = files.find((file) => file.kind === "json");
  if (jsonFile === undefined) {
    throw new Error("Spritesheet JSON metadata is missing.");
  }
  return importers.importSpritesheetJson(pngFiles[0], jsonFile.file);
}

export function getConversionSuccessStatus(
  mode: FileImportFormat,
  project: Pick<SpriteProject, "frames" | "layers">,
): string {
  const frameCount = project.frames.length;
  const frameNoun = frameCount === 1 ? "frame" : "frames";
  if (mode === "piskel") {
    const layerCount = project.layers.length;
    const layerNoun = layerCount === 1 ? "layer" : "layers";
    return (
      `Converted ${frameCount} visible Piskel ${frameNoun} and preserved ${layerCount} ${layerNoun} ` +
      "in an editable Aseprite timeline. Ready to download."
    );
  }
  return (
    `Converted ${frameCount} ${frameNoun} ` +
    "into an editable Aseprite timeline. Ready to download."
  );
}

export function getConversionErrorMessage(
  mode: FileImportFormat,
  error: unknown,
): string {
  if (mode !== "piskel") {
    return error instanceof Error && error.message.trim().length > 0
      ? error.message
      : "Could not convert the selected files.";
  }

  const diagnostic = getPiskelImportDiagnostic(error);
  if (diagnostic === null) {
    return (
      "Could not convert the Piskel file. " +
      "Check that it is a supported model-version-2 .piskel file."
    );
  }
  if (
    error instanceof PiskelImportError &&
    error.code === "browser-image-decode"
  ) {
    return (
      `Could not decode an embedded Piskel layer image in this browser: ${diagnostic} ` +
      "Check that the .piskel file is complete and try again."
    );
  }
  return (
    `The Piskel file failed validation: ${diagnostic} ` +
    "Check that it is a supported model-version-2 .piskel file."
  );
}

function createNumberInput(
  document: Document,
  labelText: string,
  value: string,
): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement("label");
  const input = document.createElement("input");
  label.textContent = labelText;
  input.type = "number";
  input.min = "1";
  input.step = "1";
  input.required = true;
  input.value = value;
  label.append(input);
  return { label, input };
}

export function mountConverterUi(root: HTMLElement): ConverterUi {
  const document = root.ownerDocument;
  root.replaceChildren();

  const header = document.createElement("header");
  const title = document.createElement("h1");
  const introduction = document.createElement("p");
  const privacy = document.createElement("p");
  title.textContent = "Sprite to Aseprite Converter";
  introduction.textContent =
    "Convert frames into an editable Aseprite timeline from PNG sequences, spritesheets, and Piskel projects.";
  privacy.textContent =
    "Files are processed browser-locally. Your artwork is never uploaded.";
  privacy.className = "privacy-notice";
  header.append(title, introduction, privacy);

  const controls = document.createElement("section");
  const controlsHeading = document.createElement("h2");
  const modeLabel = document.createElement("label");
  const modeSelect = document.createElement("select");
  controls.className = "panel";
  controlsHeading.textContent = "1. Choose an import mode";
  modeLabel.textContent = "Import mode";
  for (const [value, label] of Object.entries(MODE_LABELS)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    modeSelect.append(option);
  }
  modeLabel.append(modeSelect);

  const gridFields = document.createElement("fieldset");
  const gridLegend = document.createElement("legend");
  const frameWidth = createNumberInput(document, "Frame width", "32");
  const frameHeight = createNumberInput(document, "Frame height", "32");
  const rows = createNumberInput(document, "Rows", "1");
  const columns = createNumberInput(document, "Columns", "1");
  const frameOrderLabel = document.createElement("label");
  const frameOrder = document.createElement("select");
  const rowMajor = document.createElement("option");
  const columnMajor = document.createElement("option");
  gridFields.className = "grid-options";
  gridLegend.textContent = "Grid settings";
  frameOrderLabel.textContent = "Frame order";
  rowMajor.value = "row-major";
  rowMajor.textContent = "Rows first";
  columnMajor.value = "column-major";
  columnMajor.textContent = "Columns first";
  frameOrder.append(rowMajor, columnMajor);
  frameOrderLabel.append(frameOrder);
  gridFields.append(
    gridLegend,
    frameWidth.label,
    frameHeight.label,
    rows.label,
    columns.label,
    frameOrderLabel,
  );
  controls.append(controlsHeading, modeLabel, gridFields);

  const importPanel = document.createElement("section");
  const importHeading = document.createElement("h2");
  const dropZone = document.createElement("div");
  const dropInstructions = document.createElement("p");
  const fileInput = document.createElement("input");
  const sourceError = document.createElement("p");
  const sourceStatus = document.createElement("p");
  const memoryWarning = document.createElement("p");
  importPanel.className = "panel";
  importHeading.textContent = "2. Add source files";
  dropZone.className = "drop-zone";
  dropInstructions.textContent =
    "Drag and drop PNG, JSON, or Piskel files here, or choose files below.";
  fileInput.type = "file";
  fileInput.multiple = true;
  fileInput.accept = SUPPORTED_SOURCE_ACCEPT;
  fileInput.setAttribute(
    "aria-label",
    "Choose PNG, JSON, or Piskel sprite source files",
  );
  sourceError.setAttribute("role", "alert");
  sourceError.setAttribute("aria-live", "assertive");
  sourceStatus.setAttribute("role", "status");
  sourceStatus.setAttribute("aria-live", "polite");
  memoryWarning.className = "memory-warning";
  memoryWarning.setAttribute("role", "status");
  memoryWarning.setAttribute("aria-live", "polite");
  memoryWarning.hidden = true;
  dropZone.append(dropInstructions, fileInput);
  importPanel.append(
    importHeading,
    dropZone,
    sourceError,
    sourceStatus,
    memoryWarning,
  );

  const convertPanel = document.createElement("section");
  const convertHeading = document.createElement("h2");
  const convertButton = document.createElement("button");
  const conversionProgress = document.createElement("progress");
  const conversionStatus = document.createElement("p");
  const conversionError = document.createElement("p");
  convertPanel.className = "panel";
  convertHeading.textContent = "3. Convert and download";
  convertButton.type = "button";
  convertButton.textContent = "Convert to .aseprite";
  convertButton.disabled = true;
  conversionProgress.className = "conversion-progress";
  conversionProgress.setAttribute("aria-label", "Conversion progress");
  conversionProgress.hidden = true;
  conversionStatus.id = "conversion-status";
  conversionStatus.setAttribute("role", "status");
  conversionStatus.setAttribute("aria-live", "polite");
  conversionStatus.textContent = "Choose source files to begin.";
  conversionError.setAttribute("role", "alert");
  conversionError.setAttribute("aria-live", "assertive");
  conversionError.hidden = true;
  convertButton.setAttribute("aria-describedby", conversionStatus.id);
  convertPanel.append(
    convertHeading,
    convertButton,
    conversionProgress,
    conversionStatus,
    conversionError,
  );

  const workspace = document.createElement("div");
  const previewContainer = document.createElement("div");
  const layerContainer = document.createElement("div");
  const exportContainer = document.createElement("div");
  workspace.className = "workspace";
  previewContainer.className = "panel";
  layerContainer.className = "panel";
  exportContainer.className = "download-area";
  workspace.append(previewContainer, layerContainer);
  convertPanel.append(exportContainer);
  root.append(header, controls, importPanel, convertPanel, workspace);

  let mode: FileImportFormat = "png-sequence";
  let selectedFiles: readonly BrowserSourceFile[] = [];
  let conversionRequest = 0;
  let isConverting = false;

  const conversionElements: ConversionUiElements = {
    activityControl: convertButton,
    progress: conversionProgress,
    status: conversionStatus,
    error: conversionError,
    sourceControls: [
      modeSelect,
      fileInput,
      frameWidth.input,
      frameHeight.input,
      rows.input,
      columns.input,
      frameOrder,
    ],
    dropZone,
    convertButton,
  };

  const exportUi = mountExportDownloadUi(exportContainer);
  exportUi.element.hidden = true;

  const syncProject = (project: SpriteProject | null): void => {
    previewUi.setProject(project);
    layerUi.setProject(project);
    exportUi.setProject(project);
    exportUi.element.hidden = project === null;
  };

  const previewUi = mountPreviewTimelineUi(previewContainer, {
    onProjectChange(project): void {
      layerUi.setProject(project);
      exportUi.setProject(project);
    },
  });
  const layerUi = mountLayerNamingUi(layerContainer, {
    onProjectChange(project): void {
      previewUi.setProject(project);
      exportUi.setProject(project);
    },
  });

  const clearConversion = (): void => {
    conversionRequest += 1;
    isConverting = false;
    selectedFiles = [];
    renderConversionState(conversionElements, {
      isWorking: false,
      canConvert: false,
      status: "Choose source files to begin.",
    });
    memoryWarning.hidden = true;
    memoryWarning.textContent = "";
    syncProject(null);
  };

  const fileImportDependencies: FileImportDependencies = {
    format: mode,
    onFilesImported(files): void {
      if (isConverting) {
        throw new Error(
          "Wait for the current conversion to finish before changing source files.",
        );
      }
      clearConversion();
      const selectionError = getSourceSelectionError(mode, files);
      if (selectionError !== null) {
        throw new Error(selectionError);
      }
      selectedFiles = files;
      renderConversionState(conversionElements, {
        isWorking: false,
        canConvert: true,
        status: "Source files are ready to convert.",
      });
      renderLargeFileWarning(
        memoryWarning,
        mode,
        files.map(({ file }) => file),
      );
    },
  };
  const fileImportControl = bindFileImportControl(
    fileInput,
    sourceError,
    sourceStatus,
    fileImportDependencies,
    dropZone,
  );

  const readGridOptions = (): SpritesheetGridImportOptions => ({
    frameWidth: Number(frameWidth.input.value),
    frameHeight: Number(frameHeight.input.value),
    rows: Number(rows.input.value),
    columns: Number(columns.input.value),
    frameOrder: frameOrder.value as "row-major" | "column-major",
  });

  const handleModeChange = (): void => {
    mode = modeSelect.value as FileImportFormat;
    fileImportDependencies.format = mode;
    gridFields.hidden = mode !== "spritesheet-grid";
    fileInput.multiple =
      mode === "png-sequence" || mode === "spritesheet-json";
    dropInstructions.textContent =
      mode === "piskel"
        ? "Drop exactly one .piskel file here, or choose one below."
        : "Drag and drop PNG, JSON, or Piskel files here, or choose files below.";
    fileInput.value = "";
    void fileImportControl.selectFiles([]);
    clearConversion();
  };

  const handleConvert = async (): Promise<void> => {
    if (isConverting || selectedFiles.length === 0) {
      return;
    }
    const request = ++conversionRequest;
    isConverting = true;
    syncProject(null);
    renderConversionState(conversionElements, {
      isWorking: true,
      canConvert: true,
      status:
        mode === "piskel"
          ? "Converting the Piskel project browser-locally. This may take a while."
          : "Converting files browser-locally. This may take a while.",
    });

    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (request !== conversionRequest) {
        return;
      }
      const project = await convertSourceFiles(
        mode,
        selectedFiles,
        readGridOptions(),
      );
      if (request !== conversionRequest) {
        return;
      }
      syncProject(project);
      renderConversionState(conversionElements, {
        isWorking: false,
        canConvert: true,
        status: getConversionSuccessStatus(mode, project),
      });
    } catch (error) {
      if (request !== conversionRequest) {
        return;
      }
      syncProject(null);
      renderConversionState(conversionElements, {
        isWorking: false,
        canConvert: true,
        status:
          mode === "piskel"
            ? "Piskel conversion did not complete."
            : "Conversion did not complete.",
        error: getConversionErrorMessage(mode, error),
      });
    } finally {
      if (request === conversionRequest) {
        isConverting = false;
      }
    }
  };

  modeSelect.addEventListener("change", handleModeChange);
  convertButton.addEventListener("click", handleConvert);
  handleModeChange();

  return {
    destroy(): void {
      conversionRequest += 1;
      modeSelect.removeEventListener("change", handleModeChange);
      convertButton.removeEventListener("click", handleConvert);
      fileImportControl.destroy();
      previewUi.destroy();
      layerUi.destroy();
      exportUi.destroy();
      root.replaceChildren();
    },
  };
}
