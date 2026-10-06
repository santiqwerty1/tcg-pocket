// Generates the PWA icons (PNG) without dependencies: a blue rounded tile with two overlapping cards.
// Run with `node scripts/make-icons.mjs` from apps/web; output goes to public/.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = join(here, '..', 'public')
const iconsDir = join(publicDir, 'icons')
mkdirSync(iconsDir, { recursive: true })

const BLUE = [37, 99, 235, 255] // #2563eb (theme color)
const LIGHT = [191, 219, 254, 255] // #bfdbfe
const WHITE = [255, 255, 255, 255]
const TRANSPARENT = [0, 0, 0, 0]

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed) >>> 0)
  return Buffer.concat([length, typed, crc])
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0 // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Signed distance helpers in the unit square (0..1). */
function inRoundedRect(px, py, cx, cy, hw, hh, radius, angleDeg) {
  const a = (-angleDeg * Math.PI) / 180
  const dx = px - cx
  const dy = py - cy
  const x = dx * Math.cos(a) - dy * Math.sin(a)
  const y = dx * Math.sin(a) + dy * Math.cos(a)
  const qx = Math.abs(x) - (hw - radius)
  const qy = Math.abs(y) - (hh - radius)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
  return outside <= 0
}

function render(size, { maskable }) {
  const rgba = Buffer.alloc(size * size * 4)
  const ss = 3 // supersampling per axis
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0]
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = (x + (sx + 0.5) / ss) / size
          const py = (y + (sy + 0.5) / ss) / size
          let color = TRANSPARENT
          const tile = maskable ? true : inRoundedRect(px, py, 0.5, 0.5, 0.5, 0.5, 0.22, 0)
          if (tile) color = BLUE
          // Safe zone for maskable icons is the central 80 %: keep the glyph inside 0.14..0.86.
          const scale = maskable ? 0.78 : 0.92
          const gx = 0.5 + (px - 0.5) / scale
          const gy = 0.5 + (py - 0.5) / scale
          if (tile && inRoundedRect(gx, gy, 0.44, 0.5, 0.17, 0.24, 0.035, -14)) color = LIGHT
          if (tile && inRoundedRect(gx, gy, 0.58, 0.52, 0.17, 0.24, 0.035, 8)) color = WHITE
          if (tile && Math.hypot(gx - 0.58, gy - 0.52) < 0.075) color = BLUE
          if (tile && Math.hypot(gx - 0.58, gy - 0.52) < 0.03) color = WHITE
          for (let i = 0; i < 4; i++) acc[i] += color[i]
        }
      }
      const o = (y * size + x) * 4
      for (let i = 0; i < 4; i++) rgba[o + i] = Math.round(acc[i] / (ss * ss))
    }
  }
  return encodePng(size, size, rgba)
}

writeFileSync(join(iconsDir, 'icon-192.png'), render(192, { maskable: false }))
writeFileSync(join(iconsDir, 'icon-512.png'), render(512, { maskable: false }))
writeFileSync(join(iconsDir, 'icon-maskable-512.png'), render(512, { maskable: true }))
writeFileSync(join(publicDir, 'apple-touch-icon.png'), render(180, { maskable: true }))

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="14" fill="#2563eb"/>
<rect x="17" y="16" width="21" height="31" rx="3" fill="#bfdbfe" transform="rotate(-14 27.5 31.5)"/>
<rect x="27" y="17" width="21" height="31" rx="3" fill="#fff" transform="rotate(8 37.5 32.5)"/>
<circle cx="37.5" cy="33" r="5" fill="#2563eb"/>
<circle cx="37.5" cy="33" r="2" fill="#fff"/>
</svg>
`
writeFileSync(join(publicDir, 'favicon.svg'), favicon)
console.log('icons written to', publicDir)
