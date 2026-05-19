import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from './supabase'
import {
  getDemoResumen, getDemoCalendario, getDemoGastos, getDemoMonthlyStats, getDemoDeudaHistorica, getDemoMonthlyStatsByAuto,
} from './demoData'
import {
  getResumen, getCalendario, getConfig, upsertTurno, deleteTurno, marcarFranco, quitarFranco,
  insertGasto, deleteGasto, getGastos, updateKms, insertMantenimiento,
  signIn, signUp, signOut, signInWithGoogle, getProfile, checkFleet, createFleet,
  getAdminUsers, setUserActivo, addPayment,
  createAuto, deleteAuto, createChofer, updateAutoTurnoBase, updateAutoVencimientos, updateChofer,
  getUserMantItems, createMantItem, updateMantItem, deleteMantItem,
  getMonthlyStats, getDeudaHistorica, getMonthlyStatsByAuto,
  getDeudas, insertDeuda, saldarDeuda, deleteDeuda,
} from './data'

// ── CONSTANTES ────────────────────────────────────────────────────────────────
const TURNO_BASE_DEFAULT = 50000

const DEMO_DEUDAS = [
  { id: 'dd1', chofer_id: 'dc2', descripcion: 'Multa de tránsito', monto: 15000, fecha: '2026-05-01', saldado: false, choferes: { nombre: 'Roberto P.', autos: { nombre: 'Corsa Blanco' } } },
  { id: 'dd2', chofer_id: 'dc4', descripcion: 'Adelanto de turno', monto: 25000, fecha: '2026-04-28', saldado: false, choferes: { nombre: 'Diego F.', autos: { nombre: 'Gol Negro' } } },
  { id: 'dd3', chofer_id: 'dc3', descripcion: 'Reparación espejo', monto: 8500,  fecha: '2026-04-15', saldado: true,  choferes: { nombre: 'Miguel A.', autos: { nombre: 'Gol Negro' } } },
]
const TOAST_DURATION = 3000
const ALERTA_DIAS = 5   // días de anticipación para alertas VTV/seguro

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
function ConfirmModal({ title, message, confirmLabel = 'Eliminar', onConfirm, onCancel, loading = false }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !loading && onCancel()}>
      <div className="modal-sheet">
        <div className="modal-title">{title}</div>
        {message && <div style={{ color: '#888', fontSize: 13, marginBottom: 20, lineHeight: 1.5 }}>{message}</div>}
        <button className="btn-primary ab-danger" style={{ marginBottom: 10 }} onClick={onConfirm} disabled={loading}>
          {loading ? 'Eliminando...' : confirmLabel}
        </button>
        <button className="modal-close" onClick={onCancel} disabled={loading}>Cancelar</button>
      </div>
    </div>
  )
}

// ── BAR CHART ─────────────────────────────────────────────────────────────────
function BarChart({ data }) {
  if (!data || data.length === 0) return null
  const maxVal = Math.max(...data.flatMap(d => [d.turnos, d.gastos]), 1)
  const H = 110, BW = 14, GAP = 3, SW = 52
  return (
    <div style={{ marginTop: 8 }}>
      <svg viewBox={`0 0 ${data.length * SW} ${H + 30}`} style={{ width: '100%', overflow: 'visible' }}>
        {data.map((d, i) => {
          const x = i * SW + SW / 2
          const hT = Math.max((d.turnos / maxVal) * H, 2)
          const hG = Math.max((d.gastos / maxVal) * H, 2)
          const label = MESES[d.mes - 1].slice(0, 3)
          return (
            <g key={d.key}>
              <rect x={x - BW - GAP} y={H - hT} width={BW} height={hT} fill="#3F7DF5" rx="3" />
              <rect x={x + GAP} y={H - hG} width={BW} height={hG} fill="#EF4444" rx="3" opacity="0.85" />
              <text x={x} y={H + 14} textAnchor="middle" fill="#555" fontSize="9" fontFamily="DM Mono,monospace">{label}</text>
            </g>
          )
        })}
        <line x1="0" y1={H} x2={data.length * SW} y2={H} stroke="#23232E" strokeWidth="1" />
      </svg>
      <div style={{ display: 'flex', gap: 16, marginTop: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: '#3F7DF5' }} />
          <span style={{ fontSize: 10, color: '#555' }}>Ganancias</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: '#EF4444' }} />
          <span style={{ fontSize: 10, color: '#555' }}>Gastos</span>
        </div>
      </div>
    </div>
  )
}

// ── TUTORIAL ILLUSTRATIONS ────────────────────────────────────────────────────
function IllustWelcome() {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 58, fontWeight: 800, letterSpacing: -3, color: '#fff', lineHeight: 1 }}>
        Flota<span style={{ color: '#3F7DF5' }}>.</span>
      </div>
      <div style={{ color: '#333', fontSize: 11, marginTop: 10, letterSpacing: 3, fontWeight: 700 }}>GESTIÓN DE REMISES</div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 28 }}>
        {['$312k', '6 autos', '4 choferes'].map((t, i) => (
          <div key={i} style={{ background: '#15151B', borderRadius: 10, padding: '8px 14px', fontSize: 11, color: '#555', fontWeight: 700 }}>{t}</div>
        ))}
      </div>
    </div>
  )
}

function IllustResumen() {
  return (
    <div style={{ width: 270, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, background: '#15151B', borderRadius: 14, padding: '12px 14px', border: '1px solid #1e1e2e' }}>
          <div style={{ fontSize: 9, color: '#444', letterSpacing: 1.5, fontWeight: 700, marginBottom: 6 }}>ESTA SEMANA</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>$84.500</div>
          <div style={{ fontSize: 11, color: '#10B981', marginTop: 4, fontWeight: 600 }}>▲ 12% vs semana anterior</div>
        </div>
        <div style={{ flex: 1, background: '#15151B', borderRadius: 14, padding: '12px 14px', border: '1px solid #1e1e2e' }}>
          <div style={{ fontSize: 9, color: '#444', letterSpacing: 1.5, fontWeight: 700, marginBottom: 6 }}>ESTE MES</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>$312k</div>
          <div style={{ fontSize: 11, color: '#F59E0B', marginTop: 4, fontWeight: 600 }}>neto $218.400</div>
        </div>
      </div>
      <div style={{ background: '#15151B', borderRadius: 14, padding: '12px 14px', border: '1px solid #1e1e2e' }}>
        <div style={{ fontSize: 9, color: '#444', letterSpacing: 1.5, fontWeight: 700, marginBottom: 8 }}>AUTOS EN TURNO HOY</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['Corolla','Gol','Logan','Sandero'].map((a, i) => (
            <div key={i} style={{ flex: 1, background: i < 3 ? '#3F7DF518' : '#1F1F26', borderRadius: 8, padding: '6px 4px', textAlign: 'center', fontSize: 9, color: i < 3 ? '#3F7DF5' : '#333', fontWeight: 700, border: `1px solid ${i < 3 ? '#3F7DF533' : '#222'}` }}>{a}</div>
          ))}
        </div>
      </div>
      <div style={{ background: '#1A1208', border: '1px solid #F59E0B33', borderRadius: 12, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 20 }}>🔧</div>
        <div>
          <div style={{ fontSize: 11, color: '#F59E0B', fontWeight: 700 }}>SERVICE PRÓXIMO</div>
          <div style={{ fontSize: 11, color: '#555', marginTop: 1 }}>Toyota Corolla · faltan 500 km</div>
        </div>
      </div>
    </div>
  )
}

