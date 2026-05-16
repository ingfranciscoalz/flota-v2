import { useState, useEffect, useCallback } from 'react'
import { getResumen, getCalendario, upsertTurno, deleteTurno, marcarFranco, quitarFranco, insertGasto, deleteGasto, getGastos, updateKms, insertMantenimiento } from './data'

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const DIAS_CORTOS = ['Lu','Ma','Mi','Ju','Vi','Sa','Do']
const DIAS_FULL = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo']

function fmt(n) {
  if (n === null || n === undefined) return '—'
  return '$' + Math.round(n).toLocaleString('es-AR')
}

function today() { return new Date().toISOString().split('T')[0] }

function padZ(n) { return String(n).padStart(2, '0') }

// ── TOAST ─────────────────────────────────────────────────────────────────────
function useToast() {
  const [toast, setToast] = useState(null)
  const show = useCallback((msg, type = '') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }, [])
  return { toast, show }
}

// ── APP ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState('resumen')
  const [resumen, setResumen] = useState(null)
  const [cal, setCal] = useState(null)
  const [calYear, setCalYear] = useState(new Date().getFullYear())
  const [calMonth, setCalMonth] = useState(new Date().getMonth() + 1)
  const [loading, setLoading] = useState(true)
  const { toast, show: showToast } = useToast()

  const loadResumen = useCallback(async () => {
    const data = await getResumen()
    setResumen(data)
  }, [])

  const loadCal = useCallback(async (y, m) => {
    const data = await getCalendario(y, m)
    setCal(data)
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    await Promise.all([loadResumen(), loadCal(calYear, calMonth)])
    setLoading(false)
  }, [loadResumen, loadCal, calYear, calMonth])

  useEffect(() => { loadAll() }, [])

  const changeMonth = async (delta) => {
    let m = calMonth + delta, y = calYear
    if (m > 12) { m = 1; y++ }
    if (m < 1)  { m = 12; y-- }
    setCalMonth(m); setCalYear(y)
    const data = await getCalendario(y, m)
    setCal(data)
  }

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", background: '#0a0a0a', color: '#f0f0f0', minHeight: '100dvh' }}>
      <style>{globalStyles}</style>

      {/* HEADER */}
      <div className="header">
        <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 26, fontWeight: 800, letterSpacing: -0.5 }}>
          FLOTA<span style={{ color: '#e8ff47' }}>.</span>
        </h1>
        <button className="sync-btn" onClick={loadAll}>↻</button>
      </div>

      {/* PAGES */}
      {loading && !resumen ? (
        <div className="loading"><div className="spinner" /><span>Cargando...</span></div>
      ) : (
        <>
          {page === 'resumen'   && <ResumenPage resumen={resumen} showToast={showToast} onRefresh={loadAll} />}
          {page === 'calendario' && <CalendarioPage cal={cal} calYear={calYear} calMonth={calMonth} changeMonth={changeMonth} showToast={showToast} onRefresh={() => loadCal(calYear, calMonth)} turnoBase={resumen?.config?.turno_base || 50000} />}
          {page === 'gastos'    && <GastosPage resumen={resumen} showToast={showToast} />}
        </>
      )}

      {/* BOTTOM NAV */}
      <nav className="bottom-nav">
        {[
          { id: 'resumen',    label: 'Resumen',    icon: <GridIcon /> },
          { id: 'calendario', label: 'Calendario', icon: <CalIcon /> },
          { id: 'gastos',     label: 'Gastos',     icon: <MoneyIcon /> },
        ].map(({ id, label, icon }) => (
          <button key={id} className={`bnav-btn ${page === id ? 'active' : ''}`} onClick={() => setPage(id)}>
            {icon}<span className="bnav-label">{label}</span>
          </button>
        ))}
      </nav>

      {/* TOAST */}
      {toast && <div className={`toast show ${toast.type}`}>{toast.msg}</div>}
    </div>
  )
}

