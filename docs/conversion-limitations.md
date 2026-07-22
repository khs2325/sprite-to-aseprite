# Conversion Limitations Matrix

This matrix summarizes what the converter can and cannot preserve when it
converts supported or planned formats through `SpriteProject`. It is a
preservation guide, not a lossless-conversion claim. Unsupported source data is
rejected clearly or documented as omitted when it does not affect the converted
project.

Artwork and metadata stay in the browser. The converter does not upload source
files to a server or send them to a remote image-processing service.

## Current Supported Inputs

| Input | Layers | Frames | Timing | Effects | Masks | Groups | Palettes | Metadata |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PNG sequence | No source layer data; creates one `Main` layer. | One frame per PNG; all images must share dimensions. | Configurable duration, default 100 ms. | Not present in flat PNGs. | Not present in flat PNGs. | Not present in flat PNGs. | Palette identity is not preserved; pixels become RGBA. | No editor metadata is preserved. |
| Spritesheet grid | No source layer data; creates one `Main` layer. | Grid cells become frames; grid must exactly cover the image. | Default 100 ms per frame. | Not present in flat spritesheets. | Not present in flat spritesheets. | Not present in flat spritesheets. | Palette identity is not preserved; pixels become RGBA. | Grid settings are conversion inputs, not restored editor metadata. |
| Spritesheet PNG + JSON | No source layer data; creates one `Main` layer. | Supported rectangles, trim, and common clockwise rotation are rebuilt. | Per-frame durations are supported; missing values default to 100 ms. | Not preserved. | Not preserved. | Not preserved. | Palette identity is not preserved; pixels become RGBA. | Only the documented frame rectangle, duration, trim, rotation, and supported tag subset is interpreted. Other atlas metadata is not preserved. |
| Piskel `.piskel` | Preserves supported source layers only when present in the documented subset. | Visible frames are converted; hidden frames are skipped and remaining frames are reindexed. | Global FPS becomes one duration for every converted frame; per-frame source durations are not supported. | Not preserved. | Not preserved. | Not preserved. | Palette identity is not preserved; decoded pixels become RGBA. | Project name and description are validated but not exported; other editor state is not preserved. |
| OpenRaster `.ora` | Preserves supported normal PNG-backed raster layers only. | Single-frame subset only; animation is unsupported. | No animation timing is preserved. | Not preserved. | Not preserved. | Not preserved. | Palette identity is not preserved; decoded pixels become RGBA. | Animation data, nested stack semantics, flattened previews, and other editor metadata are not preserved. |
| Pixelorama `.pxo` | Preserves supported normal raster pixel layers only. | Supported frames and full-canvas cels are converted. | Supported frame timing is converted from the documented subset. | Not preserved. | Not preserved. | Group, 3D, audio, tilemap, and unsupported layer types are not preserved. | Palettes are not preserved. | Guides, reference images, linked cels, and arbitrary editor metadata are not preserved. |
| Pixilart `.pixil` | Preserves names, order, opacity, and pixels for supported 2.7.0 `source-over` layers. `active` is not treated as visibility. | Frame-array order with one full-canvas embedded PNG per logical layer is converted. | Positive integer `speed` is interpreted as milliseconds and normalized to the Aseprite output range. | Not preserved; unsupported blends are rejected. | Not preserved. | Not preserved. | Palettes are not preserved; decoded PNG pixels become RGBA. | Only the observed genuine 2.7.0 structure is supported. Other versions, editor metadata, ambiguous identity, effects, external data, and non-PNG payloads are not preserved. Conversion is not guaranteed lossless. |
| Krita `.kra` | Preserves supported 8-bit RGBA paint layers only. | Single-frame subset only; animation timelines are unsupported. | No animation timing is preserved. | Not preserved. | Not preserved. | Not preserved. | Palette and color-profile identity are not preserved. | Flattened previews, vector data, and other editor metadata are not used to recover source layers. |
| PSD `.psd` input | Preserves supported RGB 8-bit raster layers only. | Single-frame subset only; timeline animation is unsupported. | No PSD timeline timing is preserved. | Not preserved. | Not preserved. | Not preserved. | Palette and color-profile identity are not preserved. | Text, smart objects, adjustment layers, linked files, embedded objects, clipping, PSB data, and Photoshop metadata are unsupported. |
| GIF `.gif` | No editable source layer data; rebuilds frames on one generated layer. | Supported frames, offsets, transparency, and disposal behavior are rebuilt. | Supported frame timing is converted. | Not preserved. | Not preserved. | Not preserved. | GIF palette identity is not preserved; pixels become RGBA. | Unsupported extensions and editor metadata are not preserved. |
| APNG `.apng` or animated `.png` | No editable source layer data; rebuilds frames on one generated layer. | Supported frames, offsets, blending, and disposal behavior are rebuilt. | Supported frame timing is converted. | Not preserved. | Not preserved. | Not preserved. | Palette-based APNG input is unsupported; converted pixels are RGBA. | Extra chunks and editor metadata are not preserved. |

