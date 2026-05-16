import { supabase } from './supabase'

async function uid() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user?.id) throw new Error('Sesión expirada. Volvé a iniciar sesión.')
  return session.user.id
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
export async function signUp(email, password) {
  return supabase.auth.signUp({ email, password })
}
export async function signIn(email, password) {
  return supabase.auth.signInWithPassword({ email, password })
}
export async function signOut() {
  return supabase.auth.signOut()
}
export async function getProfile() {
  const { data } = await supabase.from('profiles').select('*').maybeSingle()
  return data
}
export async function checkFleet() {
  const { data } = await supabase.from('autos').select('id').limit(1)
  return (data?.length || 0) > 0
}

// ── ADMIN ─────────────────────────────────────────────────────────────────────
export async function getAdminUsers() {
  return supabase.rpc('get_all_profiles')
}
export async function setUserActivo(id, activo) {
  return supabase.rpc('admin_set_activo', { target_id: id, new_activo: activo })
}
export async function addPayment(id) {
  return supabase.rpc('admin_add_payment', { target_id: id })
}

// ── ONBOARDING ────────────────────────────────────────────────────────────────
export async function createFleet({ turnoBase, francoWeekday, autos }) {
  let user_id
  try {
    user_id = await uid()
  } catch {
    return { error: { message: 'No autenticado' } }
  }

  const { error: cfgErr } = await supabase.from('config').upsert([
    { user_id, clave: 'turno_base', valor: String(turnoBase) },
    { user_id, clave: 'franco_weekday', valor: String(francoWeekday) },
  ], { onConflict: 'user_id,clave' })
  if (cfgErr) return { error: cfgErr }

  const createdAutoIds = []
  try {
    for (const auto of autos) {
      const nombre = auto.nombre.trim()
      if (!nombre) continue
      const { data: autoData, error: autoErr } = await supabase
        .from('autos').insert({ user_id, nombre, turno_base: turnoBase }).select('id').single()
      if (autoErr) throw autoErr
      createdAutoIds.push(autoData.id)

      for (const choferNombre of auto.choferes) {
        const cn = choferNombre.trim()
        if (!cn) continue
        const { error: chErr } = await supabase.from('choferes').insert({ user_id, auto_id: autoData.id, nombre: cn })
        if (chErr) throw chErr
      }
      await supabase.from('kms').insert({
        user_id,
        auto_id: autoData.id,
        kms_actuales: 0,
        actualizado_en: new Date().toISOString().split('T')[0],
      })
    }

    await supabase.from('user_mant_items').insert([
      { user_id, nombre: 'Aceite y filtros', frecuencia_kms: 10000 },
      { user_id, nombre: 'Distribución', frecuencia_kms: 60000 },
    ])

    return { error: null }
  } catch (err) {
    // Intentar limpiar autos creados parcialmente
    if (createdAutoIds.length > 0) {
      await supabase.from('autos').delete().in('id', createdAutoIds)
    }
    return { error: err }
  }
}

// ── FLOTA (autos, choferes, mantenimiento items) ───────────────────────────────
export async function createAuto(nombre, turnoBase) {
  const user_id = await uid()
  return supabase.from('autos').insert({ user_id, nombre, turno_base: turnoBase }).select('id').single()
}

export async function createChofer(autoId, nombre) {
  const user_id = await uid()
  return supabase.from('choferes').insert({ user_id, auto_id: autoId, nombre })
}

export async function updateAutoTurnoBase(autoId, turnoBase) {
  return supabase.from('autos').update({ turno_base: turnoBase }).eq('id', autoId)
}

