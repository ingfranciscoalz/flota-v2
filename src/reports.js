// ── REPORTES PDF + COMPARTIR ──────────────────────────────────────────────────
// Genera reportes mensuales en PDF y permite compartir por WhatsApp / Web Share API

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

function fmt(n) {
  return '$' + (Number(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })
}

function fmtFecha(ds) {
  if (!ds) return ''
  const [y, m, d] = ds.split('-')
  return `${d}/${m}/${y.slice(2)}`
}

// ── GENERA PDF MENSUAL ────────────────────────────────────────────────────────
export function generateMonthlyPDF({ resumen, gastos, year, month, nombreFlota = 'Flota' }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const M = 40
  let y = M

  // ── HEADER ──────────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(15, 15, 26)
  doc.text(nombreFlota, M, y)
  y += 8

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(106, 112, 128)
  doc.text(`Reporte mensual · ${MESES[month - 1]} ${year}`, M, y + 14)
  y += 24

  // Fecha de emisión arriba derecha
  const hoy = new Date()
  const hoyStr = `${String(hoy.getDate()).padStart(2,'0')}/${String(hoy.getMonth()+1).padStart(2,'0')}/${hoy.getFullYear()}`
  doc.setFontSize(9)
  doc.setTextColor(150, 155, 170)
  doc.text(`Emitido: ${hoyStr}`, W - M, M + 4, { align: 'right' })

  y += 16

  // ── RESUMEN EJECUTIVO ───────────────────────────────────────────────────────
  const totales = resumen?.totales || {}
  const ingresos = totales.mes || 0
  const gastosTotal = (gastos || []).filter(g => {
    const gy = parseInt(g.fecha?.slice(0,4), 10)
    const gm = parseInt(g.fecha?.slice(5,7), 10)
    return gy === year && gm === month
  }).reduce((acc, g) => acc + (parseFloat(g.monto) || 0), 0)
  const neto = ingresos - gastosTotal
  const margen = ingresos > 0 ? (neto / ingresos * 100) : 0

  // Caja resumen
  doc.setDrawColor(216, 218, 232)
  doc.setLineWidth(0.5)
  doc.roundedRect(M, y, W - M*2, 90, 8, 8)

  const cellW = (W - M*2) / 4
  const drawCell = (label, value, color, idx) => {
    const cx = M + cellW * idx
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(106, 112, 128)
    doc.text(label.toUpperCase(), cx + 14, y + 20)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(...color)
    doc.text(value, cx + 14, y + 52)
  }
  drawCell('Ingresos', fmt(ingresos), [29, 78, 216], 0)
  drawCell('Gastos', fmt(gastosTotal), [220, 38, 38], 1)
  drawCell('Neto', fmt(neto), [6, 95, 70], 2)
  drawCell('Margen', `${margen.toFixed(0)}%`, [194, 65, 12], 3)

  y += 110

  // ── POR AUTO ────────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(15, 15, 26)
  doc.text('Por auto', M, y)
  y += 4

  const autoRows = Object.values(resumen?.autos || {}).map(a => {
    const g = a.ganancias || {}
    const km = a.kms_actuales - (a.kms_iniciales || 0)
    const costoKm = km > 0 ? '$' + ((a.gastos_total || 0) / km).toFixed(1) : '—'
    const m = g.mes > 0 ? Math.round((g.neto_mes / g.mes) * 100) + '%' : '—'
    return [
      a.nombre,
      fmt(g.mes),
      fmt(g.gastos_mes),
      fmt(g.neto_mes),
      m,
      (a.kms_actuales || 0).toLocaleString('es-AR'),
      costoKm,
    ]
  })

  autoTable(doc, {
    startY: y + 8,
    margin: { left: M, right: M },
    head: [['Auto', 'Ingresos', 'Gastos', 'Neto', 'Margen', 'Kms', 'Costo/km']],
    body: autoRows,
    theme: 'plain',
    headStyles: {
      fillColor: [240, 242, 248],
      textColor: [75, 80, 96],
      fontStyle: 'bold',
      fontSize: 9,
      cellPadding: 8,
    },
    bodyStyles: {
      fontSize: 10,
      cellPadding: 8,
      textColor: [15, 15, 26],
    },
    alternateRowStyles: { fillColor: [248, 249, 253] },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right', textColor: [220, 38, 38] },
      3: { halign: 'right', fontStyle: 'bold' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
    },
  })

  y = doc.lastAutoTable.finalY + 24

  // ── POR CHOFER (deudas + ganancias) ────────────────────────────────────────
  if (y > 700) { doc.addPage(); y = M }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(15, 15, 26)
  doc.text('Por chofer', M, y)

  const choferRows = []
  Object.entries(resumen?.autos || {}).forEach(([aid, autoData]) => {
    Object.entries(autoData.deudas || {}).forEach(([cid, d]) => {
      const diasDeuda = (d.dias || []).length
      const tb = autoData.turno_base || 0
      const montoDeuda = diasDeuda * tb
      choferRows.push([
        d.nombre,
        autoData.nombre,
        fmt(d.gan_mes || 0),
        fmt(d.gan_semana || 0),
        diasDeuda > 0 ? `${diasDeuda} día${diasDeuda !== 1 ? 's' : ''}` : '—',
        diasDeuda > 0 ? fmt(montoDeuda) : '—',
      ])
    })
  })

  autoTable(doc, {
    startY: y + 8,
    margin: { left: M, right: M },
    head: [['Chofer', 'Auto', 'Mes', 'Semana', 'Días debe', 'Monto deuda']],
    body: choferRows,
    theme: 'plain',
    headStyles: {
      fillColor: [240, 242, 248],
      textColor: [75, 80, 96],
      fontStyle: 'bold',
      fontSize: 9,
      cellPadding: 8,
    },
    bodyStyles: {
      fontSize: 10,
      cellPadding: 8,
      textColor: [15, 15, 26],
    },
    alternateRowStyles: { fillColor: [248, 249, 253] },
    columnStyles: {
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right', textColor: [220, 38, 38], fontStyle: 'bold' },
    },
  })

  y = doc.lastAutoTable.finalY + 24

  // ── GASTOS DEL MES ──────────────────────────────────────────────────────────
  const gastosMes = (gastos || [])
    .filter(g => {
      const gy = parseInt(g.fecha?.slice(0, 4), 10)
      const gm = parseInt(g.fecha?.slice(5, 7), 10)
      return gy === year && gm === month
    })
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))

  if (gastosMes.length > 0) {
    if (y > 700) { doc.addPage(); y = M }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(15, 15, 26)
    doc.text(`Gastos del mes (${gastosMes.length})`, M, y)

    const gastosRows = gastosMes.map(g => [
      fmtFecha(g.fecha),
      g.autos?.nombre || '—',
      g.descripcion || '',
      (g.categoria || 'otro').toUpperCase(),
      fmt(g.monto),
    ])

    autoTable(doc, {
      startY: y + 8,
      margin: { left: M, right: M },
      head: [['Fecha', 'Auto', 'Descripción', 'Categoría', 'Monto']],
      body: gastosRows,
      theme: 'plain',
      headStyles: {
        fillColor: [240, 242, 248],
        textColor: [75, 80, 96],
        fontStyle: 'bold',
        fontSize: 9,
        cellPadding: 8,
      },
      bodyStyles: {
        fontSize: 9,
        cellPadding: 6,
        textColor: [15, 15, 26],
      },
      alternateRowStyles: { fillColor: [248, 249, 253] },
      columnStyles: {
        3: { fontSize: 8, textColor: [106, 112, 128] },
        4: { halign: 'right', textColor: [220, 38, 38], fontStyle: 'bold' },
      },
    })
  }

  // ── FOOTER ──────────────────────────────────────────────────────────────────
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(150, 155, 170)
    doc.text(`Página ${i} de ${pageCount}`, W - M, doc.internal.pageSize.getHeight() - 20, { align: 'right' })
    doc.text('Generado con Flota', M, doc.internal.pageSize.getHeight() - 20)
  }

  return doc
}

