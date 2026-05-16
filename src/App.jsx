import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from './supabase'
import {
  getResumen, getCalendario, getConfig, upsertTurno, deleteTurno, marcarFranco, quitarFranco,
  insertGasto, deleteGasto, getGastos, updateKms, insertMantenimiento,
  signIn, signUp, signOut, getProfile, checkFleet, createFleet,
  getAdminUsers, setUserActivo, addPayment,
  createAuto, createChofer, updateAutoTurnoBase, updateChofer,
  getUserMantItems, createMantItem, updateMantItem, deleteMantItem,
} from './data'

// ── CONSTANTES ────────────────────────────────────────────────────────────────
const TURNO_BASE_DEFAULT = 50000
const TOAST_DURATION = 3000

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
  const timerRef = useRef(null)
  const show = useCallback((msg, type = '') => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setToast({ msg, type })
    timerRef.current = setTimeout(() => setToast(null), TOAST_DURATION)
  }, [])
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
  return { toast, show }
}

// ── CONFIRM MODAL ─────────────────────────────────────────────────────────────
function ConfirmModal({ title, message, confirmLabel = 'Eliminar', onConfirm, onCancel }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal-sheet">
        <div className="modal-title">{title}</div>
        {message && <div style={{ color: '#888', fontSize: 13, marginBottom: 20, lineHeight: 1.5 }}>{message}</div>}
        <button className="btn-primary ab-danger" style={{ marginBottom: 10 }} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button className="modal-close" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  )
}

// ── APP ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [authState, setAuthState] = useState('loading') // loading|auth|inactive|onboarding|app
  const [inactiveReason, setInactiveReason] = useState('pending') // pending|expired
  const [profile, setProfile] = useState(null)
  const [page, setPage] = useState('resumen')
  const [resumen, setResumen] = useState(null)
  const [cal, setCal] = useState(null)
  const [calYear, setCalYear] = useState(new Date().getFullYear())
  const [calMonth, setCalMonth] = useState(new Date().getMonth() + 1)
  const [loading, setLoading] = useState(false)
  const { toast, show: showToast } = useToast()

  const handleSession = useCallback(async () => {
    const prof = await getProfile()
    if (!prof) {
      // Perfil aún no creado (trigger puede demorar) — tratar como pendiente
      setProfile(null); setInactiveReason('pending'); setAuthState('inactive'); return
    }
    setProfile(prof)
    if (prof.activo_hasta && new Date(prof.activo_hasta) < new Date()) {
      setInactiveReason('expired'); setAuthState('inactive'); return
    }
    if (!prof.activo) { setInactiveReason('pending'); setAuthState('inactive'); return }
    const hasFleet = await checkFleet()
    if (!hasFleet) { setAuthState('onboarding'); return }
    setAuthState('app')
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { setAuthState('auth'); return }
      handleSession()
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) { setAuthState('auth'); setProfile(null); return }
      handleSession()
    })
    return () => subscription.unsubscribe()
  }, [handleSession])

  const loadResumen = useCallback(async (cfg = null) => {
    const data = await getResumen(cfg); setResumen(data)
  }, [])
  const loadCal = useCallback(async (y, m, cfg = null) => {
    const data = await getCalendario(y, m, cfg); setCal(data)
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const cfg = await getConfig()
      await Promise.all([loadResumen(cfg), loadCal(calYear, calMonth, cfg)])
    } catch (err) {
      console.error('Error al cargar datos:', err)
    } finally {
      setLoading(false)
    }
  }, [loadResumen, loadCal, calYear, calMonth])

  useEffect(() => { if (authState === 'app') loadAll() }, [authState, loadAll])

  const changeMonth = async (delta) => {
    let m = calMonth + delta, y = calYear
    if (m > 12) { m = 1; y++ }
    if (m < 1)  { m = 12; y-- }
    setCalMonth(m); setCalYear(y)
    const data = await getCalendario(y, m)
    setCal(data)
  }

  if (authState === 'loading') {
    return (
      <div style={{ background: '#0a0a0a', minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <style>{globalStyles}</style>
        <div className="spinner" />
      </div>
    )
  }

  if (authState === 'auth') {
    return (
      <div style={{ background: '#0a0a0a', minHeight: '100dvh' }}>
        <style>{globalStyles}</style>
        <AuthScreen />
        {toast && <div className={`toast show ${toast.type}`}>{toast.msg}</div>}
      </div>
    )
  }

  if (authState === 'inactive') {
    return (
      <div style={{ background: '#0a0a0a', minHeight: '100dvh' }}>
        <style>{globalStyles}</style>
        <InactiveScreen
          reason={inactiveReason}
          onRefresh={handleSession}
          onSignOut={async () => { await signOut(); setAuthState('auth') }}
        />
      </div>
    )
  }

  if (authState === 'onboarding') {
    return (
      <div style={{ background: '#0a0a0a', minHeight: '100dvh' }}>
        <style>{globalStyles}</style>
        <OnboardingScreen
          showToast={showToast}
          onComplete={() => { setAuthState('app') }}
        />
        {toast && <div className={`toast show ${toast.type}`}>{toast.msg}</div>}
      </div>
    )
  }

  const navItems = [
    { id: 'resumen',    label: 'Resumen',    icon: <GridIcon /> },
    { id: 'calendario', label: 'Calendario', icon: <CalIcon /> },
    { id: 'gastos',     label: 'Gastos',     icon: <MoneyIcon /> },
    { id: 'flota',      label: 'Flota',      icon: <FleetIcon /> },
    ...(profile?.is_admin ? [{ id: 'admin', label: 'Admin', icon: <AdminIcon /> }] : []),
  ]

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", background: '#0a0a0a', color: '#f0f0f0', minHeight: '100dvh' }}>
      <style>{globalStyles}</style>

      <div className="header">
        <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 26, fontWeight: 800, letterSpacing: -0.5 }}>
          FLOTA<span style={{ color: '#276EF1' }}>.</span>
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="sync-btn" onClick={loadAll}>↻</button>
          <button className="sync-btn" onClick={async () => { await signOut(); setAuthState('auth') }} title="Cerrar sesión">⏏</button>
        </div>
      </div>

      {loading && !resumen ? (
        <div className="loading"><div className="spinner" /><span>Cargando...</span></div>
      ) : (
        <>
          {page === 'resumen'    && <ResumenPage resumen={resumen} showToast={showToast} onRefresh={loadAll} />}
          {page === 'calendario' && <CalendarioPage cal={cal} calYear={calYear} calMonth={calMonth} changeMonth={changeMonth} showToast={showToast} onRefresh={() => loadCal(calYear, calMonth)} turnoBase={resumen?.config?.turno_base || 50000} />}
          {page === 'gastos'     && <GastosPage resumen={resumen} showToast={showToast} onRefresh={loadAll} />}
          {page === 'flota'      && <FlotaPage resumen={resumen} showToast={showToast} onRefresh={loadAll} />}
          {page === 'admin'      && <AdminScreen showToast={showToast} />}
        </>
      )}

      <nav className="bottom-nav">
        {navItems.map(({ id, label, icon }) => (
          <button key={id} className={`bnav-btn ${page === id ? 'active' : ''}`} onClick={() => setPage(id)}>
            {icon}<span className="bnav-label">{label}</span>
          </button>
        ))}
      </nav>

      {toast && <div className={`toast show ${toast.type}`}>{toast.msg}</div>}
    </div>
  )
}

