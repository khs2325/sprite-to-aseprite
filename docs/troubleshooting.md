# Troubleshooting

Use this guide when conversion fails, the download does not appear, or the
generated `.aseprite` file does not open as expected. File processing remains
browser-only: selected artwork and metadata are read in the tab, converted in
the tab, and downloaded from the tab. There is no server upload, remote
image-processing fallback, or telemetry path for diagnosing private files.

## Start With The Input

Check the selected import mode before changing the source file. Each mode
expects a specific file combination:

- PNG sequence: one or more valid PNG files with the same dimensions.
- Spritesheet grid: exactly one valid PNG and grid settings that cover the
  image exactly.
- Spritesheet PNG + JSON: exactly one PNG and one supported atlas JSON file.
- Piskel, OpenRaster, Pixelorama, Krita, PSD, GIF, or APNG: exactly one source
  file from the documented supported subset for that format.

If the file extension is not listed in the supported formats, the converter
does not currently import it. A renamed file is still unsupported if its
contents do not match the expected format. For the current support matrix, see
[supported-formats.md](supported-formats.md).

## Invalid Or Corrupted Files

A file can have the right extension and still be invalid. Common causes are
zero-byte files, incomplete downloads, files copied before an editor finished
saving them, or files with valid container metadata but damaged image payloads.

Try these checks:

- open the source in the program that created it and export a fresh copy;
- confirm PNG sequences use the same canvas width and height for every frame;
- confirm a spritesheet grid has no leftover edge pixels outside the configured
  rows and columns;
- redownload or recopy a source file that came from another machine or cloud
  service; and
- avoid editing JSON or archive contents by hand unless the resulting file
  still matches the documented subset.

The converter rejects malformed files instead of trying to guess missing pixel
or metadata values.

## Malformed Metadata

Spritesheet JSON and project containers must describe frame data consistently.
For atlas JSON, the supported path is a non-empty root-level `frames` array or
object map with valid frame rectangles. Durations must be positive when
present. Rotated and trimmed frames need complete, consistent placement
metadata, and every resulting frame canvas must have the same dimensions.

For project formats such as Piskel, OpenRaster, Pixelorama, Krita, and PSD,
metadata is accepted only when it matches the documented supported subset.
Unsupported schema variants, impossible dimensions, inconsistent frame or layer
coverage, malformed embedded images, or unsupported color/layer records are
rejected rather than silently converted.

## Unsupported Or Hidden Source Features

The converter rebuilds timelines and converts frames through `SpriteProject`.
It preserves layers only when the source format contains layer data and the
importer supports that data. PNG sequences, spritesheets, GIF, and APNG are
flat sources for this app, so original source layers cannot be recovered from
them.

Some source features are intentionally unsupported, including effects, masks,
groups, non-normal blend modes, tilemaps, smart objects, adjustment layers,
unsupported color modes, and editor-only metadata unless a specific format page
documents support. Hidden or unsupported source state may be skipped, rejected,
or omitted according to that format's documentation. When a feature is required
for your workflow, export a simpler supported raster version from the source
editor and verify the rebuilt timeline in Aseprite.

## Browser Memory Limits

Large conversions can fail even when the source file is small on disk. Browser
memory usage is driven by decoded pixels, frame count, layer count, working
buffers, previews, and the generated `.aseprite` bytes. A decoded RGBA image
costs roughly `width x height x 4` bytes before conversion overhead.

If conversion slows down, fails, reloads the tab, or crashes the browser:

- close other memory-heavy tabs and applications;
- retry in an up-to-date 64-bit desktop browser;
- crop unused transparent space or reduce canvas dimensions before importing;
- split long animations into smaller batches; and
- reduce layer or frame count for layered source formats.

There is no server upload fallback for oversized files. More detail is in
[browser-memory-limits.md](browser-memory-limits.md).

## Download Does Not Start

The `.aseprite` download is generated locally by the browser after conversion
succeeds. If selecting **Download .aseprite** does not produce a file:

- check the browser downloads list and default downloads folder for
  `sprite-project.aseprite`;
- allow downloads for the local app page if the browser blocked repeated or
  automatic downloads;
- temporarily disable extensions that block downloads, Blob URLs, or local
  development pages;
- confirm the conversion result is still present after changing import modes or
  clearing selected files; and
- try the download in a regular browser window if a private or restricted
  profile blocks generated files.

Do not upload artwork to an external service just to work around a browser
download block.

## Google Search Console Cannot Fetch The Sitemap

If `https://sprite-to-aseprite.pages.dev/sitemap.xml` returns `200 OK`, an
`application/xml` content type, and a valid XML body with the sitemap
namespace, the deployed sitemap is reachable. Search Console can still show an
older **Couldn't fetch** or **Sitemap could not be read** state until Google
reprocesses a sitemap that previously failed, for example after a byte-order
mark or malformed response was fixed.

After deploying a fixed sitemap:

1. In Search Console, open **Indexing > Sitemaps**.
2. Delete the old sitemap submission if it is still listed as failed.
3. Submit `https://sprite-to-aseprite.pages.dev/sitemap.xml` again.
4. Do not use **Request indexing** for `/sitemap.xml`; that tool is for pages,
   not sitemap submissions.
5. If it still fails, use **URL Inspection > Test live URL** for
   `/sitemap.xml` and check **Page fetch** plus **Crawl allowed?**.

The repository keeps `public/sitemap.xml` and `public/robots.txt` free of a
UTF-8 BOM, and the production build must preserve those files exactly. The
robots file should allow crawling and point to:
`https://sprite-to-aseprite.pages.dev/sitemap.xml`.

## Aseprite Open Failures

If Aseprite cannot open the generated file, first confirm that the downloaded
file is complete and has the `.aseprite` extension. Then open it with
**File > Open** in Aseprite and record the exact error message and Aseprite
version.

When the file opens but looks wrong, compare the output against the app's
preview and the source:

- frame count and frame order;
- frame durations, especially non-default durations;
- canvas dimensions;
- layer names, order, visibility, and opacity when the source format contains
  supported layer data; and
- representative transparent, partially transparent, first-frame, last-frame,
  and edge pixels.

For a compatibility check, make a small edit in Aseprite, use
**File > Save As** to a new file, and reopen that copy. This verifies editability
for that generated file and Aseprite version; it is not proof of lossless
conversion or support for every source feature.

## Reporting A Problem Safely

Do not share private artwork to report a problem. Share only the smallest
original reproduction file or files needed to reproduce the issue, and only
when those files are safe to disclose. A newly created minimal sprite, tiny
atlas, or simplified project file is usually better than a real production
asset.

Useful reports include:

- converter revision or release, browser, operating system, and Aseprite
  version;
- import mode and conversion settings;
- exact converter diagnostic or exact Aseprite open error;
- source dimensions, expected frame count, expected timing, and expected layer
  behavior; and
- the minimal original reproduction file set, plus the generated `.aseprite`
  file only if it is also safe to share.

Attaching files to GitHub issues, support requests, cloud drives, chat tools,
or other services is separate from browser-local conversion and is governed by
those services.
