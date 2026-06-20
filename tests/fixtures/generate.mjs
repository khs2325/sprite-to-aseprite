import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
const sequenceDirectory = join(fixtureDirectory, "png-sequence");
const spritesheetDirectory = join(fixtureDirectory, "spritesheet");

mkdirSync(sequenceDirectory, { recursive: true });
mkdirSync(spritesheetDirectory, { recursive: true });

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

const spritesheet = [];
for (let y = 0; y < 4; y += 1) {
  spritesheet.push(...frameOne.slice(y * 4, y * 4 + 4));
  spritesheet.push(...frameTwo.slice(y * 4, y * 4 + 4));
}

writeFileSync(join(sequenceDirectory, "spark-01.png"), encodePng(4, 4, frameOne));
writeFileSync(join(sequenceDirectory, "spark-02.png"), encodePng(4, 4, frameTwo));
writeFileSync(join(spritesheetDirectory, "spark-sheet.png"), encodePng(8, 4, spritesheet));
