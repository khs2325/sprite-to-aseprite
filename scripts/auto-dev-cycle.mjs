import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const AUTOMATION_MODULE_PATH = fileURLToPath(import.meta.url);
const LOADED_AUTOMATION_SOURCE = fs.readFileSync(AUTOMATION_MODULE_PATH, "utf8");
const CHECK_COMMANDS = [
  ["npm", ["run", "typecheck"]],
  ["npm", ["run", "test"]],
  ["npm", ["run", "build"]]
];
const GENERATED_CHANGE_PREFIXES = ["tasks/", "prompts/generated/", "dist/", "build/", "coverage/", "node_modules/"];
const ROADMAP = [
  {
    title: "Define SpriteProject core model",
    summary: "Create the format-agnostic SpriteProject data model shared by importers and exporters.",
    allowedPaths: ["src/core/**", "src/**/*.test.*", "docs/**"],
    requirements: [
      "Represent canvas size, RGBA color mode, frames, layers, cels, frame duration, and cel placement.",
      "Keep the core model independent from browser UI code and file formats.",
      "Add focused construction tests without implementing importers or exporters."
    ],
    completionPaths: ["src/core/SpriteProject.ts"],
    autoMerge: true
  },
  {
    title: "Add SpriteProject validation helpers",
    summary: "Validate SpriteProject dimensions, frame references, layer data, opacity, and cel placement.",
    allowedPaths: ["src/core/validation/**", "src/core/**/*.test.*", "src/**/*.test.*"],
    requirements: [
      "Return clear validation errors for malformed project data.",
      "Reject invalid dimensions, frame indexes, opacity, and cel references.",
      "Add unit tests for valid and invalid projects."
    ],
    completionPaths: ["src/core/validation/index.ts"],
    autoMerge: true
  },
  {
    title: "Implement PNG sequence importer",
    summary: "Convert an ordered browser-local PNG sequence into a single-layer SpriteProject timeline.",
    allowedPaths: ["src/core/importers/pngSequence/**", "src/core/**/*.test.*", "src/**/*.test.*"],
    requirements: [
      "Keep all image processing browser-only and never upload user artwork.",
      "Create one layer because flat PNG files do not contain original layer data.",
      "Validate consistent frame dimensions and preserve input ordering.",
      "Add unit tests using synthetic image data rather than real user files."
    ],
    completionPaths: ["src/core/importers/pngSequence/index.ts"],
    autoMerge: true
  },
  {
    title: "Implement spritesheet grid importer",
    summary: "Slice a browser-local spritesheet grid into ordered SpriteProject frames.",
    allowedPaths: ["src/core/importers/spritesheetGrid/**", "src/core/**/*.test.*", "src/**/*.test.*"],
    requirements: [
      "Support explicit frame width, frame height, rows, columns, and frame order.",
      "Reject grids that exceed or do not fit the source image dimensions.",
      "Create one layer and do not claim original layers can be recovered.",
      "Add focused grid slicing tests with synthetic data."
    ],
    completionPaths: ["src/core/importers/spritesheetGrid/index.ts"],
    autoMerge: true
  },
  {
    title: "Implement spritesheet JSON metadata importer",
    summary: "Build SpriteProject frames from a spritesheet PNG and supported JSON frame metadata.",
    allowedPaths: ["src/core/importers/spritesheetJson/**", "src/core/**/*.test.*", "src/**/*.test.*"],
    requirements: [
      "Parse a small documented JSON metadata subset with explicit validation.",
      "Preserve frame order and duration when the metadata provides them.",
      "Reject malformed or out-of-bounds frame rectangles.",
      "Add parser and frame mapping tests without external services."
    ],
    completionPaths: ["src/core/importers/spritesheetJson/index.ts"],
    autoMerge: true
  },
  {
    title: "Create Aseprite writer skeleton",
    summary: "Define a minimal exporter boundary that consumes SpriteProject and produces binary output.",
    allowedPaths: ["src/core/exporters/aseprite/**", "src/core/**/*.test.*", "docs/**"],
    requirements: [
      "Keep the exporter independent from UI code.",
      "Define explicit binary writer helpers and unsupported-feature errors.",
      "Add tests for deterministic empty or minimal output structure without claiming full format support."
    ],
    completionPaths: ["src/core/exporters/aseprite/index.ts"],
    autoMerge: false
  },
  {
    title: "Write minimal Aseprite binary header",
    summary: "Write and test the minimal .aseprite file and frame headers for RGBA projects.",
    allowedPaths: ["src/core/exporters/aseprite/**", "src/core/**/*.test.*", "docs/**"],
    requirements: [
      "Write correct little-endian header fields for the supported RGBA subset.",
      "Validate dimensions and frame count before writing.",
      "Add byte-level tests against documented constants and offsets."
    ],
    completionPaths: ["src/core/exporters/aseprite/header.ts"],
    autoMerge: false
  },
  {
    title: "Write Aseprite layers and cels",
    summary: "Encode normal layer and cel chunks from SpriteProject into the supported Aseprite subset.",
    allowedPaths: ["src/core/exporters/aseprite/**", "src/core/**/*.test.*", "docs/**"],
    requirements: [
      "Support normal visible layers, opacity, names, cel coordinates, and frame duration.",
      "Reject unsupported modes explicitly rather than silently accepting them.",
      "Add byte-level tests for multiple frames, layers, and cels."
    ],
    completionPaths: ["src/core/exporters/aseprite/cels.ts"],
    autoMerge: false
  },
  {
    title: "Add export download UI",
    summary: "Add a browser-only action that exports the current SpriteProject and downloads an .aseprite file.",
    allowedPaths: ["src/app/**", "src/**/*.test.*", "docs/**"],
    requirements: [
      "Use Blob and browser download APIs without uploading project data.",
      "Disable export when no valid project is loaded.",
      "Show clear export errors and add focused UI tests."
    ],
    completionPaths: ["src/app/components/ExportDownload.ts"],
    autoMerge: true
  },
  {
    title: "Add browser file import UI",
    summary: "Add browser-local file selection for supported sprite source files.",
    allowedPaths: ["src/app/**", "src/**/*.test.*", "docs/**"],
    requirements: [
      "Read files only through browser APIs and never upload user artwork.",
      "Expose supported file types and reject unsupported inputs clearly.",
      "Add UI tests using synthetic File objects."
    ],
    completionPaths: ["src/app/components/FileImport.ts"],
    autoMerge: true
  },
  {
    title: "Add import error and validation UI",
    summary: "Present importer and SpriteProject validation failures in a clear browser UI.",
    allowedPaths: ["src/app/**", "src/**/*.test.*"],
    requirements: [
      "Display actionable errors without exposing file contents.",
      "Keep validation messages format-specific where useful.",
      "Add UI tests for common invalid inputs."
    ],
    completionPaths: ["src/app/components/ImportErrors.ts"],
    autoMerge: true
  },
  {
    title: "Expand importer unit tests",
    summary: "Add edge-case unit coverage across the supported importers.",
    allowedPaths: ["src/core/importers/**/*.test.*", "src/**/*.test.*", "tests/**"],
    requirements: [
      "Cover invalid dimensions, ordering, bounds, and duration metadata.",
      "Use synthetic fixtures and avoid real user artwork.",
      "Do not change importer behavior unless a test exposes a verified defect."
    ],
    autoMerge: true
  },
  {
    title: "Expand Aseprite exporter unit tests",
    summary: "Add byte-level regression coverage for the supported Aseprite exporter subset.",
    allowedPaths: ["src/core/exporters/aseprite/**/*.test.*", "src/**/*.test.*", "tests/**"],
    requirements: [
      "Cover headers, frames, layers, cels, names, opacity, and duration.",
      "Assert deterministic bytes and explicit rejection of unsupported data.",
      "Do not broaden the exporter feature set in this task."
    ],
    autoMerge: true
  },
  {
    title: "Add conversion integration smoke tests",
    summary: "Add small end-to-end tests from synthetic importer input through Aseprite export.",
    allowedPaths: ["tests/**", "src/**/*.test.*", "docs/**"],
    requirements: [
      "Cover one small happy path for each supported importer.",
      "Keep fixtures synthetic and tiny.",
      "Assert output structure without claiming unsupported lossless conversion."
    ],
    autoMerge: true
  },
  {
    title: "Document supported conversion behavior",
    summary: "Document supported inputs, browser-only processing, and the limits of flat image formats.",
    allowedPaths: ["README.md", "docs/**"],
    requirements: [
      "Describe frame conversion and timeline rebuilding accurately.",
      "State that flat PNG sources cannot recover original layers.",
      "Document supported and unsupported Aseprite features."
    ],
    completionPaths: ["README.md"],
    autoMerge: true
  },
  {
    title: "Add synthetic sample fixtures",
    summary: "Add tiny synthetic sprite fixtures for demos and automated tests.",
    allowedPaths: ["tests/fixtures/**", "docs/**"],
    requirements: [
      "Use newly generated synthetic artwork only.",
      "Keep files small and document expected frame geometry.",
      "Do not include real user sprite files or copyrighted assets."
    ],
    autoMerge: true
  },
  {
    title: "Add drag-and-drop file import",
    summary: "Add drag-and-drop as an alternative browser-local file import interaction.",
    allowedPaths: ["src/app/**", "src/**/*.test.*", "docs/**"],
    requirements: [
      "Reuse the existing browser-local import pipeline.",
      "Provide keyboard-accessible fallback controls.",
      "Add tests for accepted, rejected, and mixed drops."
    ],
    completionPaths: ["src/app/components/DropImport.ts"],
    autoMerge: true
  },
  {
    title: "Add preview timeline UI",
    summary: "Show imported SpriteProject frames in a simple browser preview timeline.",
    allowedPaths: ["src/app/**", "src/**/*.test.*"],
    requirements: [
      "Render frame order and active-frame state without mutating project data.",
      "Keep artwork local to the browser.",
      "Add tests for navigation and empty state."
    ],
    completionPaths: ["src/app/components/TimelinePreview.ts"],
    autoMerge: true
  },
  {
    title: "Add frame duration editing",
    summary: "Allow editing SpriteProject frame durations with validation in the browser UI.",
    allowedPaths: ["src/app/**", "src/core/**", "src/**/*.test.*"],
    requirements: [
      "Require finite positive frame durations within documented bounds.",
      "Update only the selected frame and preserve timeline ordering.",
      "Add model and UI tests."
    ],
    completionPaths: ["src/app/components/FrameDurationEditor.ts"],
    autoMerge: true
  },
  {
    title: "Add basic layer naming",
    summary: "Allow users to rename SpriteProject layers before export.",
    allowedPaths: ["src/app/**", "src/core/**", "src/**/*.test.*"],
    requirements: [
      "Validate non-empty layer names and preserve layer ordering.",
      "Do not imply that source layers were recovered from flat images.",
      "Add model and UI tests for rename behavior."
    ],
    completionPaths: ["src/app/components/LayerNameEditor.ts"],
    autoMerge: true
  }
];
const UI_TASK_REQUIREMENTS = [
  "Use plain TypeScript and DOM APIs.",
  "Do not add React, Vue, Svelte, or other dependencies.",
  "Keep files processed browser-locally.",
  "Do not upload user artwork.",
  "Reuse existing app, core, importer, and exporter helpers.",
  "Do not duplicate conversion logic.",
  "Add focused tests."
];
const PRODUCT_COMPLETION_TASKS = [
  {
    title: "Add Vite dev script",
    summary: "Add the missing npm development command so the browser product can be run locally with Vite.",
    auditKeys: ["devScript"],
    allowedPaths: ["package.json"],
    requirements: [
      "Add exactly a dev script that runs vite.",
      "Use the existing Vite development dependency when it is present; justify any dependency or lockfile change if one is required."
    ],
    autoMerge: true
  },
  {
    title: "Mount browser converter UI",
    summary: "Replace the placeholder entry page with the mounted, browser-local Sprite to Aseprite converter flow.",
    auditKeys: ["appRoot", "browserAppMounted", "productionBundle"],
    covers: [
      "appRoot",
      "browserAppMounted",
      "fileImportUi",
      "dragAndDrop",
      "modeSelector",
      "pngSequenceUi",
      "spritesheetGridUi",
      "spritesheetJsonUi",
      "asepriteDownloadUi",
      "exportFailureHandling",
      "disabledExportState",
      "previewTimelineUi",
      "statusAndErrors",
      "uiFlowTest",
      "productionBundle",
      "responsiveStyling"
    ],
    allowedPaths: ["index.html", "package.json", "src/index.ts", "src/app/**", "src/**/*.test.*", "docs/**"],
    requirements: [
      "Add an npm run dev script if it is missing.",
      "Ensure index.html has an app root element.",
      "Mount the real browser UI from src/index.ts.",
      "Show the title Sprite to Aseprite Converter.",
      "Explain that files are processed browser-locally.",
      "Include a mode selector for the available import modes.",
      "Include a file input and a drag-and-drop area.",
      "Include a convert button.",
      "Include a preview, status, and error area.",
      "Include a .aseprite download button when conversion succeeds.",
      "Add minimal responsive styling.",
      "Add tests for mounted UI state or DOM-free UI helpers."
    ],
    autoMerge: false,
    uiTask: true
  },
  {
    title: "Wire browser-local file import into UI",
    summary: "Make the existing browser-local file import control reachable from the mounted converter.",
    auditKeys: ["fileImportUi"],
    allowedPaths: ["index.html", "src/index.ts", "src/app/**", "src/**/*.test.*", "docs/**"],
    requirements: ["Expose an accessible file input and wire it to the existing browser-local file import helper."],
    autoMerge: true,
    uiTask: true
  },
  {
    title: "Add browser drag-and-drop import area",
    summary: "Make drag-and-drop import reachable in the mounted converter UI.",
    auditKeys: ["dragAndDrop"],
    allowedPaths: ["index.html", "src/index.ts", "src/app/**", "src/**/*.test.*", "docs/**"],
    requirements: ["Wire dragover and drop events to the same local file import pipeline used by the file input."],
    autoMerge: true,
    uiTask: true
  },
  {
    title: "Add converter import mode selector",
    summary: "Expose a mode selector for every implemented MVP importer in the mounted converter.",
    auditKeys: ["modeSelector"],
    allowedPaths: ["index.html", "src/index.ts", "src/app/**", "src/**/*.test.*", "docs/**"],
    requirements: ["Offer PNG sequence, spritesheet grid, and spritesheet JSON modes when their importers exist."],
    autoMerge: true,
    uiTask: true
  },
  {
    title: "Wire PNG sequence import into UI",
    summary: "Connect the implemented PNG sequence importer to the mounted converter flow.",
    auditKeys: ["pngSequenceUi"],
    allowedPaths: ["index.html", "src/index.ts", "src/app/**", "src/**/*.test.*", "docs/**"],
    requirements: ["Invoke the existing PNG sequence importer for the matching selected mode and surface its result or error."],
    autoMerge: true,
    uiTask: true
  },
  {
    title: "Wire spritesheet grid import into UI",
    summary: "Connect the implemented spritesheet grid importer and its grid settings to the mounted converter flow.",
    auditKeys: ["spritesheetGridUi"],
    allowedPaths: ["index.html", "src/index.ts", "src/app/**", "src/**/*.test.*", "docs/**"],
    requirements: ["Invoke the existing grid importer with explicit frame width, frame height, rows, and columns."],
    autoMerge: true,
    uiTask: true
  },
  {
    title: "Wire spritesheet JSON import into UI",
    summary: "Connect the implemented spritesheet PNG plus JSON importer to the mounted converter flow.",
    auditKeys: ["spritesheetJsonUi"],
    allowedPaths: ["index.html", "src/index.ts", "src/app/**", "src/**/*.test.*", "docs/**"],
    requirements: ["Accept a spritesheet PNG and its JSON metadata and invoke the existing JSON importer."],
    autoMerge: true,
    uiTask: true
  },
  {
    title: "Wire Aseprite export download into UI",
    summary: "Make the implemented .aseprite exporter and browser download control reachable after conversion.",
    auditKeys: ["asepriteDownloadUi"],
    allowedPaths: ["index.html", "src/index.ts", "src/app/**", "src/**/*.test.*", "docs/**"],
    requirements: ["Enable an .aseprite download only after a valid SpriteProject has been produced."],
    autoMerge: true,
    uiTask: true
  },
  {
    title: "Wire browser preview timeline into converter UI",
    summary: "Make the existing preview and timeline helpers reachable from the mounted converter flow.",
    auditKeys: ["previewTimelineUi"],
    allowedPaths: ["index.html", "src/index.ts", "src/app/**", "src/**/*.test.*", "docs/**"],
    requirements: ["Update the preview timeline when a conversion produces a SpriteProject."],
    autoMerge: true,
    uiTask: true
  },
  {
    title: "Add UI status and error handling",
    summary: "Expose clear converter progress, success, validation, and failure states in the mounted UI.",
    auditKeys: ["statusAndErrors"],
    allowedPaths: ["index.html", "src/index.ts", "src/app/**", "src/**/*.test.*", "docs/**"],
    requirements: ["Do not display file contents in errors and use accessible live status and alert output."],
    autoMerge: true,
    uiTask: true
  },
  {
    title: "Add end-to-end browser conversion smoke tests",
    summary: "Cover the mounted or DOM-free browser converter flow from mode selection through a downloadable result.",
    auditKeys: ["uiFlowTest"],
    allowedPaths: ["src/index.ts", "src/app/**", "src/**/*.test.*", "docs/**"],
    requirements: ["Use tiny synthetic inputs and cover at least one browser converter success path plus an error path."],
    autoMerge: true,
    uiTask: true
  },
  {
    title: "Add manual usage guide",
    summary: "Document how to run and use each browser-local MVP conversion mode.",
    auditKeys: ["manualUsageGuide"],
    allowedPaths: ["docs/**"],
    requirements: [
      "Document npm run dev, file selection, each available MVP import mode, conversion, preview, and .aseprite download.",
      "State that artwork stays in the browser and flat PNG sources cannot recover original layers."
    ],
    autoMerge: true
  },
  {
    title: "Add basic responsive styling",
    summary: "Add minimal responsive styling for the mounted converter controls, status, and preview.",
    auditKeys: ["responsiveStyling"],
    allowedPaths: ["index.html", "src/index.ts", "src/app/**", "src/**/*.test.*", "docs/**"],
    requirements: ["Keep the layout usable at narrow and wide browser widths without adding a styling dependency."],
    autoMerge: true,
    uiTask: true
  },
  {
    title: "Add export failure handling",
    summary: "Show a clear browser-local error when Aseprite export or download fails.",
    auditKeys: ["exportFailureHandling"],
    allowedPaths: ["index.html", "src/index.ts", "src/app/**", "src/**/*.test.*", "docs/**"],
    requirements: ["Catch exporter and browser download failures without displaying file contents."],
    autoMerge: true,
    uiTask: true
  },
  {
    title: "Add disabled export state when no valid project exists",
    summary: "Keep the Aseprite download action disabled until conversion produces a valid SpriteProject.",
    auditKeys: ["disabledExportState"],
    allowedPaths: ["index.html", "src/index.ts", "src/app/**", "src/**/*.test.*", "docs/**"],
    requirements: ["Reuse SpriteProject validation and add focused empty, invalid, and valid project state tests."],
    autoMerge: true,
    uiTask: true
  },
  {
    title: "Restore Aseprite exporter product path",
    summary: "Restore the missing Aseprite exporter entry point required by the browser conversion product.",
    auditKeys: ["asepriteExporterExists"],
    allowedPaths: ["src/core/**", "src/**/*.test.*", "tests/**", "docs/**"],
    requirements: ["Reuse the documented SpriteProject exporter boundary and add deterministic byte-level tests."],
    autoMerge: false
  },
  {
    title: "Add end-to-end PNG sequence conversion smoke test",
    summary: "Cover synthetic PNG sequence import through SpriteProject and Aseprite byte export.",
    auditKeys: ["pngSequenceE2e"],
    allowedPaths: ["src/core/**", "src/**/*.test.*", "tests/**", "docs/**"],
    requirements: ["Use tiny synthetic PNG data and assert a valid deterministic Aseprite structure."],
    autoMerge: true
  },
  {
    title: "Add end-to-end spritesheet grid conversion smoke test",
    summary: "Cover synthetic spritesheet grid import through SpriteProject and Aseprite byte export.",
    auditKeys: ["spritesheetGridE2e"],
    allowedPaths: ["src/core/**", "src/**/*.test.*", "tests/**", "docs/**"],
    requirements: ["Use a tiny synthetic grid and assert frame order and deterministic Aseprite structure."],
    autoMerge: true
  },
  {
    title: "Add end-to-end spritesheet JSON conversion smoke test",
    summary: "Cover synthetic spritesheet JSON import through SpriteProject and Aseprite byte export.",
    auditKeys: ["spritesheetJsonE2e"],
    allowedPaths: ["src/core/**", "src/**/*.test.*", "tests/**", "docs/**"],
    requirements: ["Use tiny synthetic PNG and JSON data and assert duration, order, and deterministic Aseprite structure."],
    autoMerge: true
  },
  {
    title: "Document how to test output in Aseprite",
    summary: "Document a manual verification path for opening generated files in Aseprite.",
    auditKeys: ["asepriteOutputVerificationDocs"],
    allowedPaths: ["docs/**"],
    requirements: ["Explain how to open a generated file, inspect frames and durations, and report compatibility problems without overstating fidelity."],
    autoMerge: true
  },
  {
    title: "Document browser-local processing policy",
    summary: "Document that artwork is read, converted, and downloaded entirely in the browser.",
    auditKeys: ["browserLocalDocs"],
    allowedPaths: ["docs/**"],
    requirements: ["State explicitly that user artwork is not uploaded or sent to remote processing services."],
    autoMerge: true
  },
  {
    title: "Document supported converter inputs",
    summary: "Document every currently supported MVP import mode and its required files.",
    auditKeys: ["supportedInputsDocs"],
    allowedPaths: ["docs/**"],
    requirements: ["Cover PNG sequences, spritesheet grids, and spritesheet PNG plus JSON without claiming unsupported formats."],
    autoMerge: true
  },
  {
    title: "Document flat PNG layer limitations",
    summary: "Explain that flat PNG sources cannot recover original layer structure.",
    auditKeys: ["flatLayerLimitsDocs"],
    allowedPaths: ["docs/**"],
    requirements: ["Use accurate timeline rebuilding language and avoid lossless or layer-recovery claims."],
    autoMerge: true
  },
  {
    title: "Document Aseprite compatibility limits",
    summary: "Document the supported Aseprite subset and known unsupported output features.",
    auditKeys: ["compatibilityLimitsDocs"],
    allowedPaths: ["docs/**"],
    requirements: ["Describe supported frames, layers, cels, durations, and explicit unsupported features accurately."],
    autoMerge: true
  },
  {
    title: "Add static deployment guide",
    summary: "Document how to deploy the Vite production output as a static browser-only site.",
    auditKeys: ["staticDeploymentReadiness"],
    allowedPaths: ["docs/**"],
    requirements: [
      "Document a provider-neutral static deployment process and browser-only privacy constraints.",
      "Do not add or change GitHub Actions workflows."
    ],
    autoMerge: true
  },
  {
    title: "Add production build verification notes",
    summary: "Document how to verify the built static site before deployment.",
    auditKeys: ["productionBuildNotes"],
    allowedPaths: ["docs/**"],
    requirements: ["Document npm run build, how to serve the built output locally, and a short browser conversion smoke checklist."],
    autoMerge: true
  },
  {
    title: "Add invalid import error tests",
    summary: "Cover clear UI errors for invalid files, unsupported formats, and invalid spritesheet grid settings.",
    auditKeys: ["invalidImportErrors"],
    allowedPaths: ["src/app/**", "src/**/*.test.*", "docs/**"],
    requirements: ["Use synthetic files, keep errors actionable, and never include file contents in messages."],
    autoMerge: true,
    uiTask: true
  },
  {
    title: "Add export error UI tests",
    summary: "Cover failed export and no-project-loaded states in the browser UI helpers.",
    auditKeys: ["exportErrorTests"],
    allowedPaths: ["src/app/**", "src/**/*.test.*", "docs/**"],
    requirements: ["Test exporter failures, disabled state, and recovery after a valid project loads."],
    autoMerge: true,
    uiTask: true
  },
  {
    title: "Add large-file warning UI",
    summary: "Warn users that very large sprites or long sequences may exceed browser memory limits.",
    auditKeys: ["largeFileWarning"],
    allowedPaths: ["index.html", "src/index.ts", "src/app/**", "src/**/*.test.*", "docs/**"],
    requirements: ["Use a clear non-blocking warning and do not inspect or upload files outside the browser."],
    autoMerge: true,
    uiTask: true
  },
  {
    title: "Add conversion progress status UI",
    summary: "Expose a clear working/progress state for potentially long browser-local conversions.",
    auditKeys: ["conversionProgress"],
    allowedPaths: ["index.html", "src/index.ts", "src/app/**", "src/**/*.test.*", "docs/**"],
    requirements: ["Keep controls and accessible status text consistent while conversion is running or fails."],
    autoMerge: true,
    uiTask: true
  },
  {
    title: "Document browser memory limits",
    summary: "Document practical large-file and browser-memory constraints for local conversion.",
    auditKeys: ["browserMemoryDocs"],
    allowedPaths: ["docs/**"],
    requirements: ["Explain that decoded RGBA frames can use substantially more memory than compressed source files and recommend practical mitigations."],
    autoMerge: true
  }
];
const PRODUCT_AUDIT_DEFINITIONS = [
  {
    id: "ui",
    label: "UI audit",
    checkKeys: ["devScript", "appRoot", "browserAppMounted", "fileImportUi", "dragAndDrop", "modeSelector", "previewTimelineUi", "statusAndErrors", "asepriteDownloadUi", "responsiveStyling", "productionBundle"]
  },
  {
    id: "import-coverage",
    label: "Import coverage audit",
    checkKeys: ["pngSequenceUi", "spritesheetGridUi", "spritesheetJsonUi"]
  },
  {
    id: "export-download",
    label: "Export/download audit",
    checkKeys: ["asepriteExporterExists", "asepriteDownloadUi", "exportFailureHandling", "disabledExportState"]
  },
  {
    id: "end-to-end-conversion",
    label: "End-to-end conversion audit",
    checkKeys: ["pngSequenceE2e", "spritesheetGridE2e", "spritesheetJsonE2e", "uiFlowTest"]
  },
  {
    id: "documentation",
    label: "Documentation/manual usage audit",
    checkKeys: ["browserLocalDocs", "supportedInputsDocs", "flatLayerLimitsDocs", "manualUsageGuide", "asepriteOutputVerificationDocs", "compatibilityLimitsDocs"]
  },
  {
    id: "deployment-readiness",
    label: "Deployment readiness audit",
    checkKeys: ["staticDeploymentReadiness", "productionBuildNotes"]
  },
  {
    id: "error-handling",
    label: "Error handling audit",
    checkKeys: ["invalidImportErrors", "exportFailureHandling", "disabledExportState", "exportErrorTests", "statusAndErrors"]
  },
  {
    id: "performance-large-file",
    label: "Performance/large-file readiness audit",
    checkKeys: ["largeFileWarning", "conversionProgress", "browserMemoryDocs"]
  }
];
const BROAD_UI_TASK_TITLE = "Mount browser converter UI";
const BROAD_UI_SUPPRESSED_AUDIT_KEYS = new Set([
  "fileImportUi",
  "dragAndDrop",
  "modeSelector",
  "pngSequenceUi",
  "spritesheetGridUi",
  "spritesheetJsonUi",
  "previewTimelineUi",
  "asepriteDownloadUi",
  "exportFailureHandling",
  "disabledExportState",
  "statusAndErrors",
  "responsiveStyling"
]);
const AUDIT_REPAIR_ALLOWED_PATHS = ["scripts/auto-dev-cycle.mjs", "scripts/auto-dev-cycle.test.mjs", "README_AUTOMATION.md"];
const AUDIT_INVESTIGATION_PATHS = {
  ui: ["index.html", "src/index.ts", "src/app/**", "src/**/*.test.*"],
  "import-coverage": ["src/app/**", "src/core/importers/**", "src/**/*.test.*"],
  "export-download": ["src/app/**", "src/core/exporters/**", "src/**/*.test.*"],
  "end-to-end-conversion": ["src/core/**", "src/**/*.test.*", "tests/**"],
  documentation: ["docs/**", "README.md"],
  "deployment-readiness": ["docs/**", "README.md"],
  "error-handling": ["src/app/**", "src/**/*.test.*", "docs/**"],
  "performance-large-file": ["src/app/**", "src/**/*.test.*", "docs/**"]
};
const cliArgs = new Set(process.argv.slice(2));
const dryRun = cliArgs.has("--dry-run");
const mode = getMode();
const startedAt = Date.now();
const maxRepairAttempts = readNonNegativeInteger("AUTO_DEV_MAX_REPAIR_ATTEMPTS", 3);
const stopOnFailure = readBoolean("AUTO_DEV_STOP_ON_FAILURE", true);
const allowNoPrChecks = readBoolean("AUTO_DEV_ALLOW_NO_PR_CHECKS", false);
const generateTasksWhenEmpty = readBoolean("AUTO_DEV_GENERATE_TASKS_WHEN_EMPTY", false);
const generatedTaskCount = readNonNegativeInteger("AUTO_DEV_GENERATED_TASK_COUNT", 5);
const maxGenerationRounds = readNonNegativeInteger("AUTO_DEV_MAX_GENERATION_ROUNDS", 1);
const maxTasks = readMaxTasks();
const maxMinutes = readMaxMinutes();
const deadline = Number.isFinite(maxMinutes) ? startedAt + maxMinutes * 60_000 : Infinity;

