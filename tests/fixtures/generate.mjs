import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, deflateSync } from "node:zlib";

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
const outputs = new Map();

const transparent = [0, 0, 0, 0];
const coral = [239, 71, 111, 255];
const cyan = [17, 138, 178, 255];
const yellow = [255, 209, 102, 255];

const frameOne = [
  transparent, coral, transparent, transparent,
  coral, yellow, coral, transparent,
  transparent, coral, transparent, transparent,
  transparent, transparent, transparent, transparent,
];
const frameTwo = [
  transparent, transparent, cyan, transparent,
  transparent, cyan, yellow, cyan,
  transparent, transparent, cyan, transparent,
  transparent, transparent, transparent, transparent,
];

function crc32(bytes) {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function uint32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const payload = Buffer.concat([typeBytes, data]);
  return Buffer.concat([uint32(data.length), payload, uint32(crc32(payload))]);
}

function encodePng(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  const rows = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(Buffer.from([0]));
    rows.push(Buffer.from(pixels.slice(y * width, (y + 1) * width).flat()));
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngDataUrl(width, height, pixels) {
  return `data:image/png;base64,${encodePng(width, height, pixels).toString("base64")}`;
}

function uint16(value) {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16BE(value);
  return bytes;
}

function encodeRgbaRows(width, height, pixels) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(Buffer.from([0]));
    rows.push(Buffer.from(pixels.slice(y * width, (y + 1) * width).flat()));
  }
  return deflateSync(Buffer.concat(rows), { level: 9 });
}

function apngFrameControl(sequence, frame) {
  return Buffer.concat([
    uint32(sequence),
    uint32(frame.width),
    uint32(frame.height),
    uint32(frame.left),
    uint32(frame.top),
    uint16(frame.delayNumerator),
    uint16(frame.delayDenominator),
    Buffer.from([frame.dispose, frame.blend]),
  ]);
}

function encodeApng(width, height, frames, { plays = 0 } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  const blocks = [
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("acTL", Buffer.concat([uint32(frames.length), uint32(plays)])),
  ];
  let sequence = 0;
  frames.forEach((frame, index) => {
    blocks.push(chunk("fcTL", apngFrameControl(sequence, frame)));
    sequence += 1;
    const compressed = encodeRgbaRows(frame.width, frame.height, frame.pixels);
    if (index === 0) {
      blocks.push(chunk("IDAT", compressed));
    } else {
      blocks.push(chunk("fdAT", Buffer.concat([uint32(sequence), compressed])));
      sequence += 1;
    }
  });
  blocks.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(blocks);
}

function uint16LittleEndian(value) {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value);
  return bytes;
}

function gifSubBlocks(data) {
  const blocks = [];
  for (let offset = 0; offset < data.length; offset += 255) {
    const block = data.subarray(offset, offset + 255);
    blocks.push(Buffer.from([block.length]), block);
  }
  blocks.push(Buffer.from([0]));
  return Buffer.concat(blocks);
}

function encodeGifLzw(indexes, minimumCodeSize = 2) {
  const clearCode = 1 << minimumCodeSize;
  const endCode = clearCode + 1;
  const codeSize = minimumCodeSize + 1;
  const codes = [clearCode];
  for (const index of indexes) {
    codes.push(index, clearCode);
  }
  codes.push(endCode);

  const bytes = [];
  let bits = 0;
  let bitCount = 0;
  for (const code of codes) {
    bits |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      bytes.push(bits & 0xff);
      bits >>>= 8;
      bitCount -= 8;
    }
  }
  if (bitCount > 0) {
    bytes.push(bits & 0xff);
  }
  return Buffer.from(bytes);
}

function gifFrame({
  delay,
  disposal,
  height,
  indexes,
  left,
  top,
  transparentIndex,
  width,
}) {
  const transparencyFlag = transparentIndex === undefined ? 0 : 1;
  const control = Buffer.concat([
    Buffer.from([0x21, 0xf9, 0x04, (disposal << 2) | transparencyFlag]),
    uint16LittleEndian(delay),
    Buffer.from([transparentIndex ?? 0, 0]),
  ]);
  const descriptor = Buffer.concat([
    Buffer.from([0x2c]),
    uint16LittleEndian(left),
    uint16LittleEndian(top),
    uint16LittleEndian(width),
    uint16LittleEndian(height),
    Buffer.from([0]),
  ]);
  const imageData = encodeGifLzw(indexes);
  return Buffer.concat([
    control,
    descriptor,
    Buffer.from([2]),
    gifSubBlocks(imageData),
  ]);
}