export async function deleteAuto(autoId) {
  // Obtener choferes del auto para borrar turnos y francos
  const { data: choferesData } = await supabase.from('choferes').select('id').eq('auto_id', autoId)
  const choferIds = (choferesData || []).map(c => c.id)

  if (choferIds.length > 0) {
    await supabase.from('turnos').delete().in('chofer_id', choferIds)
    await supabase.from('francos').delete().in('chofer_id', choferIds)
    await supabase.from('choferes').delete().in('id', choferIds)
  }

  await supabase.from('gastos').delete().eq('auto_id', autoId)
  await supabase.from('mantenimiento').delete().eq('auto_id', autoId)
  await supabase.from('kms').delete().eq('auto_id', autoId)

  return supabase.from('autos').delete().eq('id', autoId)
}

export async function updateAutoVencimientos(autoId, vtv_vence, seguro_vence) {
  return supabase.from('autos').update({
    vtv_vence: vtv_vence || null,
    seguro_vence: seguro_vence || null,
  }).eq('id', autoId)
}

export async function updateChofer(id, nombre) {
  return supabase.from('choferes').update({ nombre }).eq('id', id)
}

export async function getUserMantItems() {
  return supabase.from('user_mant_items').select('*').order('nombre')
}

export async function createMantItem(nombre, frecuenciaKms, autoId = null) {
  const user_id = await uid()
  return supabase.from('user_mant_items').insert({ user_id, nombre, frecuencia_kms: frecuenciaKms, auto_id: autoId || null })
}

export async function updateMantItem(id, nombre, frecuenciaKms, autoId = null) {
  return supabase.from('user_mant_items').update({ nombre, frecuencia_kms: frecuenciaKms, auto_id: autoId || null }).eq('id', id)
}

export async function deleteMantItem(id) {
  return supabase.from('user_mant_items').delete().eq('id', id)
}

// ── CONFIG ────────────────────────────────────────────────────────────────────
export async function getConfig() {
  const [configRes, autosRes, choferesRes, mantItemsRes] = await Promise.all([
    supabase.from('config').select('*'),
    supabase.from('autos').select('*'),
    supabase.from('choferes').select('*'),
    supabase.from('user_mant_items').select('*'),
  ])

  if (configRes.error) throw configRes.error
  if (autosRes.error) throw autosRes.error
  if (choferesRes.error) throw choferesRes.error
  if (mantItemsRes.error) throw mantItemsRes.error

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
  const user_id = await uid()
  return supabase.from('config').upsert({ user_id, clave, valor: String(valor) }, { onConflict: 'user_id,clave' })
}