// ── RESUMEN PAGE ──────────────────────────────────────────────────────────────
function ResumenPage({ resumen, showToast, onRefresh }) {
  const [kmsInputs, setKmsInputs] = useState({})
  const [mantModal, setMantModal] = useState(null)
  if (!resumen) return <div className="loading"><div className="spinner" /></div>

  const { autos, totales, config } = resumen

  return (
    <div className="page">
      {/* Alertas */}
      {Object.entries(autos).flatMap(([aid, adata]) =>
        (adata.mantenimiento || []).filter(m => m.estado === 'CAMBIAR').map(m => (
          <div key={aid+m.id} className="alert-banner">
            ⚠️ <span><b style={{ color: '#ff4545' }}>{adata.nombre}</b> — {m.nombre} necesita cambio</span>
          </div>
        ))
      )}

      {/* Total flota */}
      <div className="stitle">Total flota</div>
      <div className="total-banner">
        <div><div className="total-label">Esta semana</div><div className="total-value">{fmt(totales.semana)}</div></div>
        <div style={{ textAlign: 'right' }}><div className="total-label">Este mes</div><div className="total-value">{fmt(totales.mes)}</div></div>
      </div>

      {Object.entries(autos).map(([aid, adata]) => {
        const gan = adata.ganancias || {}
        const tagClass = aid === 'negro' ? 'tag-negro' : 'tag-blanco'
        const choferes = Object.values(adata.deudas || {}).map(d => d.nombre)
        return (
          <div key={aid} className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span className={`auto-tag ${tagClass}`}>{adata.nombre}</span>
              <span style={{ fontSize: 11, color: '#555' }}>{choferes.join(' · ')}</span>
            </div>
            <div className="gan-row">
              <div className="gan-cell"><div className="gan-label">Semana</div><div className="gan-value">{fmt(gan.semana)}</div></div>
              <div className="gan-cell"><div className="gan-label">Mes bruto</div><div className="gan-value">{fmt(gan.mes)}</div></div>
            </div>
            <div className="neto-row">
              <div className="neto-label">Neto del mes</div>
              <div className="neto-value">{fmt(gan.neto_mes)}</div>
            </div>
            <div className="metric-grid">
              <div className="metric"><div className="metric-label">Gastos mes</div><div className="metric-value" style={{ color: '#ff6b35' }}>{fmt(gan.gastos_mes)}</div></div>
              <div className="metric"><div className="metric-label">Kms actuales</div><div className="metric-value" style={{ color: '#f0f0f0' }}>{(adata.kms_actuales || 0).toLocaleString('es-AR')}</div></div>
            </div>
            <div className="kms-row">
              <input className="kms-input" type="number" inputMode="numeric" placeholder="Actualizar kms..."
                value={kmsInputs[aid] || ''}
                onChange={e => setKmsInputs(prev => ({ ...prev, [aid]: e.target.value }))}
              />
              <button className="kms-btn" onClick={async () => {
                const k = kmsInputs[aid]
                if (!k) return showToast('Ingresá los kms', 'error')
                const { error } = await updateKms(aid, parseInt(k))
                if (error) return showToast('⚠ ' + error.message, 'error')
                showToast('✓ Kms actualizados', 'success')
                setKmsInputs(prev => ({ ...prev, [aid]: '' }))
                onRefresh()
              }}>OK</button>
            </div>
            {adata.mantenimiento?.length > 0 && <>
              <div className="divider" />
              <div className="stitle" style={{ marginTop: 0 }}>Mantenimiento</div>
              <div className="mant-list">
                {adata.mantenimiento.map(m => (
                  <div key={m.id} className="mant-item" onClick={() => setMantModal({ autoId: aid, item: m, autoNombre: adata.nombre, kmsAct: adata.kms_actuales })}>
                    <div>
                      <div className="mant-nombre">{m.nombre}</div>
                      <div className="mant-sub">
                        {m.estado === 'CAMBIAR' ? 'Vencido' : `Próximo: ${m.proximo_kms.toLocaleString('es-AR')} km`}
                        {' · '}Faltan: {m.faltan_kms > 0 ? m.faltan_kms.toLocaleString('es-AR') + ' km' : 'VENCIDO'}
                      </div>
                    </div>
                    <span className={`mbadge ${m.estado === 'CAMBIAR' ? 'mbadge-cambiar' : 'mbadge-ok'}`}>
                      {m.estado === 'CAMBIAR' ? '⚠ CAMBIAR' : '✓ OK'}
                    </span>
                  </div>
                ))}
              </div>
            </>}
          </div>
        )
      })}

      {mantModal && (
        <MantModal
          {...mantModal}
          onClose={() => setMantModal(null)}
          onConfirm={async (kms, costo) => {
            const { error } = await insertMantenimiento(mantModal.autoId, mantModal.item.id, kms, costo, today())
            if (error) return showToast('⚠ ' + error.message, 'error')
            showToast('✓ Service registrado', 'success')
            setMantModal(null)
            onRefresh()
          }}
        />
      )}
    </div>
  )
}

