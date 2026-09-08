import { deflateSync } from 'node:zlib';

const DESIGN_SIZE = 512;
const SAMPLES = 4;
const BACKGROUND = [0x16, 0x18, 0x1b] as const;
const ACCENT = [0x3a, 0xa0, 0xb4] as const;
const INK = [0x0d, 0x11, 0x12] as const;

function roundedRect(px: number, py: number, x: number, y: number, width: number, height: number, radius: number) {
  if (px < x || px > x + width || py < y || py > y + height) return false;
  const dx = Math.max(x + radius - px, 0, px - (x + width - radius));
  const dy = Math.max(y + radius - py, 0, py - (y + height - radius));
  return dx * dx + dy * dy <= radius * radius;
}

function line(px: number, py: number, ax: number, ay: number, bx: number, by: number, width: number) {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSquared = abx * abx + aby * aby;
  const position = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSquared));
  const dx = px - (ax + abx * position);
  const dy = py - (ay + aby * position);
  return dx * dx + dy * dy <= (width * width) / 4;
}

function colorAt(x: number, y: number) {
  const inMonitorStroke = roundedRect(x, y, 127, 147, 258, 196, 37) && !roundedRect(x, y, 151, 171, 210, 148, 13);
  const inStand = line(x, y, 256, 331, 256, 379, 24) || line(x, y, 202, 379, 310, 379, 24);
  if (inMonitorStroke || inStand) return INK;
  if (roundedRect(x, y, 80, 80, 352, 352, 104)) return ACCENT;
  return BACKGROUND;
}

function render(size: number) {
  const pixels = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0];
      for (let sampleY = 0; sampleY < SAMPLES; sampleY++) {
        for (let sampleX = 0; sampleX < SAMPLES; sampleX++) {
          const designX = ((x + (sampleX + 0.5) / SAMPLES) * DESIGN_SIZE) / size;
          const designY = ((y + (sampleY + 0.5) / SAMPLES) * DESIGN_SIZE) / size;
          const color = colorAt(designX, designY);
          for (let channel = 0; channel < 3; channel++) sum[channel]! += color[channel]!;
        }
      }
      const offset = (y * size + x) * 3;
      for (let channel = 0; channel < 3; channel++)
        pixels[offset + channel] = Math.round(sum[channel]! / (SAMPLES * SAMPLES));
    }
  }
  return pixels;
}

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  crcTable[index] = value >>> 0;
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array) {
  const typeBytes = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBytes, data]);
  const result = Buffer.alloc(body.length + 8);
  result.writeUInt32BE(data.length, 0);
  body.copy(result, 4);
  result.writeUInt32BE(crc32(body), body.length + 4);
  return result;
}

function encodePng(size: number) {
  const pixels = render(size);
  const rows = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const rowOffset = y * (size * 3 + 1);
    rows[rowOffset] = 0;
    rows.set(pixels.subarray(y * size * 3, (y + 1) * size * 3), rowOffset + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows, { level: 9 })),
    pngChunk('IEND', new Uint8Array()),
  ]);
}

const outputs = [
  [192, 'src/client/assets/icon-192.png'],
  [512, 'src/client/assets/icon-512.png'],
  [512, 'src/client/assets/icon-maskable-512.png'],
  [180, 'src/client/assets/apple-touch-icon.png'],
] as const;

await Promise.all(outputs.map(([size, path]) => Bun.write(path, encodePng(size))));