// ── RESUMEN ───────────────────────────────────────────────────────────────────
export async function getResumen(cfg = null) {
  const hoy = new Date()
  const inicioMes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`
  const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1)
  const ayerStr = ayer.toISOString().split('T')[0]
  const lunesStr = getLunes(hoy)

  const [cfgData, turnosRes, gastosRes, mantRes, kmsRes, francosRes] = await Promise.all([
    cfg ? Promise.resolve(cfg) : getConfig(),
    supabase.from('turnos').select('*, choferes(auto_id)').gte('fecha', inicioMes),
    supabase.from('gastos').select('*').gte('fecha', inicioMes),
    supabase.from('mantenimiento').select('*'),
    supabase.from('kms').select('*'),
    supabase.from('francos').select('*').gte('fecha', inicioMes),
  ])

  const resolvedCfg = cfg ? cfgData : cfgData
  const turnos = turnosRes.data || []
  const gastos = gastosRes.data || []
  const mantRealizados = mantRes.data || []
  const kmsData = kmsRes.data || []
  const francosManuales = francosRes.data || []

  const kmsMap = {}
  for (const k of kmsData) kmsMap[k.auto_id] = k.kms_actuales

  // Usar Map para unificar con getCalendario
  const francosMap = {}
  for (const f of francosManuales) {
    if (!francosMap[f.chofer_id]) francosMap[f.chofer_id] = new Map()
    francosMap[f.chofer_id].set(f.fecha, f.motivo || 'franco_especial')
  }

  const resultado = {}
  let totalSemana = 0, totalMes = 0

  for (const auto of resolvedCfg.autos) {
    const autoTurnoBase = auto.turno_base || resolvedCfg.turno_base
    const choferesAuto = resolvedCfg.choferes.filter(c => c.auto_id === auto.id)
    const gastosAuto = gastos.filter(g => g.auto_id === auto.id)
    const gastosMes    = gastosAuto.reduce((s, g) => s + parseFloat(g.monto), 0)
    const gastosSemana = gastosAuto.filter(g => g.fecha >= lunesStr).reduce((s, g) => s + parseFloat(g.monto), 0)

    let ganSemana = 0, ganMes = 0
    const deudasPorChofer = {}

    for (const chofer of choferesAuto) {
      const turnosChofer = turnos.filter(t => t.chofer_id === chofer.id)
      const turnosMap = {}
      for (const t of turnosChofer) turnosMap[t.fecha] = parseFloat(t.monto)

      let gSem = 0, gMes = 0
      const diasDebe = []

      const d = new Date(inicioMes)
      while (d <= hoy) {
        const ds = d.toISOString().split('T')[0]
        const monto = turnosMap[ds] || 0
        const esFranco = isFranco(d, chofer.id, resolvedCfg.franco_weekday, francosMap)
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

    const kmsAct = kmsMap[auto.id] || 0
    const autoItems = resolvedCfg.mant_items.filter(item => !item.auto_id || item.auto_id === auto.id)
    const mantStatus = calcMantStatus(autoItems, mantRealizados.filter(m => m.auto_id === auto.id), kmsAct)

    resultado[auto.id] = {
      nombre: auto.nombre,
      turno_base: autoTurnoBase,
      kms_actuales: kmsAct,
      ganancias: {
        semana: ganSemana, mes: ganMes,
        gastos_semana: gastosSemana, gastos_mes: gastosMes,
        neto_semana: ganSemana - gastosSemana, neto_mes: ganMes - gastosMes,
      },
      deudas: deudasPorChofer,
      mantenimiento: mantStatus,
    }
  }

  const totalNetoSemana = Object.values(resultado).reduce((s, a) => s + (a.ganancias.neto_semana || 0), 0)
  const totalNetoMes    = Object.values(resultado).reduce((s, a) => s + (a.ganancias.neto_mes    || 0), 0)

  return {
    autos: resultado,
    totales: { semana: totalSemana, mes: totalMes, neto_semana: totalNetoSemana, neto_mes: totalNetoMes },
    config: resolvedCfg,
  }
}

function calcMantStatus(items, realizados, kmsAct) {
  return items.map(item => {
    const servicios = realizados.filter(r => r.tipo === item.id)
    // Usar reduce en lugar de Math.max(...spread) para evitar stack overflow con muchos registros
    const ultimoKms = servicios.reduce((max, s) => Math.max(max, s.kms_en_service || 0), 0)
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
export async function getCalendario(year, month, cfg = null) {
  const inicioMes = `${year}-${String(month).padStart(2, '0')}-01`
  const daysInMonth = new Date(year, month, 0).getDate()
  const finMes = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`

  const [cfgData, turnosRes, francosRes] = await Promise.all([
    cfg ? Promise.resolve(cfg) : getConfig(),
    supabase.from('turnos').select('*, choferes(auto_id)').gte('fecha', inicioMes).lte('fecha', finMes),
    supabase.from('francos').select('*').gte('fecha', inicioMes).lte('fecha', finMes),
  ])

  const resolvedCfg = cfg ? cfgData : cfgData
  const turnos = turnosRes.data || []
  const francos = francosRes.data || []
  const hoy = new Date().toISOString().split('T')[0]

  const turnosMap = {}
  for (const t of turnos) {
    if (!turnosMap[t.chofer_id]) turnosMap[t.chofer_id] = {}
    turnosMap[t.chofer_id][t.fecha] = parseFloat(t.monto)
  }

  const francosMap = {}
  for (const f of francos) {
    if (!francosMap[f.chofer_id]) francosMap[f.chofer_id] = new Map()
    francosMap[f.chofer_id].set(f.fecha, f.motivo || 'franco_especial')
  }

  const resultado = {}
  for (const auto of resolvedCfg.autos) {
    const autoTurnoBase = auto.turno_base || resolvedCfg.turno_base
    const choferesAuto = resolvedCfg.choferes.filter(c => c.auto_id === auto.id)
    const dias = {}

    for (let day = 1; day <= daysInMonth; day++) {
      const ds = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const d = new Date(year, month - 1, day)
      const diaInfo = {}

      for (const chofer of choferesAuto) {
        const franco = isFranco(d, chofer.id, resolvedCfg.franco_weekday, francosMap)
        const monto = turnosMap[chofer.id]?.[ds] ?? null
        let estado
        if (franco) estado = 'franco'
        else if (monto !== null && monto >= autoTurnoBase) estado = 'completo'
        else if (monto !== null && monto > 0) estado = 'parcial'
        else if (ds < hoy) estado = 'debe'
        else estado = 'futuro'
        diaInfo[chofer.id] = { nombre: chofer.nombre, estado, monto, franco_manual: francosMap[chofer.id]?.has(ds) }
      }
      dias[ds] = diaInfo
    }

    resultado[auto.id] = {
      nombre: auto.nombre,
      turno_base: autoTurnoBase,
      choferes: Object.fromEntries(choferesAuto.map(c => [c.id, c.nombre])),
      dias,
    }
  }

  return { ...resultado, franco_weekday: resolvedCfg.franco_weekday }
}

