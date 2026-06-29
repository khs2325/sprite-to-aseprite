# PSD `.psd` Format Notes

Status: documentation-only. No user-facing PSD importer exists yet.

This note defines the intended PSD limitation contract before implementation.
Any future PSD parser must keep processing browser-local: selected PSD bytes,
decoded pixels, and generated `.aseprite` files must not be uploaded to a
server or sent to a remote converter.

## Initial Target

The initial target is RGB 8-bit raster layers in one-frame PSD files.

A future importer should accept only version-1 `.psd` files that can map
directly to `SpriteProject`:

```ts
{
  width: psd.width,
  height: psd.height,
  colorMode: "rgba",
  frames: [{ index: 0, durationMs: 100 }],
  layers: [
    {
      id,
      name,
      visible,
      opacity,
      cels: [{ frameIndex: 0, x, y, imageData }],
    },
  ],
}
```

Within that subset, preserve supported raster layer names, source order,
visibility, opacity, offsets, and RGBA pixel data when those values are present
in supported layer records.

This is not full Photoshop compatibility. It is not perfect or lossless PSD
conversion. It must not claim to recover layers from a flattened composite
image.

## Unsupported Feature Behavior

Unsupported PSD features must not be silently presented as preserved. They
should produce clear diagnostics or be documented as omitted when they do not
affect the `SpriteProject` output.

Reject the file with a specific diagnostic for unsupported features that affect
pixels, layer structure, color interpretation, or timeline behavior, including:

- PSB / Large Document Format.
- Color modes other than RGB, including CMYK, indexed color, grayscale, Lab,
  duotone, bitmap, and multichannel.
- Channel depths other than 8 bits per channel.
- Text layers, smart objects, adjustment layers, and layer effects/styles.
- Layer masks, vector masks, user masks, clipping masks, and mask parameters.
- Groups, folders, section dividers, nested layers, and pass-through behavior.
- Non-normal blend modes, blend ranges, profile-dependent color conversion, or
  other compositing semantics that are not represented by `SpriteProject`.
- Animation, video frames, timeline metadata, frame durations, and conventions
  that treat layer names as animation frames.
- External assets, linked files, embedded objects, or unknown descriptor data
  that could affect rendered pixels.
- Malformed data, unsafe dimensions, unsafe allocation sizes, duplicate channel
  IDs, invalid layer rectangles, unsupported compression, or channel lengths
  that require guessing.

Documented omission is acceptable only for metadata that does not change the
converted pixels, layers, or frame timing, such as thumbnails, guides, rulers,
or editor-only notes. Omitted metadata must not be described as preserved.

Do not flatten unsupported text, smart objects, effects, masks, groups, or
animation into the output. If a later flat-composite fallback is explicitly
scoped, it must create one generated layer and state that source layers were not
preserved.
