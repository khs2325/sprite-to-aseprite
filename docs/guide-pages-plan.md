# Guide Pages Plan

This plan defines future format-specific guide pages for the static site. It
does not add routes, keyword work, testimonials, or new examples.

Guide pages should help users choose the correct browser-local conversion mode,
understand what can be preserved, and verify a generated `.aseprite` file
without overstating support.

## Source Of Truth

Before creating or updating any guide page, check:

- `docs/supported-formats.md` for current support status and status wording.
- The format note linked from that matrix for the documented supported subset.
- `docs/manual-usage-guide.md` for user-facing workflow and verification
  language.
- `docs/privacy-browser-local.md` and `docs/browser-memory-limits.md` for
  privacy and memory-limit language.

If these sources disagree, update the source docs first in a separate scoped
task before publishing or changing a guide page.

## Planned Pages

Create one small docs or route task per page. Each page should link back to the
manual usage guide, supported formats matrix, and the relevant format note.

| Page | Status label to show | Main purpose |
| --- | --- | --- |
| PNG sequence to Aseprite | Supported subset | Explain how separate PNG frames are ordered, timed, and converted into one generated layer. |
| Spritesheet grid to Aseprite | Supported subset | Explain exact grid slicing, row/column order, and why the grid must cover the full image. |
| Spritesheet JSON to Aseprite | Supported subset | Explain the supported Aseprite-style atlas subset, frame durations, tags, trimmed frames, and supported TexturePacker rotation. |
| Piskel to Aseprite | Supported subset | Explain browser-local `.piskel` import, visible-frame handling, global-FPS timing, and supported layer preservation. |
| OpenRaster to Aseprite | Supported subset | Explain the single-frame `.ora` raster-layer subset and unsupported groups, masks, effects, and animation. |
| Pixelorama to Aseprite | Supported subset | Explain supported `.pxo` raster frames, timing, and unsupported tilemaps, effects, layer types, and metadata. |
| Krita to Aseprite | Supported minimal subset | Explain supported one-frame paint-layer import and unsupported Krita masks, vectors, animation, effects, and flattened previews. |
| GIF to Aseprite | Supported subset | Explain rebuilding frames, timing, transparency, offsets, and disposal into one generated layer. |
| APNG to Aseprite | Supported subset | Explain animated PNG requirements, timing, offsets, blending, disposal, and static PNG rejection in APNG mode. |
| PSD to Aseprite | Supported subset for input | Explain the current RGB 8-bit one-frame raster-layer subset and make clear this is not full Photoshop compatibility. |
| Future PSD compatibility | Planned or research-only until implemented | Track broader PSD input, PSD output, or flat-composite fallback ideas without presenting them as available conversion paths. |

Do not create pages for planned formats as though they are available. If a
future format has only research or feasibility notes, its page must use
`Research-only` or `Planned` wording from `docs/supported-formats.md` and avoid
step-by-step conversion instructions until UI support exists.

## Required Sections Per Page

Each format guide should include:

- Current status using the exact status terms from `docs/supported-formats.md`.
- Browser-local privacy statement: selected artwork and metadata are processed
  in the browser and not uploaded to a project server for conversion.
- Supported input requirements, including file count and required companion
  files.
- What the importer converts into `SpriteProject`: frames, timing, tags, layer
  names, visibility, opacity, offsets, or pixel data as applicable.
- Limitations and unsupported features, including memory limits when relevant.
- Layer accuracy note:
  - Flat PNG sequences, spritesheets, GIF, and APNG cannot recover original
    editable layers.
  - Layers may be preserved only when the source format contains supported
    layer data and the importer preserves it.
- Fixture-safe example policy: examples must use synthetic, minimal assets or
  documented fixtures that are safe to publish. Do not use private artwork,
  downloaded sample art, copyrighted game sprites, user files, fake customer
  examples, or testimonials.
- Manual verification checklist that tells users to compare frame count, frame
  order, timing, canvas size, and supported layers in Aseprite.

## Accuracy Checks

Run these checks before publishing a guide page:

1. Confirm the page does not claim conversion is lossless, perfect, universal,
   or able to recover layers from a flat source.
2. Confirm flat formats use wording such as "rebuild timeline" and "convert
   frames" rather than source-layer preservation.
3. Confirm layered formats use wording such as "preserve layers when the source
   format contains layer data" and name the supported subset.
4. Confirm planned, research-only, and unsupported formats are clearly labeled
   and do not include working conversion steps.
5. Confirm privacy language says browser-local processing and does not imply
   server upload, cloud conversion, or remote image processing.
6. Confirm examples are fixture-safe and do not include private, user-provided,
   scraped, or testimonial content.
7. Confirm PSD wording separates current PSD input support from future broader
   Photoshop compatibility, PSD output, or fallback ideas.
8. Confirm the page has no Korean SEO keyword optimization task, keyword list,
   hidden keyword text, or search-ranking claims.

## Small Follow-Up Tasks

Break implementation into small tasks:

1. Add a static guide-page template or docs outline without routing changes.
2. Add one supported-format guide page at a time.
3. Add route entries only after the matching page copy passes the accuracy
   checks.
4. Add planned-format placeholder pages only when they are clearly useful, and
   keep them labeled as planned or research-only.
5. Update `docs/supported-formats.md` first whenever a format moves between
   planned, research-only, unsupported, and supported subset status.