// ── AUTH SCREEN ───────────────────────────────────────────────────────────────
function AuthScreen() {
  const [tab, setTab] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const submit = async () => {
    if (!email || !password) { setError('Completá email y contraseña'); return }
    setLoading(true); setError(''); setSuccess('')
    const fn = tab === 'login' ? signIn : signUp
    const { error: err } = await fn(email, password)
    setLoading(false)
    if (err) { setError(err.message); return }
    if (tab === 'register') setSuccess('Cuenta creada. Esperá la activación del administrador.')
  }

  return (
    <div style={{ padding: '80px 24px 40px', display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 36, fontWeight: 800, marginBottom: 6 }}>
        FLOTA<span style={{ color: '#276EF1' }}>.</span>
      </h1>
      <p style={{ color: '#555', fontSize: 13, marginBottom: 36 }}>Gestión de flotas de remises</p>

      <div className="tabs" style={{ marginBottom: 20 }}>
        <button className={`tab ${tab === 'login' ? 'active' : ''}`} onClick={() => { setTab('login'); setError(''); setSuccess('') }}>Ingresar</button>
        <button className={`tab ${tab === 'register' ? 'active' : ''}`} onClick={() => { setTab('register'); setError(''); setSuccess('') }}>Registrarse</button>
      </div>

      <div className="form-group">
        <input className="form-input" type="email" placeholder="Email" value={email}
          onChange={e => setEmail(e.target.value)} autoComplete="email" />
      </div>
      <div className="form-group">
        <input className="form-input" type="password" placeholder="Contraseña (mínimo 6 caracteres)" value={password}
          onChange={e => setPassword(e.target.value)} autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
          onKeyDown={e => e.key === 'Enter' && submit()} />
      </div>

      {error   && <div style={{ color: '#ff4545', fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {success && <div style={{ color: '#276EF1', fontSize: 13, marginBottom: 12 }}>{success}</div>}

      <button className="btn-primary" disabled={loading} onClick={submit}>
        {loading ? 'Cargando...' : tab === 'login' ? 'INGRESAR' : 'CREAR CUENTA'}
      </button>
    </div>
  )
}

// ── INACTIVE SCREEN ───────────────────────────────────────────────────────────
function InactiveScreen({ reason, onRefresh, onSignOut }) {
  const [checking, setChecking] = useState(false)
  const expired = reason === 'expired'
  return (
    <div style={{ padding: '100px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 20 }}>{expired ? '💳' : '⏳'}</div>
      <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, marginBottom: 10 }}>
        {expired ? 'Pago pendiente' : 'Cuenta pendiente'}
      </div>
      <div style={{ color: '#555', fontSize: 14, lineHeight: 1.6, marginBottom: 36 }}>
        {expired
          ? <>Tu suscripción venció.<br />Realizá el pago para continuar usando la app.</>
          : <>Tu cuenta está esperando activación.<br />Contactá al administrador para habilitarla.</>
        }
      </div>
      <button className="btn-primary" style={{ marginBottom: 10 }} disabled={checking} onClick={async () => {
        setChecking(true); await onRefresh(); setChecking(false)
      }}>
        {checking ? 'Verificando...' : 'Verificar activación'}
      </button>
      <button className="modal-close" onClick={onSignOut}>Cerrar sesión</button>
    </div>
  )
}

// ── ONBOARDING SCREEN ─────────────────────────────────────────────────────────
function OnboardingScreen({ showToast, onComplete }) {
  const [turnoBase, setTurnoBase] = useState('50000')
  const [francoWeekday, setFrancoWeekday] = useState('1')
  const [autos, setAutos] = useState([{ nombre: '', choferes: ['', ''] }])
  const [saving, setSaving] = useState(false)

  const addAuto = () => setAutos(p => [...p, { nombre: '', choferes: [''] }])
  const removeAuto = i => setAutos(p => p.filter((_, idx) => idx !== i))
  const setAutoNombre = (i, v) => setAutos(p => p.map((a, idx) => idx === i ? { ...a, nombre: v } : a))
  const addChofer = i => setAutos(p => p.map((a, idx) => idx === i ? { ...a, choferes: [...a.choferes, ''] } : a))
  const removeChofer = (ai, ci) => setAutos(p => p.map((a, i) => i === ai ? { ...a, choferes: a.choferes.filter((_, j) => j !== ci) } : a))
  const setChofer = (ai, ci, v) => setAutos(p => p.map((a, i) => i === ai ? { ...a, choferes: a.choferes.map((c, j) => j === ci ? v : c) } : a))

  const submit = async () => {
    for (const auto of autos) {
      if (!auto.nombre.trim()) return showToast('Ingresá el nombre de cada auto', 'error')
      if (!auto.choferes.some(c => c.trim())) return showToast('Cada auto necesita al menos un chofer', 'error')
    }
    if (!turnoBase || parseInt(turnoBase) <= 0) return showToast('Ingresá un turno base válido', 'error')
    setSaving(true)
    const { error } = await createFleet({ turnoBase: parseInt(turnoBase), francoWeekday: parseInt(francoWeekday), autos })
    setSaving(false)
    if (error) return showToast('⚠ ' + error.message, 'error')
    showToast('✓ Flota creada', 'success')
    onComplete()
  }

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", color: '#f0f0f0' }}>
      <div style={{ padding: '52px 16px 100px' }}>
        <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 24, fontWeight: 800, marginBottom: 4 }}>
          Configurar flota
        </h2>
        <p style={{ color: '#555', fontSize: 13, marginBottom: 24 }}>Podés cambiar estos datos después.</p>

        <div className="stitle">Turno base ($)</div>
        <div className="form-group">
          <input className="form-input" type="number" inputMode="numeric" placeholder="Ej: 50000"
            value={turnoBase} onChange={e => setTurnoBase(e.target.value)} />
        </div>

        <div className="stitle">Día de franco semanal</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {DIAS_CORTOS.map((d, i) => (
            <div key={i} className={`radio-opt ${francoWeekday == i ? 'sel' : ''}`}
              style={{ flex: 'none', padding: '8px 14px' }}
              onClick={() => setFrancoWeekday(String(i))}>
              <div className="rl">{d}</div>
            </div>
          ))}
        </div>

        <div className="stitle">Autos y choferes</div>
        {autos.map((auto, ai) => (
          <div key={ai} className="card" style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input className="form-input" placeholder="Nombre del auto (ej: Prisma Negro)"
                value={auto.nombre} onChange={e => setAutoNombre(ai, e.target.value)} style={{ flex: 1 }} />
              {autos.length > 1 && (
                <button onClick={() => removeAuto(ai)} style={{ padding: '0 12px', background: '#1a0505', border: '1px solid #3a1010', borderRadius: 10, color: '#ff4545', cursor: 'pointer' }}>✕</button>
              )}
            </div>
            <div className="stitle" style={{ marginTop: 0 }}>Choferes</div>
            {auto.choferes.map((c, ci) => (
              <div key={ci} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                <input className="form-input" placeholder={`Chofer ${ci + 1}`}
                  value={c} onChange={e => setChofer(ai, ci, e.target.value)} style={{ flex: 1 }} />
                {auto.choferes.length > 1 && (
                  <button onClick={() => removeChofer(ai, ci)} style={{ padding: '0 12px', background: '#1a0505', border: '1px solid #3a1010', borderRadius: 10, color: '#ff4545', cursor: 'pointer' }}>✕</button>
                )}
              </div>
            ))}
            <button onClick={() => addChofer(ai)} style={{ background: 'none', border: 'none', color: '#555', fontSize: 13, cursor: 'pointer', padding: '6px 0', marginTop: 2 }}>
              + Agregar chofer
            </button>
          </div>
        ))}

        <button className="action-btn" style={{ width: '100%', marginBottom: 16 }} onClick={addAuto}>
          + Agregar auto
        </button>

        <button className="btn-primary" disabled={saving} onClick={submit}>
          {saving ? 'Creando flota...' : 'CREAR MI FLOTA'}
        </button>
      </div>
    </div>
  )
}