// ── TURNOS ────────────────────────────────────────────────────────────────────
export async function upsertTurno(chofer_id, fecha, monto) {
  const user_id = await uid()
  return supabase.from('turnos').upsert({ user_id, chofer_id, fecha, monto }, { onConflict: 'chofer_id,fecha' })
}
export async function deleteTurno(chofer_id, fecha) {
  return supabase.from('turnos').delete().eq('chofer_id', chofer_id).eq('fecha', fecha)
}

// ── FRANCOS ───────────────────────────────────────────────────────────────────
export async function marcarFranco(chofer_id, fecha, motivo = 'franco_especial') {
  const user_id = await uid()
  return supabase.from('francos').upsert({ user_id, chofer_id, fecha, motivo }, { onConflict: 'chofer_id,fecha' })
}
export async function quitarFranco(chofer_id, fecha) {
  const user_id = await uid()
  return supabase.from('francos').upsert({ user_id, chofer_id, fecha, motivo: 'no_franco' }, { onConflict: 'chofer_id,fecha' })
}

// ── GASTOS ────────────────────────────────────────────────────────────────────
export async function insertGasto(auto_id, descripcion, monto, categoria, fecha) {
  const user_id = await uid()
  return supabase.from('gastos').insert({ user_id, auto_id, descripcion, monto, categoria, fecha })
}
export async function deleteGasto(id) {
  return supabase.from('gastos').delete().eq('id', id)
}
export async function getGastos(auto_id = null) {
  let q = supabase.from('gastos').select('*, autos(nombre)').order('fecha', { ascending: false })
  if (auto_id) q = q.eq('auto_id', auto_id)
  return q
}

// ── KMS ───────────────────────────────────────────────────────────────────────
export async function updateKms(auto_id, kms_actuales) {
  const user_id = await uid()
  return supabase.from('kms').upsert(
    { user_id, auto_id, kms_actuales, actualizado_en: new Date().toISOString().split('T')[0] },
    { onConflict: 'user_id,auto_id' }
  )
}

// ── MANTENIMIENTO ─────────────────────────────────────────────────────────────
export async function insertMantenimiento(auto_id, tipo, kms_en_service, costo, fecha) {
  const user_id = await uid()
  return supabase.from('mantenimiento').insert({ user_id, auto_id, tipo, kms_en_service, costo, fecha })
}

