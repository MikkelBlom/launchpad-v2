// Generates PNG icons (brand-green rounded tile with an "L"): the Electron tray icon
// and the PWA icons. Pure Node (zlib), no image dependencies.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const brand = [46, 125, 80]
const white = [255, 255, 255]
const L = ['1....', '1....', '1....', '1....', '1....', '1....', '11111']

function makePng(size) {
  const scale = Math.max(1, Math.floor(size / 11))
  const gw = 5 * scale
  const gh = 7 * scale
  const ox = Math.floor((size - gw) / 2)
  const oy = Math.floor((size - gh) / 2)
  const radius = Math.floor(size * 0.19)

  const inLetter = (px, py) => {
    if (px < ox || py < oy || px >= ox + gw || py >= oy + gh) return false
    const gx = Math.floor((px - ox) / scale)
    const gy = Math.floor((py - oy) / scale)
    return L[gy][gx] === '1'
  }
  const inTile = (x, y) => {
    const r = radius
    const corner = (cx, cy) => (x - cx) ** 2 + (y - cy) ** 2 > r ** 2
    if (x < r && y < r && corner(r, r)) return false
    if (x >= size - r && y < r && corner(size - r - 1, r)) return false
    if (x < r && y >= size - r && corner(r, size - r - 1)) return false
    if (x >= size - r && y >= size - r && corner(size - r - 1, size - r - 1)) return false
    return true
  }

  const raw = Buffer.alloc((size * 4 + 1) * size)
  let o = 0
  for (let y = 0; y < size; y++) {
    raw[o++] = 0
    for (let x = 0; x < size; x++) {
      let rgba
      if (!inTile(x, y)) rgba = [0, 0, 0, 0]
      else if (inLetter(x, y)) rgba = [...white, 255]
      else rgba = [...brand, 255]
      raw[o++] = rgba[0]
      raw[o++] = rgba[1]
      raw[o++] = rgba[2]
      raw[o++] = rgba[3]
    }
  }

  const crc32 = (buf) => {
    let c = ~0
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i]
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
    }
    return (~c) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length, 0)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body), 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outputs = [
  [join(root, 'resources', 'tray.png'), 32],
  [join(root, 'src', 'web', 'public', 'icon-192.png'), 192],
  [join(root, 'src', 'web', 'public', 'icon-512.png'), 512]
]
for (const [path, size] of outputs) {
  mkdirSync(dirname(path), { recursive: true })
  const png = makePng(size)
  writeFileSync(path, png)
  console.log(`Wrote ${path} (${size}px, ${png.length} bytes)`)
}
