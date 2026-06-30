# AdSense readiness

AdSense is not active yet on Sprite to Aseprite Converter.

This project currently includes only informational policy sections. It does not
load the Google AdSense script, analytics, tracking scripts, fake ads, ad
placeholders, or any backend.

## Before live ads are added

- Use [adsense-review-checklist.md](adsense-review-checklist.md) before
  requesting review or enabling any ad code.
- The site needs an approved Google AdSense account before live ads are added.
- The future AdSense publisher ID should not be hardcoded until it is available.
- Add `ads.txt` later after the AdSense publisher ID is known.
- Before requesting review, verify the deployed static page reaches About
  (`#about`), Contact (`#contact`), Privacy Policy (`#privacy-policy`), Terms
  (`#terms`), Guides (`#guides`), Browser-local conversion guide
  (`#browser-local-conversion-guide`), Supported formats guide
  (`#supported-formats-guide`), and Conversion limitations guide
  (`#conversion-limitations-guide`).
- Keep the browser-local conversion promise accurate: files are processed in
  the browser and are not uploaded to a project server for conversion.
- Keep payment handling off-site through external support providers only; this
  site does not process payment information.
- Review any proposed ad placeholder in the live converter UI before release.
  If it is confusing, unnecessary, too close to conversion controls, or
  distracts from selecting files, converting frames, or downloading output,
  hide it or remove it.

## Placement rules

Ads must not be placed near:

- file picker controls;
- drag-and-drop areas;
- Convert buttons;
- Download buttons;
- Support buttons or support provider links;
- error messages;
- selected/private file information; or
- any control where users may accidentally activate an ad.

Acceptable future placements include:

- below guide content;
- between guide sections with enough spacing; or
- near the bottom of the main page, away from converter controls.

Do not add visible ad placeholders until the final ad layout is ready for
review. Future placeholders or live ads must remain clearly separated from
converter controls and must not show fake ads or encourage ad interaction.

Safety invariant: ad elements must stay outside import, selected-file,
private-file, error, conversion, download, and support UI regions. The
DOM-free AdSense readiness tests enforce this invariant for future ad markup
such as ad placeholders, `adsbygoogle` elements, or `data-ad-*` elements.

## Content accuracy

Do not claim perfect or lossless conversion. Do not claim flat images can recover
original source layers. Supported project formats may preserve supported raster
layer data only when the source format contains that data and the documented
importer subset supports it.
