// Genera icon-192.png e icon-512.png para TuFlota
// Diseño: fondo azul sólido (#276EF1) + letra T blanca bold centrada, cuadrado lleno
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

function makePNG(size) {
  const BG    = [0x27, 0x6E, 0xF1]  // #276EF1 azul
  const WHITE = [0xFF, 0xFF, 0xFF]

  const s = size
  // F — trazo vertical izquierdo (stem)
  const stemL = Math.round(s * 0.130)
  const stemR = Math.round(s * 0.290)
  const stemT = Math.round(s * 0.180)
  const stemB = Math.round(s * 0.820)
  // Barra superior (full width)
  const topT  = stemT
  const topB  = Math.round(s * 0.340)
  const topL  = stemL
  const topR  = Math.round(s * 0.870)
  // Barra del medio (más corta, ~65% del ancho)
  const midT  = Math.round(s * 0.470)
  const midB  = Math.round(s * 0.625)
  const midL  = stemL
  const midR  = Math.round(s * 0.730)

  const rows = []
  for (let y = 0; y < size; y++) {
    const row = [0]
    for (let x = 0; x < size; x++) {
      const inStem = y >= stemT && y < stemB && x >= stemL && x < stemR
      const inTop  = y >= topT  && y < topB  && x >= topL  && x < topR
      const inMid  = y >= midT  && y < midB  && x >= midL  && x < midR
      row.push(...((inStem || inTop || inMid) ? WHITE : BG))
    }
    rows.push(...row)
  }

  const raw  = deflateSync(Buffer.from(rows))
  const sig  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 2  // 8-bit RGB

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', raw), chunk('IEND', Buffer.alloc(0))])
}

mkdirSync(join(__dirname, 'public', 'icons'), { recursive: true })
writeFileSync(join(__dirname, 'public', 'icons', 'icon-192.png'), makePNG(192))
writeFileSync(join(__dirname, 'public', 'icons', 'icon-512.png'), makePNG(512))
console.log('✓ Icons generated')
