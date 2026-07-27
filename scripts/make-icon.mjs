// Rasterises the Launchpad mark (a delta lifting off a split pad) into PNGs: the Electron
// tray icon, the Electron window/taskbar icon, and the PWA icons.
//
// Pure Node — zlib for PNG compression, 4×4 supersampling for anti-aliasing, no image
// dependencies. The geometry below is the same 32×32 box used by
// src/web/src/components/Logo.tsx and src/web/public/favicon.svg; change all three together.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BRAND = [46, 125, 80]
const WHITE = [255, 255, 255]

const UNIT = 32
const TILE_RADIUS = 7.2
// The delta's long edges bow very slightly inward (a swept wing rather than a plain
// triangle). The SVG draws them as quadratic curves; here they're flattened to points.
function quad([x0, y0], [cx, cy], [x1, y1], steps = 24) {
  const points = []
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    points.push([u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1])
  }
  return points
}

const APEX = [16, 5.2]
const RIGHT = [23, 19.6]
const NOTCH = [16, 16]
const LEFT = [9, 19.6]

const DELTA = [
  APEX,
  ...quad(APEX, [18.2, 12.5], RIGHT),
  NOTCH,
  LEFT,
  ...quad(LEFT, [13.8, 12.5], APEX)
]
const PADS = [
  { x: 5.2, y: 22.4, w: 9.2, h: 3.4, r: 1.7 },
  { x: 17.6, y: 22.4, w: 9.2, h: 3.4, r: 1.7 }
]

// Ray casting — the delta is concave (the notch), so an even-odd test is required.
function inPolygon(px, py, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function inRoundedRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false
  const cx = Math.min(Math.max(px, x + r), x + w - r)
  const cy = Math.min(Math.max(py, y + r), y + h - r)
  const dx = px - cx
  const dy = py - cy
  return dx * dx + dy * dy <= r * r
}

const inTile = (px, py) => inRoundedRect(px, py, 0, 0, UNIT, UNIT, TILE_RADIUS)
const inMark = (px, py) =>
  inPolygon(px, py, DELTA) || PADS.some((p) => inRoundedRect(px, py, p.x, p.y, p.w, p.h, p.r))

const SAMPLES = 4

function makePng(size) {
  const scale = size / UNIT
  const step = 1 / (SAMPLES * scale)
  const raw = Buffer.alloc((size * 4 + 1) * size)
  let o = 0

  for (let y = 0; y < size; y++) {
    raw[o++] = 0 // PNG filter byte: none
    for (let x = 0; x < size; x++) {
      let tileHits = 0
      let markHits = 0
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = (x + (sx + 0.5) / SAMPLES) / scale
          const py = (y + (sy + 0.5) / SAMPLES) / scale
          if (!inTile(px, py)) continue
          tileHits++
          if (inMark(px, py)) markHits++
        }
      }
      const total = SAMPLES * SAMPLES
      if (tileHits === 0) {
        raw[o++] = 0
        raw[o++] = 0
        raw[o++] = 0
        raw[o++] = 0
        continue
      }
      const markRatio = markHits / tileHits
      for (let c = 0; c < 3; c++) {
        raw[o++] = Math.round(BRAND[c] + (WHITE[c] - BRAND[c]) * markRatio)
      }
      raw[o++] = Math.round((tileHits / total) * 255)
    }
  }

  const crc32 = (buf) => {
    let c = ~0
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i]
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
    }
    return ~c >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length, 0)
    const bodyBuf = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(bodyBuf), 0)
    return Buffer.concat([len, bodyBuf, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outputs = [
  [join(root, 'resources', 'tray.png'), 32],
  [join(root, 'resources', 'icon.png'), 256],
  [join(root, 'src', 'web', 'public', 'icon-192.png'), 192],
  [join(root, 'src', 'web', 'public', 'icon-512.png'), 512]
]
for (const [path, size] of outputs) {
  mkdirSync(dirname(path), { recursive: true })
  const png = makePng(size)
  writeFileSync(path, png)
  console.log(`Wrote ${path} (${size}px, ${png.length} bytes)`)
}