## Planned Or Future Paths

| Path | Layers | Frames | Timing | Effects | Masks | Groups | Palettes | Metadata |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Future Aseprite input and bidirectional paths | Only normal layers represented by `SpriteProject` can be preserved unless the model, importer, exporter, and tests expand together. | Frames can be converted when decoded into the shared model; unsupported chunks are not round-tripped. | Frame durations and supported tags can be preserved only for paths that document and test them. | Not preserved until explicitly modeled and exported. | Not preserved until explicitly modeled and exported. | Not preserved until explicitly modeled and exported. | Indexed palette identity is not preserved by the current model. | Raw chunk order, UUIDs, user data, color profiles, slices, tilesets, and editor-only metadata are outside the current model. |
| Planned PNG sequence output | Output is flattened rendered frames, not editable layers. | One image per exported frame. | PNG files do not carry animation timing; any timing manifest must be separately specified and tested. | Not preserved. | Not preserved. | Not preserved. | Palette identity is not preserved by the planned RGBA frame output. | Filenames or optional manifests may carry limited data, but editor metadata is not preserved. |
| Planned spritesheet PNG + JSON output | Output is a flattened sheet, not editable layers. | Planned fixed-grid output writes rendered frame rectangles. | JSON timing may be written only for a documented exporter subset. | Not preserved. | Not preserved. | Not preserved. | Palette identity is not preserved by the planned RGBA output. | Only documented atlas metadata would be emitted; source editor metadata is not preserved. |
| Planned GIF/APNG output | Output is flattened animation, not editable layers. | Frames must fit encoder-specific limits and disposal/blending rules. | Timing may be clamped or quantized according to each format and implementation. | Not preserved. | Not preserved. | Not preserved. | Palette identity is not preserved; GIF output may require a generated palette. | Editor metadata is not preserved. |
| Future PSD output | Planned as a narrow static layered PSD subset, not `.aseprite` to PSD fidelity. | First useful subset should export one selected frame or one static frame document. | Aseprite frame durations, tags, and Photoshop timeline metadata are out of scope for the first PSD writer. | Not preserved. | Not preserved. | Not preserved. | Palette and color-profile identity are not preserved. | Smart objects, adjustment layers, text editability, layer comps, linked files, and Photoshop-private metadata are out of scope. |

## Flat-Image Layer Recovery

PNG sequences, spritesheets, GIF, and APNG contain rendered pixels rather than
editable source layer structure. They can rebuild timeline frames and convert
frames, but the converter cannot recover original layers, effects, masks,
groups, palettes, or editor metadata that are absent from the source.

Project formats such as Piskel, OpenRaster, Pixelorama, Pixil/Pixilart, Krita,
and PSD can preserve layers only when the source file contains layer data and the importer
supports that documented subset. A flattened preview or composite image is not
used to reconstruct missing source layers.

## Bidirectional Caveats

Future bidirectional conversion can preserve only the intersection represented
by the importer, `SpriteProject`, and the selected exporter. Aseprite, PSD, PNG
sequences, spritesheets, GIF, and APNG expose different feature sets, so a round
trip may keep frame pixels and selected timing or layer data while dropping
unsupported tags, palettes, effects, masks, groups, color profiles, and editor
metadata.

Future PSD output should be described as supported layered raster interchange
for a documented subset, not as lossless `.aseprite` round-trip conversion or
Photoshop project reconstruction.