// ── DESCARGA / COMPARTIR ──────────────────────────────────────────────────────
export function downloadPDF(doc, filename = 'reporte.pdf') {
  doc.save(filename)
}

export async function sharePDF(doc, filename = 'reporte.pdf', title = 'Reporte Flota') {
  const blob = doc.output('blob')
  const file = new File([blob], filename, { type: 'application/pdf' })

  // Web Share API con archivos (móvil moderno)
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title,
        text: title,
      })
      return { shared: true }
    } catch (e) {
      // Cancelado por el usuario → no es error
      if (e.name === 'AbortError') return { shared: false, cancelled: true }
      // Caer al fallback
    }
  }

  // Fallback: descargar
  doc.save(filename)
  return { shared: false, downloaded: true }
}

// ── COMPARTIR RESUMEN POR WHATSAPP (texto plano) ─────────────────────────────
export function buildWhatsAppSummary({ resumen, gastos, year, month, nombreFlota = 'Flota' }) {
  const totales = resumen?.totales || {}
  const ingresos = totales.mes || 0
  const gastosMesTotal = (gastos || []).filter(g => {
    const gy = parseInt(g.fecha?.slice(0,4), 10)
    const gm = parseInt(g.fecha?.slice(5,7), 10)
    return gy === year && gm === month
  }).reduce((acc, g) => acc + (parseFloat(g.monto) || 0), 0)
  const neto = ingresos - gastosMesTotal
  const margen = ingresos > 0 ? Math.round(neto / ingresos * 100) : 0

  const lines = []
  lines.push(`*${nombreFlota}*`)
  lines.push(`Resumen ${MESES[month - 1]} ${year}`)
  lines.push('')
  lines.push(`💰 Ingresos: ${fmt(ingresos)}`)
  lines.push(`💸 Gastos: ${fmt(gastosMesTotal)}`)
  lines.push(`✅ Neto: ${fmt(neto)} (${margen}%)`)
  lines.push('')
  lines.push('*Por auto:*')

  Object.values(resumen?.autos || {}).forEach(a => {
    const g = a.ganancias || {}
    lines.push(`• ${a.nombre}: ${fmt(g.neto_mes)} neto`)
  })

  // Deudas activas
  const deudasList = []
  Object.values(resumen?.autos || {}).forEach(autoData => {
    Object.values(autoData.deudas || {}).forEach(d => {
      const diasDeuda = (d.dias || []).length
      if (diasDeuda > 0) {
        const tb = autoData.turno_base || 0
        deudasList.push(`• ${d.nombre}: ${diasDeuda}d (${fmt(diasDeuda * tb)})`)
      }
    })
  })

  if (deudasList.length > 0) {
    lines.push('')
    lines.push('*Deudas activas:*')
    deudasList.forEach(d => lines.push(d))
  }

  return lines.join('\n')
}