class AutomationStop extends Error {
  constructor(message, code, options = {}) {
    super(message, { cause: options.cause });
    this.name = "AutomationStop";
    this.code = code;
    this.command = options.command ?? options.cause?.command;
    this.stdout = options.stdout ?? options.cause?.stdout ?? "";
    this.stderr = options.stderr ?? options.cause?.stderr ?? "";
    this.status = options.status ?? options.cause?.status ?? null;
    this.hardStop = options.hardStop ?? true;
  }
}

function getMode() {
  const selectedModes = ["--all", "--until-stop", "--generate-tasks"].filter((flag) => cliArgs.has(flag));
  if (selectedModes.length > 1) throw new Error(`Use only one automation mode, not ${selectedModes.join(", ")}.`);
  if (cliArgs.has("--generate-tasks")) return "generate-tasks";
  if (cliArgs.has("--until-stop")) return "until-stop";
  if (cliArgs.has("--all")) return "all";
  return "single";
}

function readBoolean(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (/^(?:1|true|yes)$/iu.test(value)) return true;
  if (/^(?:0|false|no)$/iu.test(value)) return false;
  throw new Error(`${name} must be true or false.`);
}

function readNonNegativeInteger(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer.`);
  return parsed;
}

function readPositiveNumber(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be greater than zero.`);
  return parsed;
}