// ── ADMIN SCREEN ──────────────────────────────────────────────────────────────
function diasRestantes(activo_hasta) {
  if (!activo_hasta) return null
  const diff = new Date(activo_hasta) - new Date()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function AdminScreen({ showToast }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingAction, setLoadingAction] = useState({}) // key: userId+action

  const reload = () => getAdminUsers().then(({ data }) => { setUsers(data || []); setLoading(false) })
  useEffect(() => { reload() }, [])

  const withLoading = async (key, fn) => {
    setLoadingAction(prev => ({ ...prev, [key]: true }))
    await fn()
    setLoadingAction(prev => ({ ...prev, [key]: false }))
  }

  return (
    <div className="page">
      <div className="stitle">Usuarios registrados</div>
      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : users.length === 0 ? (
        <div className="loading">Sin usuarios registrados</div>
      ) : (
        users.map(u => {
          const dias = diasRestantes(u.activo_hasta)
          const expirado = dias !== null && dias <= 0
          const pocoTiempo = dias !== null && dias > 0 && dias <= 5
          const diasColor = expirado ? '#ff4545' : pocoTiempo ? '#ffb347' : '#276EF1'
          const loadingPago = !!loadingAction[u.id + 'pago']
          const loadingActivo = !!loadingAction[u.id + 'activo']

          return (
            <div key={u.id} className="card" style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, wordBreak: 'break-all' }}>{u.nombre}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, color: '#555' }}>
                      Registro: {new Date(u.created_at).toLocaleDateString('es-AR')}
                    </span>
                    {u.is_admin && <span style={{ fontSize: 10, background: '#1a1a00', color: '#e8ff47', border: '1px solid #3a3a00', borderRadius: 4, padding: '1px 6px' }}>Admin</span>}
                  </div>
                  {dias !== null && (
                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: '#555' }}>Vence:</span>
                      <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700, color: diasColor }}>
                        {expirado ? 'VENCIDO' : `${dias} día${dias !== 1 ? 's' : ''}`}
                      </span>
                      {u.activo_hasta && (
                        <span style={{ fontSize: 10, color: '#555' }}>
                          ({new Date(u.activo_hasta).toLocaleDateString('es-AR')})
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                  <button
                    className="action-btn ab-primary"
                    style={{ width: 'auto', padding: '7px 12px', fontSize: 12 }}
                    disabled={loadingPago || loadingActivo}
                    onClick={() => withLoading(u.id + 'pago', async () => {
                      const { error } = await addPayment(u.id)
                      if (error) return showToast('⚠ ' + error.message, 'error')
                      showToast('✓ +31 días agregados', 'success')
                      reload()
                    })}
                  >
                    {loadingPago ? '...' : '+ 31 días'}
                  </button>
                  <button
                    className={`action-btn ${u.activo && !expirado ? 'ab-quitar' : 'ab-franco'}`}
                    style={{ width: 'auto', padding: '7px 12px', fontSize: 12 }}
                    disabled={loadingActivo || loadingPago}
                    onClick={() => withLoading(u.id + 'activo', async () => {
                      const { error } = await setUserActivo(u.id, !(u.activo && !expirado))
                      if (error) return showToast('⚠ ' + error.message, 'error')
                      showToast(u.activo && !expirado ? '✕ Desactivado' : '✓ Activado', 'success')
                      reload()
                    })}
                  >
                    {loadingActivo ? '...' : u.activo && !expirado ? 'Desactivar' : 'Activar'}
                  </button>
                </div>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

// ── RESUMEN PAGE ──────────────────────────────────────────────────────────────
function ResumenPage({ resumen, showToast, onRefresh }) {
  const [kmsInputs, setKmsInputs] = useState({})
  const [kmsLoading, setKmsLoading] = useState({})
  if (!resumen) return <div className="loading"><div className="spinner" /></div>

  const { autos, totales } = resumen
  const autoEntries = Object.entries(autos)

  return (
    <div className="page">
      <div className="stitle">Total flota</div>
      <div className="total-banner">
        <div><div className="total-label">Esta semana</div><div className="total-value">{fmt(totales.semana)}</div></div>
        <div style={{ textAlign: 'right' }}><div className="total-label">Este mes</div><div className="total-value">{fmt(totales.mes)}</div></div>
      </div>

      {autoEntries.length === 0 && (
        <div className="loading">Sin autos en la flota</div>
      )}

      {autoEntries.map(([aid, adata]) => {
        const gan = adata.ganancias || {}
        const choferes = Object.values(adata.deudas || {}).map(d => d.nombre)
        const isLoadingKms = !!kmsLoading[aid]
        return (
          <div key={aid} className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span className="auto-tag tag-auto">{adata.nombre}</span>
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
              <div className="metric"><div className="metric-label">Kms actuales</div><div className="metric-value">{(adata.kms_actuales || 0).toLocaleString('es-AR')}</div></div>
            </div>
            <div className="kms-row">
              <input className="kms-input" type="number" inputMode="numeric" placeholder="Actualizar kms..."
                value={kmsInputs[aid] || ''}
                onChange={e => setKmsInputs(prev => ({ ...prev, [aid]: e.target.value }))}
              />
              <button className="kms-btn" disabled={isLoadingKms} onClick={async () => {
                const k = parseInt(kmsInputs[aid])
                if (!k || k <= 0) return showToast('Ingresá los kms', 'error')
                if (k < (adata.kms_actuales || 0)) return showToast('Los kms no pueden ser menores a los actuales', 'error')
                setKmsLoading(prev => ({ ...prev, [aid]: true }))
                const { error } = await updateKms(aid, k)
                setKmsLoading(prev => ({ ...prev, [aid]: false }))
                if (error) return showToast('⚠ ' + error.message, 'error')
                showToast('✓ Kms actualizados', 'success')
                setKmsInputs(prev => ({ ...prev, [aid]: '' }))
                onRefresh()
              }}>{isLoadingKms ? '...' : 'OK'}</button>
            </div>
          </div>
        )
      })}

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
  const [filterAuto, setFilterAuto] = useState(null)
  if (!cal) return <div className="loading"><div className="spinner" /></div>

  const todayStr = today()
  const daysInMonth = new Date(calYear, calMonth, 0).getDate()
  let firstDow = new Date(calYear, calMonth - 1, 1).getDay()
  firstDow = (firstDow + 6) % 7

  const autoEntries = Object.entries(cal).filter(([k, v]) => v && v.nombre)
  const choferesList = autoEntries
    .filter(([aid]) => !filterAuto || filterAuto === aid)
    .flatMap(([aid, adata]) =>
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
        {[['#0A1428','Completo'],['#2b2000','Parcial'],['#2b0d0d','Debe'],['#0d1a2b','Franco']].map(([bg,lbl]) => (
          <div key={lbl} className="leg-item"><div className="leg-dot" style={{ background: bg }} />{lbl}</div>
        ))}
      </div>

      {autoEntries.length > 1 && (
        <div className="filter-chips">
          <button className={`filter-chip ${!filterAuto ? 'fchip-active' : ''}`} onClick={() => setFilterAuto(null)}>
            Todos
          </button>
          {autoEntries.map(([aid, adata]) => (
            <button key={aid} className={`filter-chip ${filterAuto === aid ? 'fchip-active' : ''}`} onClick={() => setFilterAuto(filterAuto === aid ? null : aid)}>
              {adata.nombre}
            </button>
          ))}
        </div>
      )}

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
    const { error } = accion === 'marcar' ? await marcarFranco(choferId, ds) : await quitarFranco(choferId, ds)
    setSaving(null)
    if (error) return showToast('⚠ ' + error.message, 'error')
    showToast(accion === 'marcar' ? '✓ Franco marcado' : '✓ Franco quitado', 'success')
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
              const dot = allFranco ? '#4a9eff' : hayDebe ? '#ff4545' : hayCompleto ? '#60AFFF' : '#555'
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
                        <button className="action-btn ab-primary" disabled={isSaving} onClick={() => doTurno(cid, adata.turno_base || turnoBase)}>
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
function GastosPage({ resumen, showToast, onRefresh }) {
  const [tab, setTab] = useState('lista')
  const [gastos, setGastos] = useState([])
  const [loadingG, setLoadingG] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null) // id del gasto a confirmar
  const autos = resumen?.config?.autos || []
  const [form, setForm] = useState({ auto_id: '', descripcion: '', monto: '', categoria: 'mantenimiento', fecha: today() })

  useEffect(() => {
    if (autos.length > 0 && !form.auto_id) {
      setForm(f => ({ ...f, auto_id: autos[0].id }))
    }
  }, [autos])

  const loadGastos = async () => {
    setLoadingG(true)
    const { data } = await getGastos()
    setGastos(data || [])
    setLoadingG(false)
  }

  useEffect(() => { if (tab === 'lista') loadGastos() }, [tab])

  const categorias = ['mantenimiento', 'combustible', 'seguro', 'impuesto', 'multa', 'otro']

  const handleDeleteConfirmed = async () => {
    const id = deleteConfirm
    setDeleteConfirm(null)
    setDeletingId(id)
    const { error } = await deleteGasto(id)
    setDeletingId(null)
    if (error) return showToast('⚠ ' + error.message, 'error')
    showToast('✓ Gasto eliminado', 'success')
    setGastos(prev => prev.filter(x => x.id !== id))
    onRefresh()
  }

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
              <button className="gasto-del-btn" disabled={deletingId === g.id}
                onClick={() => setDeleteConfirm(g.id)}>
                {deletingId === g.id ? '...' : '✕'}
              </button>
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
            if (!form.auto_id) return showToast('Seleccioná un auto', 'error')
            if (!form.descripcion || !form.monto) return showToast('Completá descripción y monto', 'error')
            const { error } = await insertGasto(form.auto_id, form.descripcion, parseFloat(form.monto), form.categoria, form.fecha)
            if (error) return showToast('⚠ ' + error.message, 'error')
            showToast('✓ Gasto registrado', 'success')
            setForm(f => ({ ...f, descripcion: '', monto: '' }))
            onRefresh()
            setTab('lista')
          }}>REGISTRAR GASTO</button>
        </>
      )}

      {deleteConfirm && (
        <ConfirmModal
          title="Eliminar gasto"
          message="¿Estás seguro? Esta acción no se puede deshacer."
          confirmLabel="Eliminar"
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  )
}

// ── FLOTA PAGE ────────────────────────────────────────────────────────────────
function FlotaPage({ resumen, showToast, onRefresh }) {
  const [tab, setTab] = useState('autos')
  return (
    <div className="page">
      <div className="tabs">
        <button className={`tab ${tab === 'autos' ? 'active' : ''}`} onClick={() => setTab('autos')}>Autos</button>
        <button className={`tab ${tab === 'mant' ? 'active' : ''}`} onClick={() => setTab('mant')}>Mantenimiento</button>
      </div>
      {tab === 'autos' && <AutosTab resumen={resumen} showToast={showToast} onRefresh={onRefresh} />}
      {tab === 'mant'  && <MantItemsTab resumen={resumen} showToast={showToast} onRefresh={onRefresh} />}
    </div>
  )
}

function AutosTab({ resumen, showToast, onRefresh }) {
  const [showNewAuto, setShowNewAuto] = useState(false)
  const [newAutoNombre, setNewAutoNombre] = useState('')
  const [newAutoTurno, setNewAutoTurno] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingTurno, setEditingTurno] = useState({})
  const [savingTurno, setSavingTurno] = useState(null)
  const [showNewChofer, setShowNewChofer] = useState(null)
  const [newChoferNombre, setNewChoferNombre] = useState('')
  const [savingChofer, setSavingChofer] = useState(false)
  const [editingChoferId, setEditingChoferId] = useState(null)
  const [editChoferNombre, setEditChoferNombre] = useState('')
  const [savingChoferEdit, setSavingChoferEdit] = useState(false)

  const autos = resumen?.config?.autos || []
  const choferes = resumen?.config?.choferes || []
  const globalTurnoBase = resumen?.config?.turno_base || 50000

  const handleCreateAuto = async () => {
    if (!newAutoNombre.trim()) return showToast('Ingresá el nombre del auto', 'error')
    if (!newAutoTurno || parseInt(newAutoTurno) <= 0) return showToast('Ingresá el turno base', 'error')
    setSaving(true)
    const { error } = await createAuto(newAutoNombre.trim(), parseInt(newAutoTurno))
    setSaving(false)
    if (error) return showToast('⚠ ' + error.message, 'error')
    showToast('✓ Auto agregado', 'success')
    setNewAutoNombre(''); setNewAutoTurno(''); setShowNewAuto(false)
    onRefresh()
  }

  const handleUpdateTurno = async (autoId) => {
    const v = editingTurno[autoId]
    if (!v || parseInt(v) <= 0) return showToast('Ingresá un turno válido', 'error')
    setSavingTurno(autoId)
    const { error } = await updateAutoTurnoBase(autoId, parseInt(v))
    setSavingTurno(null)
    if (error) return showToast('⚠ ' + error.message, 'error')
    showToast('✓ Turno actualizado', 'success')
    setEditingTurno(prev => { const n = { ...prev }; delete n[autoId]; return n })
    onRefresh()
  }

  const handleCreateChofer = async (autoId) => {
    if (!newChoferNombre.trim()) return showToast('Ingresá el nombre del chofer', 'error')
    setSavingChofer(true)
    const { error } = await createChofer(autoId, newChoferNombre.trim())
    setSavingChofer(false)
    if (error) return showToast('⚠ ' + error.message, 'error')
    showToast('✓ Chofer agregado', 'success')
    setNewChoferNombre(''); setShowNewChofer(null)
    onRefresh()
  }

  const handleEditChofer = async (id) => {
    if (!editChoferNombre.trim()) return showToast('Ingresá el nombre', 'error')
    setSavingChoferEdit(true)
    const { error } = await updateChofer(id, editChoferNombre.trim())
    setSavingChoferEdit(false)
    if (error) return showToast('⚠ ' + error.message, 'error')
    showToast('✓ Nombre actualizado', 'success')
    setEditingChoferId(null)
    onRefresh()
  }

  return (
    <>
      {autos.map(auto => {
        const autoChoferes = choferes.filter(c => c.auto_id === auto.id)
        const turnoActual = auto.turno_base || globalTurnoBase
        const turnoVal = editingTurno[auto.id] ?? ''
        return (
          <div key={auto.id} className="card" style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span className="auto-tag tag-auto">{auto.nombre}</span>
            </div>

            <div className="stitle" style={{ marginTop: 0 }}>Turno base</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <input className="form-input" type="number" inputMode="numeric"
                placeholder={`$${turnoActual.toLocaleString('es-AR')}`}
                value={turnoVal}
                onChange={e => setEditingTurno(prev => ({ ...prev, [auto.id]: e.target.value }))}
                style={{ flex: 1, fontFamily: "'DM Mono',monospace" }}
              />
              <button className="kms-btn"
                disabled={savingTurno === auto.id || !turnoVal}
                onClick={() => handleUpdateTurno(auto.id)}>
                {savingTurno === auto.id ? '...' : 'OK'}
              </button>
            </div>

            <div className="stitle">Choferes</div>
            {autoChoferes.map(c => (
              editingChoferId === c.id ? (
                <div key={c.id} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                  <input className="form-input" value={editChoferNombre}
                    onChange={e => setEditChoferNombre(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleEditChofer(c.id)}
                    style={{ flex: 1 }} autoFocus />
                  <button className="kms-btn" disabled={savingChoferEdit} onClick={() => handleEditChofer(c.id)}>
                    {savingChoferEdit ? '...' : 'OK'}
                  </button>
                  <button onClick={() => setEditingChoferId(null)}
                    style={{ padding: '0 14px', background: '#1a0505', border: '1px solid #3a1010', borderRadius: 12, color: '#ff4545', cursor: 'pointer', fontSize: 13 }}>
                    ✕
                  </button>
                </div>
              ) : (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: '#161616', borderRadius: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 14, color: '#ccc' }}>{c.nombre}</span>
                  <button className="gasto-del-btn" style={{ color: '#aaa', background: '#1A1A1A', borderColor: '#2A2A2A' }}
                    onClick={() => { setEditingChoferId(c.id); setEditChoferNombre(c.nombre) }}>
                    ✎
                  </button>
                </div>
              )
            ))}
            {showNewChofer === auto.id ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <input className="form-input" placeholder="Nombre del chofer"
                  value={newChoferNombre} onChange={e => setNewChoferNombre(e.target.value)}
                  style={{ flex: 1 }} autoFocus
                />
                <button className="kms-btn" disabled={savingChofer} onClick={() => handleCreateChofer(auto.id)}>
                  {savingChofer ? '...' : 'OK'}
                </button>
                <button onClick={() => { setShowNewChofer(null); setNewChoferNombre('') }}
                  style={{ padding: '0 14px', background: '#1a0505', border: '1px solid #3a1010', borderRadius: 12, color: '#ff4545', cursor: 'pointer', fontSize: 13 }}>
                  ✕
                </button>
              </div>
            ) : (
              <button onClick={() => setShowNewChofer(auto.id)}
                style={{ background: 'none', border: 'none', color: '#555', fontSize: 13, cursor: 'pointer', padding: '6px 0', marginTop: 2 }}>
                + Agregar chofer
              </button>
            )}
          </div>
        )
      })}

      {showNewAuto ? (
        <div className="card" style={{ marginBottom: 10 }}>
          <div className="stitle" style={{ marginTop: 0 }}>Nuevo auto</div>
          <div className="form-group">
            <input className="form-input" placeholder="Nombre (ej: Corsa Blanco)"
              value={newAutoNombre} onChange={e => setNewAutoNombre(e.target.value)} autoFocus />
          </div>
          <div className="form-group">
            <input className="form-input" type="number" inputMode="numeric" placeholder="Turno base ($)"
              value={newAutoTurno} onChange={e => setNewAutoTurno(e.target.value)}
              style={{ fontFamily: "'DM Mono',monospace" }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="action-btn ab-primary" style={{ flex: 1 }} disabled={saving} onClick={handleCreateAuto}>
              {saving ? 'Guardando...' : '✓ Agregar'}
            </button>
            <button className="action-btn" style={{ flex: 1 }} onClick={() => { setShowNewAuto(false); setNewAutoNombre(''); setNewAutoTurno('') }}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button className="action-btn" style={{ width: '100%', marginTop: 4 }} onClick={() => setShowNewAuto(true)}>
          + Agregar auto a la flota
        </button>
      )}
    </>
  )
}