export function shareWhatsApp(text, phone = '') {
  const encoded = encodeURIComponent(text)
  const url = phone
    ? `https://wa.me/${phone.replace(/\D/g, '')}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`
  window.open(url, '_blank', 'noopener,noreferrer')
}

// ── REPORTE SEMANAL DE COMPROBANTES ──────────────────────────────────────────
export function generateComprobantesReport({ turnos = [], fechaDesde, fechaHasta, nombreFlota = 'Flota' }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const M = 40
  let y = M

  // Header
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(15, 15, 26)
  doc.text(nombreFlota, M, y)
  y += 8

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(106, 112, 128)
  const desdeFmt = fmtFecha(fechaDesde)
  const hastaFmt = fmtFecha(fechaHasta)
  doc.text(`Comprobantes recibidos · ${desdeFmt} al ${hastaFmt}`, M, y + 14)
  y += 24

  const hoy = new Date()
  const hoyStr = `${String(hoy.getDate()).padStart(2,'0')}/${String(hoy.getMonth()+1).padStart(2,'0')}/${hoy.getFullYear()}`
  doc.setFontSize(9)
  doc.setTextColor(150, 155, 170)
  doc.text(`Emitido: ${hoyStr}`, W - M, M + 4, { align: 'right' })

  y += 30

  if (turnos.length === 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(12)
    doc.setTextColor(106, 112, 128)
    doc.text('Sin comprobantes en este período.', M, y)
  } else {
    // Resumen rápido
    const totalMonto = turnos.reduce((acc, t) => acc + (t.monto || 0), 0)
    const completos = turnos.filter(t => t.estado === 'completo').length
    const parciales = turnos.filter(t => t.estado === 'parcial').length

    doc.setDrawColor(216, 218, 232)
    doc.setLineWidth(0.5)
    doc.roundedRect(M, y, W - M*2, 64, 6, 6)

    const cw = (W - M*2) / 3
    const cells = [
      ['Comprobantes', `${turnos.length}`, [29, 78, 216]],
      ['Completos / Parciales', `${completos} / ${parciales}`, [6, 95, 70]],
      ['Total cobrado', fmt(totalMonto), [15, 15, 26]],
    ]
    cells.forEach(([label, val, color], i) => {
      const cx = M + cw * i
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(106, 112, 128)
      doc.text(label.toUpperCase(), cx + 12, y + 18)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(13)
      doc.setTextColor(...color)
      doc.text(val, cx + 12, y + 46)
    })

    y += 84

    // Tabla detallada
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(15, 15, 26)
    doc.text(`Detalle (${turnos.length})`, M, y)

    const rows = turnos.map(t => {
      const choferNombre = t.choferes?.nombre || '—'
      const autoNombre = t.choferes?.autos?.nombre || '—'
      const estado = t.estado === 'completo' ? 'Completo' : t.estado === 'parcial' ? 'Parcial' : t.estado || '—'
      const marcado = t.marcado_por === 'chofer' ? 'Chofer' : 'Dueño'
      return [
        fmtFecha(t.fecha),
        choferNombre,
        autoNombre,
        fmt(t.monto),
        estado,
        marcado,
        t.comprobante_url ? 'Ver →' : '—',
      ]
    })

    autoTable(doc, {
      startY: y + 8,
      margin: { left: M, right: M },
      head: [['Fecha', 'Chofer', 'Auto', 'Monto', 'Estado', 'Marcado por', 'Comprobante']],
      body: rows,
      theme: 'plain',
      headStyles: {
        fillColor: [240, 242, 248],
        textColor: [75, 80, 96],
        fontStyle: 'bold',
        fontSize: 9,
        cellPadding: 7,
      },
      bodyStyles: {
        fontSize: 9,
        cellPadding: 7,
        textColor: [15, 15, 26],
      },
      alternateRowStyles: { fillColor: [248, 249, 253] },
      columnStyles: {
        3: { halign: 'right', fontStyle: 'bold' },
        4: { halign: 'center' },
        5: { halign: 'center', textColor: [106, 112, 128] },
        6: { halign: 'center', textColor: [29, 78, 216] },
      },
      didDrawCell: (data) => {
        // Agregar link clickeable en columna "Comprobante"
        if (data.column.index === 6 && data.cell.section === 'body') {
          const turno = turnos[data.row.index]
          if (turno?.comprobante_url) {
            doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url: turno.comprobante_url })
          }
        }
      },
    })
  }

  // Footer
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(150, 155, 170)
    doc.text(`Página ${i} de ${pageCount}`, W - M, doc.internal.pageSize.getHeight() - 20, { align: 'right' })
    doc.text('Generado con Flota', M, doc.internal.pageSize.getHeight() - 20)
  }

  return doc
}
