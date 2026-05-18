// Genera feature graphic 1024x500 para Play Store
// Fondo oscuro + texto "Flota." + subtítulo
const { deflateSync } = require('zlib')
const { writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')

function crc32(buf) {
  let c = 0xFFFFFFFF
  for (const b of buf) { c ^= b; for (let i = 0; i < 8; i++) c = (c & 1) ? (c >>> 1) ^ 0xEDB88320 : c >>> 1 }
  return (c ^ 0xFFFFFFFF) >>> 0
}
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b }
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii'), d = Buffer.from(data)
  return Buffer.concat([u32(d.length), t, d, u32(crc32(Buffer.concat([t, d])))])
}

const W = 1024, H = 500

// Colores
const BG   = [0x0a, 0x0a, 0x0a]  // #0a0a0a
const BLUE = [0x27, 0x6E, 0xF1]  // #276EF1
const CARD = [0x13, 0x13, 0x18]  // #131318
const LITE = [0xf0, 0xf0, 0xf0]  // text light
const GRAY = [0x55, 0x55, 0x55]  // text gray

// ── Primitivas ────────────────────────────────────────────────────────────────
function setPixel(buf, x, y, rgb) {
  if (x < 0 || x >= W || y < 0 || y >= H) return
  const idx = (y * (W * 3 + 1)) + 1 + x * 3
  buf[idx] = rgb[0]; buf[idx+1] = rgb[1]; buf[idx+2] = rgb[2]
}

function rect(buf, x1, y1, x2, y2, rgb) {
  for (let y = y1; y < y2; y++)
    for (let x = x1; x < x2; x++)
      setPixel(buf, x, y, rgb)
}

function roundedRect(buf, x1, y1, x2, y2, r, rgb) {
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      let inside = true
      if (x < x1+r && y < y1+r) inside = (x-x1-r)**2+(y-y1-r)**2 <= r*r
      else if (x > x2-r-1 && y < y1+r) inside = (x-x2+r+1)**2+(y-y1-r)**2 <= r*r
      else if (x < x1+r && y > y2-r-1) inside = (x-x1-r)**2+(y-y2+r+1)**2 <= r*r
      else if (x > x2-r-1 && y > y2-r-1) inside = (x-x2+r+1)**2+(y-y2+r+1)**2 <= r*r
      if (inside) setPixel(buf, x, y, rgb)
    }
  }
}

// ── Fuente de píxeles 5×7 ─────────────────────────────────────────────────────
// Mapa simplificado de caracteres (5 cols × 7 rows)
const FONT = {
  'F':[[1,1,1,1,1],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0]],
  'L':[[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
  'O':[[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  'T':[[1,1,1,1,1],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0]],
  'A':[[0,0,1,0,0],[0,1,0,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,1],[1,0,0,0,1],[1,0,0,0,1]],
  '.':[[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,1,0,0],[0,0,1,0,0]],
  'G':[[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,0],[1,0,1,1,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  'E':[[1,1,1,1,1],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
  'S':[[0,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[0,1,1,1,0],[0,0,0,0,1],[0,0,0,0,1],[1,1,1,1,0]],
  'I':[[1,1,1,1,1],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[1,1,1,1,1]],
  'Ó':[[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  'N':[[1,0,0,0,1],[1,1,0,0,1],[1,0,1,0,1],[1,0,0,1,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
  'D':[[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0]],
  'R':[[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0],[1,0,1,0,0],[1,0,0,1,0],[1,0,0,0,1]],
  'M':[[1,0,0,0,1],[1,1,0,1,1],[1,0,1,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
  'É':[[1,1,1,1,1],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
  'C':[[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,1],[0,1,1,1,0]],
  'U':[[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  ' ':[[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]],
  'Y':[[1,0,0,0,1],[1,0,0,0,1],[0,1,0,1,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0]],
  'P':[[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0]],
  'Z':[[1,1,1,1,1],[0,0,0,0,1],[0,0,0,1,0],[0,0,1,0,0],[0,1,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
  'V':[[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,0,1,0],[0,1,0,1,0],[0,0,1,0,0]],
}

function drawText(buf, text, startX, startY, scale, color) {
  let cx = startX
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch] || FONT[' ']
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col]) {
          for (let sy = 0; sy < scale; sy++)
            for (let sx = 0; sx < scale; sx++)
              setPixel(buf, cx + col*scale + sx, startY + row*scale + sy, color)
        }
      }
    }
    cx += (5 + 1) * scale
  }
}

// ── Construir imagen ──────────────────────────────────────────────────────────
const rowSize = W * 3 + 1
const pixels = Buffer.alloc(H * rowSize, 0)
// filtro PNG = 0 para cada fila
for (let y = 0; y < H; y++) pixels[y * rowSize] = 0

// Fondo
rect(pixels, 0, 0, W, H, BG)

// Línea azul vertical izquierda
rect(pixels, 60, 60, 68, H-60, BLUE)

// Card mockup (derecha)
roundedRect(pixels, W-320, 80, W-60, H-80, 16, CARD)
// Mini cards dentro
roundedRect(pixels, W-300, 110, W-80, 190, 8, [0x1a,0x1a,0x22])
roundedRect(pixels, W-300, 200, W-80, 280, 8, [0x1a,0x1a,0x22])
roundedRect(pixels, W-300, 290, W-80, 370, 8, [0x1a,0x1a,0x22])
// Barras de datos simuladas
rect(pixels, W-280, 130, W-280+120, 143, BLUE)
rect(pixels, W-280, 220, W-280+80,  233, [0x10,0xB9,0x81])
rect(pixels, W-280, 310, W-280+160, 323, [0xF5,0x9E,0x0B])
// Línea de acento en card
rect(pixels, W-320, 80, W-316, H-80, BLUE)

// Texto principal "FLOTA."
drawText(pixels, 'FLOTA', 90, 140, 12, LITE)
// El punto en azul
drawText(pixels, '.', 90 + 5*6*12, 140, 12, BLUE)

// Subtítulo
drawText(pixels, 'GESTION DE REMISES', 92, 300, 4, GRAY)

// Punto decorativo azul pequeño
for (let sy = 0; sy < 8; sy++)
  for (let sx = 0; sx < 8; sx++)
    setPixel(pixels, 92+sx, 340+sy, BLUE)

// ── Encode PNG ────────────────────────────────────────────────────────────────
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8; ihdr[9] = 2

const raw = deflateSync(pixels)
const sig = Buffer.from([137,80,78,71,13,10,26,10])

const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', raw), chunk('IEND', Buffer.alloc(0))])

mkdirSync(join(__dirname, 'public', 'screenshots'), { recursive: true })
writeFileSync(join(__dirname, 'public', 'feature-graphic.png'), png)
console.log('✓ feature-graphic.png (1024x500)')
