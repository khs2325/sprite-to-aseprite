# Static deployment guide

Sprite to Aseprite Converter is a Vite app that can be deployed as static
HTML, JavaScript, and CSS. The deployed site does not need an application
server, database, serverless function, or file-upload endpoint. Conversion and
`.aseprite` generation run in the visitor's browser.

## Build the production files

Install the pinned development dependencies and run the project checks from
the repository root:

```bash
npm ci
npm run typecheck
npm run test
npm run build
```

The final command creates the production output in `dist/`. Treat that
directory as generated output: deploy it, but do not edit or commit it.

The default Vite configuration builds for the root of a domain, such as
`https://sprites.example/`. If the site will be served from a subpath, replace
the final build command with one whose base matches that public path:

```bash
npm run build -- --base=/tools/sprite-to-aseprite/
```

The leading and trailing slashes are significant. A build made for the wrong
base path will usually load `index.html` but return 404 responses for its
JavaScript or CSS assets.

To inspect the production build locally, run:

```bash
npm exec -- vite preview
```

Use the URL printed by Vite. This preview is a local check, not the production
hosting process.

## Publish to a static host

Configure any static hosting provider or web server as follows:

1. Use the repository root as the build working directory.
2. Run `npm ci` followed by `npm run build` (or the subpath build command
   above).
3. Publish the **contents** of `dist/` at the configured root or subpath.
4. Serve the site over HTTPS with `index.html` as the directory index.
5. Preserve the generated directory structure and normal MIME types for HTML,
   JavaScript, CSS, and image files.

Only the generated `dist/` contents are needed at runtime. Do not publish
`node_modules/`, repository source files, local environment files, test
fixtures, or user artwork. The current app has no client-side routes, so a
catch-all rewrite to `index.html` is not required. In particular, do not
rewrite missing asset requests to HTML, because that hides configuration
errors and prevents the app from loading.

For caching, serve generated hashed assets with a long cache lifetime and
serve `index.html` with revalidation or a short cache lifetime. This lets a new
deployment reference its matching asset filenames instead of leaving visitors
on stale HTML.

## Preserve browser-only processing

Static deployment preserves the privacy boundary only when the deployed app
remains self-contained:

- Source PNG and JSON files must be read with browser APIs and processed in
  the browser.
- Generated `.aseprite` files must be created and downloaded with browser
  APIs.
- Do not add upload endpoints, server-side conversion, cloud storage, remote
  image-processing APIs, third-party scripts, analytics, or error-reporting
  tools that transmit file contents.
- Do not put secrets in Vite environment variables or generated assets.
  Everything shipped to the browser is public.

The static host still receives ordinary requests for the site's HTML,
JavaScript, CSS, and other bundled assets. Depending on provider settings, it
may log standard request metadata such as IP address, user agent, referrer, and
requested URL. That hosting telemetry is separate from artwork processing; no
source artwork or generated `.aseprite` data should be included in those
requests.

PNG sequences and spritesheets are flat images. Deployment does not change
their limitations: the app rebuilds a timeline and converts frames, but it
cannot recover layers absent from a flat source. Layers can only be preserved
when the source format contains layer data and its importer supports it.

## Verify a deployment

After publishing, verify the deployed URL in a clean browser session:

1. Confirm that the page loads over HTTPS without console errors or failed
   asset requests.
2. Confirm that every required policy and guide section link scrolls to a
   visible section on the static page:
   - About: `#about`
   - Contact: `#contact`
   - Privacy Policy: `#privacy-policy`
   - Terms: `#terms`
   - Guides: `#guides`
   - Browser-local conversion guide: `#browser-local-conversion-guide`
   - Supported formats guide: `#supported-formats-guide`
   - Conversion limitations guide: `#conversion-limitations-guide`
3. Use a small, synthetic PNG fixture to complete a conversion and download
   the generated `.aseprite` file.
4. While selecting, converting, and downloading, inspect the browser's Network
   panel. There should be no request containing the fixture, its metadata, or
   the generated file.
5. Refresh the deployed URL and repeat the check after clearing the browser
   cache to catch incorrect base paths or stale `index.html` caching.

Do not use private artwork for deployment verification. A synthetic fixture is
enough to confirm that the static app loads and the browser-only conversion
boundary remains intact.
