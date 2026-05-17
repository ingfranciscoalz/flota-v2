// Genera icon-192.png e icon-512.png para TuFlota
// Diseño: fondo azul sólido + 3 siluetas de auto blancas en fila = "flota"
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

function d2(x, y, cx, cy) { return (x - cx) ** 2 + (y - cy) ** 2 }

// Dibuja un auto centrado en (cx, cy) con ancho total `w`
// Retorna true si el pixel (x,y) pertenece al auto
function inCar(x, y, cx, cy, w) {
  const h = w * 0.42          // alto total del auto
  const bodyH = h * 0.55      // alto del cuerpo
  const cabH  = h * 0.45      // alto de la cabina
  const cabW  = w * 0.52      // ancho de la cabina

  // Cuerpo: rectángulo ancho (parte baja)
  const bL = cx - w * 0.5
  const bR = cx + w * 0.5
  const bT = cy - bodyH * 0.5 + cabH * 0.5
  const bB = cy + h * 0.5 - h * 0.18  // margen inferior para las ruedas

  // Cabina: encima del cuerpo, centrada-trasera
  const cL = cx - cabW * 0.5 + w * 0.04
  const cR = cx + cabW * 0.5 + w * 0.04
  const cT = bT - cabH
  const cB = bT

  // Ruedas
  const wr   = w * 0.155
  const wr2  = wr * wr
  const rim2 = (wr * 0.52) ** 2
  const axleY = bB + wr * 0.25
  const axleXL = cx - w * 0.30
  const axleXR = cx + w * 0.30
  const dL = d2(x, y, axleXL, axleY)
  const dR = d2(x, y, axleXR, axleY)

  if (dL <= wr2 || dR <= wr2) {
    // dentro de la goma → negro; dentro del rin → blanco
    if (dL <= rim2 || dR <= rim2) return 'white'
    return 'black'
  }
  if (x >= bL && x < bR && y >= bT && y < bB) return 'white'
  if (x >= cL && x < cR && y >= cT && y < cB) return 'white'
  return null
}

function makePNG(size) {
  const BG    = [0x27, 0x6E, 0xF1]  // #276EF1 azul sólido
  const WHITE = [0xFF, 0xFF, 0xFF]
  const BLACK = [0x12, 0x38, 0x8A]  // azul muy oscuro para ruedas (no negro puro)

  const s = size

  // 3 autos en fila horizontal, centrados verticalmente
  // El auto del medio es ligeramente más grande (efecto perspectiva/jerarquía)
  const carW   = s * 0.245   // ancho de autos laterales
  const carWM  = s * 0.270   // ancho del auto central (un poco mayor)
  const centerY = s * 0.530  // eje vertical

  const gap = s * 0.030
  const cars = [
    { cx: s * 0.195, cy: centerY + s * 0.020, w: carW  },  // izquierda
    { cx: s * 0.500, cy: centerY - s * 0.010, w: carWM },  // centro (más grande)
    { cx: s * 0.805, cy: centerY + s * 0.020, w: carW  },  // derecha
  ]

  const rows = []
  for (let y = 0; y < size; y++) {
    const row = [0]
    for (let x = 0; x < size; x++) {
      let color = BG
      // dibujar de atrás hacia adelante (el del medio encima)
      for (const car of [cars[0], cars[2], cars[1]]) {
        const hit = inCar(x, y, car.cx, car.cy, car.w)
        if (hit === 'white') { color = WHITE; break }
        if (hit === 'black') { color = BLACK; break }
      }
      row.push(...color)
    }
    rows.push(...row)
  }

  const raw  = deflateSync(Buffer.from(rows))
  const sig  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 2

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', raw), chunk('IEND', Buffer.alloc(0))])
}

mkdirSync(join(__dirname, 'public', 'icons'), { recursive: true })
writeFileSync(join(__dirname, 'public', 'icons', 'icon-192.png'), makePNG(192))
writeFileSync(join(__dirname, 'public', 'icons', 'icon-512.png'), makePNG(512))
console.log('✓ Icons generated')