function MantModal({ autoNombre, item, kmsAct, onClose, onConfirm }) {
  const [kms, setKms] = useState(kmsAct || '')
  const [costo, setCosto] = useState('')
  const [saving, setSaving] = useState(false)
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet">
        <div className="modal-title">{item.nombre}</div>
        <div className="modal-date">{autoNombre}</div>
        <div style={{ margin: '16px 0' }}>
          <label className="form-label">Kms al realizar el service</label>
          <input className="form-input" type="number" inputMode="numeric" value={kms} onChange={e => setKms(e.target.value)} placeholder="Ej: 45000" />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label className="form-label">Costo (opcional)</label>
          <input className="form-input" type="number" inputMode="numeric" value={costo} onChange={e => setCosto(e.target.value)} placeholder="Ej: 60000" />
        </div>
        <button className="btn-primary" disabled={saving} onClick={async () => {
          setSaving(true)
          await onConfirm(parseInt(kms) || 0, parseFloat(costo) || 0)
          setSaving(false)
        }}>{saving ? 'Guardando...' : '✓ MARCAR COMO REALIZADO'}</button>
        <button className="modal-close" onClick={onClose}>Cancelar</button>
      </div>
    </div>
  )
}

// ── CALENDARIO PAGE ───────────────────────────────────────────────────────────
function CalendarioPage({ cal, calYear, calMonth, changeMonth, showToast, onRefresh, turnoBase }) {
  const [dayModal, setDayModal] = useState(null)
  if (!cal) return <div className="loading"><div className="spinner" /></div>

  const todayStr = today()
  const daysInMonth = new Date(calYear, calMonth, 0).getDate()
  let firstDow = new Date(calYear, calMonth - 1, 1).getDay()
  firstDow = (firstDow + 6) % 7

  const autoEntries = Object.entries(cal).filter(([k, v]) => v && v.nombre)
  const choferesList = autoEntries.flatMap(([aid, adata]) =>
    Object.entries(adata.choferes || {}).map(([cid, cnombre]) => ({ autoId: aid, choferId: cid, nombre: cnombre, autoNombre: adata.nombre }))
  )

  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  return (
    <div className="page">
      <div className="cal-nav">
        <button className="cal-nav-btn" onClick={() => changeMonth(-1)}>‹</button>
        <span className="cal-month-label">{MESES[calMonth - 1]} {calYear}</span>
        <button className="cal-nav-btn" onClick={() => changeMonth(1)}>›</button>
      </div>
      <div className="cal-legend">
        {[['#0d2b18','Completo'],['#2b2000','Parcial'],['#2b0d0d','Debe'],['#0d1a2b','Franco']].map(([bg,lbl]) => (
          <div key={lbl} className="leg-item"><div className="leg-dot" style={{ background: bg }} />{lbl}</div>
        ))}
      </div>
      <table className="cal-table"><thead><tr>{DIAS_CORTOS.map(d => <th key={d} className="cal-th">{d}</th>)}</tr></thead>
        <tbody>
          {chunk(cells, 7).map((week, wi) => (
            <tr key={wi}>
              {week.map((day, di) => {
                if (!day) return <td key={di} className="cal-td empty"><div className="day-cell-empty" /></td>
                const ds = `${calYear}-${padZ(calMonth)}-${padZ(day)}`
                const isFuture = ds > todayStr, isToday = ds === todayStr
                const pills = choferesList.map(ch => {
                  const info = cal[ch.autoId]?.dias?.[ds]?.[ch.choferId]
                  return info ? { ...info, nome: ch.nombre.slice(0, 3) } : { estado: 'futuro', nome: ch.nombre.slice(0, 3) }
                })
                const hayDebe = pills.some(p => p.estado === 'debe')
                const allFranco = pills.every(p => p.estado === 'franco')
                let cc = 'day-cell'
                if (isToday) cc += ' today'
                if (allFranco) cc += ' all-franco'
                else if (hayDebe) cc += ' has-debe'
                if (isFuture) cc += ' future'
                return (
                  <td key={di} className="cal-td" onClick={() => setDayModal(ds)}>
                    <div className={cc}>
                      <span className="day-num">{day}</span>
                      <div className="day-choferes">
                        {pills.map((p, pi) => {
                          const pc = { completo: 'pill-completo', parcial: 'pill-parcial', debe: 'pill-debe', franco: 'pill-franco', futuro: 'pill-futuro' }[p.estado] || 'pill-futuro'
                          const lbl = p.estado === 'completo' ? '✓' : p.estado === 'parcial' ? (p.monto || '') : p.estado === 'franco' ? 'F' : p.estado === 'debe' ? '—' : '·'
                          return <div key={pi} className={`chofer-pill ${pc}`}>{p.nome} {lbl}</div>
                        })}
                      </div>
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {dayModal && (
        <DayModal
          ds={dayModal}
          cal={cal}
          turnoBase={turnoBase}
          onClose={() => setDayModal(null)}
          showToast={showToast}
          onRefresh={async () => { await onRefresh(); setDayModal(null) }}
        />
      )}
    </div>
  )
}

function DayModal({ ds, cal, turnoBase, onClose, showToast, onRefresh }) {
  const [montos, setMontos] = useState({})
  const [saving, setSaving] = useState(null)
  const [selectedAuto, setSelectedAuto] = useState(null)

  const [y, m, d] = ds.split('-').map(Number)
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7

  const autoEntries = Object.entries(cal).filter(([k, v]) => v && v.nombre)

  const doTurno = async (choferId, monto) => {
    setSaving(choferId + 'turno')

    const { error } = await upsertTurno(choferId, ds, monto)

    setSaving(null)

    if (error) return showToast('⚠ ' + error.message, 'error')

    showToast('✓ Turno anotado', 'success')
    onRefresh()
  }

  const doFranco = async (choferId, accion) => {
    setSaving(choferId + 'franco')

    const { error } =
      accion === 'marcar'
        ? await marcarFranco(choferId, ds)
        : await quitarFranco(choferId, ds)

    setSaving(null)

    if (error) return showToast('⚠ ' + error.message, 'error')

    showToast(
      accion === 'marcar'
        ? '✓ Franco marcado'
        : '✓ Franco quitado',
      'success'
    )

    onRefresh()
  }

  const doBorrar = async (choferId) => {
    setSaving(choferId + 'borrar')

    const { error } = await deleteTurno(choferId, ds)

    setSaving(null)

    if (error) return showToast('⚠ ' + error.message, 'error')

    showToast('✓ Pago eliminado', 'success')
    onRefresh()
  }

  const adata = selectedAuto ? cal[selectedAuto] : null

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet">
        <div className="modal-date">{DIAS_FULL[dow]}</div>
        <div className="modal-title">{d} de {MESES[m - 1]}</div>

        {!selectedAuto ? (
          <>
            <div className="stitle" style={{ marginTop: 0 }}>Elegí el auto</div>
            {autoEntries.map(([aid, adata]) => {
              const choferes = Object.entries(adata.choferes || {})
              const pills = choferes.map(([cid]) => adata.dias?.[ds]?.[cid])
              const hayDebe = pills.some(p => p?.estado === 'debe')
              const hayCompleto = pills.some(p => p?.estado === 'completo')
              const allFranco = pills.every(p => p?.estado === 'franco')
              const dot = allFranco ? '#4a9eff' : hayDebe ? '#ff4545' : hayCompleto ? '#47ff8a' : '#555'
              return (
                <div key={aid} className="auto-pick-btn" onClick={() => setSelectedAuto(aid)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{adata.nombre}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 5 }}>
                    {choferes.map(([cid, cnombre]) => {
                      const info = adata.dias?.[ds]?.[cid]
                      const estado = info?.estado || 'futuro'
                      const pc = { completo: 'pill-completo', parcial: 'pill-parcial', debe: 'pill-debe', franco: 'pill-franco', futuro: 'pill-futuro' }[estado] || 'pill-futuro'
                      return <div key={cid} className={`chofer-pill ${pc}`}>{cnombre.slice(0, 3)}</div>
                    })}
                  </div>
                </div>
              )
            })}
          </>
        ) : (
          <>
            <button className="modal-back" onClick={() => setSelectedAuto(null)}>‹ Volver</button>
            <div className="stitle" style={{ marginTop: 8 }}>{adata.nombre}</div>
            {Object.entries(adata.choferes || {}).map(([cid, cnombre]) => {
              const info = adata.dias?.[ds]?.[cid]
              if (!info) return null
              const { estado, monto } = info
              const badgeClass = { completo: 'eb-completo', parcial: 'eb-parcial', debe: 'eb-debe', franco: 'eb-franco', futuro: 'eb-futuro' }[estado] || 'eb-futuro'
              const isSaving = !!saving
              return (
                <div key={cid} className="chofer-section">
                  <div className="chofer-sec-header">
                    <div className="chofer-sec-name">{cnombre}</div>
                    <span className={`eb ${badgeClass}`}>{estado.charAt(0).toUpperCase() + estado.slice(1)}</span>
                  </div>
                  {monto ? <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: '#555', marginBottom: 10 }}>Pagó: {fmt(monto)}</div> : null}
                  {estado === 'franco' ? (
                    <button className="action-btn ab-quitar" disabled={isSaving} onClick={() => doFranco(cid, 'quitar')}>
                      {saving === cid + 'franco' ? '...' : '✕ Quitar franco'}
                    </button>
                  ) : (
                    <>
                      <div className="action-grid">
                        <button className="action-btn ab-primary" disabled={isSaving} onClick={() => doTurno(cid, turnoBase)}>
                          {saving === cid + 'turno' ? '...' : '✓ Turno completo'}
                        </button>
                        <button className="action-btn ab-franco" disabled={isSaving} onClick={() => doFranco(cid, 'marcar')}>
                          {saving === cid + 'franco' ? '...' : 'Franco'}
                        </button>
                      </div>
                      <div className="monto-row" style={{ marginBottom: 8 }}>
                        <input className="monto-input" type="number" inputMode="numeric" placeholder="Otro monto..."
                          value={montos[cid] || ''}
                          onChange={e => setMontos(prev => ({ ...prev, [cid]: e.target.value }))}
                        />
                        <button className="monto-btn" disabled={isSaving} onClick={() => {
                          const v = parseFloat(montos[cid])
                          if (!v || v <= 0) return showToast('Ingresá un monto válido', 'error')
                          doTurno(cid, v)
                        }}>
                          {saving === cid + 'turno' ? '...' : 'OK'}
                        </button>
                      </div>
                      {(estado === 'completo' || estado === 'parcial') && (
                        <button className="action-btn ab-quitar" disabled={isSaving} onClick={() => doBorrar(cid)}>
                          {saving === cid + 'borrar' ? '...' : '✕ Marcar como no pagado'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </>
        )}

        <button className="modal-close" onClick={onClose}>Cerrar</button>
      </div>
    </div>
  )
}
// ── GASTOS PAGE ───────────────────────────────────────────────────────────────
function GastosPage({ resumen, showToast }) {
  const [tab, setTab] = useState('lista')
  const [gastos, setGastos] = useState([])
  const [loadingG, setLoadingG] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [form, setForm] = useState({ auto_id: 'negro', descripcion: '', monto: '', categoria: 'mantenimiento', fecha: today() })

  const loadGastos = async () => {
    setLoadingG(true)
    const { data } = await getGastos()
    setGastos(data || [])
    setLoadingG(false)
  }

  useEffect(() => { if (tab === 'lista') loadGastos() }, [tab])

  const autos = resumen?.config?.autos || [{ id: 'negro', nombre: 'Prisma Negro' }, { id: 'blanco', nombre: 'Prisma Blanco' }]
  const categorias = ['mantenimiento', 'combustible', 'seguro', 'impuesto', 'multa', 'otro']

  return (
    <div className="page">
      <div className="tabs">
        <button className={`tab ${tab === 'lista' ? 'active' : ''}`} onClick={() => setTab('lista')}>Ver gastos</button>
        <button className={`tab ${tab === 'nuevo' ? 'active' : ''}`} onClick={() => setTab('nuevo')}>+ Agregar</button>
      </div>

      {tab === 'lista' && (
        loadingG ? <div className="loading"><div className="spinner" /></div> :
        gastos.length === 0 ? <div className="loading">Sin gastos registrados</div> :
        gastos.map(g => (
          <div key={g.id} className="gasto-item">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="gasto-desc">{g.descripcion}</div>
              <div className="gasto-auto">{g.autos?.nombre} · {g.fecha} · {g.categoria}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <div className="gasto-monto">{fmt(parseFloat(g.monto))}</div>
              <button
                className="gasto-del-btn"
                disabled={deletingId === g.id}
                onClick={async () => {
                  setDeletingId(g.id)
                  const { error } = await deleteGasto(g.id)
                  setDeletingId(null)
                  if (error) return showToast('⚠ ' + error.message, 'error')
                  showToast('✓ Gasto eliminado', 'success')
                  setGastos(prev => prev.filter(x => x.id !== g.id))
                }}
              >{deletingId === g.id ? '...' : '✕'}</button>
            </div>
          </div>
        ))
      )}

      {tab === 'nuevo' && (
        <>
          <div className="stitle">Auto</div>
          <div className="radio-group" style={{ marginBottom: 12 }}>
            {autos.map(a => (
              <div key={a.id} className={`radio-opt ${form.auto_id === a.id ? 'sel' : ''}`} onClick={() => setForm(f => ({ ...f, auto_id: a.id }))}>
                <div className="rl">{a.nombre}</div>
              </div>
            ))}
          </div>
          <div className="stitle">Descripción</div>
          <div className="form-group">
            <input className="form-input" type="text" placeholder="Ej: Aceite y filtros" value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
          </div>
          <div className="stitle">Monto</div>
          <div className="form-group">
            <input className="form-input" type="number" inputMode="numeric" placeholder="0" style={{ fontFamily: "'DM Mono',monospace" }} value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} />
          </div>
          <div className="stitle">Categoría</div>
          <div className="form-group">
            <select className="form-input" value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}>
              {categorias.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </select>
          </div>
          <div className="stitle">Fecha</div>
          <div className="form-group">
            <input className="form-input" type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} style={{ colorScheme: 'dark' }} />
          </div>
          <button className="btn-primary" onClick={async () => {
            if (!form.descripcion || !form.monto) return showToast('Completá descripción y monto', 'error')
            const { error } = await insertGasto(form.auto_id, form.descripcion, parseFloat(form.monto), form.categoria, form.fecha)
            if (error) return showToast('⚠ ' + error.message, 'error')
            showToast('✓ Gasto registrado', 'success')
            setForm(f => ({ ...f, descripcion: '', monto: '' }))
            setTab('lista')
          }}>REGISTRAR GASTO</button>
        </>
      )}
    </div>
  )
}

// ── ICONS ─────────────────────────────────────────────────────────────────────
const GridIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
const CalIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
const MoneyIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>

// ── HELPERS ───────────────────────────────────────────────────────────────────
function chunk(arr, size) {
  const res = []
  for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size))
  return res
}

// ── STYLES ────────────────────────────────────────────────────────────────────
const globalStyles = `
  *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
  .header{padding:52px 16px 12px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;background:linear-gradient(to bottom,#0a0a0a 75%,transparent)}
  .sync-btn{width:36px;height:36px;border-radius:50%;background:#1e1e1e;border:1px solid #2a2a2a;color:#f0f0f0;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center}
  .page{padding:0 16px 100px}
  .loading{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;gap:12px;color:#555;font-size:13px}
  .spinner{width:26px;height:26px;border:2px solid #2a2a2a;border-top-color:#e8ff47;border-radius:50%;animation:spin 0.8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .stitle{font-family:'Syne',sans-serif;font-size:10px;font-weight:800;letter-spacing:2.5px;text-transform:uppercase;color:#555;margin:18px 0 8px}
  .card{background:#141414;border:1px solid #2a2a2a;border-radius:14px;padding:16px;margin-bottom:10px}
  .auto-tag{font-family:'Syne',sans-serif;font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;padding:3px 10px;border-radius:5px;display:inline-block}
  .tag-negro{background:#1c1c1c;color:#bbb;border:1px solid #3a3a3a}.tag-blanco{background:#f0f0f0;color:#111}
  .divider{height:1px;background:#2a2a2a;margin:14px 0}
  .alert-banner{background:#1a0505;border:1px solid #3a1010;border-radius:12px;padding:11px 14px;margin-bottom:8px;display:flex;gap:10px;align-items:center;font-size:13px}
  .total-banner{background:linear-gradient(135deg,#0f1f0f,#0a0a0a);border:1px solid #1e3a1e;border-radius:14px;padding:16px 18px;display:flex;justify-content:space-between;margin-bottom:10px}
  .total-label{font-size:10px;color:#555;font-family:'DM Mono',monospace;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
  .total-value{font-family:'DM Mono',monospace;font-size:22px;font-weight:500;color:#47ff8a}
  .gan-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0 0}
  .gan-cell{background:#1e1e1e;border-radius:10px;padding:11px 13px}
  .gan-label{font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#555;margin-bottom:3px;font-family:'DM Mono',monospace}
  .gan-value{font-family:'DM Mono',monospace;font-size:14px;font-weight:500;color:#47ff8a}
  .neto-row{background:linear-gradient(135deg,#0f1f0f,#0a1a0a);border:1px solid #1e3a1e;border-radius:10px;padding:11px 13px;margin-top:8px;display:flex;justify-content:space-between;align-items:center}
  .neto-label{font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#555;font-family:'DM Mono',monospace}
  .neto-value{font-family:'DM Mono',monospace;font-size:15px;font-weight:500;color:#47ff8a}
  .metric-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
  .metric{background:#1e1e1e;border-radius:10px;padding:11px 13px}
  .metric-label{font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#555;margin-bottom:3px;font-family:'DM Mono',monospace}
  .metric-value{font-family:'DM Mono',monospace;font-size:14px;font-weight:500;color:#e8ff47}
  .kms-row{display:flex;gap:8px;align-items:center;margin-top:8px}
  .kms-input{flex:1;padding:9px 13px;background:#1e1e1e;border:1px solid #2a2a2a;border-radius:10px;color:#f0f0f0;font-family:'DM Mono',monospace;font-size:14px;outline:none;-webkit-appearance:none}
  .kms-input:focus{border-color:#e8ff47}
  .kms-btn{padding:9px 14px;background:#e8ff47;color:#000;border:none;border-radius:10px;font-weight:700;font-size:13px;cursor:pointer}
  .mant-list{display:flex;flex-direction:column;gap:6px;margin-top:10px}
  .mant-item{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#1e1e1e;border-radius:10px;cursor:pointer}
  .mant-item:active{opacity:0.6}
  .mant-nombre{font-size:13px;font-weight:500}
  .mant-sub{font-family:'DM Mono',monospace;font-size:10px;color:#555;margin-top:2px}
  .mbadge{font-size:10px;font-weight:700;padding:3px 8px;border-radius:5px;text-transform:uppercase}
  .mbadge-ok{background:#0d2b18;color:#47ff8a}.mbadge-cambiar{background:#2b0d0d;color:#ff4545}
  .cal-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
  .cal-nav-btn{width:36px;height:36px;border-radius:50%;background:#1e1e1e;border:1px solid #2a2a2a;color:#f0f0f0;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center}
  .cal-month-label{font-family:'Syne',sans-serif;font-size:16px;font-weight:800}
  .cal-legend{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
  .leg-item{display:flex;align-items:center;gap:5px;font-size:10px;color:#555}
  .leg-dot{width:10px;height:10px;border-radius:3px;flex-shrink:0}
  .cal-table{width:100%;border-collapse:separate;border-spacing:3px}
  .cal-th{font-family:'DM Mono',monospace;font-size:10px;color:#555;text-align:center;padding:4px 2px;font-weight:500}
  .cal-td{padding:1px;vertical-align:top;cursor:pointer}.cal-td.empty{cursor:default}
  .day-cell{border-radius:8px;background:#1e1e1e;border:1px solid transparent;padding:5px 3px 4px;min-height:62px;display:flex;flex-direction:column;align-items:center;gap:2px;transition:transform 0.1s}
  .day-cell-empty{min-height:62px;background:transparent}
  .day-cell.today{border-color:#e8ff47}.day-cell.has-debe{border-color:#3a1515}.day-cell.all-franco{background:#0d1520;border-color:#1a3050}.day-cell.future{opacity:0.3}
  .day-num{font-family:'DM Mono',monospace;font-size:11px;font-weight:500;color:#555;line-height:1}
  .day-cell.today .day-num{color:#e8ff47;font-weight:700}
  .day-choferes{display:flex;flex-direction:column;gap:2px;width:100%}
  .chofer-pill{border-radius:4px;font-family:'DM Mono',monospace;font-size:9px;font-weight:700;padding:2px 3px;text-align:center;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pill-completo{background:#0d2b18;color:#47ff8a}.pill-parcial{background:#2b2000;color:#ffb347}.pill-debe{background:#2b0d0d;color:#ff4545}.pill-franco{background:#0d1a2b;color:#4a9eff}.pill-futuro{background:#141414;color:#333}
  .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:500;display:flex;align-items:flex-end}
  .modal-sheet{background:#141414;border-radius:20px 20px 0 0;width:100%;padding:20px 18px 44px;max-height:85dvh;overflow-y:auto}
  .modal-date{font-family:'DM Mono',monospace;font-size:12px;color:#555;margin-bottom:3px}
  .modal-title{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;margin-bottom:16px}
  .chofer-section{margin-bottom:12px;background:#1e1e1e;border-radius:12px;padding:14px}
  .chofer-sec-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
  .chofer-sec-name{font-size:15px;font-weight:600}.chofer-sec-sub{font-size:11px;color:#555;margin-top:1px}
  .eb{font-family:'DM Mono',monospace;font-size:10px;font-weight:700;padding:3px 9px;border-radius:5px;text-transform:uppercase}
  .eb-completo{background:#0d2b18;color:#47ff8a}.eb-parcial{background:#2b2000;color:#ffb347}.eb-debe{background:#2b0d0d;color:#ff4545}.eb-franco{background:#0d1a2b;color:#4a9eff}.eb-futuro{background:#1e1e1e;color:#555}
  .action-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
  .action-btn{padding:11px 8px;border-radius:10px;border:1px solid #2a2a2a;background:#141414;color:#f0f0f0;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;cursor:pointer;text-align:center;transition:all 0.15s}
  .action-btn:active{transform:scale(0.96)}.action-btn:disabled{opacity:0.5;cursor:not-allowed}
  .ab-primary{background:#e8ff47;color:#000;border-color:#e8ff47;font-weight:700}.ab-franco{background:#0d1a2b;color:#4a9eff;border-color:#1a3050}.ab-quitar{background:#1a0a00;color:#ffb347;border-color:#3a2000}
  .monto-row{display:flex;gap:8px}
  .monto-input{flex:1;padding:11px 13px;background:#141414;border:1px solid #2a2a2a;border-radius:10px;color:#f0f0f0;font-family:'DM Mono',monospace;font-size:15px;outline:none;-webkit-appearance:none}
  .monto-input:focus{border-color:#e8ff47}.monto-input::placeholder{color:#555}
  .monto-btn{padding:11px 16px;background:#1e1e1e;color:#f0f0f0;border:1px solid #2a2a2a;border-radius:10px;font-weight:600;font-size:13px;cursor:pointer}
  .monto-btn:active{background:#e8ff47;color:#000}.monto-btn:disabled{opacity:0.5}
  .modal-close{width:100%;padding:13px;background:transparent;color:#555;border:1px solid #2a2a2a;border-radius:12px;font-size:14px;cursor:pointer;margin-top:10px}
  .modal-back{background:none;border:none;color:#555;font-size:14px;cursor:pointer;padding:0;margin-bottom:2px}
  .auto-pick-btn{display:flex;align-items:center;justify-content:space-between;padding:16px 14px;background:#1e1e1e;border:1px solid #2a2a2a;border-radius:12px;margin-bottom:8px;cursor:pointer;transition:border-color 0.15s}
  .auto-pick-btn:active{border-color:#e8ff47;opacity:0.8}
  .tabs{display:flex;gap:6px;margin-bottom:16px}
  .tab{flex:1;padding:10px;border-radius:10px;border:1px solid #2a2a2a;background:transparent;color:#555;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;cursor:pointer;text-align:center;transition:all 0.2s}
  .tab.active{background:#e8ff47;color:#000;border-color:#e8ff47;font-weight:700}
  .gasto-item{display:flex;align-items:center;justify-content:space-between;padding:13px 14px;background:#141414;border:1px solid #2a2a2a;border-radius:12px;margin-bottom:8px}
  .gasto-desc{font-size:14px;font-weight:500}.gasto-auto{font-size:11px;color:#555;margin-top:2px}
  .gasto-monto{font-family:'DM Mono',monospace;font-size:14px;color:#ff6b35;font-weight:500;white-space:nowrap}
  .gasto-del-btn{width:28px;height:28px;border-radius:8px;border:1px solid #3a1010;background:#1a0505;color:#ff4545;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .gasto-del-btn:disabled{opacity:0.5;cursor:not-allowed}
  .form-label{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#555;font-family:'DM Mono',monospace;display:block;margin-bottom:6px}
  .form-input{width:100%;padding:13px 14px;background:#141414;border:1px solid #2a2a2a;border-radius:12px;color:#f0f0f0;font-family:'DM Sans',sans-serif;font-size:15px;outline:none;-webkit-appearance:none;transition:border-color 0.2s}
  .form-input:focus{border-color:#e8ff47}.form-input::placeholder{color:#555}
  .form-group{margin-bottom:12px}
  select.form-input{cursor:pointer}
  .radio-group{display:flex;gap:8px}
  .radio-opt{flex:1;padding:11px;border-radius:10px;border:1px solid #2a2a2a;background:#141414;text-align:center;cursor:pointer;transition:all 0.15s}
  .radio-opt.sel{border-color:#e8ff47;background:#1a1a00}
  .rl{font-size:13px;font-weight:500}
  .btn-primary{width:100%;padding:15px;background:#e8ff47;color:#000;border:none;border-radius:13px;font-family:'Syne',sans-serif;font-size:15px;font-weight:800;cursor:pointer;margin-top:8px;transition:transform 0.15s,opacity 0.15s}
  .btn-primary:active{transform:scale(0.98);opacity:0.9}
  .toast{position:fixed;bottom:90px;left:50%;transform:translateX(-50%) translateY(20px);background:#1e1e1e;border:1px solid #2a2a2a;color:#f0f0f0;padding:11px 18px;border-radius:12px;font-size:13px;font-weight:500;opacity:0;transition:all 0.3s;z-index:999;white-space:nowrap;max-width:92vw;text-align:center}
  .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}.toast.success{border-color:#47ff8a;color:#47ff8a}.toast.error{border-color:#ff4545;color:#ff4545}
  .bottom-nav{position:fixed;bottom:0;left:0;right:0;display:flex;background:rgba(10,10,10,0.94);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-top:1px solid #2a2a2a;padding:8px 0 24px;z-index:200}
  .bnav-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:5px 0;background:none;border:none;cursor:pointer;color:#555;transition:color 0.2s}
  .bnav-btn svg{width:21px;height:21px}.bnav-label{font-size:9px;font-weight:500;letter-spacing:0.3px}
  .bnav-btn.active{color:#e8ff47}
`