function IllustCalendario() {
  const days = ['L','M','M','J','V','S','D']
  const grid = [
    [null,null,null,null,'#3F7DF5','#3F7DF5',null],
    ['#3F7DF5','#3F7DF5','#3F7DF5','#3F7DF5',null,'#10B981',null],
    ['#3F7DF5',null,'#3F7DF5','#3F7DF5','#3F7DF5','#3F7DF5',null],
    ['#3F7DF5','#3F7DF5',null,'#3F7DF5',null,null,null],
  ]
  const labels = [[null,null,null,null,3,4,null],[5,6,7,8,null,9,null],[10,null,12,13,14,15,null],[16,17,null,19,null,null,null]]
  return (
    <div style={{ width: 260 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>Mayo 2025</div>
        <div style={{ display: 'flex', gap: 16, fontSize: 16, color: '#444' }}><span>‹</span><span style={{ color: '#fff' }}>›</span></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3, marginBottom: 4 }}>
        {days.map((d, i) => <div key={i} style={{ textAlign: 'center', fontSize: 9, color: '#333', fontWeight: 700, paddingBottom: 4 }}>{d}</div>)}
      </div>
      {grid.map((row, ri) => (
        <div key={ri} style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3, marginBottom: 3 }}>
          {row.map((color, ci) => (
            <div key={ci} style={{ aspectRatio: '1', borderRadius: 7, background: color || '#0e0e0e', border: `1px solid ${color ? color + '44' : '#181818'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: color ? '#fff' : '#2A2A35', fontWeight: 600 }}>
              {labels[ri][ci] || ''}
            </div>
          ))}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 16, marginTop: 10, justifyContent: 'center' }}>
        {[['#3F7DF5','Turno completo'],['#10B981','Franco']].map(([c,l]) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#555' }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{l}
          </div>
        ))}
      </div>
    </div>
  )
}

function IllustGastos() {
  const items = [
    { icon: '⛽', label: 'Combustible', sub: 'Corolla · hoy', amount: '-$12.400', color: '#F59E0B' },
    { icon: '🛡️', label: 'Seguro mensual', sub: 'Todos los autos', amount: '-$28.000', color: '#EF4444' },
    { icon: '🔧', label: 'Cambio de aceite', sub: 'VW Gol · 15 may', amount: '-$8.500', color: '#F59E0B' },
  ]
  return (
    <div style={{ width: 270, display: 'flex', flexDirection: 'column', gap: 7 }}>
      {items.map((item, i) => (
        <div key={i} style={{ background: '#15151B', borderRadius: 12, padding: '11px 13px', display: 'flex', alignItems: 'center', gap: 11, border: '1px solid #1e1e1e' }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: item.color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>{item.icon}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#ddd' }}>{item.label}</div>
            <div style={{ fontSize: 10, color: '#444', marginTop: 2 }}>{item.sub}</div>
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: item.color, flexShrink: 0 }}>{item.amount}</div>
        </div>
      ))}
      <div style={{ background: '#0D1F0D', border: '1px solid #10B98133', borderRadius: 12, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 9, color: '#10B981', fontWeight: 700, letterSpacing: 1.5 }}>NETO DEL MES</div>
          <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>ingresos $312k − gastos $93.6k</div>
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#10B981' }}>$218.400</div>
      </div>
    </div>
  )
}

function IllustStats() {
  const months = ['DIC','ENE','FEB','MAR','ABR','MAY']
  const data = [{g:62,e:42},{g:75,e:50},{g:68,e:46},{g:88,e:58},{g:82,e:53},{g:100,e:65}]
  return (
    <div style={{ width: 270 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ fontSize: 9, color: '#444', fontWeight: 700, letterSpacing: 1.5 }}>ÚLTIMOS 6 MESES</div>
        <div style={{ display: 'flex', gap: 10 }}>
          {[['#3F7DF5','Ingresos'],['#F59E0B','Gastos']].map(([c,l]) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#555' }}>
              <div style={{ width: 7, height: 7, borderRadius: 2, background: c }} />{l}
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 5, alignItems: 'flex-end', height: 100, marginBottom: 6 }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, height: '100%', justifyContent: 'flex-end' }}>
            <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 86 }}>
              <div style={{ width: 13, borderRadius: '4px 4px 0 0', background: '#3F7DF5', height: `${d.g}%`, opacity: i === 5 ? 1 : 0.35 }} />
              <div style={{ width: 13, borderRadius: '4px 4px 0 0', background: '#F59E0B', height: `${d.e}%`, opacity: i === 5 ? 1 : 0.35 }} />
            </div>
            <div style={{ fontSize: 8, color: i === 5 ? '#777' : '#2A2A35', fontWeight: 700 }}>{months[i]}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <div style={{ flex: 1, background: '#15151B', borderRadius: 12, padding: '10px 12px', border: '1px solid #1e1e1e' }}>
          <div style={{ fontSize: 9, color: '#444', fontWeight: 700, letterSpacing: 1 }}>TOTAL INGRESOS</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#3F7DF5', marginTop: 4 }}>$487k</div>
        </div>
        <div style={{ flex: 1, background: '#15151B', borderRadius: 12, padding: '10px 12px', border: '1px solid #1e1e1e' }}>
          <div style={{ fontSize: 9, color: '#444', fontWeight: 700, letterSpacing: 1 }}>MARGEN NETO</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#10B981', marginTop: 4 }}>35.4%</div>
        </div>
      </div>
    </div>
  )
}

function IllustAutos() {
  const autos = [
    { nombre: 'Toyota Corolla', patente: 'AB 123 CD', chofer: 'Juan Pérez', color: '#3F7DF5', km: '87.420 km', ok: true },
    { nombre: 'VW Gol', patente: 'EF 456 GH', chofer: 'Carlos López', color: '#10B981', km: '124.800 km', ok: true },
    { nombre: 'Renault Logan', patente: 'IJ 789 KL', chofer: 'Sin asignar', color: '#333', km: '203.100 km', ok: false },
  ]
  return (
    <div style={{ width: 270, display: 'flex', flexDirection: 'column', gap: 7 }}>
      {autos.map((a, i) => (
        <div key={i} style={{ background: '#15151B', borderRadius: 12, padding: '11px 13px', display: 'flex', alignItems: 'center', gap: 12, borderLeft: `3px solid ${a.color}`, border: '1px solid #1e1e1e', borderLeftColor: a.color, borderLeftWidth: 3 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#ddd' }}>{a.nombre}</div>
              {!a.ok && <div style={{ fontSize: 9, background: '#F59E0B22', color: '#F59E0B', borderRadius: 5, padding: '2px 6px', fontWeight: 700 }}>SERVICE</div>}
            </div>
            <div style={{ fontSize: 10, color: '#444', marginTop: 2 }}>{a.patente} · {a.chofer}</div>
          </div>
          <div style={{ fontSize: 10, color: '#333', fontWeight: 600 }}>{a.km}</div>
        </div>
      ))}
    </div>
  )
}

function IllustDeudas() {
  const deudas = [
    { chofer: 'Juan Pérez', desc: 'Adelanto en efectivo', monto: '$15.000', pending: true },
    { chofer: 'Carlos López', desc: 'Multa de tránsito', monto: '$8.500', pending: true },
    { chofer: 'Roberto Díaz', desc: 'Reparación de espejo', monto: '$3.200', pending: false },
  ]
  return (
    <div style={{ width: 270, display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ fontSize: 9, color: '#444', fontWeight: 700, letterSpacing: 1.5 }}>DEUDAS DE CHOFERES</div>
        <div style={{ fontSize: 9, background: '#EF444422', color: '#EF4444', borderRadius: 6, padding: '3px 8px', fontWeight: 700 }}>TOTAL $23.500</div>
      </div>
      {deudas.map((d, i) => (
        <div key={i} style={{ background: '#15151B', borderRadius: 12, padding: '11px 13px', display: 'flex', alignItems: 'center', gap: 11, border: '1px solid #1e1e1e', opacity: d.pending ? 1 : 0.45 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#ddd' }}>{d.chofer}</div>
              <div style={{ fontSize: 9, background: d.pending ? '#EF444422' : '#10B98122', color: d.pending ? '#EF4444' : '#10B981', borderRadius: 5, padding: '2px 6px', fontWeight: 700 }}>
                {d.pending ? 'PENDIENTE' : 'SALDADO'}
              </div>
            </div>
            <div style={{ fontSize: 10, color: '#444', marginTop: 2 }}>{d.desc}</div>
          </div>
          <div style={{ fontSize: 14, fontWeight: 800, color: d.pending ? '#EF4444' : '#444' }}>{d.monto}</div>
        </div>
      ))}
    </div>
  )
}

// ── TUTORIAL OVERLAY ──────────────────────────────────────────────────────────
const TUTORIAL_STEPS = [
  { color: '#3F7DF5', subtitle: 'Bienvenido a', title: 'Flota.', body: 'Todo lo que necesitás para gestionar tu flota de remises. Rápido, claro y desde el celular.', Illust: IllustWelcome },
  { color: '#3F7DF5', subtitle: 'Pestaña Resumen', title: 'El pulso de\ntu flota', body: 'De un vistazo: ganancias de la semana, neto del mes, qué autos están en turno y alertas de mantenimiento.', Illust: IllustResumen },
  { color: '#60AFFF', subtitle: 'Pestaña Calendario', title: 'Turnos\ndía a día', body: 'Tocás un día y registrás turno completo, parcial o franco. Todo queda guardado por auto y por chofer.', Illust: IllustCalendario },
  { color: '#F59E0B', subtitle: 'Pestaña Gastos', title: 'Control de\ncostos real', body: 'Cargá combustible, seguros, multas y lo que sea. El neto del mes se calcula solo restando los gastos.', Illust: IllustGastos },
  { color: '#10B981', subtitle: 'Pestaña Stats', title: 'Rentabilidad\na la vista', body: 'Analizá los últimos 6 meses de ingresos vs gastos, detectá tendencias y medí el margen real de tu negocio.', Illust: IllustStats },
  { color: '#8B5CF6', subtitle: 'Autos & Choferes', title: 'Tu flota\norganizada', body: 'Registrá cada auto con su historial de km y mantenimiento. Asigná choferes y controlá el estado de cada uno.', Illust: IllustAutos },
  { color: '#EF4444', subtitle: 'Pestaña Deudas', title: 'Deudas de\nchoferes', body: 'Registrá adelantos, multas o gastos a cargo del chofer. Marcalos como saldados cuando te devuelvan el dinero.', Illust: IllustDeudas },
]

function TutorialOverlay({ onDone }) {
  const [step, setStep] = useState(0)
  const [animKey, setAnimKey] = useState(0)
  const [dir, setDir] = useState(1)
  const touchStart = useRef(null)
  const isLast = step === TUTORIAL_STEPS.length - 1
  const s = TUTORIAL_STEPS[step]
  const Illust = s.Illust

  const go = (delta) => {
    const next = step + delta
    if (next < 0 || next >= TUTORIAL_STEPS.length) return
    setDir(delta); setAnimKey(k => k + 1); setStep(next)
  }
  const finish = () => { localStorage.setItem('flota_tutorial', 'done'); onDone() }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'flex', flexDirection: 'column', background: '#000', overflow: 'hidden' }}
      onTouchStart={e => { touchStart.current = e.touches[0].clientX }}
      onTouchEnd={e => {
        if (!touchStart.current) return
        const diff = touchStart.current - e.changedTouches[0].clientX
        if (Math.abs(diff) > 50) go(diff > 0 ? 1 : -1)
        touchStart.current = null
      }}
    >
      {/* Área de ilustración */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `radial-gradient(ellipse at 50% 55%, ${s.color}22 0%, #000 70%)`, transition: 'background 0.5s ease', overflow: 'hidden', padding: '0 20px' }}>
        <div key={animKey} className={dir >= 0 ? 'tsr' : 'tsl'} style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
          <Illust />
        </div>
      </div>

      {/* Área de contenido */}
      <div style={{ background: '#060606', borderTop: '1px solid #141414', padding: '20px 24px 40px', flexShrink: 0 }}>
        {/* Barra de progreso */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 18 }}>
          {TUTORIAL_STEPS.map((_, i) => (
            <div key={i} onClick={() => go(i - step)} style={{ flex: i === step ? 4 : 1, height: 3, borderRadius: 2, background: i < step ? s.color + '55' : i === step ? s.color : '#181818', transition: 'flex 0.4s cubic-bezier(0.22,1,0.36,1), background 0.4s', cursor: 'pointer' }} />
          ))}
        </div>

        <div key={animKey + 'txt'} className={dir >= 0 ? 'tsr' : 'tsl'}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2.5, textTransform: 'uppercase', color: s.color, marginBottom: 6 }}>{s.subtitle}</div>
          <div style={{ fontSize: 26, fontWeight: 800, fontFamily: "'Syne',sans-serif", letterSpacing: -0.8, lineHeight: 1.2, marginBottom: 9, whiteSpace: 'pre-line' }}>{s.title}</div>
          <div style={{ fontSize: 14, color: '#555', lineHeight: 1.65, marginBottom: 20 }}>{s.body}</div>
        </div>

        <button
          style={{ width: '100%', padding: '15px 20px', background: s.color, color: '#fff', border: 'none', borderRadius: 14, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", letterSpacing: 0.3, transition: 'transform 0.1s, background 0.4s' }}
          onClick={() => isLast ? finish() : go(1)}
          onTouchStart={e => { e.currentTarget.style.transform = 'scale(0.97)' }}
          onTouchEnd={e => { e.currentTarget.style.transform = '' }}
        >
          {isLast ? 'EMPEZAR →' : 'SIGUIENTE →'}
        </button>
        <button onClick={finish} style={{ display: 'block', width: '100%', textAlign: 'center', marginTop: 14, background: 'none', border: 'none', color: '#252525', fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
          Saltar tutorial
        </button>
      </div>
    </div>
  )
}

// ── APP ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [authState, setAuthState] = useState('loading') // loading|auth|inactive|onboarding|app|demo
  const [inactiveReason, setInactiveReason] = useState('pending') // pending|expired
  const [profile, setProfile] = useState(null)
  const [isDemoMode, setIsDemoMode] = useState(false)
  const [page, setPage] = useState('resumen')
  const [resumen, setResumen] = useState(null)
  const [cal, setCal] = useState(null)
  const [calYear, setCalYear] = useState(new Date().getFullYear())
  const [calMonth, setCalMonth] = useState(new Date().getMonth() + 1)
  const [loading, setLoading] = useState(false)
  const [showTutorial, setShowTutorial] = useState(false)
  const [showInstall, setShowInstall] = useState(false)
  const [trialWelcomeDismissed, setTrialWelcomeDismissed] = useState(
    () => !!localStorage.getItem('flota_trial_welcome')
  )
  const installPrompt = useRef(null)
  const { toast, show: showToast } = useToast()

  // Detectar iOS (Safari no soporta beforeinstallprompt)
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
  const isInStandaloneMode = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); installPrompt.current = e; setShowInstall(true) }
    const onInstalled = () => { setShowInstall(false); installPrompt.current = null }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled) }
  }, [])

  const handleInstall = async () => {
    if (!installPrompt.current) return
    installPrompt.current.prompt()
    const { outcome } = await installPrompt.current.userChoice
    if (outcome === 'accepted') setShowInstall(false)
    installPrompt.current = null
  }

  // En iOS mostramos instrucciones si no está en modo standalone
  const showIosInstall = isIOS && !isInStandaloneMode

  useEffect(() => {
    if (authState === 'app' && !localStorage.getItem('flota_tutorial')) {
      setShowTutorial(true)
    }
  }, [authState])

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

    // Subscription check (skip for admin)
    if (!prof.is_admin) {
      const trialValid = prof.trial_hasta && new Date(prof.trial_hasta) > new Date()
      const subActive = prof.suscripcion_activa && prof.suscripcion_vence && new Date(prof.suscripcion_vence) > new Date()
      if (!trialValid && !subActive) {
        setAuthState('subscription'); return
      }
    }

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

  const updateCalDay = useCallback((autoId, choferId, ds, patch) => {
    setCal(prev => {
      if (!prev?.[autoId]?.dias?.[ds]) return prev
      return {
        ...prev,
        [autoId]: {
          ...prev[autoId],
          dias: {
            ...prev[autoId].dias,
            [ds]: { ...prev[autoId].dias[ds], [choferId]: { ...prev[autoId].dias[ds][choferId], ...patch } }
          }
        }
      }
    })
  }, [])

  const enterDemoMode = useCallback(() => {
    setIsDemoMode(true)
    setAuthState('demo')
    setPage('resumen')
    setResumen(getDemoResumen())
    setCal(getDemoCalendario(new Date().getFullYear(), new Date().getMonth() + 1))
    setShowTutorial(true)
  }, [])

  const loadResumen = useCallback(async (cfg = null) => {
    const data = await getResumen(cfg); setResumen(data)
  }, [])
  const loadCal = useCallback(async (y, m, cfg = null) => {
    const data = await getCalendario(y, m, cfg); setCal(data)
  }, [])

  const loadAll = useCallback(async () => {
    if (isDemoMode) {
      setResumen(getDemoResumen())
      setCal(getDemoCalendario(calYear, calMonth))
      return
    }
    setLoading(true)
    try {
      const cfg = await getConfig()
      await Promise.all([loadResumen(cfg), loadCal(calYear, calMonth, cfg)])
    } catch (err) {
      console.error('Error al cargar datos:', err)
    } finally {
      setLoading(false)
    }
  }, [isDemoMode, loadResumen, loadCal, calYear, calMonth])

  useEffect(() => { if (authState === 'app') loadAll() }, [authState, loadAll])

  const changeMonth = async (delta) => {
    let m = calMonth + delta, y = calYear
    if (m > 12) { m = 1; y++ }
    if (m < 1)  { m = 12; y-- }
    setCalMonth(m); setCalYear(y)
    if (isDemoMode) { setCal(getDemoCalendario(y, m)); return }
    const data = await getCalendario(y, m)
    setCal(data)
  }

  if (authState === 'loading') {
    return (
      <div style={{ background: '#08080A', minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <style>{globalStyles}</style>
        <div className="spinner" />
      </div>
    )
  }

  if (authState === 'auth') {
    return (
      <div style={{ background: '#08080A', minHeight: '100dvh' }}>
        <style>{globalStyles}</style>
        <AuthScreen onEnterDemo={enterDemoMode} showInstall={showInstall} onInstall={handleInstall} showIosInstall={showIosInstall} />
        {toast && <div className={`toast show ${toast.type}`}>{toast.msg}</div>}
      </div>
    )
  }

  if (authState === 'inactive') {
    return (
      <div style={{ background: '#08080A', minHeight: '100dvh' }}>
        <style>{globalStyles}</style>
        <InactiveScreen
          reason={inactiveReason}
          onRefresh={handleSession}
          onSignOut={async () => { await signOut(); setAuthState('auth') }}
        />
      </div>
    )
  }

  if (authState === 'subscription') {
    return (
      <div style={{ background: '#08080A', minHeight: '100dvh' }}>
        <style>{globalStyles}</style>
        <SubscriptionScreen
          profile={profile}
          onSignOut={async () => { await signOut(); setAuthState('auth') }}
          onSubscribed={handleSession}
        />
      </div>
    )
  }

  if (authState === 'onboarding') {
    return (
      <div style={{ background: '#08080A', minHeight: '100dvh' }}>
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
    { id: 'stats',      label: 'Stats',      icon: <StatsIcon /> },
    ...(!isDemoMode && profile?.is_admin ? [{ id: 'admin', label: 'Admin', icon: <AdminIcon /> }] : []),
  ]

  // Trial banner logic
  const trialDaysLeft = profile?.trial_hasta && new Date(profile.trial_hasta) > new Date()
    ? Math.ceil((new Date(profile.trial_hasta) - new Date()) / (1000 * 60 * 60 * 24))
    : 0
  const trialActive = !profile?.is_admin && trialDaysLeft > 0 && !profile?.suscripcion_activa
  const showTrialWelcome = trialActive && !trialWelcomeDismissed && trialDaysLeft >= 25
  const showTrialWarning = trialActive && trialDaysLeft <= 7

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", background: '#08080A', color: '#F4F4F8', minHeight: '100dvh' }}>
      <style>{globalStyles}</style>

      {isDemoMode && (
        <div style={{ background: '#0B1A3A', borderBottom: '1px solid #1A2B5C', padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: '#3F7DF5', fontWeight: 700, letterSpacing: 1 }}>👁 MODO DEMO — los cambios no se guardan</span>
          <button
            onClick={() => { setIsDemoMode(false); setAuthState('auth'); setResumen(null); setCal(null) }}
            style={{ background: 'none', border: '1px solid #1A2B5C', borderRadius: 8, color: '#3F7DF5', fontSize: 11, fontWeight: 700, padding: '4px 10px', cursor: 'pointer', letterSpacing: 0.5 }}
          >SALIR</button>
        </div>
      )}

      {showTrialWelcome && (
        <div style={{ background: '#0B1A3A', borderBottom: '1px solid #1A2B5C', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#7EB1FF', fontWeight: 600 }}>
            🎉 Bienvenido — tenés <strong>{trialDaysLeft} días</strong> de prueba gratuita
          </span>
          <button
            onClick={() => { localStorage.setItem('flota_trial_welcome', '1'); setTrialWelcomeDismissed(true) }}
            style={{ background: 'none', border: 'none', color: '#444', fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: '0 4px', flexShrink: 0 }}
          >×</button>
        </div>
      )}

      {showTrialWarning && (
        <div style={{ background: '#1A1000', borderBottom: '1px solid #3A2800', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#F59E0B', fontWeight: 600 }}>
            ⚠ Tu período de prueba vence en <strong>{trialDaysLeft} día{trialDaysLeft !== 1 ? 's' : ''}</strong>
          </span>
          <button
            onClick={() => setAuthState('subscription')}
            style={{ background: '#F59E0B', border: 'none', borderRadius: 8, color: '#000', fontSize: 11, fontWeight: 700, padding: '4px 10px', cursor: 'pointer', flexShrink: 0 }}
          >Suscribirme</button>
        </div>
      )}

      <div className="header">
        <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 26, fontWeight: 800, letterSpacing: -0.5, color: '#F4F4F8' }}>
          Flota<span style={{ color: '#3F7DF5' }}>.</span>
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {showInstall && (
            <button className="sync-btn" onClick={handleInstall} title="Instalar app"
              style={{ background: '#0B1A3A', border: '1px solid #1A2B5C', color: '#3F7DF5', fontSize: 11, fontWeight: 700, padding: '0 10px', letterSpacing: 0.5 }}>
              ⬇ Instalar
            </button>
          )}
          {showIosInstall && !showInstall && (
            <IosInstallHint />
          )}
          {!isDemoMode && <button className="sync-btn" onClick={loadAll}>↻</button>}
          {!isDemoMode && <button className="sync-btn" onClick={async () => { await signOut(); setAuthState('auth') }} title="Cerrar sesión">⏏</button>}
        </div>
      </div>

      <div key={page} className="page-anim">
        {page === 'resumen'    && <ResumenPage resumen={resumen} showToast={showToast} onRefresh={loadAll} />}
        {page === 'calendario' && <CalendarioPage cal={cal} calYear={calYear} calMonth={calMonth} changeMonth={changeMonth} showToast={showToast} onRefresh={() => { if (!isDemoMode) loadCal(calYear, calMonth) }} turnoBase={resumen?.config?.turno_base || TURNO_BASE_DEFAULT} isDemoMode={isDemoMode} onDemoUpdateDay={updateCalDay} />}
        {page === 'gastos'     && <GastosPage resumen={resumen} showToast={showToast} onRefresh={loadAll} isDemoMode={isDemoMode} />}
        {page === 'flota'      && <FlotaPage resumen={resumen} showToast={showToast} onRefresh={loadAll} isDemoMode={isDemoMode} />}
        {page === 'stats'      && <StatsPage resumen={resumen} showToast={showToast} isDemoMode={isDemoMode} />}
        {page === 'admin'      && <AdminScreen showToast={showToast} />}
      </div>

      <nav className="bottom-nav">
        {navItems.map(({ id, label, icon }) => (
          <button key={id} className={`bnav-btn ${page === id ? 'active' : ''}`} onClick={() => setPage(id)}>
            {icon}<span className="bnav-label">{label}</span>
          </button>
        ))}
      </nav>

      {toast && <div className={`toast show ${toast.type}`}>{toast.msg}</div>}
      {showTutorial && <TutorialOverlay onDone={() => setShowTutorial(false)} />}
    </div>
  )
}

// ── IOS INSTALL HINT ──────────────────────────────────────────────────────────
function IosInstallHint() {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ background: '#0B1A3A', border: '1px solid #1A2B5C', borderRadius: 10, color: '#3F7DF5', fontSize: 11, fontWeight: 700, padding: '6px 10px', cursor: 'pointer', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 4 }}>
        ⬇ Instalar
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '110%', right: 0, width: 230, background: '#15151B', border: '1px solid #2E2E3B', borderRadius: 14, padding: '14px 16px', zIndex: 999, boxShadow: '0 8px 32px #000a' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#F4F4F8', marginBottom: 8 }}>Instalar en iPhone / iPad</div>
          <div style={{ fontSize: 12, color: '#aaa', lineHeight: 1.6 }}>
            1. Tocá el ícono <span style={{ fontSize: 14 }}>⎙</span> <strong style={{ color: '#F4F4F8' }}>Compartir</strong> en Safari<br />
            2. Elegí <strong style={{ color: '#F4F4F8' }}>Añadir a pantalla de inicio</strong><br />
            3. Tocá <strong style={{ color: '#F4F4F8' }}>Añadir</strong>
          </div>
          <button onClick={() => setOpen(false)} style={{ marginTop: 12, background: 'none', border: 'none', color: '#3F7DF5', fontSize: 12, cursor: 'pointer', padding: 0 }}>Cerrar</button>
        </div>
      )}
    </div>
  )
}