// ── STATS ─────────────────────────────────────────────────────────────────────
export async function getMonthlyStats() {
  const now = new Date()
  const since = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString().split('T')[0]

  const [turnosRes, gastosRes] = await Promise.all([
    supabase.from('turnos').select('fecha, monto').gte('fecha', since),
    supabase.from('gastos').select('fecha, monto').gte('fecha', since),
  ])

  const meses = {}
  for (let i = 0; i <= 5; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    meses[key] = { key, mes: d.getMonth() + 1, año: d.getFullYear(), turnos: 0, gastos: 0 }
  }

  for (const t of turnosRes.data || []) {
    const k = t.fecha.slice(0, 7)
    if (meses[k]) meses[k].turnos += parseFloat(t.monto)
  }
  for (const g of gastosRes.data || []) {
    const k = g.fecha.slice(0, 7)
    if (meses[k]) meses[k].gastos += parseFloat(g.monto)
  }

  return Object.values(meses)
}

export async function getDeudaHistorica(cfg = null) {
  const hoy = new Date()
  const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1)
  const ayerStr = ayer.toISOString().split('T')[0]

  const resolvedCfg = cfg || await getConfig()

  // Fecha mínima = el auto más antiguo de la flota
  const fechaMinima = resolvedCfg.autos.reduce((min, auto) => {
    const d = auto.created_at ? auto.created_at.split('T')[0] : ayerStr
    return d < min ? d : min
  }, ayerStr)

  const [turnosRes, francosRes] = await Promise.all([
    supabase.from('turnos').select('chofer_id, fecha, monto').gte('fecha', fechaMinima),
    supabase.from('francos').select('chofer_id, fecha, motivo').gte('fecha', fechaMinima),
  ])

  const turnosMap = {}
  for (const t of turnosRes.data || []) {
    if (!turnosMap[t.chofer_id]) turnosMap[t.chofer_id] = {}
    turnosMap[t.chofer_id][t.fecha] = parseFloat(t.monto)
  }
  const francosMap = {}
  for (const f of francosRes.data || []) {
    if (!francosMap[f.chofer_id]) francosMap[f.chofer_id] = new Map()
    francosMap[f.chofer_id].set(f.fecha, f.motivo || 'franco_especial')
  }

  const resultado = {}
  for (const auto of resolvedCfg.autos) {
    const autoTurnoBase = auto.turno_base || resolvedCfg.turno_base
    // Arrancar desde la fecha de creación del auto, no desde enero
    const inicioAuto = auto.created_at ? auto.created_at.split('T')[0] : fechaMinima

    for (const chofer of resolvedCfg.choferes.filter(c => c.auto_id === auto.id)) {
      let diasDebe = 0, ganTotal = 0
      const d = new Date(inicioAuto)
      while (d.toISOString().split('T')[0] <= ayerStr) {
        const ds = d.toISOString().split('T')[0]
        const pagado = turnosMap[chofer.id]?.[ds]
        if (pagado) {
          ganTotal += pagado
        } else if (!isFranco(d, chofer.id, resolvedCfg.franco_weekday, francosMap)) {
          diasDebe++
        }
        d.setDate(d.getDate() + 1)
      }
      resultado[chofer.id] = {
        nombre: chofer.nombre,
        autoNombre: auto.nombre,
        diasDebe,
        montoDebe: diasDebe * autoTurnoBase,
        ganTotal,
      }
    }
  }
  return resultado
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function getLunes(d) {
  const lunes = new Date(d)
  lunes.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return lunes.toISOString().split('T')[0]
}

function isFranco(d, chofer_id, franco_weekday, francosMap) {
  const ds = d.toISOString().split('T')[0]
  const francoData = francosMap[chofer_id]
  if (francoData instanceof Map) {
    if (francoData.get(ds) === 'no_franco') return false
    if (francoData.has(ds)) return true
  }
  const dowLunes = (d.getDay() + 6) % 7
  return dowLunes === parseInt(franco_weekday)
}
