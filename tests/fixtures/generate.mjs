import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

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

const spritesheet = [];
for (let y = 0; y < 4; y += 1) {
  spritesheet.push(...frameOne.slice(y * 4, y * 4 + 4));
  spritesheet.push(...frameTwo.slice(y * 4, y * 4 + 4));
}

outputs.set("png-sequence/spark-01.png", encodePng(4, 4, frameOne));
outputs.set("png-sequence/spark-02.png", encodePng(4, 4, frameTwo));
outputs.set("spritesheet/spark-sheet.png", encodePng(8, 4, spritesheet));

const red = [230, 57, 70, 255];
const green = [42, 157, 143, 255];
const blue = [69, 123, 157, 255];
const white = [255, 255, 255, 255];

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