function encodeGif(width, height, frames, { loopCount } = {}) {
  const globalColorTable = Buffer.from([
    0, 0, 0,
    230, 57, 70,
    42, 157, 143,
    69, 123, 157,
  ]);
  const blocks = [
    Buffer.from("GIF89a", "ascii"),
    uint16LittleEndian(width),
    uint16LittleEndian(height),
    Buffer.from([0x91, 0, 0]),
    globalColorTable,
  ];
  if (loopCount !== undefined) {
    blocks.push(Buffer.concat([
      Buffer.from([0x21, 0xff, 0x0b]),
      Buffer.from("NETSCAPE2.0", "ascii"),
      Buffer.from([0x03, 0x01]),
      uint16LittleEndian(loopCount),
      Buffer.from([0]),
    ]));
  }
  blocks.push(...frames.map(gifFrame), Buffer.from([0x3b]));
  return Buffer.concat(blocks);
}

function piskelLayer(name, opacity, frames, chunks) {
  return JSON.stringify({
    name,
    opacity,
    frameCount: frames.length,
    chunks: chunks.map(({ frameIndexes }) => {
      const pixels = [];
      for (let y = 0; y < 2; y += 1) {
        for (const frameIndex of frameIndexes) {
          pixels.push(...frames[frameIndex].slice(y * 2, y * 2 + 2));
        }
      }
      return {
        layout: frameIndexes.map((frameIndex) => [frameIndex]),
        base64PNG: pngDataUrl(frameIndexes.length * 2, 2, pixels),
      };
    }),
  });
}

function piskelFile(name, fps, layers) {
  return `${JSON.stringify({
    modelVersion: 2,
    piskel: {
      name,
      description: "Synthetic test fixture",
      fps,
      height: 2,
      width: 2,
      layers,
      hiddenFrames: [],
    },
  }, null, 2)}\n`;
}

