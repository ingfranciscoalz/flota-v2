// ── OCR DE RECIBOS (Tesseract.js) ─────────────────────────────────────────────
// Lee tickets/facturas y extrae monto, fecha, categoría y descripción.

import Tesseract from 'tesseract.js'

// Categorías inferidas a partir de keywords del recibo
const CATEGORY_KEYWORDS = {
  combustible: ['ypf', 'shell', 'axion', 'puma', 'oil', 'nafta', 'gnc', 'gasoil', 'diesel', 'combustible', 'estacion de servicio', 'esso'],
  mantenimiento: ['lubricentro', 'aceite', 'filtro', 'taller', 'mecanic', 'service', 'frenos', 'bujias', 'cubiertas', 'neumat', 'goma', 'repuesto', 'pastillas', 'embrague', 'amortiguador'],
  seguro: ['seguro', 'poliza', 'cobertura', 'aseguradora', 'la caja', 'allianz', 'mapfre', 'sancor', 'meridional', 'rivadavia', 'federacion patronal'],
  impuesto: ['vtv', 'patente', 'impuesto', 'municipalidad', 'rentas', 'sat', 'arba', 'agip', 'verificacion tecnica'],
  multa: ['multa', 'infraccion', 'acta', 'transito', 'policia'],
}

function inferCategoria(text) {
  const lower = text.toLowerCase()
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return cat
    }
  }
  return 'otro'
}

// Extrae el monto más probable: priorizar líneas con "TOTAL", sino el número más grande con formato monetario
function inferMonto(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  // 1. Buscar línea con "TOTAL" (case insensitive)
  const totalLineRegex = /total/i
  const moneyRegex = /\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\b/g
  const moneyAnyRegex = /([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/g

  let candidates = []

  // Buscar específicamente líneas con TOTAL
  for (const line of lines) {
    if (totalLineRegex.test(line)) {
      let m
      moneyAnyRegex.lastIndex = 0
      while ((m = moneyAnyRegex.exec(line)) !== null) {
        const parsed = parseMonto(m[1])
        if (parsed > 0) candidates.push({ value: parsed, priority: 10, line })
      }
    }
  }

  // Sino, todos los números con $ explícito o formato monetario claro
  if (candidates.length === 0) {
    for (const line of lines) {
      let m
      moneyRegex.lastIndex = 0
      while ((m = moneyRegex.exec(line)) !== null) {
        const parsed = parseMonto(m[1])
        if (parsed > 100) candidates.push({ value: parsed, priority: 1, line })
      }
    }
  }

  if (candidates.length === 0) return null

  // Devolver el de mayor prioridad, y si empata, el mayor valor
  candidates.sort((a, b) => b.priority - a.priority || b.value - a.value)
  return candidates[0].value
}

function parseMonto(str) {
  if (!str) return 0
  // Argentina usa . como separador miles y , como decimal: "12.345,67"
  // Pero también puede venir "12,345.67" o "12345"
  const cleaned = str.replace(/\s/g, '')
  // Si tiene tanto . como ,
  if (cleaned.includes('.') && cleaned.includes(',')) {
    const lastDot = cleaned.lastIndexOf('.')
    const lastComma = cleaned.lastIndexOf(',')
    if (lastComma > lastDot) {
      // Formato AR: 12.345,67
      return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'))
    } else {
      // Formato EN: 12,345.67
      return parseFloat(cleaned.replace(/,/g, ''))
    }
  }
  // Solo .
  if (cleaned.includes('.')) {
    const parts = cleaned.split('.')
    // Si la última parte tiene 1-2 dígitos → es decimal
    if (parts[parts.length - 1].length <= 2) return parseFloat(cleaned)
    // Sino → separador miles
    return parseFloat(cleaned.replace(/\./g, ''))
  }
  // Solo ,
  if (cleaned.includes(',')) {
    const parts = cleaned.split(',')
    if (parts[parts.length - 1].length <= 2) return parseFloat(cleaned.replace(',', '.'))
    return parseFloat(cleaned.replace(/,/g, ''))
  }
  return parseFloat(cleaned) || 0
}

// Extrae fecha en formato YYYY-MM-DD
function inferFecha(text) {
  // dd/mm/yyyy o dd-mm-yyyy
  const re = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/g
  let m
  while ((m = re.exec(text)) !== null) {
    let [, d, mo, y] = m
    if (y.length === 2) y = '20' + y
    const dd = String(parseInt(d, 10)).padStart(2, '0')
    const mm = String(parseInt(mo, 10)).padStart(2, '0')
    const yy = parseInt(y, 10)
    // Validar año razonable
    if (yy >= 2020 && yy <= 2030) {
      // Validar mes <=12 y día <=31
      if (parseInt(mm, 10) >= 1 && parseInt(mm, 10) <= 12 && parseInt(dd, 10) >= 1 && parseInt(dd, 10) <= 31) {
        return `${yy}-${mm}-${dd}`
      }
    }
  }
  return null
}

// Comercio / descripción: primera línea con letras (probablemente el nombre del negocio)
function inferDescripcion(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  for (const line of lines) {
    // Saltar líneas que son solo números o muy cortas
    if (line.length < 4) continue
    if (/^[\d\s.,/$:-]+$/.test(line)) continue
    // Limpiar
    return line.slice(0, 60)
  }
  return ''
}

// ── API PÚBLICA ───────────────────────────────────────────────────────────────
export async function scanReceipt(imageFile, onProgress) {
  const result = await Tesseract.recognize(imageFile, 'spa+eng', {
    logger: m => {
      if (onProgress && m.status === 'recognizing text') {
        onProgress(Math.round(m.progress * 100))
      }
    },
  })

  const text = result.data.text || ''
  return {
    raw: text,
    monto: inferMonto(text),
    fecha: inferFecha(text),
    descripcion: inferDescripcion(text),
    categoria: inferCategoria(text),
  }
}
