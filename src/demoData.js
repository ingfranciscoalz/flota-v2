// ── DEMO DATA ─────────────────────────────────────────────────────────────────
// Datos ficticios para el modo demo. Ninguna llamada a Supabase.

const DEMO_AUTOS_LIST = [
  { id: 'da1', nombre: 'Corsa Blanco', turno_base: 50000, kms_actuales: 76500,  vtv_vence: '2026-06-15', seguro_vence: '2026-09-20' },
  { id: 'da2', nombre: 'Gol Negro',    turno_base: 48000, kms_actuales: 143200, vtv_vence: '2026-05-19', seguro_vence: '2026-08-10' },
]
const DEMO_CHOFERES_LIST = [
  { id: 'dc1', auto_id: 'da1', nombre: 'Carlos M.'  },
  { id: 'dc2', auto_id: 'da1', nombre: 'Roberto P.' },
  { id: 'dc3', auto_id: 'da2', nombre: 'Miguel A.'  },
  { id: 'dc4', auto_id: 'da2', nombre: 'Diego F.'   },
]
const DEMO_MANT_ITEMS = [
  { id: 'dm1', nombre: 'Aceite y filtros', frecuencia_kms: 10000 },
  { id: 'dm2', nombre: 'Distribución',     frecuencia_kms: 60000 },
]
const FRANCO_WEEKDAY = 1 // Martes (dowLunes formula)

// IDs de días con deuda por chofer (para calendario y resumen)
const DEBE_MAP = {
  dc2: ['2026-05-13', '2026-05-14', '2026-05-15'],
  dc3: ['2026-05-15'],
  dc4: ['2026-05-07', '2026-05-08', '2026-05-09', '2026-05-13', '2026-05-15'],
}

export function getDemoResumen() {
  return {
    autos: {
      da1: {
        nombre: 'Corsa Blanco',
        turno_base: 50000,
        kms_actuales: 76500,
        ganancias: { semana: 200000, mes: 550000, gastos_semana: 8500, gastos_mes: 37000, neto_semana: 191500, neto_mes: 513000 },
        deudas: {
          dc1: { nombre: 'Carlos M.',  dias: [],                        gan_semana: 100000, gan_mes: 350000 },
          dc2: { nombre: 'Roberto P.', dias: DEBE_MAP.dc2,              gan_semana: 100000, gan_mes: 200000 },
        },
        mantenimiento: [
          { id: 'dm1', nombre: 'Aceite y filtros', frecuencia_kms: 10000, ultimo_kms: 70000,  proximo_kms: 80000,  faltan_kms: 3500,  estado: 'OK'     },
          { id: 'dm2', nombre: 'Distribución',     frecuencia_kms: 60000, ultimo_kms: 20000,  proximo_kms: 80000,  faltan_kms: 3500,  estado: 'OK'     },
        ],
      },
      da2: {
        nombre: 'Gol Negro',
        turno_base: 48000,
        kms_actuales: 143200,
        ganancias: { semana: 192000, mes: 480000, gastos_semana: 9800, gastos_mes: 41500, neto_semana: 182200, neto_mes: 438500 },
        deudas: {
          dc3: { nombre: 'Miguel A.', dias: DEBE_MAP.dc3,              gan_semana: 96000, gan_mes: 336000 },
          dc4: { nombre: 'Diego F.',  dias: DEBE_MAP.dc4,              gan_semana: 96000, gan_mes: 144000 },
        },
        mantenimiento: [
          { id: 'dm1', nombre: 'Aceite y filtros', frecuencia_kms: 10000, ultimo_kms: 140000, proximo_kms: 150000, faltan_kms: 6800,  estado: 'OK'     },
          { id: 'dm2', nombre: 'Distribución',     frecuencia_kms: 60000, ultimo_kms: 80000,  proximo_kms: 140000, faltan_kms: -3200, estado: 'CAMBIAR' },
        ],
      },
    },
    totales: { semana: 392000, mes: 1030000, neto_semana: 373700, neto_mes: 951500 },
    config: {
      turno_base: 50000,
      franco_weekday: FRANCO_WEEKDAY,
      autos: DEMO_AUTOS_LIST,
      choferes: DEMO_CHOFERES_LIST,
      mant_items: DEMO_MANT_ITEMS,
    },
  }
}

