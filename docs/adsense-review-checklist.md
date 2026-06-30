# AdSense review checklist

Use this checklist before requesting AdSense review or before enabling any ad
code. It prepares the static site for review without adding live ads,
analytics, tracking, fake traffic, or testimonial claims.

## Content

- [ ] The home page clearly describes the tool as Sprite to Aseprite Converter.
- [ ] Conversion wording says the app can rebuild timelines and convert frames
  into `.aseprite` files.
- [ ] The site does not claim perfect, guaranteed, or lossless conversion.
- [ ] Flat PNG sequences, spritesheets, GIF, and APNG are described as rendered
  frame sources, not editable layer sources.
- [ ] The site does not claim that layers can be recovered from a flat PNG.
- [ ] Layer wording says layers are preserved only when the source format
  contains layer data and the supported importer preserves it.
- [ ] Browser-local conversion claims are visible and accurate: selected source
  files are processed in the browser and are not uploaded to a project server
  for conversion.
- [ ] Limitations are visible before review, including unsupported source
  features, browser memory limits, and the difference between converting frames
  and reconstructing absent source data.

## Navigation

- [ ] The deployed page loads over HTTPS without broken JavaScript or CSS assets.
- [ ] The About section is reachable from normal page navigation and `#about`.
- [ ] The Contact section is reachable from normal page navigation and
  `#contact`.
- [ ] The Privacy Policy section is reachable from normal page navigation and
  `#privacy-policy`.
- [ ] The Terms section is reachable from normal page navigation and `#terms`.
- [ ] The Guides section is reachable from normal page navigation and `#guides`.
- [ ] The browser-local conversion guide is reachable at
  `#browser-local-conversion-guide`.
- [ ] The supported formats guide is reachable at `#supported-formats-guide`.
- [ ] The conversion limitations guide is reachable at
  `#conversion-limitations-guide`.

## Policy Pages

- [ ] About content identifies what the site does and does not imply an
  unverified company, team, endorsement, or user base.
- [ ] Contact content provides a real way to report bugs, policy issues,
  security concerns, or support problems.
- [ ] Privacy wording states that artwork and metadata selected for conversion
  stay in the browser and are not uploaded for conversion.
- [ ] Privacy wording distinguishes browser-local conversion from ordinary
  static-host requests for HTML, JavaScript, CSS, images, and other bundled
  assets.
- [ ] Privacy wording does not say ads, analytics, tracking, or payment
  processing are active unless those features are actually deployed.
- [ ] Terms content does not promise uninterrupted service, guaranteed file
  compatibility, or complete recovery of source data.
- [ ] Any optional support wording says support is voluntary and does not unlock
  hidden conversion functionality.

## Deployment

- [ ] Deploy only generated static assets; do not publish repository source,
  tests, fixtures, local environment files, or user artwork.
- [ ] Keep the production site static: no upload endpoint, server-side
  conversion, cloud artwork storage, analytics, error-reporting script, or
  remote image-processing API.
- [ ] Verify a small synthetic conversion in the deployed site.
- [ ] During selection, conversion, and download, the browser Network panel
  shows no request containing the source fixture, source metadata, or generated
  `.aseprite` file.
- [ ] The deployed build matches [static-deployment.md](static-deployment.md),
  including HTTPS, correct asset paths, and cache behavior.

## No Live Ads

- [ ] No Google AdSense script is loaded.
- [ ] No `adsbygoogle` element or `data-ad-*` markup is present.
- [ ] No fake ads, fake ad placeholders, or simulated ad units are shown.
- [ ] No analytics, tracking scripts, or fake traffic mechanisms are added.
- [ ] No AdSense publisher ID is committed or shipped until the real approved ID
  is known and a separate task enables ads.
- [ ] No `ads.txt` is added until the publisher ID is known and the site is ready
  for the official AdSense entry.
- [ ] Future ad placement remains outside file picker, drag-and-drop,
  conversion, error, download, private file, and support-link UI regions.

## Final Pre-Review Check

- [ ] Re-read [adsense-readiness.md](adsense-readiness.md).
- [ ] Run `node scripts/auto-dev-cycle.mjs --dry-run`.
- [ ] Confirm the diff contains documentation only and no changes to code,
  secrets, generated files, workflows, dependencies, or tests.