function zipLocalHeader({
  compressionMethod,
  compressedSize,
  crc,
  name,
  uncompressedSize,
}) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(compressionMethod, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(33, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressedSize, 18);
  header.writeUInt32LE(uncompressedSize, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function zipCentralDirectoryHeader({
  compressionMethod,
  compressedSize,
  crc,
  localHeaderOffset,
  name,
  uncompressedSize,
}) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(compressionMethod, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(33, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(compressedSize, 20);
  header.writeUInt32LE(uncompressedSize, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(localHeaderOffset, 42);
  return header;
}

function encodeZip(entries) {
  const localRecords = [];
  const centralDirectoryRecords = [];
  let localHeaderOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const source = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content, "utf8");
    const compressionMethod = entry.compressionMethod ?? 8;
    const compressed = compressionMethod === 0
      ? source
      : deflateRawSync(source, { level: 9 });
    const crc = crc32(source);
    const metadata = {
      compressionMethod,
      compressedSize: compressed.length,
      crc,
      localHeaderOffset,
      name,
      uncompressedSize: source.length,
    };
    const localHeader = zipLocalHeader(metadata);

    localRecords.push(localHeader, name, compressed);
    centralDirectoryRecords.push(zipCentralDirectoryHeader(metadata), name);
    localHeaderOffset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralDirectoryRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localHeaderOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localRecords, centralDirectory, end]);
}

const openRasterBaseLayerPng = encodePng(2, 2, [
  coral, transparent,
  cyan, yellow,
]);
const openRasterTopLayerPng = encodePng(2, 2, [
  transparent, yellow,
  coral, cyan,
]);
const openRasterThumbnailPng = encodePng(2, 2, [
  transparent, transparent,
  coral, transparent,
]);
const openRasterMergedPng = encodePng(4, 3, [
  transparent, transparent, transparent, transparent,
  coral, transparent, transparent, transparent,
  cyan, yellow, transparent, transparent,
]);

const kritaProfile = "sRGB-elle-V2-srgbtrc.icc";
const kritaImageName = "Synthetic Krita";
const kritaTileWidth = 64;
const kritaTileHeight = 64;
const kritaLayerPixels = new Map([
  [
    "layer1",
    [
      [transparent, yellow],
      [coral, cyan],
    ],
  ],
  [
    "layer2",
    [
      [cyan, transparent],
      [transparent, yellow],
    ],
  ],
]);

function rgbaToKritaBgra([redChannel, greenChannel, blueChannel, alphaChannel]) {
  return [blueChannel, greenChannel, redChannel, alphaChannel];
}

function encodeKritaPaintDeviceTile(pixels) {
  const pixelSize = 4;
  const tileBytes = Buffer.alloc(kritaTileWidth * kritaTileHeight * pixelSize);

  for (let y = 0; y < pixels.length; y += 1) {
    const row = pixels[y];
    for (let x = 0; x < row.length; x += 1) {
      const offset = (y * kritaTileWidth + x) * pixelSize;
      Buffer.from(rgbaToKritaBgra(row[x])).copy(tileBytes, offset);
    }
  }

  const rawFlag = Buffer.from([0]);
  const tilePayload = Buffer.concat([rawFlag, tileBytes]);

  return Buffer.concat([
    Buffer.from(`VERSION 2
TILEWIDTH ${kritaTileWidth}
TILEHEIGHT ${kritaTileHeight}
PIXELSIZE ${pixelSize}
DATA 1
0,0,LZF,${tilePayload.length}
`, "utf8"),
    tilePayload,
  ]);
}

function kritaDocumentInfoXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<document-info xmlns="http://www.calligra.org/DTD/document-info">
  <about>
    <title>${kritaImageName}</title>
  </about>
</document-info>
`;
}

function kritaLayerAttributes({
  colorSpaceName = "RGBA",
  compositeOp = "normal",
  filename,
  name,
  nodeType = "paintlayer",
  opacity = 255,
  visible = 1,
  x = 0,
  y = 0,
}) {
  return [
    `name="${name}"`,
    `nodetype="${nodeType}"`,
    `filename="${filename}"`,
    `x="${x}"`,
    `y="${y}"`,
    `opacity="${opacity}"`,
    `visible="${visible}"`,
    `compositeop="${compositeOp}"`,
    `colorspacename="${colorSpaceName}"`,
    `profile="${kritaProfile}"`,
    `channelflags="OOOO"`,
    `channellockflags="OOOO"`,
    `locked="0"`,
    `uuid="{00000000-0000-0000-0000-000000000000}"`,
    `collapsed="0"`,
    `colorlabel="0"`,
    `intimeline="0"`,
    `onionskin="0"`,
  ].join(" ");
}

function kritaMainDocXml({
  imageColorSpaceName = "RGBA",
  imageProfile = kritaProfile,
  layers,
}) {
  const layerXml = layers
    .map((layer) => `    <layer ${kritaLayerAttributes(layer)} />`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<DOC editor="krita" depth="8" syntaxVersion="2.0">
  <IMAGE mime="application/x-kra" name="${kritaImageName}" width="2" height="2" x-res="72" y-res="72" colorspacename="${imageColorSpaceName}" profile="${imageProfile}">
    <LAYERS>
${layerXml}
    </LAYERS>
  </IMAGE>
</DOC>
`;
}

function kritaFixture({
  includeLayerData = true,
  layers,
  mergedImage = encodePng(2, 2, [
    coral, cyan,
    yellow, transparent,
  ]),
  rootXml = kritaMainDocXml({ layers }),
}) {
  const entries = [
    {
      name: "mimetype",
      content: "application/x-krita",
      compressionMethod: 0,
    },
    { name: "maindoc.xml", content: rootXml },
    { name: "documentinfo.xml", content: kritaDocumentInfoXml() },
    {
      name: "preview.png",
      content: encodePng(2, 2, [
        transparent, cyan,
        coral, yellow,
      ]),
    },
  ];

  if (includeLayerData) {
    for (const layer of layers) {
      if ((layer.nodeType ?? "paintlayer") !== "paintlayer") {
        continue;
      }
      const pixels = kritaLayerPixels.get(layer.filename);
      if (pixels === undefined) {
        continue;
      }
      entries.push(
        {
          name: `${kritaImageName}/layers/${layer.filename}`,
          content: encodeKritaPaintDeviceTile(pixels),
        },
        {
          name: `${kritaImageName}/layers/${layer.filename}.defaultpixel`,
          content: Buffer.from(rgbaToKritaBgra(transparent)),
        },
      );
    }
  }

  entries.push({ name: "mergedimage.png", content: mergedImage });

  return encodeZip(entries);
}

