// Generates resources/tray.png — a simple rounded brand-green tile with an "L".
// Pure Node (zlib), no image dependencies.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SIZE = 32
const brand = [46, 125, 80] // #2e7d50
const white = [255, 255, 255]

// A tiny 5x7 bitmap for the letter "L".
const L = ['1....', '1....', '1....', '1....', '1....', '1....', '11111']

function inLetter(px, py) {
  // Center the 5x7 glyph (scaled 3x) in the 32x32 tile.
  const scale = 3
  const gw = 5 * scale
  const gh = 7 * scale
  const ox = Math.floor((SIZE - gw) / 2)
  const oy = Math.floor((SIZE - gh) / 2)
  if (px < ox || py < oy || px >= ox + gw || py >= oy + gh) return false
  const gx = Math.floor((px - ox) / scale)
  const gy = Math.floor((py - oy) / scale)
  return L[gy][gx] === '1'
}

function inRoundedTile(x, y) {
  const r = 6
  const inCorner = (cx, cy) => (x - cx) ** 2 + (y - cy) ** 2 > r ** 2
  if (x < r && y < r && inCorner(r, r)) return false
  if (x >= SIZE - r && y < r && inCorner(SIZE - r - 1, r)) return false
  if (x < r && y >= SIZE - r && inCorner(r, SIZE - r - 1)) return false
  if (x >= SIZE - r && y >= SIZE - r && inCorner(SIZE - r - 1, SIZE - r - 1)) return false
  return true
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
let o = 0
for (let y = 0; y < SIZE; y++) {
  raw[o++] = 0 // filter: none
  for (let x = 0; x < SIZE; x++) {
    let rgba
    if (!inRoundedTile(x, y)) rgba = [0, 0, 0, 0]
    else if (inLetter(x, y)) rgba = [...white, 255]
    else rgba = [...brand, 255]
    raw[o++] = rgba[0]
    raw[o++] = rgba[1]
    raw[o++] = rgba[2]
    raw[o++] = rgba[3]
  }
}

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return (~c) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // color type RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0))
])

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'tray.png'), png)
console.log(`Wrote resources/tray.png (${png.length} bytes)`)
