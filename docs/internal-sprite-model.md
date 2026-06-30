# Internal Sprite Model Proposal

## Decision

Evolve and formalize the existing `SpriteProject` model instead of introducing a
separate `InternalSprite` type now.

`SpriteProject` is already the importer-to-exporter boundary described by the
architecture. Keeping that boundary avoids a second model, avoids adapter churn,
and keeps current importers, preview code, and the Aseprite exporter aligned.
The clearer path is to document stricter invariants and add optional,
output-agnostic fields only when a source format or exporter has tests proving
the field is needed.

Use `InternalSprite` as a concept name in planning, not as a new production type,
until there is a demonstrated need for a breaking model version.

## Options Compared

### Keep `SpriteProject` and formalize it

Benefits:

- Preserves the existing architecture: importers emit `SpriteProject`, exporters
  consume `SpriteProject`.
- Keeps current browser-only processing simple and auditable.
- Avoids duplicate validation rules between `SpriteProject` and `InternalSprite`.
- Lets future fields be added behind compatibility tests without refactoring all
  importers and exporters at once.
- Reduces the risk of accidentally implying that flat sources can recover layer
  data.

Costs:

- The name `SpriteProject` must carry both current conversion and future
  interchange responsibilities.
- Optional fields can accumulate unless there is a clear extension policy.
- A future bidirectional `.aseprite` reader may need data that does not fit the
  current model without a versioned expansion.

### Introduce `InternalSprite`

Benefits:

- Gives the intermediate format an explicit, neutral name for future
  bidirectional conversion and multiple exporters.
- Could model richer Aseprite concepts up front, such as slices, palettes,
  groups, blend modes, color profiles, linked cels, and user data.
- Creates a natural place for source metadata and output capability reporting.

Costs:

- Requires adapters from every existing importer and exporter before the model
  has proven new requirements.
- Creates two similar contracts that can diverge.
- Increases migration risk for no immediate product behavior change.
- May encourage speculative fields before parser, writer, and fixture coverage
  exists.

## Recommended Model Direction

Treat `SpriteProject` as the canonical internal sprite model for the next model
iteration. Formalize these invariants before adding new production fields:

- Canvas size: `width` and `height` describe the exported document canvas. Frame
  and cel pixels must be interpreted relative to this canvas.
- Color mode: keep `colorMode: "rgba"` until an importer and exporter both need
  another mode with tests.
- Frames: frames are zero-based, ordered timeline entries with explicit
  `durationMs`. Importers that read flat animation sources should rebuild the
  timeline and convert frames without claiming source-layer recovery.
- Frame tags: optional tags belong to the timeline, not to a source parser's raw
  metadata. Tags should use zero-based inclusive frame ranges and documented
  playback directions.
- Layers: layers are ordered raster layers with stable ids, user-facing names,
  visibility, opacity, and cels. Layers are preserved only when the source
  format contains supported layer data.
- Opacity: keep opacity layer-level unless a supported source and exporter need
  per-cel opacity. The valid range should be enforced consistently by validators
  and exporters.
- Cels: each cel references a frame, has signed canvas-relative `x` and `y`
  placement, and contains RGBA `ImageData`. Each layer should have at most one
  cel per frame unless a future model version explicitly supports another
  composition rule.
- Source metadata: do not place raw source documents in the core model. If
  needed, add small normalized metadata such as source format, importer name,
  supported feature flags, and safe diagnostics. Never store user artwork in
  telemetry or remote services.
- Future output needs: add fields only when at least one importer can produce
  them and at least one exporter or UI workflow can consume them. Unsupported
  source features should be rejected or documented rather than silently dropped.

## Extension Policy

Add optional fields to `SpriteProject` when they meet all of these conditions:

1. The field represents sprite semantics rather than parser internals.
2. The field is output-agnostic or has a clear mapping to more than one useful
   output path.
3. Existing exporters can ignore the field without corrupting the output.
4. Importer validation rejects malformed data instead of inventing missing
   geometry, timing, layer, or pixel semantics.
5. Compatibility tests cover import, validation, and at least one consuming path.

Candidate future fields:

- `source`: normalized source metadata, such as format, importer version, and
  safe feature notes.
- `slices`: named canvas regions if a source format and exporter support them.
- `palette`: only after indexed-color behavior is designed and tested.
- `colorProfile`: only after input and output behavior is specified.
- `layerGroups` or parent ids: only after group ordering, visibility, opacity,
  and exporter fallback behavior are defined.
- `blendMode`: only after supported blend modes and flattening/export fallback
  rules are tested.

Avoid adding fields only to mirror one source format's raw schema. Raw metadata
belongs in parser-local code or documented diagnostics, not in the canonical
conversion model.

## When To Revisit `InternalSprite`

Introduce a versioned `InternalSprite` only if one of these becomes true:

- Multiple exporters require model semantics that are incompatible with the
  existing `SpriteProject` shape.
- A future `.aseprite` input path needs round-trip features that cannot be
  represented as optional `SpriteProject` fields without ambiguous behavior.
- Compatibility adapters become simpler than continued optional-field evolution.
- A breaking change is needed for canvas, timeline, layer, or cel semantics.

If that happens, migrate through explicit adapters:

```text
importer -> InternalSprite -> SpriteProject compatibility adapter -> existing exporters
```

Then move exporters one by one to consume `InternalSprite`, keeping fixtures that
prove old `SpriteProject` behavior is unchanged.

## Migration Risks

- Data loss: adding fields without exporter behavior can make users think
  unsupported features are preserved.
- Ambiguous layer semantics: flat sources must continue to use generated layers
  and must not claim recovered layers.
- Timing regressions: frame duration and tag range conversions can shift by one
  frame if zero-based indexes are not enforced.
- Opacity mismatches: source formats may use different opacity ranges. Importers
  must normalize before producing the model.
- Canvas placement bugs: trimmed spritesheet frames, layer offsets, and cels with
  negative offsets need consistent canvas-relative behavior.
- Silent parser acceptance: source metadata must not be used to hide unsupported
  or invalid format data.
- Adapter drift: if `InternalSprite` is introduced too early, adapters can become
  the real model and weaken validation.

## Compatibility Tests Needed

Before changing production model fields, add or update focused tests for:

- Flat PNG sequence, spritesheet grid, GIF, and APNG imports producing generated
  layers while rebuilding timelines and converting frames.
- Layered sources preserving layer names, order, visibility, opacity, frame
  coverage, cel offsets, and pixels when the source contains supported layer
  data.
- Frame tags preserving name, range, and direction through supported import and
  export paths.
- Canvas size and cel placement, including trimmed frames and signed layer
  offsets.
- Opacity normalization from each source format into the canonical range.
- Invalid parser data being rejected clearly rather than silently accepted.
- Exporter compatibility when optional future fields are absent or ignored.
- Golden output or round-trip checks for any binary writer change.

No production model change should land without these tests for the affected
semantic area.
