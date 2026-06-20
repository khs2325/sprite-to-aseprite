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
- All frames must have the same dimensions and fit inside the decoded PNG.
- Rotated and trimmed frames are rejected because this subset cannot map them
  accurately without additional placement data.
- Other metadata fields, such as `filename` and `meta`, are ignored.