// ── AUTH SCREEN ───────────────────────────────────────────────────────────────
// ── SUBSCRIPTION SCREEN ───────────────────────────────────────────────────────
function SubscriptionScreen({ profile, onSignOut, onSubscribed }) {
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState(null)

  const showToast = (msg, type = '') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const trialExpired = !profile?.trial_hasta || new Date(profile.trial_hasta) <= new Date()
  const trialDaysLeft = profile?.trial_hasta && new Date(profile.trial_hasta) > new Date()
    ? Math.ceil((new Date(profile.trial_hasta) - new Date()) / (1000 * 60 * 60 * 24))
    : 0

  const handleSubscribe = async () => {
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { showToast('Sesión expirada, volvé a iniciar sesión', 'error'); setLoading(false); return }
      const userId = session.user.id
      const userEmail = session.user.email

      const res = await fetch('/api/mobbex-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, userEmail }),
      })
      const data = await res.json()

      if (data.error === 'not_configured') {
        showToast('El pago no está configurado aún', 'error')
        setLoading(false)
        return
      }
      if (data.error || !data.checkoutUrl) {
        showToast('Error al iniciar el pago. Intentá de nuevo.', 'error')
        setLoading(false)
        return
      }

      window.location.href = data.checkoutUrl
    } catch (err) {
      showToast('Error de conexión. Intentá de nuevo.', 'error')
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '80px 24px 60px', display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '100dvh', textAlign: 'center' }}>
      {toast && <div className={`toast show ${toast.type}`}>{toast.msg}</div>}

      <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 32, fontWeight: 800, marginBottom: 6, color: '#F4F4F8', alignSelf: 'flex-start' }}>
        Flota<span style={{ color: '#3F7DF5' }}>.</span>
      </h1>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', maxWidth: 400 }}>
        <div style={{ fontSize: 56, marginBottom: 20 }}>📋</div>

        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, marginBottom: 10, color: '#F4F4F8' }}>
          {trialExpired ? 'Tu período de prueba venció' : `Te quedan ${trialDaysLeft} día${trialDaysLeft !== 1 ? 's' : ''} de prueba`}
        </div>

        <div style={{ color: '#666', fontSize: 14, lineHeight: 1.6, marginBottom: 36 }}>
          {trialExpired
            ? 'Suscribite para seguir usando Flota sin interrupciones.'
            : 'Suscribite ahora para no perder el acceso cuando termine tu prueba.'}
        </div>

        <div style={{ background: '#111', border: '1px solid #1F1F26', borderRadius: 16, padding: '24px 28px', width: '100%', marginBottom: 28 }}>
          <div style={{ fontSize: 12, color: '#555', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 }}>Plan mensual</div>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 38, fontWeight: 800, color: '#F4F4F8', marginBottom: 4 }}>
            $5.000
          </div>
          <div style={{ fontSize: 13, color: '#555' }}>ARS / mes</div>
        </div>

        <button
          className="btn-primary"
          style={{ width: '100%', maxWidth: 400, marginBottom: 16, fontSize: 15, fontWeight: 700, letterSpacing: 0.5 }}
          disabled={loading}
          onClick={handleSubscribe}
        >
          {loading ? 'Cargando...' : 'Suscribirme'}
        </button>

        <button
          onClick={onSubscribed}
          style={{ background: 'none', border: 'none', color: '#444', fontSize: 12, cursor: 'pointer', marginBottom: 8, padding: '4px 8px' }}
        >
          Ya pagué — verificar acceso
        </button>
      </div>

      <button
        onClick={onSignOut}
        style={{ background: 'none', border: 'none', color: '#444', fontSize: 12, cursor: 'pointer', textDecoration: 'underline', marginTop: 'auto', paddingTop: 24 }}
      >
        Cerrar sesión
      </button>
    </div>
  )
}