function MantItemsTab({ resumen, showToast, onRefresh }) {
  const autos = resumen?.config?.autos || []
  const autosData = resumen?.autos || {}

  const [items, setItems] = useState([])
  const [loadingItems, setLoadingItems] = useState(true)
  const [mantModal, setMantModal] = useState(null)

  // edit/create state
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ nombre: '', frecuencia: '', autoId: null })
  const [savingEdit, setSavingEdit] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [newItem, setNewItem] = useState({ nombre: '', frecuencia: '', autoId: null })
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null) // id del item a confirmar

  const reloadItems = async () => {
    setLoadingItems(true)
    const { data } = await getUserMantItems()
    setItems(data || [])
    setLoadingItems(false)
  }
  useEffect(() => { reloadItems() }, [])

  const autoNombre = (autoId) => autos.find(a => a.id === autoId)?.nombre || null

  const handleCreate = async () => {
    if (!newItem.nombre.trim()) return showToast('Ingresá el nombre', 'error')
    if (!newItem.frecuencia || parseInt(newItem.frecuencia) <= 0) return showToast('Ingresá la frecuencia en kms', 'error')
    setSaving(true)
    const { error } = await createMantItem(newItem.nombre.trim(), parseInt(newItem.frecuencia), newItem.autoId)
    setSaving(false)
    if (error) return showToast('⚠ ' + error.message, 'error')
    showToast('✓ Item agregado', 'success')
    setNewItem({ nombre: '', frecuencia: '', autoId: null }); setShowForm(false)
    reloadItems(); onRefresh()
  }

  const handleEdit = async () => {
    if (!editForm.nombre.trim()) return showToast('Ingresá el nombre', 'error')
    if (!editForm.frecuencia || parseInt(editForm.frecuencia) <= 0) return showToast('Ingresá la frecuencia en kms', 'error')
    setSavingEdit(true)
    const { error } = await updateMantItem(editingId, editForm.nombre.trim(), parseInt(editForm.frecuencia), editForm.autoId)
    setSavingEdit(false)
    if (error) return showToast('⚠ ' + error.message, 'error')
    showToast('✓ Item actualizado', 'success')
    setEditingId(null)
    reloadItems(); onRefresh()
  }

  // ── SECCIÓN DE ESTADO POR AUTO ───────────────────────────────────────────────
  const statusSection = (
    <>
      <div className="stitle">Estado por auto</div>
      {autos.length === 0 && (
        <div className="loading" style={{ padding: '20px 0' }}>Sin autos en la flota</div>
      )}
      {autos.map(auto => {
        const adata = autosData[auto.id]
        const mant = adata?.mantenimiento || []
        const kmsAct = adata?.kms_actuales || 0
        const hayCambiar = mant.some(m => m.estado === 'CAMBIAR')
        return (
          <div key={auto.id} className="card" style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span className="auto-tag tag-auto">{auto.nombre}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {hayCambiar && <span style={{ fontSize: 10, fontWeight: 700, color: '#EF4444' }}>⚠ ATENCIÓN</span>}
                <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: '#555' }}>
                  {kmsAct.toLocaleString('es-AR')} km
                </span>
              </div>
            </div>
            {mant.length === 0 ? (
              <div style={{ fontSize: 12, color: '#444', textAlign: 'center', padding: '6px 0' }}>
                Sin items de mantenimiento asignados
              </div>
            ) : (
              <div className="mant-list">
                {mant.map(m => (
                  <div key={m.id} className="mant-item"
                    onClick={() => setMantModal({ autoId: auto.id, item: m, autoNombre: auto.nombre, kmsAct })}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="mant-nombre">{m.nombre}</div>
                      <div className="mant-sub">
                        {m.estado === 'CAMBIAR'
                          ? `Último: ${m.ultimo_kms.toLocaleString('es-AR')} km · VENCIDO`
                          : `Próximo: ${m.proximo_kms.toLocaleString('es-AR')} km · faltan ${m.faltan_kms.toLocaleString('es-AR')} km`
                        }
                      </div>
                    </div>
                    <span className={`mbadge ${m.estado === 'CAMBIAR' ? 'mbadge-cambiar' : 'mbadge-ok'}`}>
                      {m.estado === 'CAMBIAR' ? '⚠ CAMBIAR' : '✓ OK'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </>
  )

  // ── SECCIÓN DE GESTIÓN DE ITEMS ───────────────────────────────────────────────
  const crudSection = (
    <>
      <div className="stitle" style={{ marginTop: 24 }}>Mis items</div>

      {loadingItems ? (
        <div className="loading" style={{ padding: '20px 0' }}><div className="spinner" /></div>
      ) : (
        <>
          {items.length === 0 && !showForm && (
            <div className="loading" style={{ padding: '20px 0', fontSize: 12 }}>Sin items — agregá uno abajo</div>
          )}

          {items.map(item => {
            const isEditing = editingId === item.id
            return (
              <div key={item.id} className="card" style={{ marginBottom: 8 }}>
                {isEditing ? (
                  <>
                    <div className="stitle" style={{ marginTop: 0 }}>Editar</div>
                    <div className="form-group">
                      <input className="form-input" placeholder="Nombre" value={editForm.nombre}
                        onChange={e => setEditForm(f => ({ ...f, nombre: e.target.value }))} autoFocus />
                    </div>
                    <div className="form-group">
                      <input className="form-input" type="number" inputMode="numeric" placeholder="Cada cuántos kms"
                        value={editForm.frecuencia} onChange={e => setEditForm(f => ({ ...f, frecuencia: e.target.value }))}
                        style={{ fontFamily: "'DM Mono',monospace" }} />
                    </div>
                    <div className="stitle">Aplica a</div>
                    <MantAutoSelector autos={autos} selected={editForm.autoId} onChange={v => setEditForm(f => ({ ...f, autoId: v }))} />
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button className="action-btn ab-primary" style={{ flex: 1 }} disabled={savingEdit} onClick={handleEdit}>
                        {savingEdit ? '...' : '✓ Guardar'}
                      </button>
                      <button className="action-btn" style={{ flex: 1 }} onClick={() => setEditingId(null)}>Cancelar</button>
                    </div>
                  </>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{item.nombre}</div>
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: '#555', marginTop: 3 }}>
                        Cada {item.frecuencia_kms.toLocaleString('es-AR')} km
                        {' · '}
                        <span style={{ color: item.auto_id ? '#276EF1' : '#666' }}>
                          {item.auto_id ? (autoNombre(item.auto_id) || 'Auto específico') : 'Todos los autos'}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button className="gasto-del-btn" style={{ color: '#aaa', background: '#161616', borderColor: '#2A2A2A' }}
                        onClick={() => { setEditingId(item.id); setEditForm({ nombre: item.nombre, frecuencia: String(item.frecuencia_kms), autoId: item.auto_id || null }) }}>
                        ✎
                      </button>
                      <button className="gasto-del-btn" disabled={deletingId === item.id}
                        onClick={() => setDeleteConfirm(item.id)}>
                        {deletingId === item.id ? '...' : '✕'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {showForm ? (
            <div className="card" style={{ marginBottom: 10 }}>
              <div className="stitle" style={{ marginTop: 0 }}>Nuevo item</div>
              <div className="form-group">
                <input className="form-input" placeholder="Nombre (ej: Frenos)" value={newItem.nombre}
                  onChange={e => setNewItem(f => ({ ...f, nombre: e.target.value }))} autoFocus />
              </div>
              <div className="form-group">
                <input className="form-input" type="number" inputMode="numeric" placeholder="Cada cuántos kms"
                  value={newItem.frecuencia} onChange={e => setNewItem(f => ({ ...f, frecuencia: e.target.value }))}
                  style={{ fontFamily: "'DM Mono',monospace" }} />
              </div>
              <div className="stitle">Aplica a</div>
              <MantAutoSelector autos={autos} selected={newItem.autoId} onChange={v => setNewItem(f => ({ ...f, autoId: v }))} />
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="action-btn ab-primary" style={{ flex: 1 }} disabled={saving} onClick={handleCreate}>
                  {saving ? 'Guardando...' : '✓ Agregar'}
                </button>
                <button className="action-btn" style={{ flex: 1 }} onClick={() => { setShowForm(false); setNewItem({ nombre: '', frecuencia: '', autoId: null }) }}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button className="action-btn" style={{ width: '100%', marginTop: 4 }} onClick={() => setShowForm(true)}>
              + Agregar item
            </button>
          )}
        </>
      )}
    </>
  )

  const handleDeleteItemConfirmed = async () => {
    const id = deleteConfirm
    setDeleteConfirm(null)
    setDeletingId(id)
    const { error } = await deleteMantItem(id)
    setDeletingId(null)
    if (error) return showToast('⚠ ' + error.message, 'error')
    showToast('✓ Item eliminado', 'success')
    setItems(prev => prev.filter(x => x.id !== id))
    onRefresh()
  }

  return (
    <>
      {statusSection}
      <div className="divider" style={{ margin: '4px 0' }} />
      {crudSection}

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

      {deleteConfirm && (
        <ConfirmModal
          title="Eliminar item"
          message="¿Estás seguro? Se eliminará el item de mantenimiento."
          confirmLabel="Eliminar"
          onConfirm={handleDeleteItemConfirmed}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </>
  )
}

function MantAutoSelector({ autos, selected, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
      <div className={`radio-opt ${!selected ? 'sel' : ''}`} style={{ flex: 'none', padding: '8px 14px' }}
        onClick={() => onChange(null)}>
        <div className="rl" style={{ fontSize: 12 }}>Todos</div>
      </div>
      {autos.map(a => (
        <div key={a.id} className={`radio-opt ${selected === a.id ? 'sel' : ''}`} style={{ flex: 'none', padding: '8px 14px' }}
          onClick={() => onChange(selected === a.id ? null : a.id)}>
          <div className="rl" style={{ fontSize: 12 }}>{a.nombre}</div>
        </div>
      ))}
    </div>
  )
}

// ── ICONS ─────────────────────────────────────────────────────────────────────
const GridIcon  = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
const CalIcon   = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
const MoneyIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
const FleetIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 17H5"/><path d="M19 17a2 2 0 0 0 2-2v-4l-2.5-5h-11L5 11v4a2 2 0 0 0 2 2"/><circle cx="8" cy="17" r="2"/><circle cx="16" cy="17" r="2"/></svg>
const AdminIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>

// ── HELPERS ───────────────────────────────────────────────────────────────────
function chunk(arr, size) {
  const res = []
  for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size))
  return res
}

// ── STYLES ────────────────────────────────────────────────────────────────────
const globalStyles = `
  *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
  body{background:#000}

  .header{padding:52px 20px 14px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;background:rgba(0,0,0,0.92);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid #1A1A1A}
  .sync-btn{width:36px;height:36px;border-radius:50%;background:#1A1A1A;border:none;color:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.15s}
  .sync-btn:active{background:#2A2A2A}

  .page{padding:0 20px 100px}
  .loading{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 20px;gap:14px;color:#555;font-size:13px}
  .spinner{width:28px;height:28px;border:2px solid #1F1F1F;border-top-color:#276EF1;border-radius:50%;animation:spin 0.75s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}

  .stitle{font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#555;margin:20px 0 10px}
  .card{background:#0D0D0D;border:1px solid #1C1C1C;border-radius:16px;padding:18px;margin-bottom:10px}
  .auto-tag{font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:4px 12px;border-radius:100px;display:inline-block}
  .tag-auto{background:#1A1A1A;color:#fff;border:1px solid #2A2A2A}
  .divider{height:1px;background:#1A1A1A;margin:14px 0}

  .alert-banner{background:#0D0000;border:1px solid #2A0000;border-radius:14px;padding:12px 16px;margin-bottom:10px;display:flex;gap:10px;align-items:center;font-size:13px}

  .total-banner{background:#0D0D0D;border:1px solid #1C1C1C;border-radius:16px;padding:18px 20px;display:flex;justify-content:space-between;margin-bottom:12px}
  .total-label{font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px}
  .total-value{font-family:'DM Mono',monospace;font-size:24px;font-weight:500;color:#276EF1}

  .gan-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0 0}
  .gan-cell{background:#161616;border-radius:12px;padding:12px 14px}
  .gan-label{font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#555;margin-bottom:4px}
  .gan-value{font-family:'DM Mono',monospace;font-size:15px;font-weight:500;color:#276EF1}

  .neto-row{background:#091428;border:1px solid #0D1E42;border-radius:12px;padding:12px 14px;margin-top:8px;display:flex;justify-content:space-between;align-items:center}
  .neto-label{font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#555}
  .neto-value{font-family:'DM Mono',monospace;font-size:16px;font-weight:600;color:#276EF1}

  .ab-danger{background:#1A0808;color:#EF4444;border:1px solid #3A1010}

  .metric-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
  .metric{background:#161616;border-radius:12px;padding:12px 14px}
  .metric-label{font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#555;margin-bottom:4px}
  .metric-value{font-family:'DM Mono',monospace;font-size:15px;font-weight:500}

  .kms-row{display:flex;gap:8px;align-items:center;margin-top:10px}
  .kms-input{flex:1;padding:10px 14px;background:#161616;border:1px solid #2A2A2A;border-radius:12px;color:#fff;font-family:'DM Mono',monospace;font-size:14px;outline:none;-webkit-appearance:none;transition:border-color 0.2s}
  .kms-input:focus{border-color:#276EF1}
  .kms-btn{padding:10px 16px;background:#fff;color:#000;border:none;border-radius:12px;font-weight:700;font-size:13px;cursor:pointer}

  .mant-list{display:flex;flex-direction:column;gap:6px;margin-top:10px}
  .mant-item{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#161616;border-radius:12px;cursor:pointer;border:1px solid transparent;transition:border-color 0.15s}
  .mant-item:active{border-color:#2A2A2A}
  .mant-nombre{font-size:13px;font-weight:600}
  .mant-sub{font-family:'DM Mono',monospace;font-size:10px;color:#555;margin-top:3px}
  .mbadge{font-size:10px;font-weight:700;padding:3px 9px;border-radius:100px;text-transform:uppercase}
  .mbadge-ok{background:#091428;color:#276EF1}.mbadge-cambiar{background:#1A0A0A;color:#EF4444}

  .cal-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
  .cal-nav-btn{width:38px;height:38px;border-radius:50%;background:#1A1A1A;border:none;color:#fff;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center}
  .cal-month-label{font-size:17px;font-weight:700;letter-spacing:-0.3px}
  .cal-legend{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px}
  .leg-item{display:flex;align-items:center;gap:5px;font-size:10px;color:#555}
  .leg-dot{width:8px;height:8px;border-radius:2px;flex-shrink:0}

  .filter-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
  .filter-chip{padding:6px 14px;border-radius:100px;border:1px solid #1C1C1C;background:#111;color:#555;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.15s;white-space:nowrap}
  .filter-chip:active{opacity:0.7}
  .fchip-active{background:#fff;color:#000;border-color:#fff}

  .cal-table{width:100%;border-collapse:separate;border-spacing:3px}
  .cal-th{font-family:'DM Mono',monospace;font-size:10px;color:#444;text-align:center;padding:4px 2px;font-weight:500}
  .cal-td{padding:1px;vertical-align:top;cursor:pointer}.cal-td.empty{cursor:default}
  .day-cell{border-radius:10px;background:#111;border:1px solid transparent;padding:5px 3px 4px;min-height:64px;display:flex;flex-direction:column;align-items:center;gap:2px}
  .day-cell-empty{min-height:64px}
  .day-cell.today{border-color:#fff}.day-cell.has-debe{border-color:#3A1515}.day-cell.all-franco{background:#080D14;border-color:#0F2040}.day-cell.future{opacity:0.25}
  .day-num{font-family:'DM Mono',monospace;font-size:11px;font-weight:500;color:#444;line-height:1}
  .day-cell.today .day-num{color:#fff;font-weight:700}
  .day-choferes{display:flex;flex-direction:column;gap:2px;width:100%}
  .chofer-pill{border-radius:4px;font-family:'DM Mono',monospace;font-size:9px;font-weight:700;padding:2px 3px;text-align:center;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pill-completo{background:#091428;color:#276EF1}.pill-parcial{background:#1A1000;color:#F59E0B}.pill-debe{background:#1A0808;color:#EF4444}.pill-franco{background:#08111F;color:#60A5FA}.pill-futuro{background:#111;color:#2A2A2A}

  .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:500;display:flex;align-items:flex-end}
  .modal-sheet{background:#0D0D0D;border-radius:24px 24px 0 0;width:100%;padding:24px 20px 48px;max-height:88dvh;overflow-y:auto;border-top:1px solid #1C1C1C}
  .modal-date{font-family:'DM Mono',monospace;font-size:11px;color:#555;margin-bottom:4px;text-transform:uppercase;letter-spacing:1px}
  .modal-title{font-size:22px;font-weight:700;margin-bottom:18px;letter-spacing:-0.3px}
  .modal-back{background:none;border:none;color:#555;font-size:14px;cursor:pointer;padding:0;margin-bottom:4px}
  .modal-close{width:100%;padding:14px;background:transparent;color:#555;border:1px solid #1C1C1C;border-radius:14px;font-size:14px;cursor:pointer;margin-top:12px}

  .auto-pick-btn{display:flex;align-items:center;justify-content:space-between;padding:16px;background:#161616;border:1px solid #1C1C1C;border-radius:14px;margin-bottom:8px;cursor:pointer;transition:border-color 0.15s}
  .auto-pick-btn:active{border-color:#333}

  .chofer-section{margin-bottom:10px;background:#161616;border-radius:14px;padding:16px}
  .chofer-sec-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
  .chofer-sec-name{font-size:16px;font-weight:600}
  .eb{font-family:'DM Mono',monospace;font-size:10px;font-weight:700;padding:4px 10px;border-radius:100px;text-transform:uppercase}
  .eb-completo{background:#091428;color:#276EF1}.eb-parcial{background:#1A1000;color:#F59E0B}.eb-debe{background:#1A0808;color:#EF4444}.eb-franco{background:#08111F;color:#60A5FA}.eb-futuro{background:#1A1A1A;color:#555}

  .action-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
  .action-btn{padding:12px 8px;border-radius:12px;border:1px solid #1C1C1C;background:#111;color:#fff;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;cursor:pointer;text-align:center;transition:opacity 0.15s}
  .action-btn:active{opacity:0.7}.action-btn:disabled{opacity:0.35;cursor:not-allowed}
  .ab-primary{background:#fff;color:#000;border-color:#fff;font-weight:700}
  .ab-franco{background:#08111F;color:#60A5FA;border-color:#0F2040}
  .ab-quitar{background:#1A0808;color:#F59E0B;border-color:#2A1010}

  .monto-row{display:flex;gap:8px}
  .monto-input{flex:1;padding:12px 14px;background:#111;border:1px solid #1C1C1C;border-radius:12px;color:#fff;font-family:'DM Mono',monospace;font-size:15px;outline:none;-webkit-appearance:none;transition:border-color 0.2s}
  .monto-input:focus{border-color:#276EF1}.monto-input::placeholder{color:#333}
  .monto-btn{padding:12px 18px;background:#1A1A1A;color:#fff;border:1px solid #2A2A2A;border-radius:12px;font-weight:600;font-size:13px;cursor:pointer;transition:background 0.15s}
  .monto-btn:active{background:#fff;color:#000}.monto-btn:disabled{opacity:0.4}

  .tabs{display:flex;gap:6px;margin-bottom:18px;background:#0D0D0D;padding:4px;border-radius:14px;border:1px solid #1C1C1C}
  .tab{flex:1;padding:10px;border-radius:10px;border:none;background:transparent;color:#555;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;cursor:pointer;text-align:center;transition:all 0.2s}
  .tab.active{background:#fff;color:#000;font-weight:700}

  .gasto-item{display:flex;align-items:center;padding:14px 16px;background:#0D0D0D;border:1px solid #1C1C1C;border-radius:14px;margin-bottom:8px}
  .gasto-desc{font-size:14px;font-weight:600}.gasto-auto{font-size:11px;color:#555;margin-top:2px}
  .gasto-monto{font-family:'DM Mono',monospace;font-size:14px;color:#EF4444;font-weight:500;white-space:nowrap}
  .gasto-del-btn{width:30px;height:30px;border-radius:10px;border:1px solid #2A1010;background:#1A0808;color:#EF4444;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .gasto-del-btn:disabled{opacity:0.4;cursor:not-allowed}

  .form-label{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#555;display:block;margin-bottom:8px}
  .form-input{width:100%;padding:14px 16px;background:#111;border:1px solid #1C1C1C;border-radius:14px;color:#fff;font-family:'DM Sans',sans-serif;font-size:15px;outline:none;-webkit-appearance:none;transition:border-color 0.2s}
  .form-input:focus{border-color:#276EF1}.form-input::placeholder{color:#333}
  .form-group{margin-bottom:14px}
  select.form-input{cursor:pointer}
  .radio-group{display:flex;gap:8px}
  .radio-opt{flex:1;padding:12px;border-radius:12px;border:1px solid #1C1C1C;background:#111;text-align:center;cursor:pointer;transition:all 0.15s}
  .radio-opt.sel{border-color:#276EF1;background:#091428}
  .rl{font-size:13px;font-weight:600;color:#fff}

  .btn-primary{width:100%;padding:16px;background:#fff;color:#000;border:none;border-radius:14px;font-family:'DM Sans',sans-serif;font-size:15px;font-weight:700;cursor:pointer;margin-top:8px;transition:opacity 0.15s}
  .btn-primary:active{opacity:0.85}.btn-primary:disabled{opacity:0.4;cursor:not-allowed}

  .toast{position:fixed;bottom:92px;left:50%;transform:translateX(-50%) translateY(16px);background:#1A1A1A;border:1px solid #2A2A2A;color:#fff;padding:12px 20px;border-radius:100px;font-size:13px;font-weight:600;opacity:0;transition:all 0.25s;z-index:999;white-space:nowrap;max-width:92vw;text-align:center}
  .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}.toast.success{border-color:#276EF1;color:#276EF1}.toast.error{border-color:#EF4444;color:#EF4444}

  .bottom-nav{position:fixed;bottom:0;left:0;right:0;display:flex;background:rgba(0,0,0,0.95);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border-top:1px solid #1A1A1A;padding:10px 0 26px;z-index:200}
  .bnav-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;padding:4px 0;background:none;border:none;cursor:pointer;color:#444;transition:color 0.2s}
  .bnav-btn svg{width:22px;height:22px}.bnav-label{font-size:9px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase}
  .bnav-btn.active{color:#fff}
`
