import { supabase } from './supabase'

// ── CONFIG ────────────────────────────────────────────────────────────────────
export async function getConfig() {
  const [configRes, autosRes, choferesRes, mantItemsRes] = await Promise.all([
    supabase.from('config').select('*'),
    supabase.from('autos').select('*'),
    supabase.from('choferes').select('*'),
    supabase.from('mantenimiento_items').select('*'),
  ])
  const cfg = {}
  for (const row of configRes.data || []) cfg[row.clave] = row.valor
  return {
    turno_base: parseInt(cfg.turno_base || '50000'),
    franco_weekday: parseInt(cfg.franco_weekday || '1'),
    autos: autosRes.data || [],
    choferes: choferesRes.data || [],
    mant_items: mantItemsRes.data || [],
  }
}

export async function updateConfig(clave, valor) {
  return supabase.from('config').upsert({ clave, valor: String(valor) })
}

// ── RESUMEN ───────────────────────────────────────────────────────────────────
export async function getResumen() {
  const hoy = new Date()
  const inicioMes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`
  const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1)
  const ayerStr = ayer.toISOString().split('T')[0]
  const lunesStr = getLunes(hoy)

  const [cfg, turnosRes, gastosRes, mantRes, kmsRes, francosRes] = await Promise.all([
    getConfig(),
    supabase.from('turnos').select('*, choferes(auto_id)').gte('fecha', inicioMes),
    supabase.from('gastos').select('*').gte('fecha', inicioMes),
    supabase.from('mantenimiento').select('*'),
    supabase.from('kms').select('*'),
    supabase.from('francos').select('*').gte('fecha', inicioMes),
  ])

  const turnos = turnosRes.data || []
  const gastos = gastosRes.data || []
  const mantRealizados = mantRes.data || []
  const kmsData = kmsRes.data || []
  const francosManuales = francosRes.data || []

  // Mapa kms por auto
  const kmsMap = {}
  for (const k of kmsData) kmsMap[k.auto_id] = k.kms_actuales

  // Mapa francos manuales {chofer_id: Set<fecha>}
  const francosMap = {}
  for (const f of francosManuales) {
    if (!francosMap[f.chofer_id]) francosMap[f.chofer_id] = new Set()
    francosMap[f.chofer_id].add(f.fecha)
  }

  const resultado = {}
  let totalSemana = 0, totalMes = 0

  for (const auto of cfg.autos) {
    const choferesAuto = cfg.choferes.filter(c => c.auto_id === auto.id)
    const gastosAuto = gastos.filter(g => g.auto_id === auto.id)
    const gastosMes = gastosAuto.reduce((s, g) => s + parseFloat(g.monto), 0)

    let ganSemana = 0, ganMes = 0
    const deudasPorChofer = {}

    for (const chofer of choferesAuto) {
      const turnosChofer = turnos.filter(t => t.chofer_id === chofer.id)
      const turnosMap = {}
      for (const t of turnosChofer) turnosMap[t.fecha] = parseFloat(t.monto)

      let gSem = 0, gMes = 0
      const diasDebe = []

      // Iterar días del mes
      const d = new Date(inicioMes)
      while (d <= hoy) {
        const ds = d.toISOString().split('T')[0]
        const monto = turnosMap[ds] || 0
        const esFranco = isFranco(d, chofer.id, cfg.franco_weekday, francosMap)

        if (monto > 0) {
          gMes += monto
          if (ds >= lunesStr) gSem += monto
        } else if (!esFranco && ds <= ayerStr) {
          diasDebe.push(ds)
        }
        d.setDate(d.getDate() + 1)
      }

      ganSemana += gSem
      ganMes += gMes
      deudasPorChofer[chofer.id] = { nombre: chofer.nombre, dias: diasDebe, gan_semana: gSem, gan_mes: gMes }
    }

    totalSemana += ganSemana
    totalMes += ganMes

    // Mantenimiento
    const kmsAct = kmsMap[auto.id] || 0
    const mantStatus = calcMantStatus(cfg.mant_items, mantRealizados.filter(m => m.auto_id === auto.id), kmsAct)

    resultado[auto.id] = {
      nombre: auto.nombre,
      kms_actuales: kmsAct,
      turno_base: cfg.turno_base,
      ganancias: { semana: ganSemana, mes: ganMes, gastos_mes: gastosMes, neto_mes: ganMes - gastosMes },
      deudas: deudasPorChofer,
      mantenimiento: mantStatus,
    }
  }

  return {
    autos: resultado,
    totales: { semana: totalSemana, mes: totalMes },
    config: cfg,
  }
}

function calcMantStatus(items, realizados, kmsAct) {
  return items.map(item => {
    const servicios = realizados.filter(r => r.tipo === item.id)
    const ultimoKms = servicios.length > 0 ? Math.max(...servicios.map(s => s.kms_en_service || 0)) : 0
    const proximo = ultimoKms + item.frecuencia_kms
    const faltan = proximo - kmsAct
    return {
      ...item,
      ultimo_kms: ultimoKms,
      proximo_kms: proximo,
      faltan_kms: faltan,
      estado: faltan <= 0 ? 'CAMBIAR' : 'OK',
    }
  })
}

// ── CALENDARIO ────────────────────────────────────────────────────────────────
export async function getCalendario(year, month) {
  const inicioMes = `${year}-${String(month).padStart(2, '0')}-01`
  const daysInMonth = new Date(year, month, 0).getDate()
  const finMes = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`

  const [cfg, turnosRes, francosRes] = await Promise.all([
    getConfig(),
    supabase.from('turnos').select('*, choferes(auto_id)').gte('fecha', inicioMes).lte('fecha', finMes),
    supabase.from('francos').select('*').gte('fecha', inicioMes).lte('fecha', finMes),
  ])

  const turnos = turnosRes.data || []
  const francos = francosRes.data || []
  const hoy = new Date().toISOString().split('T')[0]

  // Mapa turnos {chofer_id: {fecha: monto}}
  const turnosMap = {}
  for (const t of turnos) {
    if (!turnosMap[t.chofer_id]) turnosMap[t.chofer_id] = {}
    turnosMap[t.chofer_id][t.fecha] = parseFloat(t.monto)
  }

  // Mapa francos {chofer_id: Set<fecha>}
  const francosMap = {}
  for (const f of francos) {
    if (!francosMap[f.chofer_id]) francosMap[f.chofer_id] = new Set()
    francosMap[f.chofer_id].add(f.fecha)
  }

  const resultado = {}
  for (const auto of cfg.autos) {
    const choferesAuto = cfg.choferes.filter(c => c.auto_id === auto.id)
    const dias = {}

    for (let day = 1; day <= daysInMonth; day++) {
      const ds = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const d = new Date(year, month - 1, day)
      const diaInfo = {}

      for (const chofer of choferesAuto) {
        const franco = isFranco(d, chofer.id, cfg.franco_weekday, francosMap)
        const monto = turnosMap[chofer.id]?.[ds] ?? null
        let estado
        if (franco) estado = 'franco'
        else if (monto !== null && monto >= cfg.turno_base) estado = 'completo'
        else if (monto !== null && monto > 0) estado = 'parcial'
        else if (ds < hoy) estado = 'debe'
        else estado = 'futuro'

        diaInfo[chofer.id] = { nombre: chofer.nombre, estado, monto, franco_manual: francosMap[chofer.id]?.has(ds) }
      }
      dias[ds] = diaInfo
    }

    resultado[auto.id] = {
      nombre: auto.nombre,
      choferes: Object.fromEntries(choferesAuto.map(c => [c.id, c.nombre])),
      dias,
    }
  }

  return { ...resultado, franco_weekday: cfg.franco_weekday }
}