function readMaxTasks() {
  if (process.env.AUTO_DEV_MAX_TASKS !== undefined) {
    return readNonNegativeInteger("AUTO_DEV_MAX_TASKS", 0);
  }
  if (mode === "until-stop") return 10;
  if (mode === "all") return null;
  return 1;
}

function readMaxMinutes() {
  if (process.env.AUTO_DEV_MAX_MINUTES !== undefined) {
    return readPositiveNumber("AUTO_DEV_MAX_MINUTES", Infinity);
  }
  return mode === "until-stop" ? 120 : Infinity;
}

function quoteArg(arg) {
  return /[\s"]/u.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg;
}

function formatCommand(command, commandArgs) {
  return [command, ...commandArgs].map(quoteArg).join(" ");
}

function spawnCommand(command, commandArgs, options) {
  if (process.platform === "win32" && (command === "codex" || command.endsWith(".cmd"))) {
    return spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", formatCommand(command, commandArgs)], options);
  }
  return spawnSync(command, commandArgs, options);
}

function npmCommand(platform = process.platform) {
  return platform === "win32" ? "npm.cmd" : "npm";
}

function remainingRuntimeMs() {
  return Number.isFinite(deadline) ? Math.max(1, deadline - Date.now()) : undefined;
}

function run(command, commandArgs = [], options = {}) {
  const commandText = formatCommand(command, commandArgs);
  const printCommand = options.printCommand ?? true;
  const printOutput = options.printOutput ?? true;
  if (printCommand) console.log(`\n> ${commandText}`);

  const result = spawnCommand(command, commandArgs, {
    encoding: "utf8",
    input: options.input,
    maxBuffer: 20 * 1024 * 1024,
    shell: false,
    stdio: options.input === undefined ? "pipe" : ["pipe", "pipe", "pipe"],
    timeout: options.timeout ?? remainingRuntimeMs()
  });

  if (printOutput && result.stdout) process.stdout.write(result.stdout);
  if (printOutput && result.stderr) process.stderr.write(result.stderr);

  if (result.error || result.status !== 0) {
    const error = new Error(`Command failed: ${commandText}`, { cause: result.error });
    error.command = commandText;
    error.stdout = result.stdout ?? "";
    error.stderr = result.stderr ?? result.error?.message ?? "";
    error.status = result.status;
    error.timedOut = result.error?.code === "ETIMEDOUT";
    throw error;
  }

  return result;
}

function runQuiet(command, commandArgs = []) {
  return run(command, commandArgs, { printCommand: false, printOutput: false });
}

function hasCommand(command) {
  try {
    runQuiet(command, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

function readStatus() {
  return runQuiet("git", ["status", "--porcelain"]).stdout.trim();
}

function currentBranch() {
  return runQuiet("git", ["branch", "--show-current"]).stdout.trim() || "unknown";
}

function taskStateRecoveryCommands(status) {
  const commands = [];
  for (const line of status.split(/\r?\n/u).filter(Boolean)) {
    const state = line.slice(0, 2);
    const rawPath = line.slice(3).split(" -> ").at(-1);
    if (!rawPath || !/^tasks\/(?:backlog|done|failed)\//u.test(rawPath)) continue;
    if (state === "??") commands.push(`Remove-Item ${quoteArg(rawPath)} -Force`);
    else commands.push(`git restore ${quoteArg(rawPath)}`);
  }
  return [...new Set(commands)];
}

function guardDirtyTaskStateOnTaskBranch(branch = currentBranch(), status = readStatus()) {
  if (!branch.startsWith("codex/task-") || !/^.. tasks\/(?:backlog|done|failed)\//mu.test(status)) return;
  const recovery = taskStateRecoveryCommands(status);
  throw new AutomationStop(
    [
      "Task state is dirty on a task branch. Clean it before continuing:",
      ...(recovery.length > 0 ? recovery : ["git status --short"])
    ].join("\n"),
    "dirty_task_state"
  );
}

function ensureCleanGit() {
  const status = readStatus();
  guardDirtyTaskStateOnTaskBranch(currentBranch(), status);
  if (!isWorkingTreeCleanStatus(status)) {
    throw new AutomationStop("Git working tree is not clean; refusing unsafe cleanup.", "unclean_worktree");
  }
}

function isWorkingTreeCleanStatus(status) {
  return String(status ?? "").trim().length === 0;
}

function ensureOnMain() {
  const branch = currentBranch();
  if (branch === "main") return;
  ensureCleanGit();
  run("git", ["checkout", "main"]);
}

function pullMain() {
  ensureOnMain();
  run("git", ["pull", "--ff-only", "origin", "main"]);
}

function ensureGhReady() {
  if (!hasCommand("gh")) {
    throw new AutomationStop("GitHub CLI (gh) is required. Install it, then run `gh auth login`.", "gh_missing");
  }
  try {
    runQuiet("gh", ["auth", "status"]);
  } catch (error) {
    throw new AutomationStop("GitHub CLI is not authenticated. Run `gh auth login` and try again.", "gh_auth", { cause: error });
  }
}

function listBacklogTasks() {
  const backlogDir = path.resolve("tasks", "backlog");
  if (!fs.existsSync(backlogDir)) return [];
  return fs.readdirSync(backlogDir).filter((file) => file.endsWith(".yaml")).sort();
}

function walkFiles(directory, rootDirectory = process.cwd()) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(entryPath, rootDirectory) : [path.relative(rootDirectory, entryPath).replaceAll("\\", "/")];
  });
}

function listOpenTaskBranchIds(rootDirectory = process.cwd()) {
  const result = spawnSync("git", ["branch", "--all", "--no-merged", "main", "--format=%(refname:short)"], {
    cwd: rootDirectory,
    encoding: "utf8",
    shell: false
  });
  if (result.status !== 0) return [];
  return [...new Set([...result.stdout.matchAll(/(?:^|\/)codex\/task-(\d+)$/gmu)].map((match) => match[1]))].sort();
}

function collectProjectPlanningContext(rootDirectory = process.cwd()) {
  const docPaths = ["AGENTS.md", "README.md", "docs/architecture.md", "docs/product-spec.md", "docs/roadmap.md"];
  const docs = Object.fromEntries(docPaths.filter((file) => fs.existsSync(path.join(rootDirectory, file))).map((file) => [file, fs.readFileSync(path.join(rootDirectory, file), "utf8")]));
  const sourceFiles = walkFiles(path.join(rootDirectory, "src"), rootDirectory);
  const testFiles = [
    ...walkFiles(path.join(rootDirectory, "test"), rootDirectory),
    ...walkFiles(path.join(rootDirectory, "tests"), rootDirectory),
    ...walkFiles(path.join(rootDirectory, "scripts"), rootDirectory).filter((file) => /\.(?:test|spec)\./u.test(file)),
    ...sourceFiles.filter((file) => /\.(?:test|spec)\./u.test(file))
  ];
  const tasks = [];

  for (const state of ["backlog", "active", "done", "failed"]) {
    const directory = path.join(rootDirectory, "tasks", state);
    if (!fs.existsSync(directory)) continue;
    for (const file of fs.readdirSync(directory).filter((name) => name.endsWith(".yaml")).sort()) {
      const filePath = path.join(directory, file);
      try {
        tasks.push({ state, file, data: YAML.parse(fs.readFileSync(filePath, "utf8")) });
      } catch (error) {
        throw new AutomationStop(`Could not parse existing task ${path.relative(rootDirectory, filePath)}: ${error.message}`, "task_parse_failure");
      }
    }
  }

  return { docs, sourceFiles, testFiles: [...new Set(testFiles)].sort(), tasks, openTaskBranchIds: listOpenTaskBranchIds(rootDirectory) };
}

function readTextFile(rootDirectory, relativePath) {
  const filePath = path.join(rootDirectory, relativePath);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function resolveLocalModule(rootDirectory, importerPath, specifier) {
  if (!specifier.startsWith(".")) return null;
  const unresolved = path.resolve(path.dirname(path.join(rootDirectory, importerPath)), specifier);
  const candidates = [
    unresolved,
    `${unresolved}.ts`,
    `${unresolved}.tsx`,
    `${unresolved}.js`,
    `${unresolved}.mjs`,
    path.join(unresolved, "index.ts"),
    path.join(unresolved, "index.tsx"),
    path.join(unresolved, "index.js")
  ];
  const resolved = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  return resolved ? path.relative(rootDirectory, resolved).replaceAll("\\", "/") : null;
}

function collectReachableSource(rootDirectory, entryPath = "src/index.ts") {
  const reachable = new Set();
  const pending = [entryPath];
  const importPattern = /(?:\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\))/gu;

  while (pending.length > 0) {
    const relativePath = pending.pop();
    if (!relativePath || reachable.has(relativePath)) continue;
    const source = readTextFile(rootDirectory, relativePath);
    if (!source) continue;
    reachable.add(relativePath);
    for (const match of source.matchAll(importPattern)) {
      const resolved = resolveLocalModule(rootDirectory, relativePath, match[1] ?? match[2]);
      if (resolved && !reachable.has(resolved)) pending.push(resolved);
    }
  }

  return reachable;
}

function auditProductCompleteness(options = {}) {
  const rootDirectory = path.resolve(options.rootDirectory ?? process.cwd());
  const context = options.context ?? collectProjectPlanningContext(rootDirectory);
  const packageText = readTextFile(rootDirectory, "package.json");
  let packageJson = {};
  try {
    packageJson = packageText ? JSON.parse(packageText) : {};
  } catch {
    packageJson = {};
  }

  const indexHtml = readTextFile(rootDirectory, "index.html");
  const entrySource = readTextFile(rootDirectory, "src/index.ts");
  const reachableFiles = collectReachableSource(rootDirectory);
  const reachableText = [...reachableFiles].map((file) => readTextFile(rootDirectory, file)).join("\n");
  const lowerReachableText = reachableText.toLocaleLowerCase("en-US");
  const sourceFileSet = new Set(context.sourceFiles);
  const hasImporter = {
    pngSequence: sourceFileSet.has("src/core/importers/pngSequence/index.ts"),
    spritesheetGrid: sourceFileSet.has("src/core/importers/spritesheetGrid/index.ts"),
    spritesheetJson: sourceFileSet.has("src/core/importers/spritesheetJson/index.ts")
  };
  const hasExporter = sourceFileSet.has("src/core/exporters/aseprite/index.ts");
  const hasPreviewHelper = sourceFileSet.has("src/app/previewTimeline.ts") || context.sourceFiles.some((file) => /(?:preview|timeline)/iu.test(file));
  const appRoot = /<(?:div|main|section)[^>]+id=["'](?:app|root)["'][^>]*>/iu.test(indexHtml);
  const callsMountFunction = /\b(?:mount|initialize|init|render|create)[A-Za-z0-9]*(?:App|Ui|Converter)?\s*\(/u.test(entrySource);
  const locatesAppRoot = /(?:getElementById|querySelector)(?:\s*<[^;()\n]+>)?\s*\(/u.test(entrySource);
  const mutatesDom = /(?:createElement|append|replaceChildren|innerHTML)/u.test(entrySource);
  const importsAppModule = /(?:from\s+|import\s*)["']\.\/app(?:\/|["'])/u.test(entrySource);
  const browserAppMounted = appRoot && locatesAppRoot && (mutatesDom || (importsAppModule && callsMountFunction)) && !/placeholder|automation framework installed/iu.test(entrySource);
  const createsFileInput = /createElement\(\s*["']input["']\s*\)/u.test(reachableText) && /\.type\s*=\s*["']file["']/u.test(reachableText);
  const declarativeFileInput = /<input[^>]+type=["']file["']/iu.test(indexHtml + reachableText);
  const fileImportUi = (createsFileInput || declarativeFileInput) && /(?:bindFileImportControl|mountFileImportUi|addEventListener\(\s*["']change["'])/u.test(reachableText);
  const dragAndDrop = /addEventListener\(\s*["']dragover["']/u.test(reachableText) && /addEventListener\(\s*["']drop["']/u.test(reachableText) && /dataTransfer/u.test(reachableText);
  const modeControl = /createElement\(\s*["']select["']\s*\)|<select\b|(?:type=["']radio["']|\.type\s*=\s*["']radio["'])/iu.test(reachableText + indexHtml);
  const availableModeNames = [
    hasImporter.pngSequence ? /png[ -]?sequence/iu : null,
    hasImporter.spritesheetGrid ? /spritesheet[ -]?grid/iu : null,
    hasImporter.spritesheetJson ? /spritesheet[ -]?(?:json|png\s*\+\s*json)/iu : null
  ].filter(Boolean);
  const modeSelector = modeControl && availableModeNames.every((pattern) => pattern.test(reachableText + indexHtml));
  const uiTestText = context.testFiles.filter((file) => /(?:^|\/)src\/(?:app\/|index\.)/u.test(file)).map((file) => readTextFile(rootDirectory, file)).join("\n");
  const uiFlowTest = /(?:mount[A-Za-z0-9]*(?:Ui|App|Converter)|bind[A-Za-z0-9]*Control|converter\s+(?:flow|state))/iu.test(uiTestText);
  const docsText = Object.values(context.docs).join("\n") + "\n" + walkFiles(path.join(rootDirectory, "docs"), rootDirectory).map((file) => readTextFile(rootDirectory, file)).join("\n");
  const manualUsageGuide = /npm run dev/iu.test(docsText) && /(?:png sequence|spritesheet grid|spritesheet.*json)/iu.test(docsText) && /download/iu.test(docsText);
  const appSourceText = context.sourceFiles.filter((file) => file.startsWith("src/app/") && !/\.(?:test|spec)\./u.test(file)).map((file) => readTextFile(rootDirectory, file)).join("\n");
  const appTestText = context.testFiles.filter((file) => file.startsWith("src/app/")).map((file) => readTextFile(rootDirectory, file)).join("\n");
  const testSources = context.testFiles.map((file) => ({ file, text: readTextFile(rootDirectory, file) }));
  const hasConversionTest = (importName) => testSources.some(({ text }) => text.includes(importName) && text.includes("exportAseprite") && /synthetic|fixture/iu.test(text));
  const taskHistoryText = context.tasks.map((task) => `${task.data?.title ?? ""} ${task.data?.goal ?? ""}`).join("\n");
  const hasCssFile = context.sourceFiles.some((file) => /\.css$/iu.test(file));
  const responsiveStyling = (hasCssFile || /<style\b|\.style\./iu.test(indexHtml + reachableText)) && /@media|clamp\(|min\(|max-width|grid-template|flex-wrap/iu.test(indexHtml + reachableText + context.sourceFiles.map((file) => readTextFile(rootDirectory, file)).join("\n"));
  const reachesConversionCode = [...reachableFiles].some((file) => /src\/core\/(?:importers|exporters)\//u.test(file));
  const productionBundle = browserAppMounted && reachableFiles.size > 1 && reachesConversionCode && !/automation framework installed/iu.test(indexHtml);
  const downloadReachable = hasExporter && reachableFiles.has("src/core/exporters/aseprite/index.ts") && /download[^\n]{0,80}\.aseprite|\.aseprite[^\n]{0,80}download/iu.test(reachableText);
  const exportFailureHandling = downloadReachable && /(?:try\s*\{|catch\s*\(|export[^\n]{0,80}(?:failed|error)|could not export)/iu.test(reachableText);
  const disabledExportState = downloadReachable && /disabled/u.test(reachableText) && /(?:valid\s*SpriteProject|isValidSpriteProject|no valid project|before exporting)/iu.test(reachableText);
  const invalidImportErrors = /unsupported[^\n]{0,80}(?:file|format)|invalid[^\n]{0,80}(?:file|grid)|grid[^\n]{0,80}(?:invalid|failed|error)/iu.test(appSourceText + appTestText);
  const exportErrorTests = /(?:could not export|export fails|no valid project|before exporting)/iu.test(appTestText) && /disabled/iu.test(appTestText);
  const browserLocalDocs = /browser[- ](?:only|local)|processed in the browser|stay in the browser/iu.test(docsText) && /(?:not|never|do not)[^\n]{0,50}upload/iu.test(docsText);
  const supportedInputsDocs = /png sequence/iu.test(docsText) && /spritesheet grid/iu.test(docsText) && /spritesheet[^\n]{0,40}json/iu.test(docsText);
  const flatLayerLimitsDocs = /(?:cannot|can't|do not|does not)[^\n]{0,60}(?:recover|reconstruct)[^\n]{0,40}(?:layer|layers)|flat png[^\n]{0,80}(?:layer|layers)/iu.test(docsText);
  const asepriteOutputVerificationDocs = /(?:open|inspect|test|verify)[^\n]{0,80}(?:generated[^\n]{0,30})?\.aseprite|aseprite[^\n]{0,80}(?:open|inspect|test|verify)/iu.test(docsText);
  const compatibilityLimitsDocs = /(?:unsupported|does not currently export|compatibility limit|supported subset)/iu.test(docsText) && /(?:linked cels|tilemap|indexed|grayscale|frame tags|blend modes)/iu.test(docsText);
  const staticDeploymentReadiness = /(?:static deployment|deploy[^\n]{0,80}(?:static|github pages|netlify|vercel)|github pages)/iu.test(docsText) || /(?:static deployment|github pages deployment)/iu.test(taskHistoryText);
  const productionBuildNotes = /npm run build/iu.test(docsText) && /(?:serve|preview|deploy)[^\n]{0,80}(?:dist|built|production)|(?:dist|built|production)[^\n]{0,80}(?:serve|preview|deploy)/iu.test(docsText);
  const largeFileWarning = /(?:large|long)[^\n]{0,80}(?:file|sprite|sequence)[^\n]{0,80}(?:memory|slow|limit|warning)|browser memory/iu.test(indexHtml + reachableText);
  const conversionProgress =
    /(?:converting|processing|working|progress)/iu.test(reachableText) &&
    /(?:setAttribute\(\s*["']role["']\s*,\s*["']status["']|setAttribute\(\s*["']aria-live["']|role\s*=\s*["']status["']|aria-live\s*=)/iu.test(reachableText) &&
    /(?:createElement\(\s*["']progress["']\s*\)|aria-busy)/iu.test(reachableText) &&
    /disabled\s*=\s*[^;\n]{0,80}(?:isWorking|isConverting|processing|converting)/iu.test(reachableText);
  const browserMemoryDocs = /browser[^\n]{0,60}memory|memory[^\n]{0,60}(?:browser|rgba|decoded|large file)/iu.test(docsText);

  const checks = {
    devScript: { passed: packageJson.scripts?.dev === "vite", message: 'package.json has a "dev": "vite" script' },
    appRoot: { passed: appRoot, message: "index.html contains an app root" },
    browserAppMounted: { passed: browserAppMounted, message: "src/index.ts mounts or initializes the browser converter" },
    fileImportUi: { passed: fileImportUi, message: "a usable browser-local file import UI is reachable" },
    dragAndDrop: { passed: dragAndDrop, message: "a drag-and-drop area is wired to local file import" },
    modeSelector: { passed: modeSelector, message: "a mode selector exposes the available import modes" },
    pngSequenceUi: { passed: !hasImporter.pngSequence || reachableFiles.has("src/core/importers/pngSequence/index.ts"), message: "PNG sequence import is reachable from the UI" },
    spritesheetGridUi: { passed: !hasImporter.spritesheetGrid || reachableFiles.has("src/core/importers/spritesheetGrid/index.ts"), message: "spritesheet grid import is reachable from the UI" },
    spritesheetJsonUi: { passed: !hasImporter.spritesheetJson || reachableFiles.has("src/core/importers/spritesheetJson/index.ts"), message: "spritesheet JSON import is reachable from the UI" },
    asepriteExporterExists: { passed: hasExporter, message: "Aseprite exporter entry point exists" },
    asepriteDownloadUi: { passed: !hasExporter || downloadReachable, message: ".aseprite export and download are reachable from the UI" },
    exportFailureHandling: { passed: !hasExporter || exportFailureHandling, message: "export and download failures have clear UI handling" },
    disabledExportState: { passed: !hasExporter || disabledExportState, message: "export stays disabled until a valid project exists" },
    previewTimelineUi: { passed: !hasPreviewHelper || [...reachableFiles].some((file) => /(?:preview|timeline)/iu.test(file)), message: "preview or timeline output is reachable from the UI" },
    statusAndErrors: { passed: /(?:role["']?\s*,?\s*["'](?:alert|status)|aria-live|statusOutput|errorOutput)/iu.test(reachableText), message: "status and error output are reachable from the UI" },
    uiFlowTest: { passed: uiFlowTest, message: "a focused mounted-flow or DOM-free UI state test exists" },
    pngSequenceE2e: { passed: !hasImporter.pngSequence || hasConversionTest("importPngSequence"), message: "synthetic PNG sequence conversion has an end-to-end Aseprite test" },
    spritesheetGridE2e: { passed: !hasImporter.spritesheetGrid || hasConversionTest("importSpritesheetGrid"), message: "synthetic spritesheet grid conversion has an end-to-end Aseprite test" },
    spritesheetJsonE2e: { passed: !hasImporter.spritesheetJson || hasConversionTest("importSpritesheetJson"), message: "synthetic spritesheet JSON conversion has an end-to-end Aseprite test" },
    productionBundle: { passed: productionBundle, message: "the production entry is more than a placeholder bundle" },
    browserLocalDocs: { passed: browserLocalDocs, message: "documentation states that artwork stays browser-local and is not uploaded" },
    supportedInputsDocs: { passed: supportedInputsDocs, message: "documentation lists every supported MVP input" },
    flatLayerLimitsDocs: { passed: flatLayerLimitsDocs, message: "documentation says flat PNG layers cannot be recovered" },
    manualUsageGuide: { passed: manualUsageGuide, message: "manual browser conversion usage is documented" },
    asepriteOutputVerificationDocs: { passed: asepriteOutputVerificationDocs, message: "documentation explains how to test generated output in Aseprite" },
    compatibilityLimitsDocs: { passed: compatibilityLimitsDocs, message: "Aseprite compatibility limits are documented" },
    staticDeploymentReadiness: { passed: staticDeploymentReadiness, message: "a static deployment guide or task exists" },
    productionBuildNotes: { passed: productionBuildNotes, message: "production build verification is documented" },
    invalidImportErrors: { passed: invalidImportErrors, message: "invalid files, formats, and grid settings have clear tested errors" },
    exportErrorTests: { passed: exportErrorTests, message: "failed export and no-project UI states have focused tests" },
    largeFileWarning: { passed: largeFileWarning, message: "the UI warns about large files or browser memory pressure" },
    conversionProgress: { passed: conversionProgress, message: "long-running conversion progress is exposed in UI status" },
    browserMemoryDocs: { passed: browserMemoryDocs, message: "browser memory and large-file limits are documented" },
    responsiveStyling: { passed: responsiveStyling, message: "basic responsive converter styling exists" }
  };
  const missing = Object.entries(checks).filter(([, check]) => !check.passed).map(([key, check]) => ({ key, message: check.message }));
  const audits = PRODUCT_AUDIT_DEFINITIONS.map((definition) => {
    const auditChecks = definition.checkKeys.map((key) => ({ key, ...checks[key] }));
    return {
      id: definition.id,
      label: definition.label,
      passed: auditChecks.every((check) => check.passed),
      checks: auditChecks,
      missing: auditChecks.filter((check) => !check.passed)
    };
  });
  return { passed: audits.every((audit) => audit.passed), audits, checks, missing, reachableFiles: [...reachableFiles].sort() };
}

function listExistingTaskIds(context = collectProjectPlanningContext()) {
  return context.tasks.map((task) => String(task.data?.id ?? getTaskId(task.file))).filter(Boolean);
}

function getNextTaskId(existingIds, offset = 0) {
  const numericIds = existingIds.map((id) => Number.parseInt(String(id), 10)).filter(Number.isFinite);
  const next = (numericIds.length > 0 ? Math.max(...numericIds) : 0) + 1 + offset;
  return String(next).padStart(Math.max(3, String(next).length), "0");
}

function normalizeTitle(title) {
  return String(title).toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/gu, " ").trim();
}

function slugify(title) {
  return normalizeTitle(title).replaceAll(" ", "-").slice(0, 70).replace(/-$/u, "");
}

function buildGeneratedTask(roadmapItem, id) {
  const productContext = "This task was generated deterministically because a product-completeness audit found missing product work in the repository.";
  const requirements = [
    ...(roadmapItem.uiTask ? UI_TASK_REQUIREMENTS : []),
    ...roadmapItem.requirements
  ];
  return {
    id,
    title: roadmapItem.title,
    status: "backlog",
    ...(roadmapItem.productCompletion ? { task_origin: "product-completion" } : {}),
    ...(roadmapItem.auditGap ? { audit_gap: roadmapItem.auditGap } : {}),
    priority: "high",
    goal: roadmapItem.summary,
    context: roadmapItem.productCompletion ? productContext : "This task was generated deterministically from the repository roadmap, architecture, current source tree, and existing task history.",
    scope: {
      summary: roadmapItem.summary
    },
    non_goals: [
      "Do not implement unrelated roadmap features.",
      "Do not upload user artwork or use external processing services.",
      "Do not add production dependencies without a clear task need and verification."
    ],
    requirements,
    acceptance_criteria: [
      roadmapItem.summary,
      "Focused tests cover the behavior introduced by this task.",
      "Typecheck, tests, and build pass."
    ],
    verification: CHECK_COMMANDS.map(([command, args]) => `${command} ${args.join(" ")}`)
  };
}

function auditCategoryForKey(audit, key) {
  const category = audit.audits?.find((item) => item.checks?.some((check) => check.key === key));
  return category ? { id: category.id, label: category.label } : { id: "unmapped", label: "Unmapped product audit" };
}

function taskId(task) {
  return String(task.data?.id ?? getTaskId(task.file));
}

function taskMatchesAuditGap(task, template, checkKeys) {
  const titleMatches = normalizeTitle(task.data?.title ?? "") === normalizeTitle(template?.title ?? "");
  const goalMatches = normalizeTitle(task.data?.goal ?? "") === normalizeTitle(template?.summary ?? "");
  const recordedKeys = task.data?.audit_gap?.check_keys ?? [];
  return titleMatches || goalMatches || recordedKeys.some((key) => checkKeys.includes(key));
}

function auditGapDuplicateReason(task, template, checkKeys) {
  if (normalizeTitle(task.data?.title ?? "") === normalizeTitle(template?.title ?? "")) return "normalized title matches the mapped candidate";
  if (normalizeTitle(task.data?.goal ?? "") === normalizeTitle(template?.summary ?? "")) return "normalized goal matches the mapped candidate";
  const recordedKeys = task.data?.audit_gap?.check_keys ?? [];
  const matchingKeys = recordedKeys.filter((key) => checkKeys.includes(key));
  return `task audit_gap metadata covers ${matchingKeys.join(", ") || "the same check"}`;
}

function duplicatePriority(task, openTaskBranchIds) {
  if (task.state !== "done" && openTaskBranchIds.has(taskId(task))) return 4;
  if (task.state === "active" || task.state === "backlog") return 3;
  if (task.state === "done") return 2;
  if (task.state === "failed") return 1;
  return 0;
}

function findAuditGapDuplicates(context, template, checkKeys) {
  const openTaskBranchIds = new Set((context.openTaskBranchIds ?? []).map(String));
  return context.tasks
    .filter((task) => taskMatchesAuditGap(task, template, checkKeys))
    .sort((left, right) => duplicatePriority(right, openTaskBranchIds) - duplicatePriority(left, openTaskBranchIds)
      || Number(taskId(right)) - Number(taskId(left)));
}

function auditDuplicateLocation(task, context, template, checkKeys) {
  if (!task) return null;
  const branchOpen = task.state !== "done" && (context.openTaskBranchIds ?? []).map(String).includes(taskId(task));
  return {
    id: taskId(task),
    title: task.data?.title ?? "Untitled task",
    state: branchOpen ? "open-branch" : task.state,
    taskState: task.state,
    branchOpen,
    location: branchOpen ? `codex/task-${taskId(task)}` : `tasks/${task.state}/${task.file}`,
    reason: auditGapDuplicateReason(task, template, checkKeys)
  };
}

function remediationSubject(title) {
  return String(title).replace(/^(?:add|wire|mount|restore|document|implement|create|write)\s+/iu, "");
}

function buildAuditRemediationTemplate(template, duplicate, checks, category) {
  const retry = duplicate.taskState === "failed";
  const checkKeys = checks.map((check) => check.key);
  const checkText = checks.map((check) => `${check.key}: ${check.message}`).join("; ");
  const action = retry ? "Retry" : "Complete";
  return {
    ...template,
    title: `${action} ${remediationSubject(template.title)} audit gap after task ${duplicate.id}`,
    summary: `${action} the still-failing ${category.label} check(s) after ${duplicate.taskState} task ${duplicate.id} "${duplicate.title}": ${checkText}.`,
    allowedPaths: [...new Set([...template.allowedPaths, ...AUDIT_REPAIR_ALLOWED_PATHS])],
    requirements: [
      `Reproduce and inspect the remaining ${category.label} check(s): ${checkText}.`,
      `Review task ${duplicate.id} "${duplicate.title}" and its resulting changes before editing.`,
      "Distinguish genuinely missing product work from an incomplete prior implementation and a stale or incorrect audit detector/mapping.",
      "Apply the smallest safe product fix; if the product already satisfies the requirement, correct the audit detector or mapping and add a focused regression test.",
      ...template.requirements
    ],
    productCompletion: true,
    auditGap: {
      kind: retry ? "retry" : "remediation",
      category: category.id,
      check_keys: checkKeys,
      previous_task_id: duplicate.id,
      previous_task_state: duplicate.taskState
    }
  };
}

function buildAuditInvestigationTemplate(check, category) {
  const categoryPaths = AUDIT_INVESTIGATION_PATHS[category.id] ?? [];
  return {
    title: `Investigate unmapped product audit gap: ${check.key}`,
    summary: `Investigate the unmapped ${category.label} check ${check.key}: ${check.message}.`,
    auditKeys: [check.key],
    allowedPaths: [...new Set([...categoryPaths, ...AUDIT_REPAIR_ALLOWED_PATHS])],
    requirements: [
      `Reproduce and inspect audit check ${check.key}: ${check.message}.`,
      "Determine whether product work is genuinely missing, the detector is stale or incorrect, or the task mapping is missing.",
      "Fix the audit mapping or detector when it is wrong and add a focused regression test.",
      "Change product code only when the missing behavior is clear; otherwise document why the audit is invalid."
    ],
    autoMerge: false,
    productCompletion: true,
    auditGap: { kind: "investigation", category: category.id, check_keys: [check.key] }
  };
}

function planProductCompletionTasks(audit, context, count = generatedTaskCount) {
  const suppression = productTaskDependencySuppression(audit, context);
  const missingByKey = new Map(audit.missing.map((check) => [check.key, check]));
  const decisions = [];
  const selected = [];
  const handledKeys = new Set();
  const coveredBySelected = new Map();

  for (const template of PRODUCT_COMPLETION_TASKS) {
    const mappedChecks = template.auditKeys.map((key) => missingByKey.get(key)).filter(Boolean);
    const alreadyCoveredChecks = mappedChecks.filter((check) => coveredBySelected.has(check.key));
    if (alreadyCoveredChecks.length > 0) {
      decisions.push({
        category: auditCategoryForKey(audit, alreadyCoveredChecks[0].key),
        checks: alreadyCoveredChecks,
        candidateTitle: template.title,
        duplicate: null,
        caseType: "genuinely missing product work covered by a broader generated task",
        decision: `covered by generated broader candidate "${coveredBySelected.get(alreadyCoveredChecks[0].key)}"`,
        taskTemplate: null
      });
      for (const check of alreadyCoveredChecks) handledKeys.add(check.key);
    }
    const checks = mappedChecks.filter((check) => !coveredBySelected.has(check.key));
    if (checks.length === 0) continue;
    const category = auditCategoryForKey(audit, checks[0].key);
    const duplicates = findAuditGapDuplicates(context, template, checks.map((check) => check.key))
      .map((task) => auditDuplicateLocation(task, context, template, checks.map((check) => check.key)));
    const duplicate = duplicates[0] ?? null;
    const suppressed = checks.every((check) => suppression.coveredKeys.has(check.key));
    let taskTemplate = null;
    let decision;
    let caseType;

    if (suppressed) {
      caseType = "product work is still pending in a broader task";
      decision = `blocked by pending broader task ${suppression.broadTask.id} "${suppression.broadTask.title}"`;
    }
    else if (!duplicate) {
      taskTemplate = { ...template, productCompletion: true };
      caseType = "product work is genuinely missing";
      decision = "generate missing-work task";
    } else if (duplicate.state === "backlog" || duplicate.state === "active" || duplicate.state === "open-branch") {
      caseType = "product work is still pending";
      decision = `blocked by identical ${duplicate.state} task`;
    } else {
      taskTemplate = buildAuditRemediationTemplate(template, duplicate, checks, category);
      caseType = duplicate.taskState === "failed"
        ? "a prior attempt failed"
        : "a done task did not satisfy the audit, or the detector is stale/wrong";
      decision = duplicate.taskState === "failed" ? "generate unique retry/remediation task" : "generate unique remediation task because a done task still fails the audit";
    }

    if (taskTemplate && selected.length < count) {
      selected.push(taskTemplate);
      for (const key of template.covers ?? template.auditKeys) coveredBySelected.set(key, taskTemplate.title);
    }
    else if (taskTemplate) decision = `deferred by generated task count limit (${count})`;
    for (const check of checks) handledKeys.add(check.key);
    decisions.push({ category, checks, candidateTitle: template.title, duplicate, duplicates, caseType, decision, taskTemplate });
  }

  for (const check of audit.missing.filter((item) => !handledKeys.has(item.key))) {
    const category = auditCategoryForKey(audit, check.key);
    const taskTemplate = buildAuditInvestigationTemplate(check, category);
    let decision = "generate investigation task because no product-task mapping exists";
    const duplicates = findAuditGapDuplicates(context, taskTemplate, [check.key])
      .map((task) => auditDuplicateLocation(task, context, taskTemplate, [check.key]));
    const duplicate = duplicates[0] ?? null;
    if (duplicate && ["backlog", "active", "open-branch"].includes(duplicate.state)) decision = `blocked by identical ${duplicate.state} investigation`;
    else if (selected.length < count) selected.push(duplicate ? buildAuditRemediationTemplate(taskTemplate, duplicate, [check], category) : taskTemplate);
    else decision = `deferred by generated task count limit (${count})`;
    decisions.push({
      category,
      checks: [check],
      candidateTitle: null,
      duplicate,
      duplicates,
      caseType: "the audit detector/mapping is stale, wrong, or missing",
      decision,
      taskTemplate
    });
  }

  return { selected, decisions, dependencySuppression: suppression };
}

function selectRoadmapTasks(context, count = generatedTaskCount) {
  const existingTitles = new Set(context.tasks.map((task) => normalizeTitle(task.data?.title ?? "")));
  const existingPaths = new Set(context.sourceFiles);
  const available = ROADMAP.filter((item) => {
    if (existingTitles.has(normalizeTitle(item.title))) return false;
    return !(item.completionPaths ?? []).some((file) => existingPaths.has(file));
  }).slice(0, count);
  const existingIds = listExistingTaskIds(context);
  return available.map((item, index) => buildGeneratedTask(item, getNextTaskId(existingIds, index)));
}

function productTaskDependencySuppression(audit, context) {
  const broadTask = context.tasks.find((task) => normalizeTitle(task.data?.title ?? "") === normalizeTitle(BROAD_UI_TASK_TITLE));
  const taskId = String(broadTask?.data?.id ?? "");
  const branchOpen = (context.openTaskBranchIds ?? []).map(String).includes(taskId);
  const pending = Boolean(broadTask) && broadTask.state !== "done" && broadTask.state !== "failed"
    && (broadTask.state === "backlog" || broadTask.state === "active" || branchOpen);
  if (!pending) return { active: false, broadTask: null, coveredKeys: new Set(), skippedTitles: [] };

  const missingKeys = new Set(audit.missing.map((item) => item.key));
  const skippedTitles = PRODUCT_COMPLETION_TASKS
    .filter((template) => template.title !== BROAD_UI_TASK_TITLE)
    .filter((template) => template.auditKeys.some((key) => missingKeys.has(key) && BROAD_UI_SUPPRESSED_AUDIT_KEYS.has(key)))
    .map((template) => template.title);
  return {
    active: true,
    broadTask: { id: taskId, title: broadTask.data?.title ?? BROAD_UI_TASK_TITLE, state: broadTask.state, branchOpen },
    coveredKeys: new Set(BROAD_UI_SUPPRESSED_AUDIT_KEYS),
    skippedTitles
  };
}

function selectProductCompletionTasks(audit, context, count = generatedTaskCount) {
  const plan = planProductCompletionTasks(audit, context, count);

  const existingIds = listExistingTaskIds(context);
  const tasks = plan.selected.map((item, index) => buildGeneratedTask(item, getNextTaskId(existingIds, index)));
  Object.defineProperty(tasks, "dependencySuppression", { value: plan.dependencySuppression, enumerable: false });
  Object.defineProperty(tasks, "auditPlan", { value: plan, enumerable: false });
  return tasks;
}

function buildTaskYaml(task) {
  return YAML.stringify(task, { lineWidth: 0 });
}

function generatedTaskFileName(task) {
  return `${task.id}-${slugify(task.title)}.yaml`;
}

function writeGeneratedTaskFiles(tasks, options = {}) {
  const backlogDir = path.resolve("tasks", "backlog");
  if (!options.dryRun) fs.mkdirSync(backlogDir, { recursive: true });
  const generated = tasks.map((task) => {
    const fileName = generatedTaskFileName(task);
    const filePath = path.join(backlogDir, fileName);
    if (!options.dryRun) {
      if (fs.existsSync(filePath)) throw new AutomationStop(`Refusing to overwrite existing task ${fileName}.`, "task_generation_collision");
      fs.writeFileSync(filePath, buildTaskYaml(task), "utf8");
    }
    return { task, fileName, filePath };
  });
  Object.defineProperty(generated, "dependencySuppression", { value: tasks.dependencySuppression, enumerable: false });
  Object.defineProperty(generated, "auditPlan", { value: tasks.auditPlan, enumerable: false });
  return generated;
}

function generateBacklogTasks(options = {}) {
  const context = options.context ?? collectProjectPlanningContext();
  const tasks = selectRoadmapTasks(context, options.count ?? generatedTaskCount);
  return writeGeneratedTaskFiles(tasks, { dryRun: options.dryRun ?? false });
}

function generateProductCompletionTasks(options = {}) {
  const context = options.context ?? collectProjectPlanningContext();
  const audit = options.audit ?? auditProductCompleteness({ context });
  const tasks = selectProductCompletionTasks(audit, context, options.count ?? generatedTaskCount);
  return writeGeneratedTaskFiles(tasks, { dryRun: options.dryRun ?? false });
}

function printProductAuditSummary(audit) {
  console.log("Running product completeness audits...");
  if (audit.passed) {
    for (const category of audit.audits) console.log(`${category.label}: passed`);
    return;
  }
  for (const category of audit.audits) {
    if (category.passed) console.log(`${category.label}: passed`);
    else console.log(`${category.label}: missing ${category.missing.map((check) => check.message).join("; ")}`);
  }
}

function printProductAuditTaskDecisions(audit, plan) {
  if (audit.passed || !plan) return;
  console.log("Product audit task decisions:");
  for (const entry of plan.decisions) {
    for (const check of entry.checks) {
      console.log(`- ${entry.category.label} / ${check.key}: ${check.message}`);
      console.log(`  Candidate: ${entry.candidateTitle ?? "none (unmapped check)"}`);
      if (entry.duplicate) {
        for (const duplicate of entry.duplicates ?? [entry.duplicate]) {
          console.log(`  Duplicate: ${duplicate.id} "${duplicate.title}" at ${duplicate.location} (${duplicate.state}); reason: ${duplicate.reason}`);
        }
        if ((entry.duplicates ?? [entry.duplicate]).some((duplicate) => duplicate.taskState === "done")) console.log("  Done-but-audit-still-fails: yes");
      } else console.log("  Duplicate: none");
      console.log(`  Case: ${entry.caseType}`);
      console.log(`  Decision: ${entry.decision}`);
    }
  }
}

function printUnresolvedAuditGuidance(audit, plan, prefix = "") {
  if (audit.passed || !plan || plan.selected.length > 0) return;
  const blocked = plan.decisions.filter((entry) => /blocked/iu.test(entry.decision));
  const doneDuplicates = [...new Map(plan.decisions
    .flatMap((entry) => entry.duplicates ?? (entry.duplicate ? [entry.duplicate] : []))
    .filter((duplicate) => duplicate.taskState === "done")
    .map((duplicate) => [duplicate.id, duplicate])).values()];
  console.log(`${prefix}All failing audit gaps blocked by pending duplicates: ${blocked.length === plan.decisions.length ? "yes" : "no"}`);
  console.log(`${prefix}Done duplicates whose audits still fail: ${doneDuplicates.map((duplicate) => `${duplicate.id} ${duplicate.title}`).join(", ") || "none"}`);
  console.log(`${prefix}Inspect without mutation: node scripts/auto-dev-cycle.mjs --dry-run --generate-tasks`);
  console.log(`${prefix}Next action: create remediation/investigation tasks for unblocked gaps, finish any listed pending task/branch, or fix the audit mapping.`);
}

function productCompletionStopReason(audit, generatedCount, plan = null) {
  if (generatedCount > 0) return "Generated product-completion tasks; rerun automation to continue";
  if (audit.passed) return "No backlog tasks remain and product completeness audits passed";
  if (plan?.decisions?.length > 0 && plan.decisions.every((entry) => /blocked/iu.test(entry.decision))) {
    return "Product completeness audits failed; all candidate tasks are blocked by backlog, active, or open-branch duplicates";
  }
  return "Product completeness audits failed and no non-duplicate product-completion tasks could be generated";
}

function printGeneratedTaskSummary(generated, prefix = "Generated") {
  if (generated.length === 0) {
    console.log(`${prefix} tasks: none`);
  } else {
    console.log(`${prefix} tasks:`);
    for (const { task, fileName } of generated) console.log(`- ${task.id}: ${task.title} (${fileName})`);
  }
  const suppression = generated.dependencySuppression;
  if (suppression?.active && suppression.skippedTitles.length > 0) {
    console.log(`Skipped ${suppression.skippedTitles.length} narrower product task(s) because ${suppression.broadTask.id}: ${suppression.broadTask.title} is still ${suppression.broadTask.state}.`);
  }
}

function commitAndPushGeneratedTasks(generated) {
  const relativePaths = generated.map(({ filePath }) => path.relative(process.cwd(), filePath));
  run("git", ["add", "--", ...relativePaths]);
  run("git", ["commit", "-m", `chore(tasks): generate ${generated.length} backlog tasks`]);
  run("git", ["push", "origin", "main"]);
}

function runGenerateTasksMode() {
  if (dryRun) {
    const context = collectProjectPlanningContext();
    let generated = generateBacklogTasks({ context, dryRun: true });
    let stopReason = null;
    if (generated.length === 0) {
      console.log("No normal roadmap tasks remain.");
      const audit = auditProductCompleteness({ context });
      printProductAuditSummary(audit);
      generated = generateProductCompletionTasks({ audit, context, dryRun: true });
      printProductAuditTaskDecisions(audit, generated.auditPlan);
      console.log(`[dry-run] would generate product-completion tasks: ${generated.map(({ task }) => task.id).join(", ") || "none"}`);
      printGeneratedTaskSummary(generated, "[dry-run] product-completion");
      printUnresolvedAuditGuidance(audit, generated.auditPlan, "[dry-run] ");
      stopReason = productCompletionStopReason(audit, generated.length, generated.auditPlan);
    } else {
      printGeneratedTaskSummary(generated, "[dry-run] would generate");
    }
    if (stopReason) console.log(`[dry-run] Stop reason: ${stopReason}`);
    console.log("[dry-run] no task files, commits, pushes, or pulls were created");
    return generated;
  }

  ensureCleanGit();
  ensureOnMain();
  pullMain();
  ensureCleanGit();
  const context = collectProjectPlanningContext();
  let generated = generateBacklogTasks({ context });
  let stopReason = null;
  if (generated.length === 0) {
    console.log("No normal roadmap tasks remain.");
    const audit = auditProductCompleteness({ context });
    printProductAuditSummary(audit);
    generated = generateProductCompletionTasks({ audit, context });
    printProductAuditTaskDecisions(audit, generated.auditPlan);
    console.log(`Generated product-completion tasks: ${generated.map(({ task }) => task.id).join(", ") || "none"}`);
    printUnresolvedAuditGuidance(audit, generated.auditPlan);
    stopReason = productCompletionStopReason(audit, generated.length, generated.auditPlan);
  }
  if (generated.length > 0) commitAndPushGeneratedTasks(generated);
  printGeneratedTaskSummary(generated);
  if (stopReason) console.log(`Stop reason: ${stopReason}`);
  return generated;
}

function getTaskId(taskFile) {
  return taskFile.split("-")[0];
}

function readTask(taskFile) {
  return YAML.parse(fs.readFileSync(path.resolve("tasks", "backlog", taskFile), "utf8"));
}

function moveTaskFile(fromDirName, toDirName, taskFile) {
  const fromPath = path.resolve("tasks", fromDirName, taskFile);
  const toDir = path.resolve("tasks", toDirName);
  const toPath = path.join(toDir, taskFile);
  fs.mkdirSync(toDir, { recursive: true });
  fs.renameSync(fromPath, toPath);
  return toPath;
}

function createTaskBranch(taskId) {
  const branchName = `codex/task-${taskId}`;
  run("git", ["checkout", "-b", branchName]);
  return branchName;
}

function generatePrompt(taskId) {
  run("node", ["scripts/make-prompt.mjs", taskId]);
  return fs.readFileSync(path.resolve("prompts", "generated", `${taskId}.md`), "utf8");
}

function getCodexArgs() {
  const extraArgs = process.env.CODEX_EXEC_ARGS === undefined
    ? ["--sandbox", "workspace-write"]
    : process.env.CODEX_EXEC_ARGS.trim().split(/\s+/u).filter(Boolean);
  return ["exec", ...extraArgs, "-"];
}

function isQuotaOrTokenFailure(output) {
  return /(?:insufficient[_ ]quota|quota[_ ](?:exceeded|reached)|rate[_ -]?limit|too many requests|context[_ ](?:length|window)|maximum[_ ]context|tokens?[_ ](?:exhausted|limit)|out[_ ]of[_ ]tokens|usage[_ ]limit|credit[_ ]balance|billing[_ ]limit|authentication[_ ]failed|unauthorized|invalid[_ ]api[_ ]key|expired[_ ]api[_ ]key|login[_ ]required)/iu.test(output);
}

function isRecoverableCodexSandboxVerificationFailure(output) {
  return /(?:Cannot read directory ["']\.\.\/\.\.["']: Access is denied|Could not resolve|vite\.config\.ts|failed to load config|UnauthorizedAccessException|npm\.ps1|Test-Path\s*:\s*Access is denied|(?:npm run (?:test|build)|vitest|vite)[\s\S]{0,240}(?:access is denied|access denied|EACCES|EPERM|operation not permitted|sandbox)|(?:access is denied|access denied|EACCES|EPERM|operation not permitted)[\s\S]{0,240}(?:tests? (?:did not|never) run|before tests?|vitest|vite))/iu.test(output);
}

function changedPaths() {
  return readStatus().split(/\r?\n/u).filter(Boolean).map((line) => line.slice(3).split(" -> ").at(-1)).filter(Boolean);
}

function hasTaskRelevantChanges(paths, task = null) {
  void task;
  return paths.some((file) => {
    const normalized = file.replaceAll("\\", "/");
    return !GENERATED_CHANGE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  });
}

function shouldContinueAfterCodexFailure(output, paths, task = null) {
  return isRecoverableCodexSandboxVerificationFailure(output) && hasTaskRelevantChanges(paths, task);
}

function readFailureGitState() {
  try {
    return { branch: currentBranch(), status: readStatus() };
  } catch {
    return { branch: "unknown", status: "Unable to read git status" };
  }
}

function buildFailureLogContent(error, context = {}, gitState = readFailureGitState()) {
  const recoveryCommands = (context.suggestedRecovery
    ?? error.suggestedRecovery
    ?? taskStateRecoveryCommands(gitState.status).join("\n"))
    || "Inspect `git status --short` and preserve task implementation changes before cleanup.";
  return [
    `TIMESTAMP: ${new Date().toISOString()}`,
    `MODE: ${mode}`,
    `TASK: ${context.taskId ?? "Unknown"}`,
    `TASK FILE: ${context.taskFile ?? "Unknown"}`,
    `BRANCH: ${context.branch ?? gitState.branch}`,
    `PHASE: ${context.phase ?? "Unknown"}`,
    `COMMAND: ${error.command ?? "Unknown"}`,
    `EXIT STATUS: ${error.status ?? "Unknown"}`,
    `ENVIRONMENT ONLY: ${context.environmentOnly ?? error.environmentOnly ?? false}`,
    `CHANGES PRODUCED: ${context.changesProduced ?? "Unknown"}`,
    `PR URL: ${context.prUrl ?? "None"}`,
    "",
    "STDOUT:",
    error.stdout ?? "",
    "",
    "STDERR:",
    error.stderr ?? "",
    "",
    "MESSAGE:",
    error.message ?? String(error),
    "",
    "GIT STATUS:",
    gitState.status || "Clean",
    "",
    "SUGGESTED RECOVERY:",
    recoveryCommands
  ].join("\n");
}

function writeFailureLog(error, context = {}) {
  const outDir = path.resolve("prompts", "generated");
  fs.mkdirSync(outDir, { recursive: true });
  const logPath = path.join(outDir, "last-failure.log");
  const content = buildFailureLogContent(error, context);
  fs.writeFileSync(logPath, content, "utf8");
  return logPath;
}

function runCodexWithPrompt(prompt, taskId, phase = "implementation", task = null) {
  const codexArgs = getCodexArgs();
  try {
    return run("codex", codexArgs, { input: prompt });
  } catch (error) {
    const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error.message ?? ""}`;
    const paths = changedPaths();
    const changesProduced = hasTaskRelevantChanges(paths, task);
    if (error.timedOut) {
      writeFailureLog(error, { taskId, phase, changesProduced });
      throw new AutomationStop("Maximum automation runtime reached while Codex was running.", "max_runtime", { cause: error });
    }
    if (isQuotaOrTokenFailure(output)) {
      writeFailureLog(error, { taskId, phase, changesProduced });
      throw new AutomationStop("Codex stopped because of a likely quota, token, context, rate-limit, or authentication error.", "codex_limit_or_auth", { cause: error });
    }
    if (shouldContinueAfterCodexFailure(output, paths, task)) {
      error.environmentOnly = true;
      writeFailureLog(error, {
        taskId,
        phase,
        environmentOnly: true,
        changesProduced,
        suggestedRecovery: "No recovery is needed yet. The outer automation is continuing with local typecheck, test, and build."
      });
      console.warn("Codex hit a managed Windows sandbox verification limitation after producing task-relevant changes. Continuing to outer local verification.");
      return { status: error.status, stdout: error.stdout, stderr: error.stderr, recoverableEnvironmentFailure: true };
    }
    writeFailureLog(error, { taskId, phase, environmentOnly: false, changesProduced });
    throw new AutomationStop("Codex execution failed. See prompts/generated/last-failure.log.", "codex_failure", { cause: error });
  }
}

function runChecks() {
  for (const [, commandArgs] of CHECK_COMMANDS) run(npmCommand(), commandArgs);
}

function repair(taskId, task, error) {
  const logPath = writeFailureLog(error, { taskId, phase: "verification" });
  const failureLog = fs.readFileSync(logPath, "utf8");
  const prompt = `Read AGENTS.md first.

The previous automated task ${taskId} failed verification.

Failure log:
\`\`\`text
${failureLog.slice(0, 20000)}
\`\`\`

Fix only the smallest cause of the failure.

Rules:
- Do not refactor unrelated code.
- Do not start a new feature.
- Do not remove tests to make checks pass.
- Modify any repository file required to fix the task, while keeping the repair narrowly focused.
- If unrelated automation tests fail, report that failure instead of making an unrelated fix.
- Keep the diff small.
- Stop after making the fix.
`;
  runCodexWithPrompt(prompt, taskId, "repair", task);
}

function verifyWithRepairs(taskId, task) {
  let lastError = null;
  for (let repairsUsed = 0; repairsUsed <= maxRepairAttempts; repairsUsed += 1) {
    try {
      runChecks();
      return repairsUsed;
    } catch (error) {
      lastError = error;
      if (error.timedOut) {
        throw new AutomationStop("Maximum automation runtime reached during local verification.", "max_runtime", { cause: error });
      }
      if (repairsUsed >= maxRepairAttempts) break;
      console.log(`Verification failed. Repair attempt ${repairsUsed + 1}/${maxRepairAttempts}.`);
      repair(taskId, task, error);
    }
  }
  writeFailureLog(lastError, { taskId, phase: "verification" });
  const stop = new AutomationStop("Outer local verification failed after all repair attempts.", "verification_failure", { cause: lastError });
  stop.localVerificationFailed = true;
  throw stop;
}

function commitAndPush(taskId, branchName) {
  run("git", ["add", "."]);
  run("git", ["commit", "-m", `Task ${taskId}: automated Codex implementation`]);
  run("git", ["push", "-u", "origin", branchName]);
}

function createPr(taskId, taskFile, branchName, repairsUsed) {
  const title = `Task ${taskId}: automated Codex implementation`;
  const body = [
    "⚠️ This pull request was generated automatically by the Codex automation loop.",
    "",
    `Task file: \`tasks/backlog/${taskFile}\``,
    "",
    "Local verification:",
    "- `npm run typecheck`",
    "- `npm run test`",
    "- `npm run build`",
    "",
    `Repair attempts used: ${repairsUsed}`
  ].join("\n");

  try {
    run("gh", ["pr", "create", "--base", "main", "--head", branchName, "--title", title, "--body", body]);
    const result = runQuiet("gh", ["pr", "view", branchName, "--json", "number,url"]);
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new AutomationStop("Failed to create or inspect the pull request.", "pr_failure", { cause: error });
  }
}

function isNoPrChecksReported(output) {
  return /no checks reported/iu.test(output);
}

function prChecksFailurePolicy(output, allowNoChecks = allowNoPrChecks) {
  if (!isNoPrChecksReported(output)) return "fail";
  return allowNoChecks ? "continue" : "fail-no-checks";
}

function canContinueWithoutPrChecks(output, allowNoChecks, localVerificationPassed) {
  return localVerificationPassed && prChecksFailurePolicy(output, allowNoChecks) === "continue";
}

function waitForPrChecks(prNumber, localVerificationPassed = true) {
  try {
    run("gh", ["pr", "checks", String(prNumber), "--watch", "--interval", "10"]);
  } catch (error) {
    const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error.message ?? ""}`;
    const policy = prChecksFailurePolicy(output);
    if (policy === "continue") {
      if (!canContinueWithoutPrChecks(output, allowNoPrChecks, localVerificationPassed)) {
        throw new AutomationStop("Cannot bypass missing PR checks because mandatory local verification has not passed.", "verification_required", { cause: error });
      }
      console.warn("Warning: GitHub reported no PR checks. AUTO_DEV_ALLOW_NO_PR_CHECKS=true, so automation will continue to mandatory PR metadata validation.");
      return { noChecks: true };
    }
    if (policy === "fail-no-checks") {
      throw new AutomationStop("No GitHub PR checks were reported. Configure CI or set AUTO_DEV_ALLOW_NO_PR_CHECKS=true explicitly.", "no_pr_checks", { cause: error });
    }
    if (error.timedOut) {
      throw new AutomationStop("Maximum automation runtime reached while waiting for GitHub checks.", "max_runtime", { cause: error });
    }
    throw new AutomationStop("GitHub Actions or pull request checks failed.", "ci_failure", { cause: error });
  }
}

function autoMergePolicyDecision({ localVerificationPassed, requiredPrChecksPassed = true, safetyValidationPassed }) {
  if (!localVerificationPassed) return "block-verification";
  if (!requiredPrChecksPassed) return "block-ci";
  if (!safetyValidationPassed) return "block-safety";
  return "allow";
}

function prMergeSafetyDecision(pr, branchName, task = {}, options = {}) {
  void task;
  const localVerificationPassed = options.localVerificationPassed ?? true;
  const requiredPrChecksPassed = options.requiredPrChecksPassed ?? true;
  const reasons = [];
  if (!localVerificationPassed) reasons.push("mandatory local verification has not passed");
  if (!requiredPrChecksPassed) reasons.push("required PR checks have not passed");
  if (!pr.headRefName?.startsWith("codex/task-")) reasons.push(`PR head is not a codex/task-* branch: ${pr.headRefName}`);
  if (pr.headRefName !== branchName) reasons.push(`PR head is ${pr.headRefName}, expected ${branchName}`);
  if (pr.baseRefName !== "main") reasons.push(`PR base is ${pr.baseRefName}, expected main`);
  const policy = autoMergePolicyDecision({
    localVerificationPassed,
    requiredPrChecksPassed,
    safetyValidationPassed: reasons.length === 0
  });
  return { allowed: policy === "allow", policy, reasons };
}

function validatePrBeforeMerge(prNumber, branchName, taskFile, task) {
  void taskFile;
  let pr;
  try {
    const result = runQuiet("gh", ["pr", "view", String(prNumber), "--json", "baseRefName,files,headRefName,url"]);
    pr = JSON.parse(result.stdout);
  } catch (error) {
    throw new AutomationStop("Could not inspect pull request safety metadata.", "safety_check_failure", { cause: error });
  }

  const decision = prMergeSafetyDecision(pr, branchName, task);
  if (!decision.allowed) {
    const stop = new AutomationStop(`PR metadata validation rejected auto-merge:\n- ${decision.reasons.join("\n- ")}`, "safety_check_failure");
    stop.prUrl = pr.url;
    stop.safetyValidationFailed = true;
    throw stop;
  }
  return pr;
}

function mergePr(prNumber) {
  let mergeError = null;
  try {
    run("gh", ["pr", "merge", String(prNumber), "--squash", "--delete-branch"]);
  } catch (error) {
    mergeError = error;
  }

  try {
    const result = runQuiet("gh", ["pr", "view", String(prNumber), "--json", "mergedAt,state,url"]);
    const merged = JSON.parse(result.stdout);
    if (merged.mergedAt) {
      if (mergeError) console.warn(`Warning: PR merged, but branch cleanup reported an error: ${mergeError.message}`);
      return merged;
    }
    throw new Error(`PR state is ${merged.state}; mergedAt is empty.`);
  } catch (error) {
    throw new AutomationStop("Pull request merge failed.", "merge_failure", { cause: mergeError ?? error });
  }
}

function canMoveTaskToDone(merged, branch) {
  return merged && branch === "main";
}

function moveTaskToDoneAfterMerge(taskId, taskFile, merged) {
  const branch = currentBranch();
  if (!canMoveTaskToDone(merged, branch)) {
    throw new AutomationStop("Refusing to move task to done before merge or outside main.", "task_state_failure");
  }
  const backlogPath = path.resolve("tasks", "backlog", taskFile);
  if (!fs.existsSync(backlogPath)) {
    throw new AutomationStop(`Expected backlog task is missing after merge: tasks/backlog/${taskFile}.`, "task_state_failure");
  }
  moveTaskFile("backlog", "done", taskFile);
  let committed = false;
  try {
    run("git", ["add", "--", path.join("tasks", "backlog", taskFile), path.join("tasks", "done", taskFile)]);
    run("git", ["commit", "-m", `Task ${taskId}: mark automation task done`]);
    committed = true;
    run("git", ["push", "origin", "main"]);
  } catch (error) {
    const suggestedRecovery = committed
      ? "The implementation is merged and the task-state commit is local on main. Run: git push origin main"
      : "The implementation is merged, but the task-state commit did not finish. Inspect git status, then commit only the backlog-to-done move on main.";
    const stop = new AutomationStop("Implementation merged, but updating task state on main failed.", "task_state_failure", { cause: error });
    stop.suggestedRecovery = suggestedRecovery;
    throw stop;
  }
}

function cleanupAfterTask(taskId, branchName, taskFile, merged) {
  run("git", ["checkout", "main"]);
  pullMain();
  moveTaskToDoneAfterMerge(taskId, taskFile, merged);
  if (localBranchExists(branchName)) {
    try {
      run("git", ["branch", "-D", branchName]);
    } catch (error) {
      console.warn(`Warning: could not delete local branch ${branchName}: ${error.message}`);
    }
  }
  ensureCleanGit();
}

function failureTaskStatePolicy(branchPushed, prCreated) {
  if (branchPushed || prCreated) {
    return "Implementation was already pushed or a PR may exist. Task state was left unchanged. Recover the PR/branch first; do not move the task locally on the task branch.";
  }
  return "Task state was left unchanged in backlog. Preserve or inspect implementation changes on the task branch before cleanup.";
}

function localBranchExists(branchName) {
  try {
    runQuiet("git", ["show-ref", "--verify", `refs/heads/${branchName}`]);
    return true;
  } catch {
    return false;
  }
}

function remoteBranchExists(branchName) {
  try {
    runQuiet("git", ["ls-remote", "--exit-code", "--heads", "origin", branchName]);
    return true;
  } catch {
    return false;
  }
}

function findExistingPr(branchName) {
  try {
    const result = runQuiet("gh", ["pr", "list", "--head", branchName, "--state", "all", "--limit", "1", "--json", "baseRefName,headRefName,mergedAt,number,state,url"]);
    return JSON.parse(result.stdout)[0] ?? null;
  } catch (error) {
    throw new AutomationStop(`Could not inspect existing PRs for ${branchName}.`, "pr_recovery_failure", { cause: error });
  }
}

function existingTaskRecoveryAction(pr, hasLocalBranch, hasRemoteBranch) {
  if (pr?.mergedAt || pr?.state === "MERGED") return "complete-merged";
  if (pr?.state === "OPEN") return hasLocalBranch || hasRemoteBranch ? "resume-pr" : "stale-pr";
  if (pr) return "stale-pr";
  if (hasLocalBranch || hasRemoteBranch) return "resume-branch";
  return "start";
}

function checkoutExistingTaskBranch(branchName, hasLocalBranch, hasRemoteBranch) {
  ensureCleanGit();
  if (currentBranch() === branchName) return;
  if (hasLocalBranch) {
    run("git", ["checkout", branchName]);
    return;
  }
  if (hasRemoteBranch) {
    run("git", ["fetch", "origin", branchName]);
    run("git", ["checkout", "-b", branchName, "--track", `origin/${branchName}`]);
    return;
  }
  throw new AutomationStop(`PR exists but branch ${branchName} is missing locally and remotely.`, "stale_pr", {
    command: `gh pr view --web ${branchName}`
  });
}

function isBranchBehindOriginMain(branchName, commandRunner = runQuiet) {
  try {
    return Number(commandRunner("git", ["rev-list", "--count", `${branchName}..origin/main`]).stdout.trim()) > 0;
  } catch {
    return false;
  }
}

function branchBehindMainRecoveryGuidance(branchName) {
  return [
    "This branch may need the latest main changes:",
    `  git checkout ${branchName}`,
    "  git fetch origin main",
    "  git merge origin/main",
    "  npm run typecheck",
    "  npm run test",
    "  npm run build",
    "  git push"
  ].join("\n");
}

function buildExistingPrRecoverySummary(context) {
  const lines = [
    "Existing PR recovery summary:",
    `- Existing PR URL: ${context.prUrl ?? "None"}`,
    `- Implementation failure: ${context.implementationFailure ? "yes" : "no"}`,
    `- Stale branch needs origin/main: ${context.branchBehindMain ? "yes" : "no"}`,
    `- Managed Windows sandbox limitation: ${context.managedSandboxFailure ? "yes" : "no"}`,
    `- Outer local verification failed: ${context.localVerificationFailed ? "yes" : "no"}`,
    `- PR metadata validation failed: ${context.safetyValidationFailed ? "yes" : "no"}`
  ];
  if (context.branchBehindMain) lines.push("", branchBehindMainRecoveryGuidance(context.branchName));
  return lines.join("\n");
}

function verifyRecoveredBranch(taskId, checkRunner = runChecks, failureLogger = writeFailureLog) {
  try {
    checkRunner();
  } catch (error) {
    failureLogger(error, { taskId, phase: "existing-branch-verification", environmentOnly: false });
    const stop = new AutomationStop("Existing task branch failed mandatory local verification in the outer automation; it was not merged.", "verification_failure", { cause: error });
    stop.localVerificationFailed = true;
    throw stop;
  }
}

function recoverExistingTask(taskId, taskFile, task, branchName) {
  const pr = findExistingPr(branchName);
  const hasLocalBranch = localBranchExists(branchName);
  const hasRemoteBranch = remoteBranchExists(branchName);
  const action = existingTaskRecoveryAction(pr, hasLocalBranch, hasRemoteBranch);
  if (action === "start") return null;
  let recoveredMerged = action === "complete-merged";
  let branchBehindMain = false;

  try {
    console.log(`Existing task recovery: ${action} for ${branchName}${pr?.url ? ` (${pr.url})` : ""}`);
    if (action === "complete-merged") {
      cleanupAfterTask(taskId, branchName, taskFile, true);
      return { taskId, prUrl: pr.url, merged: true, repairsUsed: 0, recovered: true };
    }
    if (action === "stale-pr") {
      throw new AutomationStop(
        `Existing PR ${pr?.url ?? ""} is closed/stale or its branch is missing. Inspect it before retrying.`,
        "stale_pr",
        { command: pr?.url ? `gh pr view ${pr.number} --web` : `git branch -a --list "*${branchName}"` }
      );
    }

    checkoutExistingTaskBranch(branchName, hasLocalBranch, hasRemoteBranch);
    branchBehindMain = isBranchBehindOriginMain(branchName);
    verifyRecoveredBranch(taskId);
    let recoveredPr = pr;
    if (action === "resume-branch") {
      const ahead = Number(runQuiet("git", ["rev-list", "--count", `main..${branchName}`]).stdout.trim());
      if (!ahead) throw new AutomationStop(`Existing branch ${branchName} has no commits ahead of main.`, "stale_branch");
      if (!hasRemoteBranch) run("git", ["push", "-u", "origin", branchName]);
      recoveredPr = createPr(taskId, taskFile, branchName, 0);
    }
    waitForPrChecks(recoveredPr.number);
    validatePrBeforeMerge(recoveredPr.number, branchName, taskFile, task);
    mergePr(recoveredPr.number);
    recoveredMerged = true;
    cleanupAfterTask(taskId, branchName, taskFile, true);
    return { taskId, prUrl: recoveredPr.url, merged: true, repairsUsed: 0, recovered: true };
  } catch (error) {
    error.prUrl = error.prUrl ?? pr?.url;
    error.prMerged = error.prMerged ?? recoveredMerged;
    error.branchBehindMain = error.branchBehindMain ?? branchBehindMain;
    error.localVerificationFailed = error.localVerificationFailed ?? error.code === "verification_failure";
    error.safetyValidationFailed = error.safetyValidationFailed ?? error.code === "safety_check_failure";
    error.managedSandboxFailure = error.managedSandboxFailure ?? error.environmentOnly === true;
    error.implementationFailure = error.implementationFailure
      ?? (error.localVerificationFailed && !error.branchBehindMain && !error.managedSandboxFailure);
    const recoveryParts = [];
    if (error.suggestedRecovery) recoveryParts.push(error.suggestedRecovery);
    const recoverySummary = buildExistingPrRecoverySummary({
      branchName,
      prUrl: error.prUrl,
      implementationFailure: error.implementationFailure,
      branchBehindMain: error.branchBehindMain,
      managedSandboxFailure: error.managedSandboxFailure,
      localVerificationFailed: error.localVerificationFailed,
      safetyValidationFailed: error.safetyValidationFailed
    });
    error.message = `${error.message}${error.suggestedRecovery ? `\n\n${error.suggestedRecovery}` : ""}\n\n${recoverySummary}`;
    error.suggestedRecovery = [...recoveryParts, recoverySummary].filter(Boolean).join("\n\n");
    throw error;
  }
}

function runOneTask(taskFile) {
  const taskId = getTaskId(taskFile);
  const task = readTask(taskFile);
  let branchName = null;
  let branchPushed = false;
  let merged = false;
  let pr = null;
  let managedSandboxFailure = false;

  try {
    ensureCleanGit();
    ensureOnMain();
    const recovered = recoverExistingTask(taskId, taskFile, task, `codex/task-${taskId}`);
    if (recovered) return recovered;
    branchName = createTaskBranch(taskId);
    const prompt = generatePrompt(taskId);
    const codexResult = runCodexWithPrompt(prompt, taskId, "implementation", task);
    managedSandboxFailure = codexResult?.recoverableEnvironmentFailure === true;
    const repairsUsed = verifyWithRepairs(taskId, task);
    commitAndPush(taskId, branchName);
    branchPushed = true;
    pr = createPr(taskId, taskFile, branchName, repairsUsed);
    waitForPrChecks(pr.number);
    validatePrBeforeMerge(pr.number, branchName, taskFile, task);
    mergePr(pr.number);
    merged = true;
    cleanupAfterTask(taskId, branchName, taskFile, merged);
    return { taskId, prUrl: pr.url, merged: true, repairsUsed };
  } catch (error) {
    const stop = error instanceof AutomationStop
      ? error
      : new AutomationStop(error.message ?? String(error), "unexpected_failure", { cause: error, hardStop: stopOnFailure });
    stop.localVerificationFailed = stop.localVerificationFailed ?? stop.code === "verification_failure";
    stop.safetyValidationFailed = stop.safetyValidationFailed ?? stop.code === "safety_check_failure";
    stop.managedSandboxFailure = stop.managedSandboxFailure ?? managedSandboxFailure;
    stop.implementationFailure = stop.implementationFailure
      ?? (stop.code === "codex_failure" || (stop.localVerificationFailed && !stop.managedSandboxFailure));
    stop.prUrl = stop.prUrl ?? error.prUrl ?? pr?.url;
    const recoveryMessage = stop.suggestedRecovery ?? failureTaskStatePolicy(branchPushed, Boolean(pr || stop.prUrl));
    stop.message += `\n${recoveryMessage}`;
    stop.suggestedRecovery = recoveryMessage;
    writeFailureLog(stop, {
      taskId,
      taskFile,
      phase: stop.code,
      environmentOnly: stop.environmentOnly ?? false,
      changesProduced: hasTaskRelevantChanges(changedPaths(), task),
      prUrl: stop.prUrl,
      suggestedRecovery: recoveryMessage
    });
    stop.taskId = taskId;
    stop.branchName = branchName;
    stop.prMerged = stop.prMerged ?? error.prMerged ?? merged;
    throw stop;
  }
}

function inspectGitState() {
  try {
    const branchResult = spawnCommand("git", ["branch", "--show-current"], { encoding: "utf8", shell: false });
    const statusResult = spawnCommand("git", ["status", "--porcelain"], { encoding: "utf8", shell: false });
    return {
      branch: branchResult.status === 0 ? branchResult.stdout.trim() || "unknown" : "unknown",
      clean: statusResult.status === 0 ? statusResult.stdout.trim().length === 0 : false
    };
  } catch {
    return { branch: "unknown", clean: false };
  }
}

function hasAutomationSourceChanged(filePath = AUTOMATION_MODULE_PATH, loadedSource = LOADED_AUTOMATION_SOURCE) {
  try {
    return fs.readFileSync(filePath, "utf8") !== loadedSource;
  } catch {
    return true;
  }
}

function printDryRunTaskPlan(taskFile, task) {
    const taskId = getTaskId(taskFile);
    const branchName = `codex/task-${taskId}`;
    console.log(`\n[dry-run] planned task ${taskId}: ${taskFile}`);
    console.log("  1. Verify the working tree is clean and checkout main");
    console.log("  2. Pull origin/main with --ff-only and verify gh authentication");
    console.log(`  3. Create ${branchName} and generate prompts/generated/${taskId}.md`);
    console.log(`  4. Run ${formatCommand("codex", getCodexArgs())} with the prompt on stdin`);
    console.log("  5. Run typecheck, test, and build; use bounded repairs if needed");
    console.log("  6. Commit implementation changes, push, and create an automated PR into main");
    console.log("  7. Keep task state unchanged while the implementation PR is open");
    console.log("  8. Wait for GitHub checks and validate PR head/base metadata");
    console.log("  9. Squash-merge the PR and request remote branch deletion");
    console.log(` 10. Checkout main, pull the merge, move ${taskFile} from backlog to done on main, push that state commit, and continue`);
    void task;
}

function printDryRunPlan() {
  const backlog = listBacklogTasks();
  const dryRunTaskLimit = maxTasks ?? backlog.length;
  const generationPreviewCount = dryRunTaskLimit > 0 ? Math.min(generatedTaskCount, dryRunTaskLimit) : generatedTaskCount;
  let plannedTasks = backlog.slice(0, dryRunTaskLimit).map((fileName) => ({ fileName, task: readTask(fileName) }));
  let emptyBacklogStopReason = null;
  console.log(`[dry-run] mode: ${mode}`);
  console.log(`[dry-run] safety limits: max tasks=${maxTasks === null ? "backlog length" : maxTasks}, max minutes=${Number.isFinite(maxMinutes) ? maxMinutes : "none"}, generation rounds=${maxGenerationRounds}`);

  if (plannedTasks.length === 0) {
    const context = collectProjectPlanningContext();
    const normalTasks = selectRoadmapTasks(context, generationPreviewCount);
    if (mode === "until-stop" && generateTasksWhenEmpty && normalTasks.length > 0 && maxGenerationRounds > 0) {
      const generated = writeGeneratedTaskFiles(normalTasks, { dryRun: true });
      printGeneratedTaskSummary(generated, "[dry-run] would generate");
      plannedTasks = generated.map(({ task, fileName }) => ({ task, fileName }));
    } else if (normalTasks.length > 0) {
      if (mode === "until-stop" && generateTasksWhenEmpty && maxGenerationRounds === 0) {
        console.log("[dry-run] backlog is empty and task generation limit is already reached");
      } else {
        console.log("[dry-run] no backlog tasks remain; normal roadmap generation is available but not enabled for this mode");
      }
      emptyBacklogStopReason = "No backlog tasks remain";
    } else {
      console.log("No normal roadmap tasks remain.");
      const audit = auditProductCompleteness({ context });
      printProductAuditSummary(audit);
      let generated = [];
      if (maxGenerationRounds === 0) {
        console.log("[dry-run] task generation limit is already reached");
      } else {
        generated = generateProductCompletionTasks({ audit, context, dryRun: true, count: generationPreviewCount });
      }
      printProductAuditTaskDecisions(audit, generated.auditPlan);
      console.log(`[dry-run] would generate product-completion tasks: ${generated.map(({ task }) => task.id).join(", ") || "none"}`);
      printGeneratedTaskSummary(generated, "[dry-run] product-completion");
      printUnresolvedAuditGuidance(audit, generated.auditPlan, "[dry-run] ");
      emptyBacklogStopReason = maxGenerationRounds === 0 && !audit.passed
        ? `Product completeness audits failed; task generation limit reached (${maxGenerationRounds})`
        : productCompletionStopReason(audit, generated.length, generated.auditPlan);
      if (mode === "until-stop" && generateTasksWhenEmpty) {
        plannedTasks = generated.map(({ task, fileName }) => ({ task, fileName }));
      }
    }
  }

  if (plannedTasks.length === 0 && emptyBacklogStopReason) console.log(`[dry-run] Stop reason: ${emptyBacklogStopReason}`);
  for (const { fileName, task } of plannedTasks) printDryRunTaskPlan(fileName, task);

  if (backlog.length > plannedTasks.length) console.log(`\n[dry-run] would stop at the max task limit with ${backlog.length - plannedTasks.length} task(s) remaining`);
  else if (mode === "until-stop" && generateTasksWhenEmpty && maxGenerationRounds > 0 && plannedTasks.length > 0) console.log("\n[dry-run] would stop when the generation-round or task/runtime limit is reached");
  else console.log("\n[dry-run] would stop when the backlog is empty");
  console.log("[dry-run] no commands or repository mutations were performed");
  return emptyBacklogStopReason ?? "Dry-run plan completed without mutations";
}

function buildLoopSummaryLines(summary, gitState = inspectGitState(), elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1)) {
  const lines = [
    "Automation loop summary",
    `Mode: ${summary.mode}`,
    `Completed task IDs: ${summary.completedTaskIds.join(", ") || "None"}`,
    `Failed task ID: ${summary.failedTaskId ?? "None"}`,
    `Stop reason: ${summary.stopReason}`,
    `Elapsed time: ${elapsedSeconds}s`,
    `Current branch: ${gitState.branch}`,
    `Working tree clean: ${gitState.clean ? "yes" : "no"}`,
    `Existing PR URL: ${summary.existingPrUrl ?? "None"}`,
    `PR URLs created: ${summary.prUrls.join(", ") || "None"}`,
    `PRs merged: ${summary.mergedPrUrls.join(", ") || "None"}`,
    `Generated task IDs: ${summary.generatedTaskIds.join(", ") || "None"}`,
    `Local verification failed: ${summary.localVerificationFailed ? "yes" : "no"}`,
    `PR metadata validation failed: ${summary.safetyValidationFailed ? "yes" : "no"}`,
    `Task branch behind main: ${summary.branchBehindMain ? "yes" : "no"}`,
    `Generated tasks skipped because broader work covers them: ${summary.skippedCoveredTasks.join(", ") || "None"}`
  ];
  if (summary.auditGenerationBlocked !== null && summary.auditGenerationBlocked !== undefined) {
    lines.push(
      `All failing audit gaps blocked by pending duplicates: ${summary.auditGenerationBlocked ? "yes" : "no"}`,
      `Done duplicates whose audits still fail: ${summary.doneAuditDuplicates.join(", ") || "None"}`,
      "Audit generation dry-run: node scripts/auto-dev-cycle.mjs --dry-run --generate-tasks",
      "Next action: create remediation/investigation tasks for unblocked gaps, finish any listed pending task/branch, or fix the audit mapping."
    );
  }
  return lines;
}

function printLoopSummary(summary) {
  console.log(`\n${buildLoopSummaryLines(summary).join("\n")}`);
}

function runLoop() {
  const summary = {
    mode,
    completedTaskIds: [],
    failedTaskId: null,
    stopReason: "Not started",
    prUrls: [],
    mergedPrUrls: [],
    generatedTaskIds: [],
    existingPrUrl: null,
    localVerificationFailed: false,
    safetyValidationFailed: false,
    branchBehindMain: false,
    skippedCoveredTasks: [],
    auditGenerationBlocked: null,
    doneAuditDuplicates: []
  };

  if (dryRun) {
    summary.stopReason = printDryRunPlan();
    if (mode !== "single") printLoopSummary(summary);
    return summary;
  }

  let effectiveMaxTasks = maxTasks;
  let generationRounds = 0;

  try {
    while (true) {
      if (Date.now() >= deadline) {
        summary.stopReason = `Max runtime limit reached (${maxMinutes} minutes)`;
        break;
      }

      ensureCleanGit();
      ensureOnMain();
      pullMain();
      if (hasAutomationSourceChanged()) {
        summary.stopReason = "Automation source changed during this run; rerun automation before processing or generating more tasks";
        break;
      }
      const backlog = listBacklogTasks();
      if (effectiveMaxTasks !== null && summary.completedTaskIds.length >= effectiveMaxTasks) {
        summary.stopReason = `Max task limit reached (${effectiveMaxTasks})`;
        break;
      }
      if (backlog.length === 0) {
        const context = collectProjectPlanningContext();
        const normalTasks = selectRoadmapTasks(context, generatedTaskCount);
        if (normalTasks.length > 0) {
          if (mode === "until-stop" && generateTasksWhenEmpty) {
            if (generationRounds >= maxGenerationRounds) {
              summary.stopReason = `No backlog tasks remain and task generation limit reached (${maxGenerationRounds})`;
              break;
            }
            const generated = writeGeneratedTaskFiles(normalTasks);
            commitAndPushGeneratedTasks(generated);
            printGeneratedTaskSummary(generated);
            summary.generatedTaskIds.push(...generated.map(({ task }) => task.id));
            generationRounds += 1;
            continue;
          }
          summary.stopReason = "No backlog tasks remain";
          break;
        }

        console.log("No normal roadmap tasks remain.");
        const audit = auditProductCompleteness({ context });
        printProductAuditSummary(audit);
        if (audit.passed) {
          summary.stopReason = productCompletionStopReason(audit, 0);
          break;
        }
        if (generationRounds >= maxGenerationRounds) {
          summary.stopReason = `Product completeness audits failed; task generation limit reached (${maxGenerationRounds})`;
          break;
        }

        const generated = generateProductCompletionTasks({ audit, context });
        summary.skippedCoveredTasks.push(...(generated.dependencySuppression?.skippedTitles ?? []));
        printProductAuditTaskDecisions(audit, generated.auditPlan);
        console.log(`Generated product-completion tasks: ${generated.map(({ task }) => task.id).join(", ") || "none"}`);
        if (generated.length === 0) {
          summary.auditGenerationBlocked = generated.auditPlan.decisions.every((entry) => /blocked/iu.test(entry.decision));
          summary.doneAuditDuplicates = [...new Set(generated.auditPlan.decisions
            .flatMap((entry) => entry.duplicates ?? (entry.duplicate ? [entry.duplicate] : []))
            .filter((duplicate) => duplicate.taskState === "done")
            .map((duplicate) => `${duplicate.id} ${duplicate.title}`))];
          printUnresolvedAuditGuidance(audit, generated.auditPlan);
          summary.stopReason = productCompletionStopReason(audit, 0, generated.auditPlan);
          break;
        }
        commitAndPushGeneratedTasks(generated);
        printGeneratedTaskSummary(generated, "Generated product-completion");
        summary.generatedTaskIds.push(...generated.map(({ task }) => task.id));
        generationRounds += 1;
        if (mode === "until-stop" && generateTasksWhenEmpty) continue;
        summary.stopReason = productCompletionStopReason(audit, generated.length, generated.auditPlan);
        break;
      }
      if (effectiveMaxTasks === null) effectiveMaxTasks = backlog.length;
      ensureGhReady();

      const taskFile = backlog[0];
      console.log(`\nSelected task: ${taskFile}`);
      try {
        const result = runOneTask(taskFile);
        summary.completedTaskIds.push(result.taskId);
        summary.prUrls.push(result.prUrl);
        if (result.recovered) summary.existingPrUrl = result.prUrl;
        if (result.merged) summary.mergedPrUrls.push(result.prUrl);
      } catch (error) {
        summary.failedTaskId = error.taskId ?? getTaskId(taskFile);
        summary.stopReason = error.message;
        summary.existingPrUrl = error.prUrl ?? summary.existingPrUrl;
        summary.localVerificationFailed = error.localVerificationFailed === true;
        summary.safetyValidationFailed = error.safetyValidationFailed === true;
        summary.branchBehindMain = error.branchBehindMain === true;
        if (error.prUrl) summary.prUrls.push(error.prUrl);
        if (error.prUrl && error.prMerged) summary.mergedPrUrls.push(error.prUrl);
        if (stopOnFailure || error.hardStop || mode === "all") process.exitCode = 1;
        break;
      }

      if (mode === "single") {
        summary.stopReason = "Single task completed";
        break;
      }
    }
  } catch (error) {
    summary.stopReason = error.message ?? String(error);
    if (mode === "single") console.error(summary.stopReason);
    process.exitCode = 1;
  }

  if (mode !== "single" || summary.failedTaskId) printLoopSummary(summary);
  return summary;
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === AUTOMATION_MODULE_PATH;

if (isMainModule) {
  try {
    if (mode === "generate-tasks") runGenerateTasksMode();
    else runLoop();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

export {
  auditProductCompleteness,
  branchBehindMainRecoveryGuidance,
  buildFailureLogContent,
  buildExistingPrRecoverySummary,
  buildLoopSummaryLines,
  buildTaskYaml,
  autoMergePolicyDecision,
  canContinueWithoutPrChecks,
  canMoveTaskToDone,
  collectProjectPlanningContext,
  existingTaskRecoveryAction,
  failureTaskStatePolicy,
  generateBacklogTasks,
  generateProductCompletionTasks,
  getNextTaskId,
  guardDirtyTaskStateOnTaskBranch,
  hasAutomationSourceChanged,
  hasTaskRelevantChanges,
  isWorkingTreeCleanStatus,
  isRecoverableCodexSandboxVerificationFailure,
  isBranchBehindOriginMain,
  isNoPrChecksReported,
  listExistingTaskIds,
  npmCommand,
  normalizeTitle,
  planProductCompletionTasks,
  prMergeSafetyDecision,
  productCompletionStopReason,
  prChecksFailurePolicy,
  productTaskDependencySuppression,
  selectRoadmapTasks,
  selectProductCompletionTasks,
  shouldContinueAfterCodexFailure,
  verifyRecoveredBranch,
  writeGeneratedTaskFiles
};