export function getDemoCalendario(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate()
  const hoyStr = new Date().toISOString().split('T')[0]

  const autoChoferes = {
    da1: [{ id: 'dc1', nombre: 'Carlos M.' }, { id: 'dc2', nombre: 'Roberto P.' }],
    da2: [{ id: 'dc3', nombre: 'Miguel A.' }, { id: 'dc4', nombre: 'Diego F.'   }],
  }

  const resultado = {}
  for (const auto of DEMO_AUTOS_LIST) {
    const dias = {}
    for (let day = 1; day <= daysInMonth; day++) {
      const ds = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const d = new Date(year, month - 1, day)
      const dowLunes = (d.getDay() + 6) % 7
      const esFranco = dowLunes === FRANCO_WEEKDAY
      const diaInfo = {}

      for (const chofer of autoChoferes[auto.id]) {
        let estado, monto = null
        if (esFranco) {
          estado = 'franco'
        } else if (ds > hoyStr) {
          estado = 'futuro'
        } else if (DEBE_MAP[chofer.id]?.includes(ds)) {
          estado = 'debe'
        } else if (day % 20 === 0) {
          estado = 'parcial'; monto = Math.floor(auto.turno_base * 0.6)
        } else {
          estado = 'completo'; monto = auto.turno_base
        }
        diaInfo[chofer.id] = { nombre: chofer.nombre, estado, monto, franco_manual: false }
      }
      dias[ds] = diaInfo
    }

    resultado[auto.id] = {
      nombre: auto.nombre,
      turno_base: auto.turno_base,
      choferes: Object.fromEntries(autoChoferes[auto.id].map(c => [c.id, c.nombre])),
      dias,
    }
  }

  return { ...resultado, franco_weekday: FRANCO_WEEKDAY }
}

export function getDemoGastos() {
  return [
    { id: 'dg1', auto_id: 'da2', descripcion: 'Aceite y filtros',   monto: 15000, categoria: 'mantenimiento', fecha: '2026-05-10', autos: { nombre: 'Gol Negro'    } },
    { id: 'dg2', auto_id: 'da1', descripcion: 'Revisión de frenos', monto: 22000, categoria: 'mantenimiento', fecha: '2026-05-08', autos: { nombre: 'Corsa Blanco' } },
    { id: 'dg3', auto_id: 'da2', descripcion: 'Seguro mensual',     monto: 18500, categoria: 'seguro',        fecha: '2026-04-25', autos: { nombre: 'Gol Negro'    } },
    { id: 'dg4', auto_id: 'da1', descripcion: 'Combustible',        monto: 12000, categoria: 'combustible',   fecha: '2026-04-20', autos: { nombre: 'Corsa Blanco' } },
    { id: 'dg5', auto_id: 'da2', descripcion: 'Patente',            monto:  8500, categoria: 'impuesto',      fecha: '2026-04-15', autos: { nombre: 'Gol Negro'    } },
    { id: 'dg6', auto_id: 'da1', descripcion: 'Filtro de aire',     monto:  6000, categoria: 'mantenimiento', fecha: '2026-03-30', autos: { nombre: 'Corsa Blanco' } },
  ]
}

export function getDemoMonthlyStats() {
  const now = new Date()
  const turnos = [1450000, 1620000, 1380000, 1750000, 1920000, 1030000]
  const gastos  = [180000,  210000,  165000,  225000,  195000,   78500]
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)
    return {
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      mes: d.getMonth() + 1,
      año: d.getFullYear(),
      turnos: turnos[i],
      gastos: gastos[i],
    }
  })
}

export function getDemoDeudaHistorica() {
  return {
    dc1: { nombre: 'Carlos M.',  autoNombre: 'Corsa Blanco', diasDebe: 0, montoDebe: 0,      ganTotal: 2450000 },
    dc2: { nombre: 'Roberto P.', autoNombre: 'Corsa Blanco', diasDebe: 3, montoDebe: 150000, ganTotal: 1820000 },
    dc3: { nombre: 'Miguel A.',  autoNombre: 'Gol Negro',    diasDebe: 1, montoDebe: 48000,  ganTotal: 2280000 },
    dc4: { nombre: 'Diego F.',   autoNombre: 'Gol Negro',    diasDebe: 5, montoDebe: 240000, ganTotal: 1440000 },
  }
}