// ── TURNOS ────────────────────────────────────────────────────────────────────
export async function upsertTurno(chofer_id, fecha, monto) {
  // Verificar si ya existe
  const { data } = await supabase.from('turnos').select('id').eq('chofer_id', chofer_id).eq('fecha', fecha).single()
  if (data) {
    return supabase.from('turnos').update({ monto }).eq('id', data.id)
  }
  return supabase.from('turnos').insert({ chofer_id, fecha, monto })
}

// ── FRANCOS ───────────────────────────────────────────────────────────────────
export async function marcarFranco(chofer_id, fecha, motivo = 'franco_especial') {
  return supabase.from('francos').upsert({ chofer_id, fecha, motivo }, { onConflict: 'chofer_id,fecha' })
}

export async function quitarFranco(chofer_id, fecha) {
  return supabase.from('francos').delete().eq('chofer_id', chofer_id).eq('fecha', fecha)
}

// ── GASTOS ────────────────────────────────────────────────────────────────────
export async function insertGasto(auto_id, descripcion, monto, categoria, fecha) {
  return supabase.from('gastos').insert({ auto_id, descripcion, monto, categoria, fecha })
}

export async function getGastos(auto_id = null) {
  let q = supabase.from('gastos').select('*, autos(nombre)').order('fecha', { ascending: false })
  if (auto_id) q = q.eq('auto_id', auto_id)
  return q
}

// ── KMS ───────────────────────────────────────────────────────────────────────
export async function updateKms(auto_id, kms_actuales) {
  return supabase.from('kms').upsert({ auto_id, kms_actuales, actualizado_en: new Date().toISOString().split('T')[0] })
}

// ── MANTENIMIENTO ─────────────────────────────────────────────────────────────
export async function insertMantenimiento(auto_id, tipo, kms_en_service, costo, fecha) {
  // También actualizar kms
  await updateKms(auto_id, kms_en_service)
  return supabase.from('mantenimiento').insert({ auto_id, tipo, kms_en_service, costo, fecha })
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function getLunes(d) {
  const lunes = new Date(d)
  lunes.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return lunes.toISOString().split('T')[0]
}

function isFranco(d, chofer_id, franco_weekday, francosMap) {
  const ds = d.toISOString().split('T')[0]
  if (francosMap[chofer_id]?.has(ds)) return true
  return d.getDay() === (franco_weekday === 0 ? 0 : (parseInt(franco_weekday) + 1) % 7 === 0 ? 7 : parseInt(franco_weekday) + 1) % 7
}