function AuthScreen({ onEnterDemo, showInstall, onInstall, showIosInstall }) {
  const [tab, setTab] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
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

  // Si el usuario vuelve atrás desde Google OAuth, resetear el estado
  useEffect(() => {
    const reset = () => setGoogleLoading(false)
    window.addEventListener('pageshow', reset)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reset()
    })
    return () => {
      window.removeEventListener('pageshow', reset)
    }
  }, [])

  const handleGoogle = async () => {
    setGoogleLoading(true); setError('')
    const { error: err } = await signInWithGoogle()
    if (err) { setError(err.message); setGoogleLoading(false) }
    // Si no hay error, el browser redirige a Google — no hay más código acá
  }

  return (
    <div style={{ padding: '80px 24px 40px', display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 36, fontWeight: 800, marginBottom: 6, color: '#F4F4F8' }}>
        Flota<span style={{ color: '#3F7DF5' }}>.</span>
      </h1>
      {showInstall && (
        <button onClick={onInstall}
          style={{ alignSelf: 'flex-start', marginBottom: 16, padding: '8px 14px', background: '#0B1A3A', border: '1px solid #1A2B5C', borderRadius: 10, color: '#3F7DF5', fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5 }}>
          ⬇ Instalar Flota
        </button>
      )}
      {showIosInstall && !showInstall && (
        <div style={{ alignSelf: 'stretch', marginBottom: 16, padding: '12px 16px', background: '#0B1A3A', border: '1px solid #1A2B5C', borderRadius: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#7EB1FF', marginBottom: 6 }}>⬇ Instalar en iPhone / iPad</div>
          <div style={{ fontSize: 12, color: '#888', lineHeight: 1.7 }}>
            1. Tocá el ícono <span style={{ fontSize: 13 }}>⎙</span> <strong style={{ color: '#ccc' }}>Compartir</strong> en Safari<br />
            2. Elegí <strong style={{ color: '#ccc' }}>Añadir a pantalla de inicio</strong><br />
            3. Tocá <strong style={{ color: '#ccc' }}>Añadir</strong>
          </div>
        </div>
      )}
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
      {success && <div style={{ color: '#3F7DF5', fontSize: 13, marginBottom: 12 }}>{success}</div>}

      <button className="btn-primary" disabled={loading} onClick={submit}>
        {loading ? 'Cargando...' : tab === 'login' ? 'INGRESAR' : 'CREAR CUENTA'}
      </button>

      {/* Separador */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0' }}>
        <div style={{ flex: 1, height: 1, background: '#1F1F26' }} />
        <span style={{ fontSize: 11, color: '#444', textTransform: 'uppercase', letterSpacing: 1.5 }}>o</span>
        <div style={{ flex: 1, height: 1, background: '#1F1F26' }} />
      </div>

      {/* Botón Google */}
      <button
        disabled={googleLoading}
        onClick={handleGoogle}
        style={{ width: '100%', padding: '13px 16px', background: '#fff', border: '1px solid #2E2E3B', borderRadius: 14, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", color: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: googleLoading ? 0.6 : 1 }}>
        {/* Ícono Google SVG */}
        <svg width="18" height="18" viewBox="0 0 48 48">
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.7 2.5 30.2 0 24 0 14.8 0 6.9 5.4 3 13.3l7.8 6C12.7 13.1 17.9 9.5 24 9.5z"/>
          <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 6.9-10 6.9-17z" /><path fill="#FBBC05" d="M10.8 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7L2.5 13.3A23.9 23.9 0 0 0 0 24c0 3.8.9 7.4 2.5 10.6l8.3-5.9z"/>
          <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.5-5.8c-2 1.4-4.6 2.2-7.7 2.2-6.1 0-11.3-3.6-13.2-9.2l-8.3 5.9C6.9 42.6 14.8 48 24 48z"/>
        </svg>
        {googleLoading ? 'Redirigiendo...' : 'Continuar con Google'}
      </button>

      <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid #1F1F26' }}>
        <div style={{ fontSize: 11, color: '#444', textAlign: 'center', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1.5 }}>¿Querés ver cómo funciona?</div>
        <button
          style={{ width: '100%', padding: '14px', background: '#0B1A3A', color: '#3F7DF5', border: '1px solid #1A2B5C', borderRadius: 14, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}
          onClick={onEnterDemo}
        >
          PROBAR DEMO
        </button>
        <div style={{ fontSize: 11, color: '#333', textAlign: 'center', marginTop: 8 }}>
          Sin registro. Solo para explorar la app.
        </div>
      </div>
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
    <div style={{ fontFamily: "'DM Sans', sans-serif", color: '#F4F4F8' }}>
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
          const diasColor = expirado ? '#ff4545' : pocoTiempo ? '#ffb347' : '#3F7DF5'
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

// ── SKELETON LOADER ───────────────────────────────────────────────────────────
function SkeletonResumen() {
  return (
    <div className="page" style={{ paddingTop: 16 }}>
      <div className="skel" style={{ height: 86, borderRadius: 16, marginBottom: 12 }} />
      {[0, 1].map(i => (
        <div key={i} className="card" style={{ marginBottom: 10, animationDelay: `${i * 100}ms` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <div className="skel" style={{ height: 22, width: '36%', borderRadius: 100 }} />
            <div className="skel" style={{ height: 14, width: '28%', borderRadius: 6 }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div className="skel" style={{ height: 62, borderRadius: 12 }} />
            <div className="skel" style={{ height: 62, borderRadius: 12 }} />
          </div>
          <div className="skel" style={{ height: 48, borderRadius: 12, marginBottom: 8 }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div className="skel" style={{ height: 52, borderRadius: 12 }} />
            <div className="skel" style={{ height: 52, borderRadius: 12 }} />
          </div>
          <div className="skel" style={{ height: 42, borderRadius: 12 }} />
        </div>
      ))}
    </div>
  )
}

// ── RESUMEN PAGE ──────────────────────────────────────────────────────────────
function diasParaVencer(fecha) {
  if (!fecha) return null
  return Math.ceil((new Date(fecha) - new Date()) / 86400000)
}

function ResumenPage({ resumen, showToast, onRefresh }) {
  const [kmsInputs, setKmsInputs] = useState({})
  const [kmsLoading, setKmsLoading] = useState({})
  if (!resumen) return <SkeletonResumen />

  const { autos, totales } = resumen
  const autoEntries = Object.entries(autos)

  // Alertas VTV / seguro
  const alertas = (resumen.config?.autos || []).flatMap(auto => {
    const items = []
    const dVtv = diasParaVencer(auto.vtv_vence)
    const dSeg = diasParaVencer(auto.seguro_vence)
    if (dVtv !== null && dVtv <= ALERTA_DIAS)
      items.push({ auto: auto.nombre, tipo: 'VTV', dias: dVtv })
    if (dSeg !== null && dSeg <= ALERTA_DIAS)
      items.push({ auto: auto.nombre, tipo: 'Seguro', dias: dSeg })
    return items
  })

  return (
    <div className="page">
      {/* Botón PDF */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, marginBottom: 4 }} className="no-print">
        <button onClick={() => window.print()}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: '#111', border: '1px solid #23232E', borderRadius: 10, color: '#555', fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
          ↓ Exportar PDF
        </button>
      </div>

      {/* Alertas VTV/Seguro */}
      {alertas.map((a, i) => (
        <div key={i} className={`alert-banner ${a.dias <= 0 ? 'alert-danger' : 'alert-warn'}`}>
          <span>{a.dias <= 0 ? '🔴' : '🟡'}</span>
          <span>
            <strong>{a.auto}</strong> — {a.tipo}{' '}
            {a.dias <= 0 ? 'VENCIDO' : `vence en ${a.dias} día${a.dias !== 1 ? 's' : ''}`}
          </span>
        </div>
      ))}

      <div className="stitle">Total flota</div>
      <div className="total-banner">
        <div style={{ flex: 1 }}>
          <div className="total-label">Esta semana</div>
          <div className="total-value">{fmt(totales.neto_semana ?? totales.semana)}</div>
          <div style={{ fontSize: 10, color: '#444', marginTop: 2, fontFamily: "'DM Mono',monospace" }}>bruto {fmt(totales.semana)}</div>
        </div>
        <div style={{ width: 1, background: '#2E2E3B', alignSelf: 'stretch', margin: '0 18px' }} />
        <div style={{ flex: 1, textAlign: 'right' }}>
          <div className="total-label">Este mes</div>
          <div className="total-value">{fmt(totales.neto_mes ?? totales.mes)}</div>
          <div style={{ fontSize: 10, color: '#444', marginTop: 2, fontFamily: "'DM Mono',monospace" }}>bruto {fmt(totales.mes)}</div>
        </div>
      </div>

      {autoEntries.length === 0 && (
        <div className="loading">Sin autos en la flota</div>
      )}

      {autoEntries.map(([aid, adata], i) => {
        const gan = adata.ganancias || {}
        const choferes = Object.values(adata.deudas || {}).map(d => d.nombre)
        const isLoadingKms = !!kmsLoading[aid]
        return (
          <div key={aid} className="card" style={{ animationDelay: `${i * 70}ms` }}>
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
function CalendarioPage({ cal, calYear, calMonth, changeMonth, showToast, onRefresh, turnoBase, isDemoMode, onDemoUpdateDay }) {
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
        {[['#0A1A10','Completo'],['#2b2000','Parcial'],['#2b0d0d','Debe'],['#0d1a2b','Franco']].map(([bg,lbl]) => (
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
          isDemoMode={isDemoMode}
          onDemoUpdateDay={onDemoUpdateDay}
        />
      )}
    </div>
  )
}

function DayModal({ ds, cal, turnoBase, onClose, showToast, onRefresh, isDemoMode, onDemoUpdateDay }) {
  const [montos, setMontos] = useState({})
  const [saving, setSaving] = useState(null)
  const [selectedAuto, setSelectedAuto] = useState(null)

  const [y, m, d] = ds.split('-').map(Number)
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7

  const autoEntries = Object.entries(cal).filter(([k, v]) => v && v.nombre)

  const doTurno = async (choferId, monto) => {
    if (isDemoMode) {
      const autoTurnoBase = adata?.turno_base || turnoBase
      const estado = monto >= autoTurnoBase ? 'completo' : 'parcial'
      onDemoUpdateDay(selectedAuto, choferId, ds, { estado, monto })
      showToast('✓ Turno anotado', 'success')
      onRefresh()
      return
    }
    setSaving(choferId + 'turno')
    const { error } = await upsertTurno(choferId, ds, monto)
    setSaving(null)
    if (error) return showToast('⚠ ' + error.message, 'error')
    showToast('✓ Turno anotado', 'success')
    onRefresh()
  }

  const doFranco = async (choferId, accion) => {
    if (isDemoMode) {
      if (accion === 'marcar') {
        onDemoUpdateDay(selectedAuto, choferId, ds, { estado: 'franco', monto: null })
      } else {
        const pasado = ds < new Date().toISOString().split('T')[0]
        onDemoUpdateDay(selectedAuto, choferId, ds, { estado: pasado ? 'debe' : 'futuro', monto: null })
      }
      showToast(accion === 'marcar' ? '✓ Franco marcado' : '✓ Franco quitado', 'success')
      onRefresh()
      return
    }
    setSaving(choferId + 'franco')
    const { error } = accion === 'marcar' ? await marcarFranco(choferId, ds) : await quitarFranco(choferId, ds)
    setSaving(null)
    if (error) return showToast('⚠ ' + error.message, 'error')
    showToast(accion === 'marcar' ? '✓ Franco marcado' : '✓ Franco quitado', 'success')
    onRefresh()
  }

  const doBorrar = async (choferId) => {
    if (isDemoMode) {
      const pasado = ds < new Date().toISOString().split('T')[0]
      onDemoUpdateDay(selectedAuto, choferId, ds, { estado: pasado ? 'debe' : 'futuro', monto: null })
      showToast('✓ Pago eliminado', 'success')
      onRefresh()
      return
    }
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
              const dot = allFranco ? '#4a9eff' : hayDebe ? '#ff4545' : hayCompleto ? '#10B981' : '#555'
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
function GastosPage({ resumen, showToast, onRefresh, isDemoMode }) {
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
    if (isDemoMode) { setGastos(getDemoGastos()); return }
    setLoadingG(true)
    const { data } = await getGastos()
    setGastos(data || [])
    setLoadingG(false)
  }

  useEffect(() => { if (tab === 'lista') loadGastos() }, [tab])

  const categorias = ['mantenimiento', 'combustible', 'seguro', 'impuesto', 'multa', 'otro']

  const handleDeleteConfirmed = async () => {
    if (isDemoMode) {
      const id = deleteConfirm
      setDeleteConfirm(null)
      setGastos(prev => prev.filter(x => x.id !== id))
      showToast('✓ Gasto eliminado', 'success')
      return
    }
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
            if (isDemoMode) {
              const demoGasto = {
                id: 'demo-' + Date.now(),
                auto_id: form.auto_id,
                descripcion: form.descripcion,
                monto: parseFloat(form.monto),
                categoria: form.categoria,
                fecha: form.fecha,
                autos: { nombre: autos.find(a => a.id === form.auto_id)?.nombre || '' },
              }
              setGastos(prev => [demoGasto, ...prev])
              showToast('✓ Gasto registrado', 'success')
              setForm(f => ({ ...f, descripcion: '', monto: '' }))
              setTab('lista')
              return
            }
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
function FlotaPage({ resumen, showToast, onRefresh, isDemoMode }) {
  const [tab, setTab] = useState('autos')
  return (
    <div className="page">
      <div className="tabs">
        <button className={`tab ${tab === 'autos' ? 'active' : ''}`} onClick={() => setTab('autos')}>Autos</button>
        <button className={`tab ${tab === 'mant' ? 'active' : ''}`} onClick={() => setTab('mant')}>Mantenimiento</button>
        <button className={`tab ${tab === 'deudas' ? 'active' : ''}`} onClick={() => setTab('deudas')}>Deudas</button>
      </div>
      {tab === 'autos'   && <AutosTab resumen={resumen} showToast={showToast} onRefresh={onRefresh} isDemoMode={isDemoMode} />}
      {tab === 'mant'    && <MantItemsTab resumen={resumen} showToast={showToast} onRefresh={onRefresh} isDemoMode={isDemoMode} />}
      {tab === 'deudas'  && <DeudasTab resumen={resumen} showToast={showToast} isDemoMode={isDemoMode} />}
    </div>
  )
}

function DeudasTab({ resumen, showToast, isDemoMode }) {
  const [deudas, setDeudas] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filtro, setFiltro] = useState('pendientes') // 'pendientes' | 'todas'
  const [saving, setSaving] = useState(false)
  const [actionId, setActionId] = useState(null)
  const [form, setForm] = useState({ chofer_id: '', descripcion: '', monto: '', fecha: today() })

  const choferes = resumen?.config?.choferes || []

  const load = useCallback(async () => {
    if (isDemoMode) { setDeudas(DEMO_DEUDAS); setLoading(false); return }
    setLoading(true)
    const { data, error } = await getDeudas()
    setLoading(false)
    if (error) { showToast('⚠ ' + error.message, 'error'); return }
    setDeudas(data || [])
  }, [isDemoMode, showToast])

  useEffect(() => { load() }, [load])

  const handleAdd = async () => {
    if (!form.chofer_id) return showToast('Seleccioná un chofer', 'error')
    if (!form.descripcion.trim()) return showToast('Ingresá una descripción', 'error')
    const monto = parseFloat(form.monto)
    if (!monto || monto <= 0) return showToast('Ingresá un monto válido', 'error')
    if (isDemoMode) {
      const chofer = choferes.find(c => c.id === form.chofer_id)
      setDeudas(prev => [{
        id: 'demo-' + Date.now(), chofer_id: form.chofer_id, descripcion: form.descripcion,
        monto, fecha: form.fecha, saldado: false,
        choferes: { nombre: chofer?.nombre || '?', autos: { nombre: '' } }
      }, ...prev])
      showToast('✓ Deuda registrada', 'success')
      setForm({ chofer_id: '', descripcion: '', monto: '', fecha: today() }); setShowForm(false); return
    }
    setSaving(true)
    const { error } = await insertDeuda(form.chofer_id, form.descripcion, monto, form.fecha)
    setSaving(false)
    if (error) return showToast('⚠ ' + error.message, 'error')
    showToast('✓ Deuda registrada', 'success')
    setForm({ chofer_id: '', descripcion: '', monto: '', fecha: today() }); setShowForm(false)
    load()
  }

  const handleSaldar = async (id) => {
    if (isDemoMode) {
      setDeudas(prev => prev.map(d => d.id === id ? { ...d, saldado: true } : d))
      showToast('✓ Marcada como saldada', 'success'); return
    }
    setActionId(id + 'saldar')
    const { error } = await saldarDeuda(id)
    setActionId(null)
    if (error) return showToast('⚠ ' + error.message, 'error')
    showToast('✓ Marcada como saldada', 'success')
    load()
  }

  const handleDelete = async (id) => {
    if (isDemoMode) {
      setDeudas(prev => prev.filter(d => d.id !== id))
      showToast('✓ Eliminada', 'success'); return
    }
    setActionId(id + 'del')
    const { error } = await deleteDeuda(id)
    setActionId(null)
    if (error) return showToast('⚠ ' + error.message, 'error')
    showToast('✓ Eliminada', 'success')
    load()
  }

  const visibles = filtro === 'pendientes' ? deudas.filter(d => !d.saldado) : deudas
  const totalPendiente = deudas.filter(d => !d.saldado).reduce((s, d) => s + parseFloat(d.monto || 0), 0)

  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div className="stitle" style={{ marginBottom: 2 }}>Deudas de choferes</div>
          {totalPendiente > 0 && (
            <div style={{ fontSize: 12, color: '#EF4444', fontFamily: "'DM Mono',monospace" }}>
              Pendiente: {fmt(totalPendiente)}
            </div>
          )}
        </div>
        <button className="action-btn ab-primary" style={{ padding: '8px 14px', fontSize: 13 }} onClick={() => setShowForm(f => !f)}>
          {showForm ? '✕ Cancelar' : '+ Agregar'}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="stitle" style={{ marginTop: 0 }}>Chofer</div>
          <div className="form-group">
            <select className="form-input" value={form.chofer_id} onChange={e => setForm(f => ({ ...f, chofer_id: e.target.value }))}>
              <option value="">Seleccioná un chofer...</option>
              {choferes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div className="stitle">Descripción</div>
          <div className="form-group">
            <input className="form-input" placeholder="Ej: Multa, adelanto, daño al auto..." value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <div>
              <div className="stitle" style={{ marginTop: 0 }}>Monto ($)</div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <input className="form-input" type="number" inputMode="numeric" placeholder="0" style={{ fontFamily: "'DM Mono',monospace" }} value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} />
              </div>
            </div>
            <div>
              <div className="stitle" style={{ marginTop: 0 }}>Fecha</div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <input className="form-input" type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
              </div>
            </div>
          </div>
          <button className="btn-primary" disabled={saving} onClick={handleAdd}>
            {saving ? 'Guardando...' : 'REGISTRAR DEUDA'}
          </button>
        </div>
      )}

      {/* Filtro */}
      <div className="tabs" style={{ marginBottom: 12 }}>
        <button className={`tab ${filtro === 'pendientes' ? 'active' : ''}`} onClick={() => setFiltro('pendientes')}>
          Pendientes {deudas.filter(d => !d.saldado).length > 0 ? `(${deudas.filter(d => !d.saldado).length})` : ''}
        </button>
        <button className={`tab ${filtro === 'todas' ? 'active' : ''}`} onClick={() => setFiltro('todas')}>Todas</button>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="loading">Cargando...</div>
      ) : visibles.length === 0 ? (
        <div className="loading">{filtro === 'pendientes' ? 'Sin deudas pendientes 🎉' : 'Sin deudas registradas'}</div>
      ) : (
        visibles.map(d => (
          <div key={d.id} className="card" style={{ marginBottom: 8, opacity: d.saldado ? 0.5 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span className="auto-tag tag-auto" style={{ fontSize: 11 }}>{d.choferes?.nombre || '?'}</span>
                  {d.choferes?.autos?.nombre && <span style={{ fontSize: 11, color: '#555' }}>{d.choferes.autos.nombre}</span>}
                  {d.saldado && <span style={{ fontSize: 10, color: '#10B981', fontWeight: 700, letterSpacing: 0.5 }}>SALDADO</span>}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{d.descripcion}</div>
                <div style={{ fontSize: 11, color: '#555' }}>{d.fecha}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 16, fontWeight: 700, color: d.saldado ? '#555' : '#EF4444', marginBottom: 8 }}>
                  {fmt(parseFloat(d.monto))}
                </div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  {!d.saldado && (
                    <button
                      className="action-btn ab-primary"
                      style={{ padding: '5px 10px', fontSize: 11, borderRadius: 8 }}
                      disabled={!!actionId}
                      onClick={() => handleSaldar(d.id)}
                    >
                      {actionId === d.id + 'saldar' ? '...' : '✓ Saldar'}
                    </button>
                  )}
                  <button
                    className="gasto-del-btn"
                    disabled={!!actionId}
                    onClick={() => handleDelete(d.id)}
                  >
                    {actionId === d.id + 'del' ? '...' : '✕'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))
      )}
    </>
  )
}

function AutosTab({ resumen, showToast, onRefresh, isDemoMode }) {
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
  const [vencimientos, setVencimientos] = useState({}) // autoId -> {vtv, seguro}
  const [savingVenc, setSavingVenc] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null) // { id, nombre }
  const [deletingAuto, setDeletingAuto] = useState(false)

  const autos = resumen?.config?.autos || []
  const choferes = resumen?.config?.choferes || []
  const globalTurnoBase = resumen?.config?.turno_base || TURNO_BASE_DEFAULT

  const handleSaveVencimientos = async (autoId) => {
    if (isDemoMode) return showToast('👁 Modo demo — los cambios no se guardan', 'info')
    const v = vencimientos[autoId] || {}
    setSavingVenc(autoId)
    const { error } = await updateAutoVencimientos(autoId, v.vtv || null, v.seguro || null)
    setSavingVenc(null)
    if (error) return showToast('⚠ ' + error.message, 'error')
    showToast('✓ Vencimientos guardados', 'success')
    onRefresh()
  }

  const handleCreateAuto = async () => {
    if (isDemoMode) return showToast('👁 Modo demo — los cambios no se guardan', 'info')
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
    if (isDemoMode) return showToast('👁 Modo demo — los cambios no se guardan', 'info')
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

  const demoBlock = () => showToast('👁 Modo demo — los cambios no se guardan', 'info')

  const handleDeleteAutoConfirmed = async () => {
    if (isDemoMode) { setDeleteConfirm(null); return demoBlock() }
    if (!deleteConfirm) return
    setDeletingAuto(true)
    const { error } = await deleteAuto(deleteConfirm.id)
    setDeletingAuto(false)
    setDeleteConfirm(null)
    if (error) return showToast('⚠ ' + error.message, 'error')
    showToast('✓ Auto eliminado', 'success')
    onRefresh()
  }

  const handleCreateChofer = async (autoId) => {
    if (isDemoMode) return showToast('👁 Modo demo — los cambios no se guardan', 'info')
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
    if (isDemoMode) return showToast('👁 Modo demo — los cambios no se guardan', 'info')
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
      {deleteConfirm && (
        <ConfirmModal
          title={`Eliminar ${deleteConfirm.nombre}`}
          message="Se borrarán todos sus choferes, turnos, gastos y mantenimiento. Esta acción no se puede deshacer."
          onConfirm={handleDeleteAutoConfirmed}
          onCancel={() => setDeleteConfirm(null)}
          loading={deletingAuto}
        />
      )}
      {autos.map(auto => {
        const autoChoferes = choferes.filter(c => c.auto_id === auto.id)
        const turnoActual = auto.turno_base || globalTurnoBase
        const turnoVal = editingTurno[auto.id] ?? ''
        return (
          <div key={auto.id} className="card" style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span className="auto-tag tag-auto">{auto.nombre}</span>
              <button
                onClick={() => setDeleteConfirm({ id: auto.id, nombre: auto.nombre })}
                style={{ background: 'none', border: 'none', color: '#555', fontSize: 16, cursor: 'pointer', padding: '4px 8px', lineHeight: 1 }}
                title="Eliminar auto"
              >🗑</button>
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

            <div className="stitle">VTV y Seguro</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 10, color: '#555', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>VTV vence</div>
                <input className="form-input" type="date" style={{ colorScheme: 'dark', fontSize: 13, padding: '10px 12px' }}
                  value={vencimientos[auto.id]?.vtv ?? (auto.vtv_vence || '')}
                  onChange={e => setVencimientos(p => ({ ...p, [auto.id]: { ...p[auto.id], vtv: e.target.value } }))}
                />
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#555', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Seguro vence</div>
                <input className="form-input" type="date" style={{ colorScheme: 'dark', fontSize: 13, padding: '10px 12px' }}
                  value={vencimientos[auto.id]?.seguro ?? (auto.seguro_vence || '')}
                  onChange={e => setVencimientos(p => ({ ...p, [auto.id]: { ...p[auto.id], seguro: e.target.value } }))}
                />
              </div>
            </div>
            <button className="action-btn ab-primary" style={{ width: '100%', marginBottom: 14 }}
              disabled={savingVenc === auto.id}
              onClick={() => handleSaveVencimientos(auto.id)}>
              {savingVenc === auto.id ? '...' : '✓ Guardar vencimientos'}
            </button>

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
                  <button className="gasto-del-btn" style={{ color: '#aaa', background: '#1F1F26', borderColor: '#2A2A35' }}
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

function MantItemsTab({ resumen, showToast, onRefresh, isDemoMode }) {
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
    if (isDemoMode) {
      setItems(resumen?.config?.mant_items || [])
      setLoadingItems(false)
      return
    }
    setLoadingItems(true)
    const { data } = await getUserMantItems()
    setItems(data || [])
    setLoadingItems(false)
  }
  useEffect(() => { reloadItems() }, [])

  const autoNombre = (autoId) => autos.find(a => a.id === autoId)?.nombre || null

  const demoBlock = () => showToast('👁 Modo demo — los cambios no se guardan', 'info')

  const handleCreate = async () => {
    if (isDemoMode) return demoBlock()
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
    if (isDemoMode) return demoBlock()
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
                        <span style={{ color: item.auto_id ? '#3F7DF5' : '#666' }}>
                          {item.auto_id ? (autoNombre(item.auto_id) || 'Auto específico') : 'Todos los autos'}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button className="gasto-del-btn" style={{ color: '#aaa', background: '#161616', borderColor: '#2A2A35' }}
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
    if (isDemoMode) { setDeleteConfirm(null); return demoBlock() }
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

// ── STATS PAGE ────────────────────────────────────────────────────────────────
const AUTO_COLORS = ['#3F7DF5', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444']

function MultiLineChart({ data, metric }) {
  if (!data || data.length === 0) return null
  const W = 320, H = 190
  const PAD = { top: 14, right: 18, bottom: 26, left: 46 }
  const cW = W - PAD.left - PAD.right
  const cH = H - PAD.top - PAD.bottom
  const n = data[0].monthly.length

  const allVals = data.flatMap(a => a.monthly.map(m => m[metric]))
  const maxVal = Math.max(...allVals, 1)

  // Nice round max for Y axis
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxVal)))
  const niceMax = Math.ceil(maxVal / magnitude) * magnitude

  const X = i => PAD.left + (n > 1 ? (i / (n - 1)) * cW : cW / 2)
  const Y = v => PAD.top + cH - (v / niceMax) * cH

  const fmtY = v => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : v

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* Grid horizontales */}
      {[0, 0.25, 0.5, 0.75, 1].map(p => (
        <line key={p}
          x1={PAD.left} x2={W - PAD.right}
          y1={PAD.top + cH * (1 - p)} y2={PAD.top + cH * (1 - p)}
          stroke={p === 0 ? '#222' : '#141414'} strokeWidth={p === 0 ? 1.5 : 1} />
      ))}

      {/* Y labels */}
      {[0, 0.5, 1].map(p => (
        <text key={p} x={PAD.left - 6} y={PAD.top + cH * (1 - p) + 3}
          textAnchor="end" fill="#333" fontSize="8" fontFamily="'DM Mono',monospace">
          {fmtY(niceMax * p)}
        </text>
      ))}

      {/* Líneas y áreas por auto */}
      {data.map((auto, ai) => {
        const color = AUTO_COLORS[ai % AUTO_COLORS.length]
        const pts = auto.monthly.map((m, i) => [X(i), Y(m[metric])])
        const polyPts = pts.map(p => p.join(',')).join(' ')
        const areaPts = `${X(0)},${PAD.top + cH} ${polyPts} ${X(n - 1)},${PAD.top + cH}`
        return (
          <g key={auto.id}>
            <polygon points={areaPts} fill={color} opacity="0.07" />
            <polyline points={polyPts} fill="none" stroke={color} strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" />
            {pts.map(([cx, cy], i) => (
              <g key={i}>
                <circle cx={cx} cy={cy} r="5" fill="#000" />
                <circle cx={cx} cy={cy} r="3.5" fill={color} />
              </g>
            ))}
          </g>
        )
      })}

      {/* X labels */}
      {data[0].monthly.map((m, i) => (
        <text key={i} x={X(i)} y={H - 4} textAnchor="middle"
          fill="#3a3a3a" fontSize="9" fontFamily="'DM Sans',sans-serif" fontWeight="700">
          {m.mes}
        </text>
      ))}
    </svg>
  )
}

function AutosComparisonTab({ isDemoMode }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [metric, setMetric] = useState('ingresos') // 'ingresos' | 'neto'

  useEffect(() => {
    if (isDemoMode) { setData(getDemoMonthlyStatsByAuto()); setLoading(false); return }
    getMonthlyStatsByAuto().then(d => { setData(d); setLoading(false) }).catch(() => setLoading(false))
  }, [isDemoMode])

  if (loading) return <div className="loading"><div className="spinner" /></div>
  if (!data || data.length === 0) return <div className="loading" style={{ padding: '40px 0' }}>Sin autos registrados</div>

  // Último mes = mes actual (último item del array)
  const lastIdx = data[0].monthly.length - 1

  return (
    <>
      {/* Gráfico principal */}
      <div className="card" style={{ marginBottom: 10, padding: '16px 14px' }}>
        {/* Leyenda + toggle */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 14 }}>
            {data.map((auto, ai) => (
              <div key={auto.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: 3, background: AUTO_COLORS[ai % AUTO_COLORS.length] }} />
                <span style={{ fontSize: 11, color: '#aaa', fontWeight: 600 }}>{auto.nombre}</span>
              </div>
            ))}
          </div>
          {/* Toggle ingresos / neto */}
          <div style={{ display: 'flex', background: '#111', borderRadius: 8, padding: 3, gap: 2 }}>
            {[['ingresos', 'Bruto'], ['neto', 'Neto']].map(([id, label]) => (
              <button key={id} onClick={() => setMetric(id)}
                style={{ padding: '4px 10px', background: metric === id ? '#1e1e2e' : 'transparent', border: metric === id ? '1px solid #3F7DF533' : '1px solid transparent', borderRadius: 6, color: metric === id ? '#3F7DF5' : '#444', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <MultiLineChart data={data} metric={metric} />
      </div>

      {/* Cards de este mes por auto */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {data.map((auto, ai) => {
          const color = AUTO_COLORS[ai % AUTO_COLORS.length]
          const last = auto.monthly[lastIdx]
          const prev = lastIdx > 0 ? auto.monthly[lastIdx - 1] : null
          const delta = prev && prev[metric] > 0 ? Math.round((last[metric] - prev[metric]) / prev[metric] * 100) : null
          const margen = last.ingresos > 0 ? Math.round(last.neto / last.ingresos * 100) : 0
          return (
            <div key={auto.id} style={{ flex: 1, background: '#0e0e0e', borderRadius: 14, padding: '14px 12px', borderTop: `3px solid ${color}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', marginBottom: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{auto.nombre}</div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 19, fontWeight: 800, color, lineHeight: 1 }}>{fmt(last[metric])}</div>
              <div style={{ fontSize: 9, color: '#444', marginTop: 3, marginBottom: 10 }}>{metric === 'neto' ? 'neto este mes' : 'ingresos este mes'}</div>
              {delta !== null && (
                <div style={{ fontSize: 11, fontWeight: 700, color: delta >= 0 ? '#10B981' : '#EF4444', marginBottom: 6 }}>
                  {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% vs mes ant.
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #1F1F26', paddingTop: 8, marginTop: 4 }}>
                <div>
                  <div style={{ fontSize: 8, color: '#333', letterSpacing: 1 }}>GASTOS</div>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: '#F59E0B', marginTop: 2 }}>{fmt(last.gastos)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 8, color: '#333', letterSpacing: 1 }}>MARGEN</div>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: margen >= 50 ? '#10B981' : margen >= 25 ? '#F59E0B' : '#EF4444', marginTop: 2 }}>{margen}%</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function StatsPage({ resumen, showToast, isDemoMode }) {
  const [tab, setTab] = useState('general')
  const [monthlyData, setMonthlyData] = useState(null)
  const [deuda, setDeuda] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (isDemoMode) {
      setMonthlyData(getDemoMonthlyStats())
      setDeuda(getDemoDeudaHistorica())
      setLoading(false)
      return
    }
    const load = async () => {
      setLoading(true)
      try {
        const cfg = resumen?.config || null
        const [md, dd] = await Promise.all([getMonthlyStats(), getDeudaHistorica(cfg)])
        setMonthlyData(md)
        setDeuda(dd)
      } catch (e) {
        showToast('Error al cargar stats', 'error')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [isDemoMode])

  if (loading) return <div className="loading"><div className="spinner" /></div>

  const deudaEntries = deuda ? Object.entries(deuda) : []
  const hayDeuda = deudaEntries.some(([, d]) => d.diasDebe > 0)
  const totalGan = monthlyData?.reduce((s, d) => s + d.turnos, 0) || 0
  const totalGas = monthlyData?.reduce((s, d) => s + d.gastos, 0) || 0

  return (
    <div className="page">
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 18, background: '#0e0e0e', borderRadius: 12, padding: 4 }}>
        {[['general', 'General'], ['autos', 'Por auto']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex: 1, padding: '9px', background: tab === id ? '#1a1a2e' : 'transparent', border: tab === id ? '1px solid #3F7DF533' : '1px solid transparent', borderRadius: 9, color: tab === id ? '#3F7DF5' : '#444', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", transition: 'all 0.2s' }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <>
          <div className="stitle">Rentabilidad mensual</div>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <div>
                <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase', letterSpacing: 1.5 }}>Ganancias 6m</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 18, fontWeight: 600, color: '#3F7DF5' }}>{fmt(totalGan)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase', letterSpacing: 1.5 }}>Gastos 6m</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 18, fontWeight: 600, color: '#EF4444' }}>{fmt(totalGas)}</div>
              </div>
            </div>
            <div style={{ marginTop: 6, paddingTop: 10, borderTop: '1px solid #23232E', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: '#555', textTransform: 'uppercase', letterSpacing: 1.5 }}>Neto 6 meses</span>
              <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 16, fontWeight: 700, color: totalGan - totalGas >= 0 ? '#3F7DF5' : '#EF4444' }}>
                {fmt(totalGan - totalGas)}
              </span>
            </div>
            <BarChart data={monthlyData} />
          </div>

          <div className="stitle">Deuda acumulada — {new Date().getFullYear()}</div>
          {deudaEntries.length === 0 ? (
            <div className="loading" style={{ padding: '30px 0' }}>Sin choferes registrados</div>
          ) : !hayDeuda ? (
            <div className="card" style={{ textAlign: 'center', color: '#3F7DF5', fontSize: 13 }}>✓ Todos los choferes al día</div>
          ) : (
            deudaEntries.map(([cid, d]) => (
              <div key={cid} className="card" style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{d.nombre}</div>
                    <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{d.autoNombre}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {d.diasDebe > 0 ? (
                      <>
                        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, color: '#EF4444', fontWeight: 700 }}>
                          {d.diasDebe} día{d.diasDebe !== 1 ? 's' : ''}
                        </div>
                        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: '#EF4444' }}>
                          ~{fmt(d.montoDebe)}
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 12, color: '#3F7DF5', fontWeight: 600 }}>✓ Al día</div>
                    )}
                  </div>
                </div>
                {d.ganTotal > 0 && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #23232E', display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 1 }}>Recaudado en {new Date().getFullYear()}</span>
                    <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, color: '#3F7DF5' }}>{fmt(d.ganTotal)}</span>
                  </div>
                )}
              </div>
            ))
          )}
        </>
      )}

      {tab === 'autos' && <AutosComparisonTab isDemoMode={isDemoMode} />}
    </div>
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
const StatsIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>

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

  .header{padding:52px 20px 14px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;background:rgba(0,0,0,0.92);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid #1F1F26}
  .sync-btn{width:36px;height:36px;border-radius:50%;background:#1F1F26;border:none;color:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.15s}
  .sync-btn:active{background:#2A2A35}

  .page{padding:0 20px 100px}
  .loading{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 20px;gap:14px;color:#555;font-size:13px}
  .spinner{width:28px;height:28px;border:2px solid #1F1F1F;border-top-color:#3F7DF5;border-radius:50%;animation:spin 0.75s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}

  .stitle{font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#888;margin:24px 0 10px}
  .card{background:#15151B;border:1px solid #2E2E3B;border-radius:20px;padding:20px;margin-bottom:16px}
  .auto-tag{font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:5px 14px;border-radius:100px;display:inline-block}
  .tag-auto{background:#1A2B5C;color:#A6CBFF;border:1px solid #2D4F9C}
  .divider{height:1px;background:#222228;margin:14px 0}

  .alert-banner{background:#1A0A00;border:1px solid #3A1800;border-radius:14px;padding:12px 16px;margin-bottom:10px;display:flex;gap:10px;align-items:center;font-size:13px}

  .total-banner{background:#15151B;border:1px solid #2E2E3B;border-radius:20px;padding:18px 20px;display:flex;align-items:stretch;margin-bottom:16px;overflow:hidden}
  .total-label{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px}
  .total-value{font-family:'DM Mono',monospace;font-size:min(22px,5.5vw);font-weight:500;color:#7EB1FF;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

  .gan-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0 0}
  .gan-cell{background:#1D1D26;border:1px solid #2E2E3B;border-radius:12px;padding:12px 14px}
  .gan-label{font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#666;margin-bottom:5px}
  .gan-value{font-family:'DM Mono',monospace;font-size:16px;font-weight:500;color:#7EB1FF}

  .neto-row{background:#0B1A3A;border:1px solid #1E3A6A;border-radius:12px;padding:14px 16px;margin-top:8px;display:flex;justify-content:space-between;align-items:center}
  .neto-label{font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#4A7AB5}
  .neto-value{font-family:'DM Mono',monospace;font-size:18px;font-weight:600;color:#7EB1FF}

  .ab-danger{background:#1A0808;color:#EF4444;border:1px solid #3A1010}

  .metric-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
  .metric{background:#1D1D26;border:1px solid #2E2E3B;border-radius:12px;padding:12px 14px}
  .metric-label{font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#666;margin-bottom:5px}
  .metric-value{font-family:'DM Mono',monospace;font-size:15px;font-weight:500}

  .kms-row{display:flex;gap:8px;align-items:center;margin-top:12px}
  .kms-input{flex:1;padding:11px 14px;background:#1D1D26;border:1px solid #2E2E3B;border-radius:12px;color:#fff;font-family:'DM Mono',monospace;font-size:14px;outline:none;-webkit-appearance:none;transition:border-color 0.2s}
  .kms-input:focus{border-color:#3F7DF5}
  .kms-btn{padding:11px 18px;background:#3F7DF5;color:#fff;border:none;border-radius:12px;font-weight:700;font-size:13px;cursor:pointer}

  .mant-list{display:flex;flex-direction:column;gap:8px;margin-top:12px}
  .mant-item{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#1D1D26;border-radius:14px;cursor:pointer;border:1px solid #2E2E3B;transition:border-color 0.15s}
  .mant-item:active{border-color:#444}
  .mant-nombre{font-size:13px;font-weight:600;color:#CFCFD8}
  .mant-sub{font-family:'DM Mono',monospace;font-size:10px;color:#666;margin-top:3px}
  .mbadge{font-size:10px;font-weight:700;padding:4px 10px;border-radius:100px;text-transform:uppercase}
  .mbadge-ok{background:#0B1A3A;color:#7EB1FF}.mbadge-cambiar{background:#1A0A0A;color:#EF4444}

  .cal-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
  .cal-nav-btn{width:38px;height:38px;border-radius:50%;background:#1F1F26;border:none;color:#fff;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center}
  .cal-month-label{font-size:17px;font-weight:700;letter-spacing:-0.3px}
  .cal-legend{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px}
  .leg-item{display:flex;align-items:center;gap:5px;font-size:10px;color:#555}
  .leg-dot{width:8px;height:8px;border-radius:2px;flex-shrink:0}

  .filter-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
  .filter-chip{padding:6px 14px;border-radius:100px;border:1px solid #23232E;background:#111;color:#555;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.15s;white-space:nowrap}
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
  .pill-completo{background:#0A1A10;color:#10B981}.pill-parcial{background:#1A1000;color:#F59E0B}.pill-debe{background:#1A0808;color:#EF4444}.pill-franco{background:#08111F;color:#60A5FA}.pill-futuro{background:#111;color:#2A2A35}

  .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:500;display:flex;align-items:flex-end}
  .modal-sheet{background:#0F0F14;border-radius:24px 24px 0 0;width:100%;padding:24px 20px 48px;max-height:88dvh;overflow-y:auto;border-top:1px solid #23232E}
  .modal-date{font-family:'DM Mono',monospace;font-size:11px;color:#555;margin-bottom:4px;text-transform:uppercase;letter-spacing:1px}
  .modal-title{font-size:22px;font-weight:700;margin-bottom:18px;letter-spacing:-0.3px}
  .modal-back{background:none;border:none;color:#555;font-size:14px;cursor:pointer;padding:0;margin-bottom:4px}
  .modal-close{width:100%;padding:14px;background:transparent;color:#555;border:1px solid #23232E;border-radius:14px;font-size:14px;cursor:pointer;margin-top:12px}

  .auto-pick-btn{display:flex;align-items:center;justify-content:space-between;padding:16px;background:#161616;border:1px solid #23232E;border-radius:14px;margin-bottom:8px;cursor:pointer;transition:border-color 0.15s}
  .auto-pick-btn:active{border-color:#333}

  .chofer-section{margin-bottom:10px;background:#161616;border-radius:14px;padding:16px}
  .chofer-sec-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
  .chofer-sec-name{font-size:16px;font-weight:600}
  .eb{font-family:'DM Mono',monospace;font-size:10px;font-weight:700;padding:4px 10px;border-radius:100px;text-transform:uppercase}
  .eb-completo{background:#0A1A10;color:#10B981}.eb-parcial{background:#1A1000;color:#F59E0B}.eb-debe{background:#1A0808;color:#EF4444}.eb-franco{background:#08111F;color:#60A5FA}.eb-futuro{background:#1F1F26;color:#555}

  .action-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
  .action-btn{padding:12px 8px;border-radius:12px;border:1px solid #23232E;background:#111;color:#fff;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;cursor:pointer;text-align:center;transition:opacity 0.15s}
  .action-btn:active{opacity:0.7}.action-btn:disabled{opacity:0.35;cursor:not-allowed}
  .ab-primary{background:#fff;color:#000;border-color:#fff;font-weight:700}
  .ab-franco{background:#08111F;color:#60A5FA;border-color:#0F2040}
  .ab-quitar{background:#1A0808;color:#F59E0B;border-color:#2A1010}

  .monto-row{display:flex;gap:8px}
  .monto-input{flex:1;padding:12px 14px;background:#111;border:1px solid #23232E;border-radius:12px;color:#fff;font-family:'DM Mono',monospace;font-size:15px;outline:none;-webkit-appearance:none;transition:border-color 0.2s}
  .monto-input:focus{border-color:#3F7DF5}.monto-input::placeholder{color:#333}
  .monto-btn{padding:12px 18px;background:#1F1F26;color:#fff;border:1px solid #2A2A35;border-radius:12px;font-weight:600;font-size:13px;cursor:pointer;transition:background 0.15s}
  .monto-btn:active{background:#fff;color:#000}.monto-btn:disabled{opacity:0.4}

  .tabs{display:flex;gap:6px;margin-bottom:18px;background:#0F0F14;padding:4px;border-radius:14px;border:1px solid #23232E}
  .tab{flex:1;padding:10px;border-radius:10px;border:none;background:transparent;color:#555;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;cursor:pointer;text-align:center;transition:all 0.2s}
  .tab.active{background:#fff;color:#000;font-weight:700}

  .gasto-item{display:flex;align-items:center;padding:14px 16px;background:#0F0F14;border:1px solid #23232E;border-radius:14px;margin-bottom:8px}
  .gasto-desc{font-size:14px;font-weight:600}.gasto-auto{font-size:11px;color:#555;margin-top:2px}
  .gasto-monto{font-family:'DM Mono',monospace;font-size:14px;color:#EF4444;font-weight:500;white-space:nowrap}
  .gasto-del-btn{width:30px;height:30px;border-radius:10px;border:1px solid #2A1010;background:#1A0808;color:#EF4444;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .gasto-del-btn:disabled{opacity:0.4;cursor:not-allowed}

  .form-label{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#555;display:block;margin-bottom:8px}
  .form-input{width:100%;padding:14px 16px;background:#111;border:1px solid #23232E;border-radius:14px;color:#fff;font-family:'DM Sans',sans-serif;font-size:15px;outline:none;-webkit-appearance:none;transition:border-color 0.2s}
  .form-input:focus{border-color:#3F7DF5}.form-input::placeholder{color:#333}
  .form-group{margin-bottom:14px}
  select.form-input{cursor:pointer}
  .radio-group{display:flex;gap:8px}
  .radio-opt{flex:1;padding:12px;border-radius:12px;border:1px solid #23232E;background:#111;text-align:center;cursor:pointer;transition:all 0.15s}
  .radio-opt.sel{border-color:#3F7DF5;background:#0B1A3A}
  .rl{font-size:13px;font-weight:600;color:#fff}

  .btn-primary{width:100%;padding:16px;background:#fff;color:#000;border:none;border-radius:14px;font-family:'DM Sans',sans-serif;font-size:15px;font-weight:700;cursor:pointer;margin-top:8px;transition:opacity 0.15s}
  .btn-primary:active{opacity:0.85}.btn-primary:disabled{opacity:0.4;cursor:not-allowed}

  .toast{position:fixed;bottom:92px;left:50%;transform:translateX(-50%) translateY(16px);background:#1F1F26;border:1px solid #2A2A35;color:#fff;padding:12px 20px;border-radius:100px;font-size:13px;font-weight:600;opacity:0;transition:all 0.25s;z-index:999;white-space:nowrap;max-width:92vw;text-align:center}
  .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}.toast.success{border-color:#3F7DF5;color:#3F7DF5}.toast.error{border-color:#EF4444;color:#EF4444}

  .bottom-nav{position:fixed;bottom:0;left:0;right:0;display:flex;background:rgba(0,0,0,0.95);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border-top:1px solid #1F1F26;padding:10px 0 26px;z-index:200}
  .bnav-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;padding:4px 0;background:none;border:none;cursor:pointer;color:#444;transition:color 0.2s}
  .bnav-btn svg{width:22px;height:22px}.bnav-label{font-size:9px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase}
  .bnav-btn.active{color:#fff}
  .bnav-btn{transition:color 0.2s}
  .bnav-btn.active svg{filter:drop-shadow(0 0 6px rgba(39,110,241,0.55))}
  .bnav-btn svg{transition:filter 0.25s}
  .bnav-btn.active .bnav-label{color:#3F7DF5}

  /* ── Animaciones ─────────────────────────────────────────────── */
  @keyframes pageIn   { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
  @keyframes cardIn   { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
  @keyframes shimmer  { 0%{background-position:-200% center} 100%{background-position:200% center} }
  @keyframes modalUp  { from{transform:translateY(100%);opacity:0} to{transform:translateY(0);opacity:1} }
  @keyframes overlayIn{ from{opacity:0} to{opacity:1} }
  @keyframes tsr      { from{opacity:0;transform:translateX(32px)} to{opacity:1;transform:translateX(0)} }
  @keyframes tsl      { from{opacity:0;transform:translateX(-32px)} to{opacity:1;transform:translateX(0)} }

  .page-anim{animation:pageIn 0.22s ease-out}
  .card{animation:cardIn 0.28s ease-out both}
  .tsr{animation:tsr 0.35s cubic-bezier(0.22,1,0.36,1)}
  .tsl{animation:tsl 0.35s cubic-bezier(0.22,1,0.36,1)}

  /* ── Skeleton ────────────────────────────────────────────────── */
  .skel{background:linear-gradient(90deg,#0F0F14 25%,#181818 50%,#0F0F14 75%);background-size:200% 100%;animation:shimmer 1.6s ease-in-out infinite;border-radius:8px}

  /* ── Modal ───────────────────────────────────────────────────── */
  .modal-overlay{animation:overlayIn 0.25s ease-out}
  .modal-sheet{animation:modalUp 0.38s cubic-bezier(0.32,0.72,0,1)}

  /* ── Botones ─────────────────────────────────────────────────── */
  .btn-primary{transition:transform 0.1s,opacity 0.15s}
  .btn-primary:active{transform:scale(0.97);opacity:0.88}
  .action-btn{transition:transform 0.1s,opacity 0.15s,background 0.15s,border-color 0.15s}
  .action-btn:active{transform:scale(0.95)}
  .kms-btn{transition:transform 0.1s,background 0.15s}
  .kms-btn:active{transform:scale(0.95)}
  .sync-btn{transition:background 0.15s,transform 0.15s}
  .sync-btn:active{transform:scale(0.88)}

  /* ── Tarjetas ────────────────────────────────────────────────── */
  .card{transition:border-color 0.2s}
  .gasto-item{transition:background 0.15s}
  .mant-item{transition:border-color 0.15s,background 0.15s}

  /* ── Alertas ─────────────────────────────────────────────────── */
  .alert-warn{background:#1A1200;border-color:#3A2800;color:#F59E0B}
  .alert-danger{background:#1A0000;border-color:#3A0000;color:#EF4444}

  @media print {
    .no-print,.header,.bottom-nav,.toast,.kms-row,.sync-btn,.stitle,.tabs,.action-btn,.gasto-del-btn,.modal-overlay{display:none!important}
    body{background:#fff!important;color:#000!important}
    .page{padding:16px!important}
    .card{background:#f9f9f9!important;border-color:#ddd!important;break-inside:avoid;margin-bottom:12px}
    .gan-cell,.neto-row,.metric,.total-banner{background:#F4F4F8!important;border-color:#ddd!important}
    .gan-value,.neto-value,.metric-value,.total-value{color:#000!important}
    .gan-label,.neto-label,.metric-label,.total-label{color:#666!important}
    .auto-tag{background:#eee!important;color:#000!important;border-color:#ccc!important}
  }
`