function openRasterStackXml({ topCompositeOp = "svg:src-over" } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<image version="0.0.6" w="4" h="3">
  <stack>
    <layer name="Top hidden half" src="data/top-hidden.png" x="1" y="-1" opacity="0.5" visibility="hidden" composite-op="${topCompositeOp}" />
    <layer name="Base visible" src="data/base-visible.png" x="0" y="1" />
  </stack>
</image>
`;
}

function openRasterFixture({
  includeTopLayer = true,
  stackXml = openRasterStackXml(),
} = {}) {
  const entries = [
    {
      name: "mimetype",
      content: "image/openraster",
      compressionMethod: 0,
    },
    { name: "stack.xml", content: stackXml },
    { name: "data/base-visible.png", content: openRasterBaseLayerPng },
  ];

  if (includeTopLayer) {
    entries.push({ name: "data/top-hidden.png", content: openRasterTopLayerPng });
  }

  entries.push(
    { name: "Thumbnails/thumbnail.png", content: openRasterThumbnailPng },
    { name: "mergedimage.png", content: openRasterMergedPng },
  );

  return encodeZip(entries);
}

function rawRgba(pixels) {
  return Buffer.from(pixels.flat());
}

function pixeloramaCel() {
  return {
    opacity: 1,
    z_index: 0,
    ui_color: "(0, 0, 0, 0)",
    metadata: {},
  };
}

function pixeloramaLayer({
  blendMode = 0,
  effects = [],
  name,
  opacity = 1,
  type = 0,
  visible = true,
} = {}) {
  return {
    name,
    visible,
    locked: false,
    blend_mode: blendMode,
    clipping_mask: false,
    opacity,
    ui_color: "(0, 0, 0, 0)",
    parent: -1,
    effects,
    type,
    new_cels_linked: false,
    metadata: {},
  };
}

function pixeloramaDataJson({
  fps = 10,
  frames,
  layers,
  metadata = {},
  name = "synthetic-pixelorama",
  tilesets = [],
} = {}) {
  return JSON.stringify({
    pixelorama_version: "1.1.10",
    pxo_version: 6,
    size_x: 2,
    size_y: 2,
    color_mode: 5,
    tile_mode_x_basis_x: 2,
    tile_mode_x_basis_y: 0,
    tile_mode_y_basis_x: 0,
    tile_mode_y_basis_y: 2,
    layers,
    tags: [],
    guides: [],
    symmetry_points: [1, 1],
    frames,
    current_frame: 0,
    current_layer: 0,
    brushes: [],
    palettes: [],
    project_current_palette_name: "",
    reference_images: [],
    tilesets,
    vanishing_points: [],
    export_directory_path: "",
    export_file_name: name,
    export_file_format: 0,
    fps,
    license: "",
    user_data: "",
    author_display_name: "",
    author_real_name: "",
    author_contact: "",
    author_company: "",
    metadata,
  });
}

function pixeloramaFrame(duration, layerCount) {
  return {
    cels: Array.from({ length: layerCount }, pixeloramaCel),
    duration,
    metadata: {},
  };
}

function pixeloramaFixture({
  includeImageData = true,
  layers,
  frames = [pixeloramaFrame(1, layers.length)],
  imageData,
  metadata = {},
  tilesets = [],
} = {}) {
  const entries = [
    {
      name: "data.json",
      content: pixeloramaDataJson({
        frames,
        layers,
        metadata,
        tilesets,
      }),
    },
    {
      name: "mimetype",
      content: "application/x-pixelorama",
    },
    {
      name: "preview.png",
      content: encodePng(2, 2, [
        coral, transparent,
        transparent, yellow,
      ]),
    },
  ];

  if (includeImageData) {
    for (const [path, pixels] of imageData) {
      entries.push({ name: path, content: rawRgba(pixels) });
      entries.push({
        name: path.replace("/layer_", "/indices_layer_"),
        content: Buffer.from([0]),
      });
    }
  }

  for (let tilesetIndex = 0; tilesetIndex < tilesets.length; tilesetIndex += 1) {
    entries.push({
      name: `tilesets/${tilesetIndex}/0`,
      content: rawRgba([
        coral, transparent,
        transparent, yellow,
      ]),
    });
  }

  return encodeZip(entries);
}

const spritesheet = [];
for (let y = 0; y < 4; y += 1) {
  spritesheet.push(...frameOne.slice(y * 4, y * 4 + 4));
  spritesheet.push(...frameTwo.slice(y * 4, y * 4 + 4));
}

outputs.set("png-sequence/spark-01.png", encodePng(4, 4, frameOne));
outputs.set("png-sequence/spark-02.png", encodePng(4, 4, frameTwo));
outputs.set("spritesheet/spark-sheet.png", encodePng(8, 4, spritesheet));
const kritaPositiveLayers = [
  {
    filename: "layer1",
    name: "Top hidden half",
    opacity: 128,
    visible: 0,
    x: 1,
    y: -1,
  },
  {
    filename: "layer2",
    name: "Base visible",
  },
];
outputs.set(
  "krita/two-paint-layers.kra",
  kritaFixture({ layers: kritaPositiveLayers }),
);
outputs.set(
  "krita/unsupported-vector-layer.kra",
  kritaFixture({
    layers: [
      {
        filename: "layer1",
        name: "Vector unsupported",
        nodeType: "shapelayer",
      },
    ],
  }),
);
outputs.set(
  "krita/unsupported-color-depth.kra",
  kritaFixture({
    layers: [{
      colorSpaceName: "RGBA16",
      filename: "layer1",
      name: "RGBA16 unsupported",
    }],
    rootXml: kritaMainDocXml({
      imageColorSpaceName: "RGBA16",
      layers: [{
        colorSpaceName: "RGBA16",
        filename: "layer1",
        name: "RGBA16 unsupported",
      }],
    }),
  }),
);
outputs.set(
  "krita/missing-layer-data.kra",
  kritaFixture({
    includeLayerData: false,
    layers: kritaPositiveLayers,
  }),
);
outputs.set(
  "krita/flattened-preview-only.kra",
  kritaFixture({
    includeLayerData: false,
    layers: [],
    rootXml: kritaMainDocXml({ layers: [] }),
  }),
);
outputs.set("openraster/two-layers.ora", openRasterFixture());
outputs.set(
  "openraster/unsupported-blend-mode.ora",
  openRasterFixture({
    stackXml: openRasterStackXml({ topCompositeOp: "svg:multiply" }),
  }),
);
outputs.set(
  "openraster/missing-layer-data.ora",
  openRasterFixture({ includeTopLayer: false }),
);
outputs.set(
  "openraster/malformed-stack.ora",
  openRasterFixture({
    stackXml: `<?xml version="1.0" encoding="UTF-8"?>
<image version="0.0.6" w="4" h="3">
  <stack>
    <layer name="Broken" src="data/base-visible.png">
  </stack>
`,
  }),
);

const pixeloramaPositiveLayers = [
  pixeloramaLayer({ name: "Base visible half", opacity: 0.5 }),
  pixeloramaLayer({ name: "Hidden ink", visible: false }),
];
const pixeloramaPositiveFrames = [
  pixeloramaFrame(1, pixeloramaPositiveLayers.length),
  pixeloramaFrame(2.5, pixeloramaPositiveLayers.length),
];
const pixeloramaPositiveImageData = [
  [
    "image_data/frames/1/layer_1",
    [
      cyan, transparent,
      transparent, yellow,
    ],
  ],
  [
    "image_data/frames/1/layer_2",
    [
      transparent, coral,
      transparent, transparent,
    ],
  ],
  [
    "image_data/frames/2/layer_1",
    [
      transparent, transparent,
      cyan, yellow,
    ],
  ],
  [
    "image_data/frames/2/layer_2",
    [
      coral, transparent,
      yellow, transparent,
    ],
  ],
];
outputs.set(
  "pixelorama/two-layers-two-frames.pxo",
  pixeloramaFixture({
    frames: pixeloramaPositiveFrames,
    imageData: pixeloramaPositiveImageData,
    layers: pixeloramaPositiveLayers,
  }),
);
outputs.set(
  "pixelorama/unsupported-blend-mode.pxo",
  pixeloramaFixture({
    imageData: [["image_data/frames/1/layer_1", pixeloramaPositiveImageData[0][1]]],
    layers: [pixeloramaLayer({ name: "Multiply unsupported", blendMode: 3 })],
  }),
);
outputs.set(
  "pixelorama/unsupported-effects.pxo",
  pixeloramaFixture({
    imageData: [["image_data/frames/1/layer_1", pixeloramaPositiveImageData[0][1]]],
    layers: [
      pixeloramaLayer({
        name: "Effects unsupported",
        effects: [{ enabled: true, name: "Outline" }],
      }),
    ],
  }),
);
outputs.set(
  "pixelorama/unsupported-tilemap-layer.pxo",
  pixeloramaFixture({
    imageData: [["image_data/frames/1/layer_1", pixeloramaPositiveImageData[0][1]]],
    layers: [pixeloramaLayer({ name: "Tilemap unsupported", type: 3 })],
    tilesets: [{ tile_size: "(2, 2)", tile_amount: 1 }],
  }),
);
outputs.set(
  "pixelorama/missing-image-data.pxo",
  pixeloramaFixture({
    includeImageData: false,
    layers: [pixeloramaLayer({ name: "Missing pixels" })],
  }),
);
outputs.set(
  "pixelorama/ambiguous-metadata.pxo",
  pixeloramaFixture({
    imageData: [["image_data/frames/1/layer_1", pixeloramaPositiveImageData[0][1]]],
    layers: [pixeloramaLayer({ name: "Metadata unsupported" })],
    metadata: { fixture_note: "reject ambiguous project metadata" },
  }),
);

const opaqueRed = [255, 0, 0, 255];
const opaqueGreen = [0, 255, 0, 255];
const opaqueBlue = [0, 0, 255, 255];
const halfRed = [255, 0, 0, 128];
const halfBlue = [0, 0, 255, 128];

outputs.set(
  "apng/timing-offsets.apng",
  encodeApng(3, 2, [
    {
      left: 0, top: 0, width: 3, height: 2,
      delayNumerator: 0, delayDenominator: 100,
      dispose: 0, blend: 0,
      pixels: [coral, transparent, transparent, transparent, transparent, transparent],
    },
    {
      left: 1, top: 0, width: 2, height: 1,
      delayNumerator: 1, delayDenominator: 60,
      dispose: 0, blend: 0,
      pixels: [transparent, cyan],
    },
    {
      left: 2, top: 1, width: 1, height: 1,
      delayNumerator: 1, delayDenominator: 0,
      dispose: 0, blend: 0,
      pixels: [yellow],
    },
    {
      left: 0, top: 1, width: 1, height: 1,
      delayNumerator: 65_535, delayDenominator: 1,
      dispose: 0, blend: 0,
      pixels: [coral],
    },
  ]),
);

outputs.set(
  "apng/blend.apng",
  encodeApng(2, 1, [
    {
      left: 0, top: 0, width: 2, height: 1,
      delayNumerator: 1, delayDenominator: 10,
      dispose: 0, blend: 0,
      pixels: [opaqueRed, opaqueGreen],
    },
    {
      left: 0, top: 0, width: 1, height: 1,
      delayNumerator: 1, delayDenominator: 10,
      dispose: 0, blend: 0,
      pixels: [halfBlue],
    },
    {
      left: 1, top: 0, width: 1, height: 1,
      delayNumerator: 1, delayDenominator: 10,
      dispose: 0, blend: 1,
      pixels: [halfRed],
    },
  ]),
);

outputs.set(
  "apng/disposal.apng",
  encodeApng(3, 1, [
    {
      left: 0, top: 0, width: 3, height: 1,
      delayNumerator: 1, delayDenominator: 20,
      dispose: 0, blend: 0,
      pixels: [opaqueRed, opaqueRed, opaqueRed],
    },
    {
      left: 1, top: 0, width: 1, height: 1,
      delayNumerator: 1, delayDenominator: 20,
      dispose: 1, blend: 0,
      pixels: [opaqueGreen],
    },
    {
      left: 2, top: 0, width: 1, height: 1,
      delayNumerator: 1, delayDenominator: 20,
      dispose: 2, blend: 0,
      pixels: [opaqueBlue],
    },
    {
      left: 0, top: 0, width: 1, height: 1,
      delayNumerator: 1, delayDenominator: 20,
      dispose: 0, blend: 0,
      pixels: [yellow],
    },
  ]),
);

outputs.set(
  "gif/timing-transparency-offsets.gif",
  encodeGif(3, 2, [
    {
      left: 0, top: 0, width: 3, height: 2,
      delay: 0, disposal: 1, transparentIndex: 0,
      indexes: [1, 0, 0, 0, 0, 0],
    },
    {
      left: 1, top: 0, width: 2, height: 1,
      delay: 1, disposal: 1, transparentIndex: 0,
      indexes: [0, 2],
    },
    {
      left: 2, top: 1, width: 1, height: 1,
      delay: 12, disposal: 1, transparentIndex: 0,
      indexes: [3],
    },
    {
      left: 0, top: 1, width: 1, height: 1,
      delay: 65_535, disposal: 1, transparentIndex: 0,
      indexes: [1],
    },
  ], { loopCount: 0 }),
);

outputs.set(
  "gif/disposal-background.gif",
  encodeGif(3, 2, [
    {
      left: 0, top: 0, width: 3, height: 2,
      delay: 5, disposal: 1,
      indexes: [1, 1, 1, 1, 1, 1],
    },
    {
      left: 1, top: 0, width: 1, height: 1,
      delay: 5, disposal: 2,
      indexes: [2],
    },
    {
      left: 2, top: 0, width: 1, height: 1,
      delay: 5, disposal: 1,
      indexes: [3],
    },
  ]),
);

outputs.set(
  "gif/disposal-previous.gif",
  encodeGif(3, 2, [
    {
      left: 0, top: 0, width: 3, height: 2,
      delay: 7, disposal: 1,
      indexes: [1, 1, 1, 1, 1, 1],
    },
    {
      left: 1, top: 0, width: 1, height: 2,
      delay: 7, disposal: 3,
      indexes: [2, 2],
    },
    {
      left: 2, top: 1, width: 1, height: 1,
      delay: 7, disposal: 1,
      indexes: [3],
    },
  ]),
);

outputs.set(
  "gif/invalid-frame-bounds.gif",
  encodeGif(3, 2, [
    {
      left: 0, top: 0, width: 3, height: 2,
      delay: 5, disposal: 1,
      indexes: [1, 1, 1, 1, 1, 1],
    },
    {
      left: 2, top: 1, width: 2, height: 1,
      delay: 5, disposal: 1,
      indexes: [2, 3],
    },
  ]),
);

const trimmedAtlas = [
  coral, yellow, cyan,
  cyan, transparent, transparent,
];
const trimmedFrames = {
  "top-right": {
    frame: { x: 1, y: 0, w: 2, h: 1 },
    duration: 125,
    rotated: false,
    trimmed: true,
    spriteSourceSize: { x: 2, y: 0, w: 2, h: 1 },
    sourceSize: { w: 4, h: 4 },
  },
  "left-column": {
    frame: { x: 0, y: 0, w: 1, h: 2 },
    duration: 75,
    rotated: false,
    trimmed: true,
    spriteSourceSize: { x: 1, y: 1, w: 1, h: 2 },
    sourceSize: { w: 4, h: 4 },
  },
};

outputs.set("spritesheet/trimmed-atlas.png", encodePng(3, 2, trimmedAtlas));
outputs.set(
  "spritesheet/trimmed-atlas.json",
  `${JSON.stringify({ frames: trimmedFrames }, null, 2)}\n`,
);
outputs.set(
  "spritesheet/trimmed-atlas-missing-placement.json",
  `${JSON.stringify({
    frames: [{
      frame: { x: 0, y: 0, w: 1, h: 2 },
      trimmed: true,
      sourceSize: { w: 4, h: 4 },
    }],
  }, null, 2)}\n`,
);

const red = [230, 57, 70, 255];
const green = [42, 157, 143, 255];
const blue = [69, 123, 157, 255];
const white = [255, 255, 255, 255];

const rotatedAtlas = [
  cyan, coral, blue,
  red, yellow, white,
  green, transparent, transparent,
];
const rotatedFrames = {
  "rotated-untrimmed": {
    frame: { x: 0, y: 0, w: 2, h: 3 },
    duration: 110,
    rotated: true,
    trimmed: false,
  },
  "rotated-trimmed": {
    frame: { x: 2, y: 0, w: 1, h: 2 },
    duration: 65,
    rotated: true,
    trimmed: true,
    spriteSourceSize: { x: 1, y: 1, w: 2, h: 1 },
    sourceSize: { w: 3, h: 2 },
  },
};

outputs.set("spritesheet/rotated-atlas.png", encodePng(3, 3, rotatedAtlas));
outputs.set(
  "spritesheet/rotated-atlas.json",
  `${JSON.stringify({ frames: rotatedFrames }, null, 2)}\n`,
);
outputs.set(
  "spritesheet/rotated-atlas-unsupported.json",
  `${JSON.stringify({
    frames: [{
      frame: { x: 0, y: 0, w: 1, h: 1 },
      rotated: 90,
    }],
  }, null, 2)}\n`,
);

const motionFrames = [
  [red, transparent, transparent, yellow],
  [transparent, green, yellow, transparent],
  [transparent, white, blue, transparent],
];
outputs.set(
  "piskel/multi-frame.piskel",
  piskelFile("Synthetic motion", 12, [
    piskelLayer("Motion", 1, motionFrames, [
      { frameIndexes: [0, 1] },
      { frameIndexes: [2] },
    ]),
  ]),
);

const backgroundFrames = [
  [blue, blue, transparent, transparent],
  [transparent, transparent, blue, blue],
];
const accentFrames = [
  [red, transparent, transparent, transparent],
  [transparent, green, transparent, transparent],
];
outputs.set(
  "piskel/multi-layer.piskel",
  piskelFile("Synthetic layers", 20, [
    piskelLayer("Background", 0.5, backgroundFrames, [
      { frameIndexes: [0, 1] },
    ]),
    piskelLayer("Accent", 1, accentFrames, [{ frameIndexes: [0, 1] }]),
  ]),
);

function mutatePiskel(source, mutate) {
  const document = JSON.parse(source);
  mutate(document);
  return `${JSON.stringify(document, null, 2)}\n`;
}

const diagnosticBase = piskelFile("Synthetic diagnostics", 12, [
  piskelLayer("Diagnostic", 1, motionFrames.slice(0, 2), [
    { frameIndexes: [0, 1] },
  ]),
]);

outputs.set(
  "piskel/unsupported-model-version.piskel",
  mutatePiskel(diagnosticBase, (document) => {
    document.modelVersion = 1;
  }),
);
outputs.set(
  "piskel/hidden-frames.piskel",
  mutatePiskel(diagnosticBase, (document) => {
    document.piskel.hiddenFrames = [1];
  }),
);
outputs.set(
  "piskel/empty-string-hidden-frames.piskel",
  mutatePiskel(diagnosticBase, (document) => {
    document.piskel.hiddenFrames = "";
  }),
);
outputs.set(
  "piskel/multiple-hidden-frames.piskel",
  mutatePiskel(outputs.get("piskel/multi-frame.piskel"), (document) => {
    document.piskel.hiddenFrames = [0, 2];
  }),
);
outputs.set(
  "piskel/numeric-string-hidden-frames.piskel",
  mutatePiskel(outputs.get("piskel/multi-frame.piskel"), (document) => {
    document.piskel.hiddenFrames = ["0", "2"];
  }),
);
outputs.set(
  "piskel/hidden-multi-layer.piskel",
  mutatePiskel(outputs.get("piskel/multi-layer.piskel"), (document) => {
    document.piskel.hiddenFrames = [1];
  }),
);
outputs.set(
  "piskel/duplicate-hidden-frames.piskel",
  mutatePiskel(diagnosticBase, (document) => {
    document.piskel.hiddenFrames = [1, "1"];
  }),
);
outputs.set(
  "piskel/out-of-range-hidden-frame.piskel",
  mutatePiskel(diagnosticBase, (document) => {
    document.piskel.hiddenFrames = [2];
  }),
);
outputs.set(
  "piskel/non-array-hidden-frames.piskel",
  mutatePiskel(diagnosticBase, (document) => {
    document.piskel.hiddenFrames = 1;
  }),
);
outputs.set(
  "piskel/all-frames-hidden.piskel",
  mutatePiskel(diagnosticBase, (document) => {
    document.piskel.hiddenFrames = [0, 1];
  }),
);
outputs.set(
  "piskel/legacy-base64png.piskel",
  mutatePiskel(diagnosticBase, (document) => {
    document.piskel.expanded = false;
    const layer = JSON.parse(document.piskel.layers[0]);
    layer.base64PNG = layer.chunks[0].base64PNG;
    delete layer.chunks;
    delete layer.opacity;
    document.piskel.layers[0] = JSON.stringify(layer);
  }),
);
outputs.set(
  "piskel/extra-harmless-field.piskel",
  mutatePiskel(diagnosticBase, (document) => {
    document.piskel.expanded = true;
  }),
);
outputs.set(
  "piskel/bad-frame-coverage.piskel",
  mutatePiskel(diagnosticBase, (document) => {
    const layer = JSON.parse(document.piskel.layers[0]);
    layer.frameCount = 3;
    document.piskel.layers[0] = JSON.stringify(layer);
  }),
);
outputs.set(
  "piskel/bad-png-dimensions.piskel",
  mutatePiskel(diagnosticBase, (document) => {
    document.piskel.width = 1;
  }),
);

for (const [relativePath, content] of outputs) {
  const outputPath = join(fixtureDirectory, relativePath);
  if (process.argv.includes("--check")) {
    const actual = readFileSync(outputPath);
    const expected = Buffer.isBuffer(content) ? content : Buffer.from(content);
    if (!actual.equals(expected)) {
      throw new Error(`${relativePath} is not deterministically generated.`);
    }
  } else {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, content);
  }
}
