# Output Format Selector Plan

Status: planning only. Do not add UI controls or exporters from this note alone.

The current product exports `.aseprite` files from a browser-local
`SpriteProject`. A future output selector should keep that boundary: importers
produce `SpriteProject`, exporters consume `SpriteProject`, and downloads are
created as local `Blob` objects without uploading artwork.

## UX

Show output format as a single selector near the download action after a
project has been converted. The default selection is Aseprite because it is the
current implemented export path and best matches the product goal of rebuilding
an editable Aseprite timeline.

Each option should have a short capability note:

| Output | State | User-facing note |
| --- | --- | --- |
| Aseprite `.aseprite` | Enabled when a valid `SpriteProject` exists. | Editable Aseprite timeline. |
| PNG sequence | Disabled until implemented. | Export one flattened PNG per frame. |
| Spritesheet PNG | Disabled until implemented. | Export frames arranged on one flattened sheet. |
| GIF | Disabled until implemented. | Export animated frames with GIF timing limits. |
| APNG | Disabled until implemented. | Export animated PNG frames where browser support allows download. |
| PSD `.psd` | Research-only and disabled. | Research target for layered raster interchange; no support promised. |

Do not describe any option as perfect, universal, or able to recover layers
from flat sources. Flat outputs such as PNG sequence, spritesheet, GIF, and APNG
may flatten visible layers for each frame. Layered output formats may preserve
layers only when the `SpriteProject` contains layer data that the exporter
explicitly supports.

## Disabled States

The selector may show planned formats before implementation, but the download
button must stay disabled for any selected format without a registered exporter.
Disabled options should explain the reason in product terms, such as
`PNG sequence export is planned but not available yet`.

All outputs are disabled until conversion produces a valid `SpriteProject`.
Format-specific exporters may also disable download when the project exceeds
their documented limits, such as GIF palette or timing constraints, APNG encoder
scope, spritesheet dimensions, frame count, or unsupported layer behavior.

Research-only PSD must stay disabled until a separate feasibility task defines
the writer subset, browser-local implementation strategy, fixtures, validation,
and copy. It must not imply bidirectional PSD conversion.

## Architecture

Introduce an output registry only when the second exporter is implemented. The
registry should be data, not UI branching:

```ts
type OutputFormat = {
  id: string;
  label: string;
  extension: string;
  implemented: boolean;
  exportProject?: (project: SpriteProject) => Promise<Blob>;
};
```

Exporter modules should remain independent from importers and UI components.
Each exporter validates the `SpriteProject` fields it can encode and returns a
clear, safe diagnostic for unsupported output conditions. UI code should only
choose a format, call the registered exporter, create a local object URL, start
the download, and revoke the URL.

## Implementation Sequence

1. Add static selector copy with only Aseprite enabled, plus disabled planned
   options and tests for disabled messaging.
2. Refactor the existing Aseprite download path behind an output registry
   without changing generated `.aseprite` bytes.
3. Add PNG sequence export because it is the smallest flattened output and can
   exercise multi-file download packaging decisions.
4. Add spritesheet PNG export with explicit grid layout, max-canvas limits, and
   tests for frame order.
5. Add GIF export only after documenting palette, timing, frame-count, and
   transparency limits.
6. Add APNG export only after documenting encoder scope, chunk validation,
   timing, disposal/blend behavior, and browser download behavior.
7. Keep PSD as research-only until a separate writer feasibility note proves a
   narrow browser-local subset and fixture strategy.

Each implementation task should update product copy, architecture notes, core
exporter tests, and UI disabled/enabled states together. Binary writer changes
need golden or structural tests before the option can be enabled.
