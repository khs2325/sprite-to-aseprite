# AdSense readiness

AdSense is not active yet on Sprite to Aseprite Converter.

This project currently includes only informational policy sections. It does not
load the Google AdSense script, analytics, tracking scripts, fake ads, ad
placeholders, or any backend.

## Before live ads are added

- The site needs an approved Google AdSense account before live ads are added.
- The future AdSense publisher ID should not be hardcoded until it is available.
- Add `ads.txt` later after the AdSense publisher ID is known.
- Keep the browser-local conversion promise accurate: files are processed in
  the browser and are not uploaded to a project server for conversion.
- Keep payment handling off-site through external support providers only; this
  site does not process payment information.

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

## Content accuracy

Do not claim perfect or lossless conversion. Do not claim flat images can recover
original source layers. Supported project formats may preserve supported raster
layer data only when the source format contains that data and the documented
importer subset supports it.
