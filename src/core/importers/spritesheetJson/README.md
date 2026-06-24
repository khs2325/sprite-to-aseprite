# Supported spritesheet JSON subset

The importer accepts Aseprite-style metadata with `frames` as either an ordered
array or an object map. Object-map frames use JSON property order.

```json
{
  "frames": [
    {
      "frame": { "x": 0, "y": 0, "w": 16, "h": 16 },
      "duration": 100,
      "rotated": false,
      "trimmed": false
    }
  ]
}
```

- `x` and `y` must be non-negative integers.
- `w`, `h`, and a provided `duration` must be positive integers.
- Missing durations use 100 milliseconds by default.
- Every atlas rectangle must fit inside the decoded PNG.
- Unrotated TexturePacker-style entries with `trimmed: true` are supported only
  when they include `sourceSize.{w,h}` and
  `spriteSourceSize.{x,y,w,h}`. The source dimensions and trimmed width and
  height must be positive integers; placement offsets must be non-negative
  integers. The trimmed dimensions must match the atlas rectangle and the
  placement must fit inside `sourceSize`.
- Trimmed rectangles are placed at their declared offset on a transparent
  `sourceSize` canvas. All resulting frame canvases must have the same size.
- Rotated frames are rejected.
- Other metadata fields, such as `filename` and `meta`, are ignored.
