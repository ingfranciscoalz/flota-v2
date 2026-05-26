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
  createAuto, deleteAuto, createChofer, updateAutoTurnoBase, updateAutoVencimientos, updateChofer, deleteChofer,
  getUserMantItems, createMantItem, updateMantItem, deleteMantItem,
  getMonthlyStats, getDeudaHistorica, getMonthlyStatsByAuto,
  getDeudas, insertDeuda, saldarDeuda, deleteDeuda,
  savePushSubscription, deletePushSubscription,
  generateChoferLink, desvincularChofer, vincularChofer,
  getMyChoferData, getMisTurnos, getMisFrancos, choferMarcarTurno, uploadComprobante,
  getWeeklyTurnosConComprobantes,
} from './data'
// reports.js se importa dinámicamente al exportar (evita cargar jsPDF en el bundle inicial)

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
  const scrollRef = useRef(null)
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth
  }, [data])

  if (!data || data.length === 0) return null
  const maxVal = Math.max(...data.flatMap(d => [d.turnos, d.gastos]), 1)
  const H = 140, PT = 16, BW = 10, GAP = 2, SW = 54
  const totalH = PT + H + 28
  const totalW = data.length * SW
  const PAD_LEFT = 44

  const magnitude = Math.pow(10, Math.floor(Math.log10(maxVal)))
  const niceMax = Math.ceil(maxVal / magnitude) * magnitude
  const fmtY = v => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : v
  const ticks = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div style={{ marginTop: 8, position: 'relative' }}>
      {/* Eje Y — overlay fijo */}
      <svg width={PAD_LEFT} height={totalH} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', background: 'var(--bg-card)', zIndex: 1 }}>
        {ticks.map(p => (
          <text key={p} x={PAD_LEFT - 5} y={PT + H - H * p + 4}
            textAnchor="end" style={{ fill: 'var(--text-sub)' }} fontSize="10" fontWeight="600" fontFamily="'DM Mono',monospace">
            {fmtY(niceMax * p)}
          </text>
        ))}
      </svg>
      {/* Gráfico scrolleable */}
      <div style={{ paddingLeft: PAD_LEFT }}>
        <div
          ref={scrollRef}
          style={{ overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch', msOverflowStyle: 'none', scrollbarWidth: 'none' }}
        >
          <svg width={totalW} height={totalH} style={{ display: 'block', overflow: 'visible' }}>
            {/* Grid horizontales */}
            {ticks.filter(p => p > 0).map(p => (
              <line key={p} x1="0" y1={PT + H - H * p} x2={totalW} y2={PT + H - H * p}
                style={{ stroke: p === 1 ? 'var(--border)' : 'var(--bg-inner)' }} strokeWidth="1" />
            ))}
            {(() => {
              // Puntos de los picos de neto para la curva suavizada
              const pts = data.map((d, i) => {
                const cx = i * SW + SW / 2
                const neto = Math.max(d.turnos - d.gastos, 0)
                const hN = neto > 0 ? Math.max((neto / niceMax) * H, 2) : 0
                return [cx, PT + H - hN]
              })
              // Genera path bezier cúbico suavizado
              let smoothPath = ''
              if (pts.length > 1) {
                smoothPath = `M ${pts[0][0]} ${pts[0][1]}`
                for (let i = 1; i < pts.length; i++) {
                  const [x0, y0] = pts[i - 1]
                  const [x1, y1] = pts[i]
                  const cpX = (x0 + x1) / 2
                  smoothPath += ` C ${cpX} ${y0} ${cpX} ${y1} ${x1} ${y1}`
                }
              }
              return (
                <>
                  {data.map((d, i) => {
                    const cx = i * SW + SW / 2
                    const neto = Math.max(d.turnos - d.gastos, 0)
                    const hT = Math.max((d.turnos / niceMax) * H, 2)
                    const hG = Math.max((d.gastos / niceMax) * H, 2)
                    const hN = neto > 0 ? Math.max((neto / niceMax) * H, 2) : 0
                    const label = MESES[d.mes - 1].slice(0, 3)
                    return (
                      <g key={d.key}>
                        <rect x={cx - BW * 1.5 - GAP} y={PT + H - hN} width={BW} height={hN} fill="#10B981" rx="2" />
                        <rect x={cx - BW / 2}          y={PT + H - hT} width={BW} height={hT} fill="#3F7DF5" rx="2" />
                        <rect x={cx + BW / 2 + GAP}    y={PT + H - hG} width={BW} height={hG} fill="#EF4444" rx="2" opacity="0.85" />
                        <text x={cx} y={PT + H + 16} textAnchor="middle" style={{ fill: 'var(--text-muted)' }} fontSize="9" fontFamily="DM Mono,monospace">{label}</text>
                      </g>
                    )
                  })}
                  {/* Curva suavizada sobre picos de neto */}
                  {smoothPath && (
                    <path d={smoothPath} fill="none" stroke="#10B981" strokeWidth="1.5" strokeOpacity="0.6" strokeDasharray="4 2" />
                  )}
                  {/* Puntos en los picos */}
                  {pts.map(([x, y], i) => (
                    <circle key={i} cx={x} cy={y} r="2.5" fill="#10B981" opacity="0.8" />
                  ))}
                </>
              )
            })()}
          </svg>
        </div>
      </div>
      <div style={{ paddingLeft: PAD_LEFT, display: 'flex', gap: 14, marginTop: 4 }}>
        {[['#10B981','Ganancias'], ['#3F7DF5','Ingresos'], ['#EF4444','Gastos']].map(([color, label]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</span>
          </div>
        ))}
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
      <div style={{ color: '#666', fontSize: 11, marginTop: 10, letterSpacing: 3, fontWeight: 700 }}>GESTIÓN DE REMISES</div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 28 }}>
        {['$312k', '6 autos', '4 choferes'].map((t, i) => (
          <div key={i} style={{ background: '#15151B', borderRadius: 10, padding: '8px 14px', fontSize: 11, color: '#888', fontWeight: 700 }}>{t}</div>
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
          <div style={{ fontSize: 11, color: '#666', letterSpacing: 1.5, fontWeight: 700, marginBottom: 6 }}>ESTA SEMANA</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>$84.500</div>
          <div style={{ fontSize: 11, color: '#10B981', marginTop: 4, fontWeight: 600 }}>▲ 12% vs semana anterior</div>
        </div>
        <div style={{ flex: 1, background: '#15151B', borderRadius: 14, padding: '12px 14px', border: '1px solid #1e1e2e' }}>
          <div style={{ fontSize: 11, color: '#666', letterSpacing: 1.5, fontWeight: 700, marginBottom: 6 }}>ESTE MES</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>$312k</div>
          <div style={{ fontSize: 11, color: '#F59E0B', marginTop: 4, fontWeight: 600 }}>neto $218.400</div>
        </div>
      </div>
      <div style={{ background: '#15151B', borderRadius: 14, padding: '12px 14px', border: '1px solid #1e1e2e' }}>
        <div style={{ fontSize: 11, color: '#666', letterSpacing: 1.5, fontWeight: 700, marginBottom: 8 }}>AUTOS EN TURNO HOY</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['Corolla','Gol','Logan','Sandero'].map((a, i) => (
            <div key={i} style={{ flex: 1, background: i < 3 ? '#3F7DF518' : '#1F1F26', borderRadius: 8, padding: '6px 4px', textAlign: 'center', fontSize: 11, color: i < 3 ? '#3F7DF5' : '#333', fontWeight: 700, border: `1px solid ${i < 3 ? '#3F7DF533' : '#222'}` }}>{a}</div>
          ))}
        </div>
      </div>
      <div style={{ background: '#1A1208', border: '1px solid #F59E0B33', borderRadius: 12, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 20 }}>🔧</div>
        <div>
          <div style={{ fontSize: 11, color: '#F59E0B', fontWeight: 700 }}>SERVICE PRÓXIMO</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>Toyota Corolla · faltan 500 km</div>
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
        <div style={{ display: 'flex', gap: 16, fontSize: 16, color: '#666' }}><span>‹</span><span style={{ color: '#fff' }}>›</span></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3, marginBottom: 4 }}>
        {days.map((d, i) => <div key={i} style={{ textAlign: 'center', fontSize: 11, color: '#666', fontWeight: 700, paddingBottom: 4 }}>{d}</div>)}
      </div>
      {grid.map((row, ri) => (
        <div key={ri} style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3, marginBottom: 3 }}>
          {row.map((color, ci) => (
            <div key={ci} style={{ aspectRatio: '1', borderRadius: 7, background: color || '#0e0e0e', border: `1px solid ${color ? color + '44' : '#181818'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: color ? '#fff' : '#2A2A35', fontWeight: 600 }}>
              {labels[ri][ci] || ''}
            </div>
          ))}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 16, marginTop: 10, justifyContent: 'center' }}>
        {[['#3F7DF5','Turno completo'],['#10B981','Franco']].map(([c,l]) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#888' }}>
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
            <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>{item.sub}</div>
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: item.color, flexShrink: 0 }}>{item.amount}</div>
        </div>
      ))}
      <div style={{ background: '#0D1F0D', border: '1px solid #10B98133', borderRadius: 12, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 11, color: '#10B981', fontWeight: 700, letterSpacing: 1.2 }}>NETO DEL MES</div>
          <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>ingresos $312k − gastos $93.6k</div>
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
        <div style={{ fontSize: 11, color: '#666', fontWeight: 700, letterSpacing: 1.2 }}>ÚLTIMOS 6 MESES</div>
        <div style={{ display: 'flex', gap: 10 }}>
          {[['#3F7DF5','Ingresos'],['#F59E0B','Gastos']].map(([c,l]) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#888' }}>
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
          <div style={{ fontSize: 11, color: '#666', fontWeight: 700, letterSpacing: 1 }}>TOTAL INGRESOS</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#3F7DF5', marginTop: 4 }}>$487k</div>
        </div>
        <div style={{ flex: 1, background: '#15151B', borderRadius: 12, padding: '10px 12px', border: '1px solid #1e1e1e' }}>
          <div style={{ fontSize: 11, color: '#666', fontWeight: 700, letterSpacing: 1 }}>MARGEN NETO</div>
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
    { nombre: 'Renault Logan', patente: 'IJ 789 KL', chofer: 'Sin asignar', color: '#666', km: '203.100 km', ok: false },
  ]
  return (
    <div style={{ width: 270, display: 'flex', flexDirection: 'column', gap: 7 }}>
      {autos.map((a, i) => (
        <div key={i} style={{ background: '#15151B', borderRadius: 12, padding: '11px 13px', display: 'flex', alignItems: 'center', gap: 12, borderLeft: `3px solid ${a.color}`, border: '1px solid #1e1e1e', borderLeftColor: a.color, borderLeftWidth: 3 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#ddd' }}>{a.nombre}</div>
              {!a.ok && <div style={{ fontSize: 11, background: '#F59E0B22', color: '#F59E0B', borderRadius: 5, padding: '2px 6px', fontWeight: 700 }}>SERVICE</div>}
            </div>
            <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>{a.patente} · {a.chofer}</div>
          </div>
          <div style={{ fontSize: 10, color: '#666', fontWeight: 600 }}>{a.km}</div>
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
        <div style={{ fontSize: 11, color: '#666', fontWeight: 700, letterSpacing: 1.2 }}>DEUDAS DE CHOFERES</div>
        <div style={{ fontSize: 11, background: '#EF444422', color: '#EF4444', borderRadius: 6, padding: '3px 8px', fontWeight: 700 }}>TOTAL $23.500</div>
      </div>
      {deudas.map((d, i) => (
        <div key={i} style={{ background: '#15151B', borderRadius: 12, padding: '11px 13px', display: 'flex', alignItems: 'center', gap: 11, border: '1px solid #1e1e1e', opacity: d.pending ? 1 : 0.45 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#ddd' }}>{d.chofer}</div>
              <div style={{ fontSize: 11, background: d.pending ? '#EF444422' : '#10B98122', color: d.pending ? '#EF4444' : '#10B981', borderRadius: 5, padding: '2px 6px', fontWeight: 700 }}>
                {d.pending ? 'PENDIENTE' : 'SALDADO'}
              </div>
            </div>
            <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>{d.desc}</div>
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
  { color: '#3F7DF5', subtitle: 'Pestaña Resumen', title: 'El pulso de\ntu flota', body: 'De un vistazo: ganancias de la semana, neto del mes, qué autos están en turno y alertas de mantenimiento. Y en Análisis, proyecciones y gráficos de rentabilidad.', Illust: IllustResumen },
  { color: '#60AFFF', subtitle: 'Pestaña Calendario', title: 'Turnos\ndía a día', body: 'Tocás un día y registrás turno completo, parcial o franco. Todo queda guardado por auto y por chofer.', Illust: IllustCalendario },
  { color: '#F59E0B', subtitle: 'Pestaña Flota', title: 'Control de\ncostos real', body: 'En Gastos cargás combustible, seguros, multas y mantenimiento. Marca y kms al día, todo en un solo lugar.', Illust: IllustGastos },
  { color: '#10B981', subtitle: 'Análisis dentro de Resumen', title: 'Rentabilidad\na la vista', body: 'Analizá meses históricos de ingresos vs gastos, proyectá fin de mes y medí el margen real de tu negocio.', Illust: IllustStats },
  { color: '#8B5CF6', subtitle: 'Autos & Choferes', title: 'Tu flota\norganizada', body: 'Registrá cada auto con su historial de km y mantenimiento. Asigná choferes y controlá el estado de cada uno.', Illust: IllustAutos },
  { color: '#EF4444', subtitle: 'Sección Deudas', title: 'Deudas de\nchoferes', body: 'En Flota → Deudas registrás adelantos, multas o gastos a cargo del chofer. Marcalos como saldados cuando te devuelvan el dinero.', Illust: IllustDeudas },
]

// ── WEEKLY COMPROBANTES REPORT ────────────────────────────────────────────────
function WeeklyReportModal({ onClose, showToast, nombreFlota }) {
  const [loading, setLoading] = useState(true)
  const [turnos, setTurnos] = useState([])
  const [exporting, setExporting] = useState(false)

  // Período: últimos 7 días
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]
  const weekAgo = new Date(today)
  weekAgo.setDate(weekAgo.getDate() - 7)
  const weekAgoStr = weekAgo.toISOString().split('T')[0]

  function fmtFecha(ds) {
    if (!ds) return ''
    const [y, m, d] = ds.split('-')
    return `${d}/${m}/${y.slice(2)}`
  }

  useEffect(() => {
    getWeeklyTurnosConComprobantes(weekAgoStr, todayStr)
      .then(data => { setTurnos(data); setLoading(false) })
      .catch(() => { setLoading(false) })
  }, [])

  async function handleDownloadPDF() {
    setExporting(true)
    try {
      const { generateComprobantesReport, downloadPDF } = await import('./reports')
      const doc = generateComprobantesReport({ turnos, fechaDesde: weekAgoStr, fechaHasta: todayStr, nombreFlota })
      downloadPDF(doc, `comprobantes_${weekAgoStr}_${todayStr}.pdf`)
    } catch (e) {
      showToast('Error al generar PDF', 'error')
    } finally {
      setExporting(false)
    }
  }

  const totalMonto = turnos.reduce((acc, t) => acc + (t.monto || 0), 0)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 520, maxHeight: '90vh', background: 'var(--bg-card)', borderRadius: '20px 20px 0 0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '18px 18px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>📋 Comprobantes de la semana</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{fmtFecha(weekAgoStr)} → {fmtFecha(todayStr)}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)', fontSize: 14 }}>Cargando comprobantes...</div>
          ) : turnos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Sin comprobantes en los últimos 7 días</div>
            </div>
          ) : (
            <>
              {/* Resumen */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
                {[
                  ['Total', `${turnos.length}`, '#3F7DF5'],
                  ['Cobrado', '$' + Math.round(totalMonto).toLocaleString('es-AR'), '#10B981'],
                  ['Choferes', `${new Set(turnos.map(t => t.chofer_id)).size}`, '#8B5CF6'],
                ].map(([label, val, color]) => (
                  <div key={label} style={{ background: 'var(--bg)', borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color }}>{val}</div>
                  </div>
                ))}
              </div>

              {/* Lista */}
              {turnos.map(t => {
                const chofer = t.choferes?.nombre || '—'
                const auto = t.choferes?.autos?.nombre || '—'
                const esCompleto = t.estado === 'completo'
                return (
                  <div key={t.id} style={{ background: 'var(--bg)', borderRadius: 12, padding: '12px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                    {/* Thumbnail */}
                    <a href={t.comprobante_url} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0 }}>
                      <img
                        src={t.comprobante_url}
                        alt="comprobante"
                        style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', display: 'block' }}
                        onError={e => { e.target.style.display = 'none' }}
                      />
                    </a>
                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{chofer}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{auto} · {fmtFecha(t.fecha)}</div>
                    </div>
                    {/* Monto + estado */}
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: esCompleto ? '#10B981' : '#F59E0B' }}>
                        ${Math.round(t.monto || 0).toLocaleString('es-AR')}
                      </div>
                      <div style={{ fontSize: 10, color: esCompleto ? '#10B981' : '#F59E0B', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        {esCompleto ? 'Completo' : 'Parcial'}
                      </div>
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && (
          <div style={{ padding: '12px 16px 20px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            <button
              onClick={handleDownloadPDF}
              disabled={exporting || turnos.length === 0}
              style={{ width: '100%', padding: '13px', background: exporting ? 'var(--bg)' : 'linear-gradient(135deg,#3F7DF5,#6366F1)', border: 'none', borderRadius: 13, color: exporting ? 'var(--text-muted)' : '#fff', fontSize: 14, fontWeight: 700, cursor: exporting || turnos.length === 0 ? 'default' : 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
              {exporting ? '⏳ Generando PDF...' : '📄 Descargar reporte PDF'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

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
          <div style={{ fontSize: 14, color: '#888', lineHeight: 1.65, marginBottom: 20 }}>{s.body}</div>
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

// ── VAPID PUBLIC KEY ──────────────────────────────────────────────────────────
const VAPID_PUBLIC_KEY = 'BNfezjUZkM6Fl0ZuTM6gU25Atne4ezKvu06TYeSY7jNuZqcko7Kh2UGi7WUsiTdFBx2RSWT4-7_kH6eEc_YWBU8'

// ── PLAY BILLING ──────────────────────────────────────────────────────────────
const PLAY_PRODUCT_ID = 'flota_pro_mensual' // debe coincidir con el ID en Play Console

function SubscriptionModal({ onClose, onPurchased }) {
  const [price, setPrice] = useState(null)
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [err, setErr] = useState(null)
  const inTWA = typeof window !== 'undefined' && 'getDigitalGoodsService' in window

  useEffect(() => {
    if (!inTWA) return
    window.getDigitalGoodsService('https://play.google.com/billing')
      .then(svc => svc.getDetails([PLAY_PRODUCT_ID]))
      .then(details => {
        const d = details?.[0]
        if (d?.price) setPrice(`${d.price.currency} ${parseFloat(d.price.value).toLocaleString('es-AR')}`)
      })
      .catch(() => {})
  }, [inTWA])

  const verifyAndActivate = async (purchaseToken) => {
    const { data: { user } } = await supabase.auth.getUser()
    const res = await fetch('/api/verify-purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purchaseToken, subscriptionId: PLAY_PRODUCT_ID, userId: user.id }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || 'Error al verificar la compra')
    }
    return res.json()
  }

  const handlePurchase = async () => {
    setLoading(true); setErr(null)
    try {
      const svc = await window.getDigitalGoodsService('https://play.google.com/billing')
      // purchase() devuelve PaymentResponse con purchaseToken
      const payment = await new PaymentRequest(
        [{ supportedMethods: 'https://play.google.com/billing', data: { sku: PLAY_PRODUCT_ID } }],
        { total: { label: 'Flota Pro', amount: { currency: 'ARS', value: '0' } } }
      ).show()
      await payment.complete('success')
      const purchaseToken = payment.details.purchaseToken
      await verifyAndActivate(purchaseToken)
      onPurchased()
    } catch (e) {
      if (e.name !== 'AbortError') setErr(e.message || 'Error al procesar el pago')
    } finally { setLoading(false) }
  }

  const handleRestore = async () => {
    setRestoring(true); setErr(null)
    try {
      const svc = await window.getDigitalGoodsService('https://play.google.com/billing')
      const purchases = await svc.listPurchases()
      const found = purchases?.find(p => p.itemId === PLAY_PRODUCT_ID)
      if (!found) { setErr('No se encontró una suscripción activa para esta cuenta'); return }
      await verifyAndActivate(found.purchaseToken)
      onPurchased()
    } catch (e) {
      setErr(e.message || 'Error al restaurar')
    } finally { setRestoring(false) }
  }

  const FEATURES = [
    ['🚗', 'Autos ilimitados', 'Sin límite de autos en tu flota'],
    ['📊', 'Stats completos', 'Gráficos de rendimiento por auto y período'],
    ['🔔', 'Recordatorios push', 'Notificaciones de turnos pendientes 24hs después'],
    ['🔧', 'Mantenimiento avanzado', 'Historial completo y alertas de service'],
  ]

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet">
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 28, fontWeight: 800, letterSpacing: -0.5, color: 'var(--text)' }}>
            Flota<span style={{ color: '#3F7DF5' }}>.</span><span style={{ color: '#F59E0B' }}> Pro</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-sub)', marginTop: 6 }}>
            {price ? `${price} / mes · Gestionado por Google Play` : inTWA ? 'Cargando precio...' : 'Disponible en la app de Android'}
          </div>
        </div>

        {FEATURES.map(([icon, title, desc]) => (
          <div key={title} style={{ display: 'flex', gap: 14, padding: '13px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 22, width: 28, flexShrink: 0, textAlign: 'center' }}>{icon}</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>
            </div>
          </div>
        ))}

        {err && <div style={{ color: '#EF4444', fontSize: 12, marginTop: 14, padding: '10px 14px', background: '#1A0808', borderRadius: 10, textAlign: 'center' }}>{err}</div>}

        {inTWA ? (
          <>
            <button className="btn-primary" style={{ marginTop: 22, background: '#3F7DF5', color: '#fff' }}
              onClick={handlePurchase} disabled={loading || restoring}>
              {loading ? 'Procesando...' : '⭐ Suscribirse con Google Play'}
            </button>
            <button onClick={handleRestore} disabled={restoring || loading}
              style={{ width: '100%', marginTop: 8, padding: '12px', background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer' }}>
              {restoring ? 'Buscando...' : 'Restaurar compra anterior'}
            </button>
          </>
        ) : (
          <div style={{ marginTop: 20, padding: 16, background: 'var(--bg-inner)', borderRadius: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Las suscripciones se gestionan desde la<br />
              <strong style={{ color: 'var(--text)' }}>app de Android en Google Play.</strong>
            </div>
          </div>
        )}

        <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 10 }}>
          Cancelá cuando quieras desde Google Play → Suscripciones
        </div>
        <button className="modal-close" onClick={onClose}>Cerrar</button>
      </div>
    </div>
  )
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)))
}

// ── APP ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [authState, setAuthState] = useState('loading') // loading|auth|auth_chofer|onboarding|app|demo|chofer
  const [profile, setProfile] = useState(null)
  const [isDemoMode, setIsDemoMode] = useState(false)
  const [myChoferData, setMyChoferData] = useState(null) // solo si el usuario es un chofer vinculado
  const [page, setPage] = useState('resumen')
  const [resumenTab, setResumenTab] = useState('resumen')
  const [resumen, setResumen] = useState(null)
  const [cal, setCal] = useState(null)
  const [calYear, setCalYear] = useState(new Date().getFullYear())
  const [calMonth, setCalMonth] = useState(new Date().getMonth() + 1)
  const [loading, setLoading] = useState(false)
  const [showTutorial, setShowTutorial] = useState(false)
  const [showInstall, setShowInstall] = useState(false)
  // Theme: 'dark' | 'light' — stored in localStorage, applied to :root
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('flota_theme') || 'dark'
    document.documentElement.setAttribute('data-theme', saved)
    return saved
  })
  // Upgrade modal
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  // Weekly comprobantes report
  const [showWeeklyReport, setShowWeeklyReport] = useState(false)
  // Export desde calendario
  const [calExporting, setCalExporting] = useState(false)
  // Push notifications
  const [notifState, setNotifState] = useState('unknown') // unknown|granted|denied|unsupported
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

  // Sincronizar tema con document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('flota_theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')

  // Inicializar estado de notificaciones
  useEffect(() => {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setNotifState('unsupported'); return
    }
    setNotifState(Notification.permission === 'granted' ? 'granted' : Notification.permission === 'denied' ? 'denied' : 'unknown')
  }, [])

  const enableNotifications = async () => {
    if (isDemoMode) { showToast('No disponible en modo demo', ''); return }
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { setNotifState('denied'); showToast('Notificaciones bloqueadas', 'error'); return }
      setNotifState('granted')
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
      // Save subscription to Supabase
      await savePushSubscription(sub.toJSON())
      showToast('¡Recordatorios activados!', 'success')
    } catch (e) {
      console.error('Push subscription error:', e)
      showToast('Error al activar notificaciones', 'error')
    }
  }

  const disableNotifications = async () => {
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) await sub.unsubscribe()
      await deletePushSubscription()
      setNotifState('unknown')
      showToast('Recordatorios desactivados', '')
    } catch (e) {
      showToast('Error al desactivar', 'error')
    }
  }

  // En iOS mostramos instrucciones si no está en modo standalone
  const showIosInstall = isIOS && !isInStandaloneMode

  useEffect(() => {
    if (authState === 'app' && !localStorage.getItem('flota_tutorial')) {
      setShowTutorial(true)
    }
  }, [authState])

  // Detectar parámetros del QR de vinculación y deep links en la URL al cargar
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('vincular')
    const cid   = params.get('c')
    if (token && cid) {
      sessionStorage.setItem('vincular_token', token)
      sessionStorage.setItem('vincular_chofer_id', cid)
      window.history.replaceState({}, '', window.location.pathname)
    }
    // Deep link desde notificación semanal de comprobantes
    if (params.get('reporte') === 'semana') {
      sessionStorage.setItem('flota_open_reporte_semana', '1')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  // Abrir reporte semanal automáticamente si vino por deep link
  useEffect(() => {
    if (authState === 'app' && sessionStorage.getItem('flota_open_reporte_semana')) {
      sessionStorage.removeItem('flota_open_reporte_semana')
      setShowWeeklyReport(true)
    }
  }, [authState])

  const handleSession = useCallback(async () => {
    // Procesar token de vinculación pendiente (el chofer acaba de hacer login con Google)
    const vincularToken = sessionStorage.getItem('vincular_token')
    const vincularCid   = sessionStorage.getItem('vincular_chofer_id')
    if (vincularToken && vincularCid) {
      sessionStorage.removeItem('vincular_token')
      sessionStorage.removeItem('vincular_chofer_id')
      const { data } = await vincularChofer(vincularToken, vincularCid)
      if (data?.ok) {
        // Vinculación exitosa: continuar como chofer
      } else if (data?.error) {
        // Error: puede que el token expiró o ya estaba vinculado — continuar igual
        console.warn('Vincular error:', data.error)
      }
    }

    const prof = await getProfile()
    setProfile(prof || null)

    // Auto-restore: si está en plan free dentro de la TWA, verificar si tiene compra activa
    if (prof && (!prof.plan || prof.plan === 'free') && typeof window !== 'undefined' && 'getDigitalGoodsService' in window) {
      try {
        const svc = await window.getDigitalGoodsService('https://play.google.com/billing')
        const purchases = await svc.listPurchases()
        const found = purchases?.find(p => p.itemId === PLAY_PRODUCT_ID)
        if (found) {
          const res = await fetch('/api/verify-purchase', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ purchaseToken: found.purchaseToken, subscriptionId: PLAY_PRODUCT_ID, userId: prof.id }),
          })
          if (res.ok) setProfile({ ...prof, plan: 'pro' })
        }
      } catch (_) { /* no estamos en TWA o no hay compra */ }
    }

    // ¿El usuario logueado es un chofer vinculado (no dueño)?
    const choferData = await getMyChoferData()
    if (choferData) {
      setMyChoferData(choferData)
      setAuthState('chofer')
      return
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

  const handleCalExport = async (action, year, month) => {
    if (!cal) return
    setCalExporting(true)
    try {
      const reportsMod = await import('./reports')
      const { generateMonthlyPDF, downloadPDF, sharePDF, buildWhatsAppSummary, buildResumenFromCal } = reportsMod
      const gastos = isDemoMode ? getDemoGastos() : ((await getGastos()).data || [])
      const nombreFlota = profile?.nombre_flota || profile?.nombre || 'Flota'
      const resumenCal = buildResumenFromCal(cal, gastos, year, month)

      if (action === 'whatsapp') {
        const text = buildWhatsAppSummary({ resumen: resumenCal, gastos, year, month, nombreFlota })
        const encoded = encodeURIComponent(text)
        window.location.href = `https://wa.me/?text=${encoded}`
        showToast('✓ Abriendo WhatsApp', 'success')
      } else {
        const doc = generateMonthlyPDF({ resumen: resumenCal, gastos, year, month, nombreFlota })
        const filename = `reporte-${MESES[month - 1].toLowerCase()}-${year}.pdf`
        if (action === 'share') {
          const result = await sharePDF(doc, filename, `Reporte ${MESES[month - 1]} ${year}`)
          if (result.downloaded) showToast('✓ PDF descargado', 'success')
          else if (result.shared) showToast('✓ Compartido', 'success')
        } else {
          downloadPDF(doc, filename)
          showToast('✓ PDF descargado', 'success')
        }
      }
    } catch (e) {
      console.error(e)
      showToast('⚠ Error al generar reporte', 'error')
    }
    setCalExporting(false)
  }

  if (authState === 'loading') {
    return (
      <div style={{ background: 'var(--bg)', minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <style>{globalStyles}</style>
        <div className="spinner" />
      </div>
    )
  }

  if (authState === 'auth' || authState === 'auth_chofer') {
    return (
      <div style={{ background: 'var(--bg)', minHeight: '100dvh' }}>
        <style>{globalStyles}</style>
        <AuthScreen
          onEnterDemo={authState === 'auth_chofer' ? null : enterDemoMode}
          showInstall={showInstall}
          onInstall={handleInstall}
          showIosInstall={showIosInstall}
          choferMode={authState === 'auth_chofer'}
        />
        {toast && <div className={`toast show ${toast.type}`}>{toast.msg}</div>}
      </div>
    )
  }

  if (authState === 'chofer') {
    return (
      <div style={{ fontFamily: "'DM Sans', sans-serif", background: 'var(--bg)', color: 'var(--text)', minHeight: '100dvh' }}>
        <style>{globalStyles}</style>
        <ChoferApp
          choferData={myChoferData}
          showToast={showToast}
          onSignOut={async () => { await signOut(); setAuthState('auth'); setMyChoferData(null) }}
          theme={theme}
          toggleTheme={toggleTheme}
        />
        {toast && <div className={`toast show ${toast.type}`}>{toast.msg}</div>}
      </div>
    )
  }

  if (authState === 'onboarding') {
    return (
      <div style={{ background: 'var(--bg)', minHeight: '100dvh' }}>
        <style>{globalStyles}</style>
        <OnboardingScreen
          showToast={showToast}
          onComplete={() => { setAuthState('app') }}
        />
        {toast && <div className={`toast show ${toast.type}`}>{toast.msg}</div>}
      </div>
    )
  }

  const isPro = profile?.plan === 'pro' || profile?.is_admin || isDemoMode

  const navItems = [
    { id: 'resumen',    label: 'Resumen',    icon: <GridIcon /> },
    { id: 'calendario', label: 'Calendario', icon: <CalIcon /> },
    { id: 'flota',      label: 'Flota',      icon: <FleetIcon /> },
    ...(!isDemoMode && profile?.is_admin ? [{ id: 'admin', label: 'Admin', icon: <AdminIcon /> }] : []),
  ]

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", background: 'var(--bg)', color: 'var(--text)', minHeight: '100dvh' }}>
      <style>{globalStyles}</style>
      <div className="app-wrap">

      {isDemoMode && (
        <div style={{ background: '#0B1A3A', borderBottom: '1px solid #1A2B5C', padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: '#3F7DF5', fontWeight: 700, letterSpacing: 1 }}>👁 MODO DEMO — los cambios no se guardan</span>
          <button
            onClick={() => { setIsDemoMode(false); setAuthState('auth'); setResumen(null); setCal(null) }}
            style={{ background: 'none', border: '1px solid #1A2B5C', borderRadius: 8, color: '#3F7DF5', fontSize: 11, fontWeight: 700, padding: '4px 10px', cursor: 'pointer', letterSpacing: 0.5 }}
          >SALIR</button>
        </div>
      )}

      <div className="header">
        <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 26, fontWeight: 800, letterSpacing: -0.5, color: 'var(--text)' }}>
          Flota<span style={{ color: '#3F7DF5' }}>.</span>
        </h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {showInstall && (
            <button className="sync-btn" onClick={handleInstall} title="Instalar app"
              style={{ background: '#0B1A3A', border: '1px solid #1A2B5C', color: '#3F7DF5', fontSize: 11, fontWeight: 700, padding: '0 10px', letterSpacing: 0.5 }}>
              ⬇ Instalar
            </button>
          )}
          {showIosInstall && !showInstall && (
            <IosInstallHint />
          )}
          {/* Notification bell */}
          {notifState !== 'unsupported' && !isDemoMode && (
            <button
              className="sync-btn"
              onClick={notifState === 'granted' ? disableNotifications : enableNotifications}
              title={notifState === 'granted' ? 'Desactivar recordatorios' : 'Activar recordatorios de turnos'}
              style={{ color: notifState === 'granted' ? '#F59E0B' : 'var(--text-faint)' }}
            >
              <svg viewBox="0 0 24 24" fill={notifState === 'granted' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="16" height="16">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                {notifState === 'granted' && <circle cx="18" cy="6" r="4" fill="#10B981" stroke="none"/>}
              </svg>
            </button>
          )}
          {/* Comprobantes semanales */}
          {!isDemoMode && (
            <button
              className="sync-btn"
              onClick={() => setShowWeeklyReport(true)}
              title="Comprobantes de la semana"
              style={{ fontSize: 14 }}
            >📋</button>
          )}
          {/* Theme toggle */}
          <button
            className="sync-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
            style={{ fontSize: 15 }}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          {!isDemoMode && <button className="sync-btn" onClick={loadAll} style={{ fontSize: 15 }}>↻</button>}
          {!isDemoMode && <button className="sync-btn" onClick={async () => { await signOut(); setAuthState('auth') }} title="Cerrar sesión" style={{ fontSize: 15 }}>⏏</button>}
        </div>
      </div>

      <div key={page} className="page-anim">
        {page === 'resumen' && (
          <>
            {/* Tabs Resumen / Análisis */}
            <div style={{ display: 'flex', gap: 6, padding: '12px 16px 0', background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 10 }}>
              {[['resumen','Resumen'],['analisis','Análisis']].map(([id, label]) => (
                <button key={id} onClick={() => setResumenTab(id)} style={{ flex: 1, padding: '9px', background: resumenTab === id ? 'var(--bg-card)' : 'transparent', border: resumenTab === id ? '1px solid #3F7DF533' : '1px solid transparent', borderRadius: 9, color: resumenTab === id ? '#3F7DF5' : 'var(--text-muted)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", transition: 'all 0.2s' }}>
                  {label}
                </button>
              ))}
            </div>
            {resumenTab === 'resumen' && <ResumenPage resumen={resumen} showToast={showToast} onRefresh={loadAll} isDemoMode={isDemoMode} profile={profile} />}
            {resumenTab === 'analisis' && <StatsPage resumen={resumen} cal={cal} calYear={calYear} calMonth={calMonth} showToast={showToast} isDemoMode={isDemoMode} isPro={isPro} onUpgrade={() => setShowUpgradeModal(true)} />}
          </>
        )}
        {page === 'calendario' && <CalendarioPage cal={cal} calYear={calYear} calMonth={calMonth} changeMonth={changeMonth} showToast={showToast} onRefresh={() => { if (!isDemoMode) { loadCal(calYear, calMonth); loadResumen() } }} turnoBase={resumen?.config?.turno_base || TURNO_BASE_DEFAULT} isDemoMode={isDemoMode} onDemoUpdateDay={updateCalDay} onExport={handleCalExport} exporting={calExporting} />}
        {page === 'flota'      && <FlotaPage resumen={resumen} showToast={showToast} onRefresh={loadAll} isDemoMode={isDemoMode} isPro={isPro} onUpgrade={() => setShowUpgradeModal(true)} />}
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
      {showUpgradeModal && (
        <SubscriptionModal
          onClose={() => setShowUpgradeModal(false)}
          onPurchased={async () => {
            setShowUpgradeModal(false)
            // Re-fetch profile para que isPro se actualice
            const prof = await getProfile()
            setProfile(prof)
            showToast('⭐ ¡Bienvenido a Flota Pro!', 'success')
          }}
        />
      )}
      {showWeeklyReport && (
        <WeeklyReportModal
          onClose={() => setShowWeeklyReport(false)}
          showToast={showToast}
          nombreFlota={profile?.nombre || 'Flota'}
        />
      )}
      </div>{/* end app-wrap */}
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
          <div style={{ fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 }}>Plan mensual</div>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 38, fontWeight: 800, color: '#F4F4F8', marginBottom: 4 }}>
            $5.000
          </div>
          <div style={{ fontSize: 13, color: '#888' }}>ARS / mes</div>
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
          style={{ background: 'none', border: 'none', color: '#666', fontSize: 12, cursor: 'pointer', marginBottom: 8, padding: '4px 8px' }}
        >
          Ya pagué — verificar acceso
        </button>
      </div>

      <button
        onClick={onSignOut}
        style={{ background: 'none', border: 'none', color: '#666', fontSize: 12, cursor: 'pointer', textDecoration: 'underline', marginTop: 'auto', paddingTop: 24 }}
      >
        Cerrar sesión
      </button>
    </div>
  )
}

function AuthScreen({ onEnterDemo, showInstall, onInstall, showIosInstall, choferMode = false }) {
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
      {choferMode
        ? <p style={{ color: '#7EB1FF', fontSize: 14, fontWeight: 600, marginBottom: 36, background: '#0B1A3A', border: '1px solid #1A2B5C', borderRadius: 12, padding: '12px 16px' }}>
            🚗 Vas a vincular tu cuenta como <strong>chofer</strong>. Iniciá sesión con la misma cuenta de Google que usás habitualmente.
          </p>
        : <p style={{ color: '#888', fontSize: 13, marginBottom: 36 }}>Gestión de flotas de remises</p>
      }

      {!choferMode && (
        <>
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
        </>
      )}

      {/* Separador */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0' }}>
        <div style={{ flex: 1, height: 1, background: '#1F1F26' }} />
        <span style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1.2 }}>o</span>
        <div style={{ flex: 1, height: 1, background: '#1F1F26' }} />
      </div>

      {/* Botón Google */}
      <button
        disabled={googleLoading}
        onClick={handleGoogle}
        style={{ width: '100%', padding: '13px 16px', background: '#fff', border: '1px solid #2E2E3B', borderRadius: 14, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", color: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: googleLoading ? 0.6 : 1 }}>
        <svg width="18" height="18" viewBox="0 0 48 48">
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.7 2.5 30.2 0 24 0 14.8 0 6.9 5.4 3 13.3l7.8 6C12.7 13.1 17.9 9.5 24 9.5z"/>
          <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 6.9-10 6.9-17z" /><path fill="#FBBC05" d="M10.8 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7L2.5 13.3A23.9 23.9 0 0 0 0 24c0 3.8.9 7.4 2.5 10.6l8.3-5.9z"/>
          <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.5-5.8c-2 1.4-4.6 2.2-7.7 2.2-6.1 0-11.3-3.6-13.2-9.2l-8.3 5.9C6.9 42.6 14.8 48 24 48z"/>
        </svg>
        {googleLoading ? 'Redirigiendo...' : 'Continuar con Google'}
      </button>

      {!choferMode && onEnterDemo && (
        <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid #1F1F26' }}>
          <div style={{ fontSize: 11, color: '#666', textAlign: 'center', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1.2 }}>¿Querés ver cómo funciona?</div>
          <button
            style={{ width: '100%', padding: '14px', background: '#0B1A3A', color: '#3F7DF5', border: '1px solid #1A2B5C', borderRadius: 14, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}
            onClick={onEnterDemo}
          >
            PROBAR DEMO
          </button>
          <div style={{ fontSize: 11, color: '#666', textAlign: 'center', marginTop: 8 }}>
            Sin registro. Solo para explorar la app.
          </div>
        </div>
      )}
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
      <div style={{ color: '#888', fontSize: 14, lineHeight: 1.6, marginBottom: 36 }}>
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
  const [step, setStep] = useState(0) // 0: turno/franco, 1: autos, 2: choferes, 3: listo
  const [animDir, setAnimDir] = useState(1)
  const [animKey, setAnimKey] = useState(0)
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

  const go = (delta) => { setAnimDir(delta); setAnimKey(k => k + 1); setStep(s => s + delta) }

  const next = () => {
    if (step === 0) {
      if (!turnoBase || parseInt(turnoBase) <= 0) return showToast('Ingresá un turno base válido', 'error')
      go(1)
    } else if (step === 1) {
      if (!autos.some(a => a.nombre.trim())) return showToast('Agregá al menos un auto', 'error')
      if (autos.some(a => !a.nombre.trim())) return showToast('Completá el nombre de todos los autos', 'error')
      go(1)
    } else if (step === 2) {
      if (autos.some(a => !a.choferes.some(c => c.trim()))) return showToast('Cada auto necesita al menos un chofer', 'error')
      go(1)
    }
  }

  const submit = async () => {
    setSaving(true)
    const { error } = await createFleet({ turnoBase: parseInt(turnoBase), francoWeekday: parseInt(francoWeekday), autos })
    setSaving(false)
    if (error) return showToast('⚠ ' + error.message, 'error')
    showToast('✓ Flota creada', 'success')
    onComplete()
  }

  const STEPS = ['Configuración', 'Tus autos', 'Choferes', 'Listo']

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#08080A', display: 'flex', flexDirection: 'column', zIndex: 800, fontFamily: "'DM Sans', sans-serif", color: '#F4F4F8' }}>
      {/* Progress */}
      <div style={{ padding: '52px 20px 0' }}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 28 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= step ? '#3F7DF5' : '#1F1F26', transition: 'background 0.4s' }} />
          ))}
        </div>
        <div style={{ fontSize: 10, color: '#3F7DF5', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>
          Paso {step + 1} de {STEPS.length}
        </div>
      </div>

      {/* Contenido animado */}
      <div key={animKey} className={animDir >= 0 ? 'tsr' : 'tsl'} style={{ flex: 1, overflowY: 'auto', padding: '0 20px 24px' }}>

        {/* Paso 0: Turno base + franco */}
        {step === 0 && (
          <>
            <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 28, fontWeight: 800, letterSpacing: -0.5, marginBottom: 6 }}>
              Configurá tu flota
            </h2>
            <p style={{ color: '#888', fontSize: 14, marginBottom: 28, lineHeight: 1.6 }}>
              Estos son los valores por defecto para registrar turnos. Podés cambiarlos después.
            </p>
            <div className="form-label">Valor del turno base ($)</div>
            <div className="form-group">
              <input className="form-input" type="number" inputMode="numeric" placeholder="Ej: 50000"
                value={turnoBase} onChange={e => setTurnoBase(e.target.value)} autoFocus />
              <div style={{ fontSize: 11, color: '#666', marginTop: 6, paddingLeft: 4 }}>El monto que cobra un chofer en un turno completo</div>
            </div>
            <div className="form-label" style={{ marginTop: 20 }}>Día de franco semanal</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {DIAS_CORTOS.map((d, i) => (
                <div key={i} className={`radio-opt ${francoWeekday == i ? 'sel' : ''}`}
                  style={{ flex: 1, padding: '10px 4px', textAlign: 'center' }}
                  onClick={() => setFrancoWeekday(String(i))}>
                  <div className="rl" style={{ fontSize: 12 }}>{d}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Paso 1: Autos */}
        {step === 1 && (
          <>
            <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 28, fontWeight: 800, letterSpacing: -0.5, marginBottom: 6 }}>
              ¿Qué autos tenés?
            </h2>
            <p style={{ color: '#888', fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>
              Podés agregar más autos después. Poné un nombre que los identifique fácil.
            </p>
            {autos.map((auto, ai) => (
              <div key={ai} style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: '#1F1F26', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>🚗</div>
                <input className="form-input" placeholder={`Auto ${ai + 1} (ej: Corsa Blanco)`}
                  value={auto.nombre} onChange={e => setAutoNombre(ai, e.target.value)} style={{ flex: 1 }} />
                {autos.length > 1 && (
                  <button onClick={() => removeAuto(ai)} style={{ width: 32, height: 32, padding: 0, background: '#1a0505', border: '1px solid #3a1010', borderRadius: 10, color: '#ff4545', cursor: 'pointer', fontSize: 14, flexShrink: 0 }}>✕</button>
                )}
              </div>
            ))}
            <button className="action-btn" style={{ width: '100%', marginTop: 6 }} onClick={addAuto}>
              + Agregar otro auto
            </button>
          </>
        )}

        {/* Paso 2: Choferes */}
        {step === 2 && (
          <>
            <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 28, fontWeight: 800, letterSpacing: -0.5, marginBottom: 6 }}>
              ¿Quiénes manejan?
            </h2>
            <p style={{ color: '#888', fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>
              Asigná los choferes a cada auto. Un auto puede tener varios.
            </p>
            {autos.map((auto, ai) => (
              <div key={ai} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#3F7DF5' }}>🚗 {auto.nombre || `Auto ${ai + 1}`}</div>
                </div>
                {auto.choferes.map((c, ci) => (
                  <div key={ci} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <input className="form-input" placeholder={`Nombre del chofer ${ci + 1}`}
                      value={c} onChange={e => setChofer(ai, ci, e.target.value)} style={{ flex: 1 }} />
                    {auto.choferes.length > 1 && (
                      <button onClick={() => removeChofer(ai, ci)} style={{ width: 32, padding: 0, background: '#1a0505', border: '1px solid #3a1010', borderRadius: 10, color: '#ff4545', cursor: 'pointer', fontSize: 14, flexShrink: 0 }}>✕</button>
                    )}
                  </div>
                ))}
                <button onClick={() => addChofer(ai)} style={{ background: 'none', border: 'none', color: '#3F7DF5', fontSize: 13, cursor: 'pointer', padding: '4px 0' }}>
                  + Agregar chofer
                </button>
              </div>
            ))}
          </>
        )}

        {/* Paso 3: Listo */}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', paddingTop: 40 }}>
            <div style={{ fontSize: 64, marginBottom: 24 }}>🎉</div>
            <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 28, fontWeight: 800, letterSpacing: -0.5, marginBottom: 10 }}>
              Todo listo
            </h2>
            <p style={{ color: '#888', fontSize: 14, lineHeight: 1.7, maxWidth: 300, marginBottom: 32 }}>
              Tu flota está configurada con <strong style={{ color: '#F4F4F8' }}>{autos.filter(a => a.nombre.trim()).length} auto{autos.filter(a => a.nombre.trim()).length !== 1 ? 's' : ''}</strong> y sus choferes.
              Podés empezar a registrar turnos desde hoy.
            </p>
            <div style={{ background: '#111', borderRadius: 14, padding: '14px 20px', width: '100%', textAlign: 'left', marginBottom: 8 }}>
              {autos.filter(a => a.nombre.trim()).map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: i < autos.length - 1 ? '1px solid #1F1F26' : 'none' }}>
                  <span style={{ fontSize: 14 }}>🚗</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{a.nombre}</div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>{a.choferes.filter(c => c.trim()).join(' · ')}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer botones */}
      <div style={{ padding: '16px 20px 40px', display: 'flex', gap: 10, background: '#08080A', borderTop: '1px solid #1F1F26' }}>
        {step > 0 && step < 3 && (
          <button className="action-btn" style={{ flex: 1 }} onClick={() => go(-1)}>← Atrás</button>
        )}
        {step < 3 && (
          <button className="btn-primary" style={{ flex: 2, marginTop: 0 }} onClick={next}>
            {step === 2 ? 'Revisar →' : 'Continuar →'}
          </button>
        )}
        {step === 3 && (
          <button className="btn-primary" style={{ marginTop: 0 }} disabled={saving} onClick={submit}>
            {saving ? 'Creando flota...' : 'EMPEZAR A USAR FLOTA →'}
          </button>
        )}
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
                    <span style={{ fontSize: 11, color: '#888' }}>
                      Registro: {new Date(u.created_at).toLocaleDateString('es-AR')}
                    </span>
                    {u.is_admin && <span style={{ fontSize: 10, background: '#1a1a00', color: '#e8ff47', border: '1px solid #3a3a00', borderRadius: 4, padding: '1px 6px' }}>Admin</span>}
                  </div>
                  {dias !== null && (
                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: '#888' }}>Vence:</span>
                      <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700, color: diasColor }}>
                        {expirado ? 'VENCIDO' : `${dias} día${dias !== 1 ? 's' : ''}`}
                      </span>
                      {u.activo_hasta && (
                        <span style={{ fontSize: 10, color: '#888' }}>
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

function ResumenPage({ resumen, showToast, onRefresh, isDemoMode, profile }) {
  const [kmsInputs, setKmsInputs] = useState({})
  const [kmsLoading, setKmsLoading] = useState({})
  if (!resumen) return <SkeletonResumen />

  const nombreFlota = profile?.nombre_flota || profile?.nombre || 'Flota'

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
          <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2, fontFamily: "'DM Mono',monospace" }}>bruto {fmt(totales.semana)}</div>
        </div>
        <div style={{ width: 1, background: 'var(--border-card)', alignSelf: 'stretch', margin: '0 18px' }} />
        <div style={{ flex: 1, textAlign: 'right' }}>
          <div className="total-label">Este mes</div>
          <div className="total-value">{fmt(totales.neto_mes ?? totales.mes)}</div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2, fontFamily: "'DM Mono',monospace" }}>bruto {fmt(totales.mes)}</div>
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
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{choferes.join(' · ')}</span>
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
              <div className="metric"><div className="metric-label">Costo / km</div><div className="metric-value" style={{ color: '#F59E0B' }}>{(adata.kms_actuales - (adata.kms_iniciales || 0)) > 0 ? '$' + ((adata.gastos_total || 0) / (adata.kms_actuales - (adata.kms_iniciales || 0))).toFixed(1) : '—'}</div></div>
              <div className="metric"><div className="metric-label">Margen</div><div className="metric-value" style={{ color: gan.mes > 0 && (gan.neto_mes / gan.mes) >= 0.5 ? '#10B981' : gan.mes > 0 && (gan.neto_mes / gan.mes) >= 0.25 ? '#F59E0B' : '#EF4444' }}>{gan.mes > 0 ? Math.round(gan.neto_mes / gan.mes * 100) + '%' : '—'}</div></div>
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

// ── CHOFER APP ────────────────────────────────────────────────────────────────
function ChoferApp({ choferData, showToast, onSignOut, theme, toggleTheme }) {
  const [calYear, setCalYear] = useState(new Date().getFullYear())
  const [calMonth, setCalMonth] = useState(new Date().getMonth() + 1)
  const [turnos, setTurnos] = useState({}) // fecha → { monto, estado, comprobante_url }
  const [francos, setFrancos] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null) // mensaje de error del RPC
  const [pagarModal, setPagarModal] = useState(null) // fecha seleccionada
  const [compImg, setCompImg] = useState(null)  // File seleccionado para comprobante
  const [saving, setSaving] = useState(false)
  const compInputRef = useRef(null)
  const [visorUrl, setVisorUrl] = useState(null) // URL del comprobante a ver
  const [montoInput, setMontoInput] = useState('') // monto editable (puede venir del OCR)
  const [ocrProgress, setOcrProgress] = useState(null) // null | 0-100
  const [ocrDetected, setOcrDetected] = useState(false) // si el OCR encontró monto
  const [ocrSuspect, setOcrSuspect] = useState(false)  // monto detectado parece incorrecto

  const hoy = today()
  const curMonthStr = `${calYear}-${String(calMonth).padStart(2, '0')}`
  const francoWeekday = choferData?.franco_weekday ?? 1

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setLoadError(null)
    const [turnosRes, francosRes] = await Promise.all([
      getMisTurnos(calYear, calMonth),
      getMisFrancos(calYear, calMonth),
    ])
    if (turnosRes.error) {
      // Mostrar el error real para poder diagnosticar (ej: columna faltante, migración pendiente)
      setLoadError(turnosRes.error.message || 'Error al cargar turnos')
      console.error('get_mis_turnos error:', turnosRes.error)
    } else if (turnosRes.data) {
      const tMap = {}
      for (const t of turnosRes.data) tMap[t.fecha] = t
      setTurnos(tMap)
    }
    if (!francosRes.error && francosRes.data) {
      setFrancos(new Set(francosRes.data.map(f => f.fecha)))
    }
    setLoading(false)
  }, [calYear, calMonth])

  // Carga inicial
  useEffect(() => { loadData() }, [loadData])

  // Auto-refresh cuando la app vuelve al primer plano (el dueño puede haber marcado días)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadData(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [loadData])

  // Resetear monto al abrir el modal
  useEffect(() => {
    if (pagarModal) {
      setMontoInput(String(choferData?.turno_base || 50000))
      setOcrDetected(false)
      setOcrSuspect(false)
      setOcrProgress(null)
      setCompImg(null)
    }
  }, [pagarModal])

  // OCR automático cuando el chofer elige la imagen
  useEffect(() => {
    if (!compImg) { setOcrProgress(null); return }
    setOcrProgress(0)
    setOcrDetected(false)
    setOcrSuspect(false)
    const turnoBase = choferData?.turno_base || 50000
    import('./ocr').then(({ scanReceipt }) => {
      scanReceipt(compImg, p => setOcrProgress(p))
        .then(res => {
          setOcrProgress(null)
          if (res.monto && res.monto > 100) {
            setMontoInput(String(Math.round(res.monto)))
            setOcrDetected(true)
            // Sospechoso si es menos del 30% del turno base
            setOcrSuspect(res.monto < turnoBase * 0.3)
          }
        })
        .catch(() => setOcrProgress(null))
    })
  }, [compImg])

  const handlePagar = async () => {
    if (!compImg) return showToast('Adjuntá el comprobante', 'error')
    setSaving(true)
    const { url, error: upErr } = await uploadComprobante(choferData.chofer_id, pagarModal, compImg)
    if (upErr) { setSaving(false); return showToast('⚠ ' + (upErr.message || 'Error al subir comprobante'), 'error') }
    const monto = parseInt(montoInput, 10) || choferData?.turno_base || 50000
    const { data, error: tErr } = await choferMarcarTurno(pagarModal, monto, url)
    setSaving(false)
    if (tErr || data?.error) return showToast('⚠ ' + (data?.error || tErr?.message), 'error')
    showToast('✓ Turno registrado', 'success')
    // Actualización optimista: el día se pone verde de inmediato sin esperar loadData
    const turnoBase = choferData?.turno_base || 50000
    const estadoLocal = monto >= turnoBase ? 'completo' : 'parcial'
    setTurnos(prev => ({
      ...prev,
      [pagarModal]: { fecha: pagarModal, monto, estado: estadoLocal, comprobante_url: url, marcado_por: 'chofer' },
    }))
    setPagarModal(null)
    setCompImg(null)
    loadData(true) // recarga silenciosa — sin spinner, sin borrar estado si falla
  }

  const changeMonth = (delta) => {
    let m = calMonth + delta, y = calYear
    if (m > 12) { m = 1; y++ }
    if (m < 1)  { m = 12; y-- }
    setCalMonth(m); setCalYear(y)
  }

  const daysInMonth = new Date(calYear, calMonth, 0).getDate()
  let firstDow = new Date(calYear, calMonth - 1, 1).getDay()
  firstDow = (firstDow + 6) % 7
  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  // Totales del mes
  let brutoMes = 0, diasPendientes = 0, totalDeuda = 0
  const turnoBase = choferData?.turno_base || 50000
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${calYear}-${String(calMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    if (ds > hoy) continue
    const dowLunes = (new Date(calYear, calMonth - 1, d).getDay() + 6) % 7
    if (dowLunes === francoWeekday || francos.has(ds)) continue
    const t = turnos[ds]
    const monto = parseFloat(t?.monto) || 0
    if (monto) brutoMes += monto
    else diasPendientes++
    const diff = turnoBase - monto
    if (diff > 0) totalDeuda += diff
  }

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)' }}>
      {/* Header */}
      <div className="header">
        <div>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, letterSpacing: -0.5 }}>
            Flota<span style={{ color: '#3F7DF5' }}>.</span>
          </h1>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
            {choferData?.nombre} · {choferData?.auto_nombre}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="sync-btn" onClick={() => loadData()} title="Actualizar" style={{ fontSize: 16 }}>↻</button>
          <button className="sync-btn" onClick={toggleTheme} title="Cambiar tema">{theme === 'dark' ? '☀' : '🌙'}</button>
          <button className="sync-btn" onClick={onSignOut} title="Cerrar sesión" style={{ fontSize: 12 }}>↩</button>
        </div>
      </div>

      <div className="page-cal">
        {/* Banner resumen del mes */}
        <div className="total-banner" style={{ marginTop: 16 }}>
          <div style={{ flex: 1 }}>
            <div className="total-label" style={{ color: totalDeuda > 0 ? '#EF4444' : 'var(--text-sub)' }}>Deuda del mes</div>
            <div className="total-value" style={{ color: totalDeuda > 0 ? '#EF4444' : '#10B981' }}>
              {totalDeuda > 0 ? fmt(totalDeuda) : '✓ Sin deuda'}
            </div>
          </div>
          <div style={{ width: 1, background: 'var(--border-card)', alignSelf: 'stretch', margin: '0 18px' }} />
          <div style={{ flex: 1, textAlign: 'right' }}>
            <div className="total-label" style={{ color: diasPendientes > 0 ? '#EF4444' : 'var(--text-sub)' }}>Sin comprobante</div>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 18, fontWeight: 600, color: diasPendientes > 0 ? '#EF4444' : '#10B981' }}>
              {diasPendientes > 0 ? `${diasPendientes} días` : '✓ Al día'}
            </div>
          </div>
        </div>

        {/* Navegación de mes */}
        <div className="cal-nav">
          <button className="cal-nav-btn" onClick={() => changeMonth(-1)}>‹</button>
          <span className="cal-month-label">{MESES[calMonth - 1]} {calYear}</span>
          <button className="cal-nav-btn" onClick={() => changeMonth(1)}>›</button>
        </div>

        {/* Leyenda */}
        <div className="cal-legend">
          {[['#10B981','Completo'],['#F59E0B','Parcial'],['#EF4444','Pendiente'],['#60A5FA','Franco']].map(([c,l]) => (
            <div key={l} className="leg-item"><div className="leg-dot" style={{ background: c }} />{l}</div>
          ))}
        </div>

        {/* Error banner — muestra el mensaje real del RPC si falla */}
        {!loading && loadError && (
          <div className="alert-banner alert-error" style={{ marginBottom: 10 }}>
            <span>⚠</span>
            <div>
              <div style={{ fontWeight: 600 }}>No se pudieron cargar los turnos</div>
              <div style={{ fontSize: 11, opacity: 0.85 }}>{loadError}</div>
            </div>
            <button
              onClick={() => loadData()}
              style={{ marginLeft: 'auto', background: 'none', border: '1px solid #EF4444', borderRadius: 6, color: '#EF4444', padding: '3px 10px', cursor: 'pointer', fontSize: 12 }}
            >Reintentar</button>
          </div>
        )}

        {loading
          ? <div className="loading"><div className="spinner" /></div>
          : (
          <table className="cal-table">
            <thead><tr>{DIAS_CORTOS.map(d => <th key={d} className="cal-th">{d}</th>)}</tr></thead>
            <tbody>
              {chunk(cells, 7).map((week, wi) => (
                <tr key={wi}>
                  {week.map((day, di) => {
                    if (!day) return <td key={di} className="cal-td empty"><div className="day-cell-empty" /></td>
                    const ds = `${calYear}-${padZ(calMonth)}-${padZ(day)}`
                    const dowLunes = (new Date(calYear, calMonth - 1, day).getDay() + 6) % 7
                    const esFranco = dowLunes === francoWeekday || francos.has(ds)
                    const esFuturo = ds > hoy
                    const t = turnos[ds]
                    const esCompleto = t?.estado === 'completo'
                    const esParcial  = t?.estado === 'parcial'
                    const esPagado   = esCompleto || esParcial
                    const tieneComp  = !!t?.comprobante_url

                    let bgColor, textColor, borderColor
                    if (esFranco)        { bgColor = '#08111F'; textColor = '#60A5FA'; borderColor = '#0F2040' }
                    else if (esFuturo)   { bgColor = 'var(--bg-dark)'; textColor = 'var(--text-dim)'; borderColor = 'transparent' }
                    else if (esCompleto) { bgColor = '#0A1A10'; textColor = '#10B981'; borderColor = '#0F3020' }
                    else if (esParcial)  { bgColor = '#1A1200'; textColor = '#F59E0B'; borderColor = '#3A2800' }
                    else                 { bgColor = '#1A0808'; textColor = '#EF4444'; borderColor = '#3A1515' }

                    const clickable = !esFranco && !esFuturo && !esPagado
                    const verComp = tieneComp

                    return (
                      <td key={di} className="cal-td" onClick={() => {
                        if (verComp) setVisorUrl(t.comprobante_url)
                        else if (clickable) setPagarModal(ds)
                      }}>
                        <div style={{ borderRadius: 8, background: bgColor, border: `1px solid ${borderColor}`, padding: '4px 2px 3px', minHeight: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, opacity: esFuturo ? 0.3 : 1, cursor: clickable || verComp ? 'pointer' : 'default' }}>
                          <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 600, color: textColor, lineHeight: 1 }}>{day}</span>
                          <span style={{ fontSize: 8, fontWeight: 700, color: textColor, textAlign: 'center', lineHeight: 1.3 }}>
                            {esFranco ? 'F' : esFuturo ? '' : esPagado ? (tieneComp ? '📎✓' : '✓') : '!'}
                          </span>
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Instrucción */}
        {!loading && diasPendientes > 0 && (
          <div className="alert-banner alert-warn" style={{ marginTop: 16 }}>
            <span>📎</span>
            <span>Tocá un día en rojo para subir el comprobante de pago</span>
          </div>
        )}
      </div>

      {/* Modal para pagar un turno */}
      {pagarModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setPagarModal(null)}>
          <div className="modal-sheet">
            <div className="modal-date">REGISTRAR PAGO</div>
            <div className="modal-title">{pagarModal.split('-').reverse().join('/')}</div>

            {/* Comprobante primero — el OCR llena el monto */}
            <div className="stitle">Comprobante de transferencia</div>
            <input
              ref={compInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={e => setCompImg(e.target.files?.[0] || null)}
            />
            {compImg ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'var(--bg-inner)', borderRadius: 12, marginBottom: 10, border: `1px solid ${ocrProgress !== null ? '#F59E0B' : '#10B981'}` }}>
                <span style={{ fontSize: 20 }}>{ocrProgress !== null ? '🔍' : '📎'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {ocrProgress !== null ? (
                    <>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#F59E0B' }}>Leyendo monto… {ocrProgress}%</div>
                      <div style={{ marginTop: 5, height: 4, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${ocrProgress}%`, background: '#F59E0B', borderRadius: 4, transition: 'width 0.3s' }} />
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#10B981' }}>
                        Comprobante listo {ocrDetected && <span style={{ fontSize: 11, background: '#10B98122', border: '1px solid #10B98144', borderRadius: 6, padding: '1px 6px', marginLeft: 4 }}>🤖 monto leído</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{compImg.name}</div>
                    </>
                  )}
                </div>
                <button onClick={() => { setCompImg(null); setOcrDetected(false) }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}>✕</button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => compInputRef.current?.click()}
                style={{ width: '100%', padding: '14px', background: 'var(--bg-inner)', border: '2px dashed var(--border-card)', borderRadius: 12, color: 'var(--text-muted)', fontSize: 14, cursor: 'pointer', marginBottom: 10, fontFamily: "'DM Sans',sans-serif" }}
              >
                📷 Adjuntar foto del comprobante
              </button>
            )}

            {/* Monto — editable, pre-llenado por OCR si lo detectó */}
            <div className="stitle" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Monto</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>Verificá antes de confirmar</span>
            </div>
            {ocrSuspect && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: '#2D1500', border: '1px solid #F59E0B55', borderRadius: 10, marginBottom: 8, fontSize: 12, color: '#F59E0B' }}>
                ⚠ El OCR leyó un monto bajo — revisá que sea correcto
              </div>
            )}
            <div style={{ position: 'relative', marginBottom: 14 }}>
              <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 16, fontWeight: 700, color: 'var(--text-muted)', pointerEvents: 'none' }}>$</span>
              <input
                type="number"
                inputMode="numeric"
                value={montoInput}
                onChange={e => { setMontoInput(e.target.value); setOcrDetected(false); setOcrSuspect(false) }}
                style={{ width: '100%', padding: '12px 14px 12px 28px', background: 'var(--bg-inner)', border: `1px solid ${ocrSuspect ? '#F59E0B88' : ocrDetected ? '#10B98166' : 'var(--border-card)'}`, borderRadius: 12, fontSize: 20, fontWeight: 700, color: 'var(--text)', fontFamily: "'DM Mono',monospace", boxSizing: 'border-box' }}
              />
            </div>

            <button className="btn-primary" disabled={saving || !compImg || ocrProgress !== null} onClick={handlePagar} style={{ marginTop: 4 }}>
              {saving ? 'Enviando...' : '✓ CONFIRMAR PAGO'}
            </button>
            <button className="modal-close" onClick={() => { setPagarModal(null); setCompImg(null) }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Visor de comprobante */}
      {visorUrl && (
        <div className="modal-overlay" onClick={() => setVisorUrl(null)}>
          <div className="modal-sheet" style={{ textAlign: 'center' }}>
            <div className="modal-title">Comprobante</div>
            <img src={visorUrl} alt="Comprobante" style={{ width: '100%', borderRadius: 12, marginBottom: 16, maxHeight: '60vh', objectFit: 'contain' }} />
            <button className="modal-close" onClick={() => setVisorUrl(null)}>Cerrar</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── CHOFER LINK MODAL (para el dueño — genera QR de vinculación) ──────────────
function ChoferLinkModal({ chofer, isDemoMode, showToast, onClose }) {
  const [linkUrl, setLinkUrl] = useState(null)
  const [qrDataUrl, setQrDataUrl] = useState(null)
  const [loading, setLoading] = useState(false)
  const [vinculado, setVinculado] = useState(!!chofer.chofer_user_id)

  const generateLink = async () => {
    if (isDemoMode) return showToast('👁 No disponible en demo', '')
    setLoading(true)
    const { url, error } = await generateChoferLink(chofer.id)
    setLoading(false)
    if (error) return showToast('⚠ ' + error.message, 'error')
    setLinkUrl(url)
    // Generar QR dinámicamente
    try {
      const QRCode = (await import('qrcode')).default
      const dataUrl = await QRCode.toDataURL(url, { width: 220, margin: 2, color: { dark: '#0F0F14', light: '#FFFFFF' } })
      setQrDataUrl(dataUrl)
    } catch (e) {
      console.error('QR gen error', e)
    }
  }

  const handleShare = () => {
    const text = `Hola ${chofer.nombre} 👋\nVinculá tu cuenta a Flota para registrar tus turnos:\n${linkUrl}`
    const encoded = encodeURIComponent(text)
    window.open(`https://wa.me/?text=${encoded}`, '_blank', 'noopener,noreferrer')
  }

  const handleCopy = () => {
    if (!linkUrl) return
    navigator.clipboard.writeText(linkUrl).then(() => showToast('✓ Link copiado', 'success'))
  }

  const handleDesvincular = async () => {
    if (isDemoMode) return showToast('👁 No disponible en demo', '')
    const { error } = await desvincularChofer(chofer.id)
    if (error) return showToast('⚠ ' + error.message, 'error')
    setVinculado(false)
    showToast('✓ Chofer desvinculado', 'success')
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet">
        <div className="modal-date">ACCESO CHOFER</div>
        <div className="modal-title">{chofer.nombre}</div>

        {vinculado ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: '#0A1A10', border: '1px solid #0F3020', borderRadius: 14, marginBottom: 16 }}>
              <span style={{ fontSize: 20 }}>✅</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#10B981' }}>Cuenta vinculada</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Este chofer puede subir sus comprobantes</div>
              </div>
            </div>
            <button className="action-btn ab-quitar" style={{ width: '100%' }} onClick={handleDesvincular}>
              Desvincular cuenta
            </button>
          </>
        ) : linkUrl ? (
          <>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              {qrDataUrl
                ? <img src={qrDataUrl} alt="QR" style={{ width: 220, height: 220, borderRadius: 12, border: '1px solid var(--border-card)' }} />
                : <div style={{ width: 220, height: 220, background: 'var(--bg-inner)', borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Generando QR...</div>
              }
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 16, wordBreak: 'break-all' }}>
              Expira en 48 horas
            </div>
            <button
              onClick={handleShare}
              style={{ width: '100%', padding: '14px', background: '#075E54', color: '#fff', border: 'none', borderRadius: 14, fontFamily: "'DM Sans',sans-serif", fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
              💬 Enviar por WhatsApp
            </button>
            <button className="action-btn" style={{ width: '100%', marginBottom: 8 }} onClick={handleCopy}>
              📋 Copiar link
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 14, color: 'var(--text-sub)', marginBottom: 20, lineHeight: 1.6 }}>
              Generá un link único para que {chofer.nombre} lo abra en su celular e inicie sesión con su cuenta de Google.
            </div>
            <button className="btn-primary" disabled={loading} onClick={generateLink}>
              {loading ? 'Generando...' : '🔗 Generar link de vinculación'}
            </button>
          </>
        )}

        <button className="modal-close" onClick={onClose}>Cerrar</button>
      </div>
    </div>
  )
}

// ── CALENDARIO PAGE ───────────────────────────────────────────────────────────
function CalendarioPage({ cal, calYear, calMonth, changeMonth, showToast, onRefresh, turnoBase, isDemoMode, onDemoUpdateDay, onExport, exporting }) {
  const [dayModal, setDayModal] = useState(null)
  const [filterAuto, setFilterAuto] = useState(null)
  const [exportMenu, setExportMenu] = useState(false)
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
    <div className="page page-cal">
      {/* position:relative + paddingRight fija el botón export a la derecha sin moverse */}
      <div className="cal-nav" style={{ position: 'relative', paddingRight: 108 }}>
        <button className="cal-nav-btn" onClick={() => changeMonth(-1)}>‹</button>
        <span className="cal-month-label">{MESES[calMonth - 1]} {calYear}</span>
        <button className="cal-nav-btn" onClick={() => changeMonth(1)}>›</button>
        {/* Export dropdown — absolutamente posicionado, no participa en el flex */}
        <div style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)' }}>
          <button
            onClick={() => setExportMenu(v => !v)}
            disabled={exporting}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 12px',
              background: exportMenu ? 'var(--bg-card)' : 'var(--bg-inner)',
              border: '1px solid var(--border-card)',
              borderRadius: 20,
              color: 'var(--text-sub)',
              fontSize: 12, fontWeight: 600,
              cursor: 'pointer',
              fontFamily: "'DM Sans',sans-serif",
              opacity: exporting ? 0.5 : 1,
              transition: 'background 0.15s',
              letterSpacing: 0.2,
            }}
          >
            {exporting
              ? <><span style={{ fontSize: 11 }}>⏳</span> Generando…</>
              : <><span style={{ fontSize: 13 }}>↗</span> Exportar</>}
          </button>
          {exportMenu && (
            <>
              <div onClick={() => setExportMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
              <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 14, padding: '6px 4px', minWidth: 220, boxShadow: '0 12px 32px rgba(0,0,0,0.3)', zIndex: 20 }}>
                {/* header del menú */}
                <div style={{ padding: '6px 12px 8px', fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', letterSpacing: 1, textTransform: 'uppercase' }}>
                  {MESES[calMonth - 1]} {calYear}
                </div>
                {[
                  { action: 'download', icon: '📄', label: 'Descargar PDF' },
                  { action: 'share',    icon: '📤', label: 'Compartir PDF' },
                  { action: 'whatsapp', icon: '💬', label: 'Enviar por WhatsApp' },
                ].map(({ action, icon, label }) => (
                  <button
                    key={action}
                    onClick={() => { setExportMenu(false); onExport(action, calYear, calMonth) }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', borderRadius: 10, color: 'var(--text)', fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-inner)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ fontSize: 17, lineHeight: 1 }}>{icon}</span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="cal-legend">
        {[['#10B981','Completo'],['#F59E0B','Parcial'],['#EF4444','Debe'],['#60A5FA','Franco']].map(([bg,lbl]) => (
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
  const [compVisor, setCompVisor] = useState(null) // URL del comprobante a ver en fullscreen

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
                  {monto ? (
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                      Pagó: {fmt(monto)}{info.marcado_por === 'chofer' ? <span style={{ marginLeft: 6, fontSize: 10, background: '#3F7DF511', border: '1px solid #3F7DF533', borderRadius: 5, padding: '1px 5px', color: '#3F7DF5' }}>chofer</span> : null}
                    </div>
                  ) : null}
                  {info.comprobante_url ? (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>Comprobante</div>
                      <div
                        onClick={() => setCompVisor(info.comprobante_url)}
                        style={{ cursor: 'pointer', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', display: 'inline-block', position: 'relative' }}
                      >
                        <img
                          src={info.comprobante_url}
                          alt="comprobante"
                          style={{ width: '100%', maxHeight: 140, objectFit: 'cover', display: 'block' }}
                        />
                        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.2s' }}
                          onMouseEnter={e => e.currentTarget.style.opacity = 1}
                          onMouseLeave={e => e.currentTarget.style.opacity = 0}
                        >
                          <span style={{ color: '#fff', fontSize: 22 }}>🔍</span>
                        </div>
                      </div>
                    </div>
                  ) : null}
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

      {/* Visor fullscreen del comprobante */}
      {compVisor && (
        <div
          onClick={() => setCompVisor(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.92)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <img
            src={compVisor}
            alt="Comprobante"
            style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 12, objectFit: 'contain', boxShadow: '0 8px 40px #000a' }}
            onClick={e => e.stopPropagation()}
          />
          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <a
              href={compVisor}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ padding: '10px 20px', background: '#3F7DF5', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}
            >
              ↗ Abrir original
            </a>
            <button
              onClick={() => setCompVisor(null)}
              style={{ padding: '10px 20px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── GASTO CATEGORY ICONS ──────────────────────────────────────────────────────
const GASTO_CATS = {
  mantenimiento: { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>, color: '#F59E0B', bg: '#1A1200' },
  combustible:   { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 22V8l7-6 7 6v14"/><path d="M14 22v-4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v4"/><path d="M18 9.5V6a2 2 0 0 0-2-2"/><path d="M20 14v3a2 2 0 0 1-2 2h0"/><path d="M18 5h2a1 1 0 0 1 1 1v4"/></svg>, color: '#3F7DF5', bg: '#0B1530' },
  seguro:        { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>, color: '#10B981', bg: '#071A0F' },
  impuesto:      { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>, color: '#8B5CF6', bg: '#130B2A' },
  multa:         { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>, color: '#EF4444', bg: '#1A0808' },
  otro:          { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>, color: '#888', bg: '#1A1A22' },
}

// ── GASTOS PAGE ───────────────────────────────────────────────────────────────
function GastosPage({ resumen, showToast, onRefresh, isDemoMode, embedded }) {
  const [tab, setTab] = useState('lista')
  const [gastos, setGastos] = useState([])
  const [loadingG, setLoadingG] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null) // id del gasto a confirmar
  const [ocrProgress, setOcrProgress] = useState(null) // null | 0..100
  const ocrInputRef = useRef(null)
  const autos = resumen?.config?.autos || []
  const [form, setForm] = useState({ auto_id: '', descripcion: '', monto: '', categoria: 'mantenimiento', fecha: today() })

  const handleScanReceipt = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setOcrProgress(0)
    try {
      const { scanReceipt } = await import('./ocr')
      const res = await scanReceipt(file, (pct) => setOcrProgress(pct))
      setOcrProgress(null)
      // Autollenar el form con lo que se pudo extraer
      setForm(f => ({
        ...f,
        descripcion: res.descripcion || f.descripcion,
        monto: res.monto ? String(res.monto) : f.monto,
        categoria: res.categoria !== 'otro' ? res.categoria : f.categoria,
        fecha: res.fecha || f.fecha,
      }))
      const extracted = []
      if (res.monto) extracted.push(`monto ${fmt(res.monto)}`)
      if (res.fecha) extracted.push('fecha')
      if (res.categoria && res.categoria !== 'otro') extracted.push(`categoría: ${res.categoria}`)
      showToast(extracted.length > 0 ? `✓ Detectado: ${extracted.join(', ')}` : '⚠ No se detectaron datos, completá manualmente', extracted.length > 0 ? 'success' : 'error')
    } catch (err) {
      console.error(err)
      setOcrProgress(null)
      showToast('⚠ Error al leer el recibo', 'error')
    }
    // Reset input para permitir re-subir la misma foto
    if (ocrInputRef.current) ocrInputRef.current.value = ''
  }

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
    <div className={embedded ? '' : 'page'}>
      <div className="tabs">
        <button className={`tab ${tab === 'lista' ? 'active' : ''}`} onClick={() => setTab('lista')}>Ver gastos</button>
        <button className={`tab ${tab === 'nuevo' ? 'active' : ''}`} onClick={() => setTab('nuevo')}>+ Agregar</button>
      </div>

      {tab === 'lista' && (
        loadingG ? <div className="loading"><div className="spinner" /></div> :
        gastos.length === 0 ? <div className="loading">Sin gastos registrados</div> :
        gastos.map(g => {
          const cat = GASTO_CATS[g.categoria] || GASTO_CATS.otro
          return (
            <div key={g.id} className="gasto-item">
              {/* Icono de categoría */}
              <div style={{ width: 38, height: 38, borderRadius: 10, background: `${cat.color}22`, border: `1px solid ${cat.color}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginRight: 12, color: cat.color }}>
                <div style={{ width: 18, height: 18 }}>{cat.icon}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="gasto-desc">{g.descripcion}</div>
                <div className="gasto-auto">
                  {g.autos?.nombre} · {g.fecha}
                  <span style={{ color: cat.color, fontWeight: 600, marginLeft: 4 }}>· {g.categoria}</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <div className="gasto-monto">{fmt(parseFloat(g.monto))}</div>
                <button className="gasto-del-btn" disabled={deletingId === g.id}
                  onClick={() => setDeleteConfirm(g.id)}>
                  {deletingId === g.id ? '...' : '✕'}
                </button>
              </div>
            </div>
          )
        })
      )}

      {tab === 'nuevo' && (
        <>
          {/* Escanear recibo con OCR */}
          <input ref={ocrInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleScanReceipt} />
          <button
            type="button"
            disabled={ocrProgress !== null}
            onClick={() => ocrInputRef.current?.click()}
            style={{
              width: '100%',
              padding: '14px',
              background: ocrProgress !== null ? 'var(--bg-inner)' : 'linear-gradient(135deg, #3F7DF5 0%, #6366F1 100%)',
              color: '#fff',
              border: 'none',
              borderRadius: 14,
              fontFamily: "'DM Sans',sans-serif",
              fontSize: 14,
              fontWeight: 700,
              cursor: ocrProgress !== null ? 'wait' : 'pointer',
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {ocrProgress !== null
              ? `⏳ Procesando... ${ocrProgress}%`
              : '📷 Escanear recibo (auto-llenar)'}
          </button>

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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
            {categorias.map(c => {
              const cat = GASTO_CATS[c] || GASTO_CATS.otro
              const sel = form.categoria === c
              return (
                <button key={c} type="button" onClick={() => setForm(f => ({ ...f, categoria: c }))}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '12px 8px', borderRadius: 12, border: `1px solid ${sel ? cat.color : 'var(--border)'}`, background: sel ? `${cat.color}22` : 'var(--bg-dark)', cursor: 'pointer', transition: 'all 0.15s' }}>
                  <div style={{ width: 22, height: 22, color: cat.color }}>{cat.icon}</div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: sel ? cat.color : 'var(--text-muted)', letterSpacing: 0.3 }}>{c.charAt(0).toUpperCase() + c.slice(1)}</span>
                </button>
              )
            })}
          </div>
          <div className="stitle">Fecha</div>
          <div className="form-group">
            <input className="form-input" type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
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
function FlotaPage({ resumen, showToast, onRefresh, isDemoMode, isPro, onUpgrade }) {
  const [tab, setTab] = useState('gastos')
  return (
    <div className="page">
      <div className="tabs">
        <button className={`tab ${tab === 'gastos' ? 'active' : ''}`} onClick={() => setTab('gastos')}>Gastos</button>
        <button className={`tab ${tab === 'deudas' ? 'active' : ''}`} onClick={() => setTab('deudas')}>Deudas</button>
        <button className={`tab ${tab === 'mant' ? 'active' : ''}`} onClick={() => setTab('mant')}>Mantenimiento</button>
        <button className={`tab ${tab === 'autos' ? 'active' : ''}`} onClick={() => setTab('autos')}>Autos</button>
      </div>
      {tab === 'gastos'  && <GastosPage resumen={resumen} showToast={showToast} onRefresh={onRefresh} isDemoMode={isDemoMode} embedded />}
      {tab === 'deudas'  && <DeudasTab resumen={resumen} showToast={showToast} isDemoMode={isDemoMode} />}
      {tab === 'mant'    && <MantItemsTab resumen={resumen} showToast={showToast} onRefresh={onRefresh} isDemoMode={isDemoMode} />}
      {tab === 'autos'   && <AutosTab resumen={resumen} showToast={showToast} onRefresh={onRefresh} isDemoMode={isDemoMode} isPro={isPro} onUpgrade={onUpgrade} />}
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
                  {d.choferes?.autos?.nombre && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.choferes.autos.nombre}</span>}
                  {d.saldado && <span style={{ fontSize: 10, color: '#10B981', fontWeight: 700, letterSpacing: 0.5 }}>SALDADO</span>}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{d.descripcion}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.fecha}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 16, fontWeight: 700, color: d.saldado ? 'var(--text-dim)' : '#EF4444', marginBottom: 8 }}>
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

function AutosTab({ resumen, showToast, onRefresh, isDemoMode, isPro, onUpgrade }) {
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
  const [linkModal, setLinkModal] = useState(null) // chofer completo para modal de vinculación
  const [vencimientos, setVencimientos] = useState({}) // autoId -> {vtv, seguro}
  const [savingVenc, setSavingVenc] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null) // { id, nombre }
  const [deletingAuto, setDeletingAuto] = useState(false)
  const [deleteChoferConfirm, setDeleteChoferConfirm] = useState(null) // { id, nombre, vinculado }
  const [deletingChofer, setDeletingChofer] = useState(false)

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
    // Plan free: máximo 1 auto
    const autosActuales = resumen?.config?.autos || []
    if (!isPro && autosActuales.length >= 1) { onUpgrade?.(); return }
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

  const handleDeleteChoferConfirmed = async () => {
    if (isDemoMode) { setDeleteChoferConfirm(null); return showToast('👁 Modo demo', 'info') }
    if (!deleteChoferConfirm) return
    setDeletingChofer(true)
    const { error } = await deleteChofer(deleteChoferConfirm.id)
    setDeletingChofer(false)
    setDeleteChoferConfirm(null)
    if (error) return showToast('⚠ ' + error.message, 'error')
    showToast('✓ Chofer eliminado', 'success')
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
      {deleteChoferConfirm && (
        <ConfirmModal
          title={`Eliminar a ${deleteChoferConfirm.nombre}`}
          message={deleteChoferConfirm.vinculado
            ? 'Este chofer tiene una cuenta vinculada. Se eliminará el chofer y se desvinculará su acceso. Sus turnos históricos quedarán registrados.'
            : 'Se eliminará el chofer. Sus turnos históricos quedarán registrados. Esta acción no se puede deshacer.'}
          onConfirm={handleDeleteChoferConfirmed}
          onCancel={() => setDeleteChoferConfirm(null)}
          loading={deletingChofer}
        />
      )}
      {linkModal && (
        <ChoferLinkModal
          chofer={linkModal}
          isDemoMode={isDemoMode}
          showToast={showToast}
          onClose={() => setLinkModal(null)}
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
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 16, cursor: 'pointer', padding: '4px 8px', lineHeight: 1 }}
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
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>VTV vence</div>
                <input className="form-input" type="date" style={{ fontSize: 13, padding: '10px 12px' }}
                  value={vencimientos[auto.id]?.vtv ?? (auto.vtv_vence || '')}
                  onChange={e => setVencimientos(p => ({ ...p, [auto.id]: { ...p[auto.id], vtv: e.target.value } }))}
                />
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Seguro vence</div>
                <input className="form-input" type="date" style={{ fontSize: 13, padding: '10px 12px' }}
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
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--bg-inner)', borderRadius: 10, marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 14, color: 'var(--text)' }}>{c.nombre}</span>
                    {c.chofer_user_id
                      ? <span title="Cuenta vinculada" style={{ fontSize: 10, background: '#0A1A10', color: '#10B981', border: '1px solid #0F3020', borderRadius: 100, padding: '2px 6px', fontWeight: 700, whiteSpace: 'nowrap' }}>✓ vinculado</span>
                      : null
                    }
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button
                      title={c.chofer_user_id ? 'Gestionar acceso' : 'Vincular chofer'}
                      style={{ width: 30, height: 30, border: `1px solid ${c.chofer_user_id ? '#0F3020' : 'var(--border)'}`, background: c.chofer_user_id ? '#0A1A10' : 'var(--bg-input)', color: c.chofer_user_id ? '#10B981' : 'var(--text-sub)', borderRadius: 8, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      onClick={() => setLinkModal(c)}
                    >
                      🔗
                    </button>
                    <button className="gasto-del-btn" style={{ color: 'var(--text-sub)', background: 'var(--bg-input)', borderColor: 'var(--border)' }}
                      onClick={() => { setEditingChoferId(c.id); setEditChoferNombre(c.nombre) }}>
                      ✎
                    </button>
                    <button className="gasto-del-btn"
                      title="Eliminar chofer"
                      onClick={() => setDeleteChoferConfirm({ id: c.id, nombre: c.nombre, vinculado: !!c.chofer_user_id })}>
                      🗑
                    </button>
                  </div>
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
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', padding: '6px 0', marginTop: 2 }}>
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
        <>
          <button className="action-btn" style={{ width: '100%', marginTop: 4 }}
            onClick={() => { if (!isPro && (resumen?.config?.autos || []).length >= 1) { onUpgrade?.() } else { setShowNewAuto(true) } }}>
            + Agregar auto a la flota
          </button>
          {!isPro && (resumen?.config?.autos || []).length >= 1 && (
            <div style={{ textAlign: 'center', marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
              Plan free: 1 auto. <button onClick={onUpgrade} style={{ background: 'none', border: 'none', color: '#3F7DF5', cursor: 'pointer', fontWeight: 700, fontSize: 12, padding: 0 }}>Pasate a Pro →</button>
            </div>
          )}
        </>
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
                <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: 'var(--text-muted)' }}>
                  {kmsAct.toLocaleString('es-AR')} km
                </span>
              </div>
            </div>
            {mant.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-faint)', textAlign: 'center', padding: '6px 0' }}>
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
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                        Cada {item.frecuencia_kms.toLocaleString('es-AR')} km
                        {' · '}
                        <span style={{ color: item.auto_id ? '#3F7DF5' : 'var(--text-faint)' }}>
                          {item.auto_id ? (autoNombre(item.auto_id) || 'Auto específico') : 'Todos los autos'}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button className="gasto-del-btn" style={{ color: 'var(--text-sub)', background: 'var(--bg-input)', borderColor: 'var(--border)' }}
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
  const scrollRef = useRef(null)
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth
  }, [data])

  if (!data || data.length === 0) return null

  const STEP = 52          // px por mes
  const H = 190
  const PAD = { top: 14, right: 18, bottom: 26, left: 46 }
  const n = data[0].monthly.length
  const cW = Math.max(n - 1, 1) * STEP
  const W = PAD.left + cW + PAD.right
  const cH = H - PAD.top - PAD.bottom

  const allVals = data.flatMap(a => a.monthly.map(m => m[metric]))
  const maxVal = Math.max(...allVals, 1)
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxVal)))
  const niceMax = Math.ceil(maxVal / magnitude) * magnitude

  const X = i => PAD.left + (n > 1 ? i * STEP : cW / 2)
  const Y = v => PAD.top + cH - (v / niceMax) * cH
  const fmtY = v => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : v

  return (
    <div style={{ position: 'relative' }}>
      {/* Gráfico scrolleable */}
      <div
        ref={scrollRef}
        style={{ overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch', msOverflowStyle: 'none', scrollbarWidth: 'none' }}
      >
        <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
          {/* Grid horizontales */}
          {[0, 0.25, 0.5, 0.75, 1].map(p => (
            <line key={p}
              x1={PAD.left} x2={W - PAD.right}
              y1={PAD.top + cH * (1 - p)} y2={PAD.top + cH * (1 - p)}
              style={{ stroke: p === 0 ? 'var(--border)' : 'var(--bg-inner)' }} strokeWidth={p === 0 ? 1.5 : 1} />
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
                    <circle cx={cx} cy={cy} r="5" style={{ fill: 'var(--bg-card)' }} />
                    <circle cx={cx} cy={cy} r="3.5" fill={color} />
                  </g>
                ))}
              </g>
            )
          })}

          {/* X labels */}
          {data[0].monthly.map((m, i) => (
            <text key={i} x={X(i)} y={H - 4} textAnchor="middle"
              style={{ fill: 'var(--text-muted)' }} fontSize="9" fontFamily="'DM Sans',sans-serif" fontWeight="700">
              {m.mes}
            </text>
          ))}
        </svg>
      </div>

      {/* Eje Y fijo encima del scroll */}
      <svg width={PAD.left} height={H}
        style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', background: 'var(--bg-card)' }}>
        {[0, 0.5, 1].map(p => (
          <text key={p} x={PAD.left - 4} y={PAD.top + cH * (1 - p) + 3}
            textAnchor="end" style={{ fill: 'var(--text-sub)' }} fontSize="11" fontWeight="600" fontFamily="'DM Mono',monospace">
            {fmtY(niceMax * p)}
          </text>
        ))}
      </svg>
    </div>
  )
}

function AutosComparisonTab({ isDemoMode }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const metric = 'neto'

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
        {/* Leyenda */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 14 }}>
            {data.map((auto, ai) => (
              <div key={auto.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: 3, background: AUTO_COLORS[ai % AUTO_COLORS.length] }} />
                <span style={{ fontSize: 11, color: 'var(--text-sub)', fontWeight: 600 }}>{auto.nombre}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', letterSpacing: 1.5, fontWeight: 700, textTransform: 'uppercase' }}>Neto mensual</div>
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
            <div key={auto.id} style={{ flex: 1, background: 'var(--bg-dark)', borderRadius: 14, padding: '14px 12px', borderTop: `3px solid ${color}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-sub)', marginBottom: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{auto.nombre}</div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 19, fontWeight: 800, color, lineHeight: 1 }}>{fmt(last[metric])}</div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 3, marginBottom: 10 }}>neto este mes</div>
              {delta !== null && (
                <div style={{ fontSize: 11, fontWeight: 700, color: delta >= 0 ? '#10B981' : '#EF4444', marginBottom: 6 }}>
                  {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% vs mes ant.
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
                <div>
                  <div style={{ fontSize: 8, color: 'var(--text-faint)', letterSpacing: 1 }}>GASTOS</div>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: '#F59E0B', marginTop: 2 }}>{fmt(last.gastos)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 8, color: 'var(--text-faint)', letterSpacing: 1 }}>MARGEN</div>
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

function StatsPage({ resumen, cal, calYear, calMonth, showToast, isDemoMode, isPro, onUpgrade }) {
  const [tab, setTab] = useState('general')
  const [monthlyData, setMonthlyData] = useState(null)
  const [deuda, setDeuda] = useState(null)
  const [deudasManuales, setDeudasManuales] = useState({}) // choferId → monto pendiente
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
        const [md, dd, dm] = await Promise.all([getMonthlyStats(), getDeudaHistorica(cfg), getDeudas()])
        setMonthlyData(md)
        setDeuda(dd)
        // Agrupar deudas manuales no saldadas por chofer
        const manual = {}
        for (const d of dm.data || []) {
          if (d.saldado) continue
          manual[d.chofer_id] = (manual[d.chofer_id] || 0) + parseFloat(d.monto || 0)
        }
        setDeudasManuales(manual)
      } catch (e) {
        showToast('Error al cargar stats', 'error')
      } finally {
        setLoading(false)
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemoMode, resumen])

  if (loading) return <div className="loading"><div className="spinner" /></div>

  // ── Locked screen for free users ──────────────────────────────────────────
  if (!isPro && !isDemoMode) {
    return (
      <div className="page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', textAlign: 'center', gap: 16 }}>
        <div style={{ fontSize: 48 }}>📊</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.5px' }}>Estadísticas Pro</div>
        <div style={{ fontSize: 14, color: 'var(--text-sub)', lineHeight: 1.6, maxWidth: 280 }}>
          Accedé a rentabilidad mensual, historial de deuda y estadísticas por auto con el plan Pro.
        </div>
        <button
          onClick={onUpgrade}
          style={{
            marginTop: 8,
            padding: '14px 32px',
            background: 'linear-gradient(135deg, #3F7DF5, #6C47FF)',
            border: 'none',
            borderRadius: 14,
            color: '#fff',
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: "'DM Sans',sans-serif",
            boxShadow: '0 4px 20px #3F7DF540',
          }}
        >
          Pasate a Pro
        </button>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Cancelá cuando quieras</div>
      </div>
    )
  }

  const deudaEntries = deuda ? Object.entries(deuda) : []
  const hayDeuda = deudaEntries.some(([, d]) => d.diasDebe > 0)
  const totalGan = monthlyData?.reduce((s, d) => s + d.turnos, 0) || 0
  const totalGas = monthlyData?.reduce((s, d) => s + d.gastos, 0) || 0

  return (
    <div className="page">
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 18, background: 'var(--bg-dark)', borderRadius: 12, padding: 4 }}>
        {[['general', 'General'], ['autos', 'Por auto']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex: 1, padding: '9px', background: tab === id ? 'var(--bg-card)' : 'transparent', border: tab === id ? '1px solid #3F7DF533' : '1px solid transparent', borderRadius: 9, color: tab === id ? '#3F7DF5' : 'var(--text-muted)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", transition: 'all 0.2s' }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <>
          {/* ── Proyección fin de mes ── */}
          {(() => {
            const now = new Date()
            const dayElapsed = now.getDate()
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
            const curMonth = monthlyData?.[monthlyData.length - 1]
            const curTurnos = curMonth?.turnos || 0
            const curGastos = curMonth?.gastos || 0
            const progress = dayElapsed / daysInMonth
            const nowYear = now.getFullYear()
            const nowMonth = now.getMonth() + 1
            const curMonthStr = `${nowYear}-${String(nowMonth).padStart(2, '0')}`
            const francoWeekday = resumen?.config?.franco_weekday ?? -1
            const calIsCurrentMonth = cal && calYear === nowYear && calMonth === nowMonth

            let faltaFutura = 0, deudaMes = 0

            if (calIsCurrentMonth && resumen?.autos) {
              // Usa cal: estado exacto por chofer/día (pago parcial, franco manual, hoy)
              for (const [autoId, autoData] of Object.entries(resumen.autos)) {
                const tb = autoData.turno_base || 0
                const calAuto = cal[autoId]
                if (!calAuto) continue
                for (const [ds, dayInfo] of Object.entries(calAuto.dias || {})) {
                  if (!ds.startsWith(curMonthStr)) continue
                  const dayNum = parseInt(ds.split('-')[2], 10)
                  for (const choferInfo of Object.values(dayInfo)) {
                    if (choferInfo.estado === 'futuro' && dayNum >= dayElapsed) {
                      faltaFutura += tb   // hoy sin cobrar + días futuros no franco
                    } else if (choferInfo.estado === 'debe') {
                      deudaMes += tb      // días pasados sin pagar
                    }
                  }
                }
              }
            } else {
              // Fallback bruto: turno_base × choferes × días laborales restantes (sin francos semanales)
              let workDaysElapsed = 0, workDaysRemaining = 0
              for (let d = 1; d <= daysInMonth; d++) {
                const dow = (new Date(nowYear, nowMonth - 1, d).getDay() + 6) % 7
                if (dow === francoWeekday) continue
                if (d < dayElapsed) workDaysElapsed++
                else workDaysRemaining++
              }
              if (resumen?.autos) {
                for (const auto of Object.values(resumen.autos)) {
                  faltaFutura += Object.keys(auto.deudas || {}).length * (auto.turno_base || 0) * workDaysRemaining
                  for (const chofer of Object.values(auto.deudas || {})) {
                    deudaMes += (chofer.dias || []).filter(ds => ds.startsWith(curMonthStr)).length * (auto.turno_base || 0)
                  }
                }
              }
            }

            // Promedio diario basado en días laborales pasados (para mostrar en tarjeta)
            let workDaysElapsedForAvg = 0
            for (let d = 1; d < dayElapsed; d++) {
              const dow = (new Date(nowYear, nowMonth - 1, d).getDay() + 6) % 7
              if (dow !== francoWeekday) workDaysElapsedForAvg++
            }
            const dailyAvgTurnos = workDaysElapsedForAvg > 0 ? curTurnos / workDaysElapsedForAvg : 0
            const projTurnos = curTurnos + faltaFutura + deudaMes
            const projNeto = projTurnos - curGastos
            const mesActual = MESES[now.getMonth()]
            return (
              <div className="card" style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1.2 }}>Proyección {mesActual}</div>
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 22, fontWeight: 700, color: projNeto >= 0 ? '#3F7DF5' : '#EF4444', marginTop: 3 }}>
                      {curTurnos > 0 ? fmt(projNeto) : '—'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1.2 }}>Día {dayElapsed} / {daysInMonth}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{Math.round(progress * 100)}% del mes</div>
                  </div>
                </div>
                {/* Barra de progreso */}
                <div style={{ height: 4, background: 'var(--bg-inner)', borderRadius: 2, marginBottom: 12, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.round(progress * 100)}%`, background: 'linear-gradient(90deg, #3F7DF5, #6C47FF)', borderRadius: 2 }} />
                </div>
                {/* Desglose 3 columnas */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  {[
                    { label: 'Recaudado', actual: curTurnos, proy: projTurnos, color: '#3F7DF5' },
                    { label: 'Gastos', actual: curGastos, proy: null, color: '#EF4444' },
                    { label: 'Prom/día', actual: Math.round(dailyAvgTurnos), proy: null, color: '#10B981' },
                  ].map(({ label, actual, proy, color }) => (
                    <div key={label} style={{ background: 'var(--bg-dark)', borderRadius: 8, padding: '8px 10px' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{label}</div>
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color, fontWeight: 600 }}>
                        {actual > 0 ? fmt(actual) : '—'}
                      </div>
                      {proy !== null && (
                        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 3 }}>
                          {actual > 0 ? `→ ${fmt(proy)}` : '—'}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {/* Falta cobrar */}
                {curTurnos > 0 && projTurnos > curTurnos && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1.2 }}>Falta cobrar este mes</span>
                    <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, fontWeight: 700, color: '#F59E0B' }}>
                      {fmt(projTurnos - curTurnos)}
                    </span>
                  </div>
                )}
              </div>
            )
          })()}

          <div className="stitle">Rentabilidad mensual</div>
          <div className="card">
            {/* Neto total */}
            <div style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1.2 }}>Ganancia total</div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 22, fontWeight: 700, color: totalGan - totalGas >= 0 ? '#10B981' : '#EF4444', marginTop: 2 }}>
                {fmt(totalGan - totalGas)}
              </div>
            </div>
            {/* Ingresos totales + Gastos totales */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1.2 }}>Prom. ganancias/mes</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 16, fontWeight: 600, color: '#10B981' }}>
                  {monthlyData?.length ? fmt(Math.round((totalGan - totalGas) / monthlyData.length)) : '—'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1.2, marginTop: 6 }}>Ingresos totales</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, fontWeight: 600, color: '#3F7DF5' }}>{fmt(totalGan)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1.2 }}>Prom. gastos/mes</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 16, fontWeight: 600, color: '#EF4444' }}>
                  {monthlyData?.length ? fmt(Math.round(totalGas / monthlyData.length)) : '—'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1.2, marginTop: 6 }}>Gastos totales</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, fontWeight: 600, color: '#EF4444' }}>{fmt(totalGas)}</div>
              </div>
            </div>
            <BarChart data={monthlyData} />
          </div>

          <div className="stitle">Deuda acumulada — {new Date().getFullYear()}</div>
          {deudaEntries.length === 0 ? (
            <div className="loading" style={{ padding: '30px 0' }}>Sin choferes registrados</div>
          ) : !hayDeuda && Object.keys(deudasManuales).length === 0 ? (
            <div className="card" style={{ textAlign: 'center', color: '#3F7DF5', fontSize: 13 }}>✓ Todos los choferes al día</div>
          ) : (
            deudaEntries.map(([cid, d]) => {
              const extraManual = deudasManuales[cid] || 0
              const totalDebe = d.montoDebe + extraManual
              const tieneDeuda = d.diasDebe > 0 || extraManual > 0
              return (
                <div key={cid} className="card" style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{d.nombre}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{d.autoNombre}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {tieneDeuda ? (
                        <>
                          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 15, color: '#EF4444', fontWeight: 700 }}>
                            ~{fmt(totalDebe)}
                          </div>
                          {d.diasDebe > 0 && (
                            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: '#EF4444', opacity: 0.75, marginTop: 2 }}>
                              {d.diasDebe} día{d.diasDebe !== 1 ? 's' : ''} sin pagar
                            </div>
                          )}
                        </>
                      ) : (
                        <div style={{ fontSize: 12, color: '#3F7DF5', fontWeight: 600 }}>✓ Al día</div>
                      )}
                    </div>
                  </div>
                  {extraManual > 0 && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Deudas pendientes</span>
                      <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, color: '#F59E0B' }}>{fmt(extraManual)}</span>
                    </div>
                  )}
                </div>
              )
            })
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
  html,body{overflow-x:hidden;width:100%}

  :root{
    --bg:#08080A;--bg-card:#15151B;--bg-input:#111;--bg-inner:#1D1D26;
    --bg-modal:#0F0F14;--bg-elem:#161616;--bg-dark:#0e0e0e;
    --border:#23232E;--border-card:#2E2E3B;--border-nav:#1F1F26;
    --text:#F4F4F8;--text-sub:#aaa;--text-muted:#888;--text-faint:#666;--text-dim:#555;
    --header-bg:rgba(0,0,0,0.92);--nav-bg:rgba(0,0,0,0.95);
  }
  [data-theme="light"]{
    --bg:#F0F2F8;--bg-card:#FFFFFF;--bg-input:#F4F5FA;--bg-inner:#EEF0F7;
    --bg-modal:#FFFFFF;--bg-elem:#F8F9FD;--bg-dark:#E8EAF2;
    --border:#E2E4EE;--border-card:#D8DAE8;--border-nav:#E0E2EE;
    --text:#0F0F1A;--text-sub:#4A5060;--text-muted:#6B7080;--text-faint:#7A8090;--text-dim:#9098B0;
    --header-bg:rgba(240,242,248,0.95);--nav-bg:rgba(240,242,248,0.97);
  }
  *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
  body{background:var(--bg);color:var(--text);transition:background 0.3s,color 0.3s}

  .header{padding:52px 20px 14px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;background:var(--header-bg);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid var(--border-nav)}
  .sync-btn{width:36px;height:36px;border-radius:50%;background:var(--bg-inner);border:none;color:var(--text);font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.15s}
  .sync-btn:active{background:var(--border-card)}

  /* ── App shell — centra en pantallas anchas ──────────────────── */
  .app-wrap{max-width:520px;margin:0 auto;position:relative;min-height:100dvh;overflow-x:hidden}

  .page{padding:0 16px 100px}
  .page-cal{padding:0 10px 100px}
  .loading{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 20px;gap:14px;color:var(--text-muted);font-size:13px}
  .spinner{width:28px;height:28px;border:2px solid var(--bg-inner);border-top-color:#3F7DF5;border-radius:50%;animation:spin 0.75s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}

  .stitle{font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--text-sub);margin:24px 0 10px}
  .card{background:var(--bg-card);border:1px solid var(--border-card);border-radius:20px;padding:20px;margin-bottom:16px}
  .auto-tag{font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:5px 14px;border-radius:100px;display:inline-block}
  .tag-auto{background:#1A2B5C;color:#A6CBFF;border:1px solid #2D4F9C}
  .divider{height:1px;background:var(--border);margin:14px 0}

  .alert-banner{background:#1A0A00;border:1px solid #3A1800;border-radius:14px;padding:12px 16px;margin-bottom:10px;display:flex;gap:10px;align-items:center;font-size:13px}

  .total-banner{background:var(--bg-card);border:1px solid var(--border-card);border-radius:20px;padding:18px 20px;display:flex;align-items:stretch;margin-bottom:16px;overflow:hidden}
  .total-label{font-size:11px;color:var(--text-sub);text-transform:uppercase;letter-spacing:1.2px;margin-bottom:6px}
  .total-value{font-family:'DM Mono',monospace;font-size:min(22px,5.5vw);font-weight:500;color:#7EB1FF;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

  .gan-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0 0}
  .gan-cell{background:var(--bg-inner);border:1px solid var(--border-card);border-radius:12px;padding:12px 14px}
  .gan-label{font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:var(--text-faint);margin-bottom:5px}
  .gan-value{font-family:'DM Mono',monospace;font-size:16px;font-weight:500;color:#7EB1FF}

  .neto-row{background:#0B1A3A;border:1px solid #1E3A6A;border-radius:12px;padding:14px 16px;margin-top:8px;display:flex;justify-content:space-between;align-items:center}
  .neto-label{font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:#6A9AD5}
  .neto-value{font-family:'DM Mono',monospace;font-size:18px;font-weight:600;color:#7EB1FF}

  .ab-danger{background:#1A0808;color:#EF4444;border:1px solid #3A1010}

  .metric-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
  .metric{background:var(--bg-inner);border:1px solid var(--border-card);border-radius:12px;padding:12px 14px}
  .metric-label{font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:var(--text-faint);margin-bottom:5px}
  .metric-value{font-family:'DM Mono',monospace;font-size:15px;font-weight:500}

  .kms-row{display:flex;gap:8px;align-items:center;margin-top:12px}
  .kms-input{flex:1;padding:11px 14px;background:var(--bg-inner);border:1px solid var(--border-card);border-radius:12px;color:var(--text);font-family:'DM Mono',monospace;font-size:14px;outline:none;-webkit-appearance:none;transition:border-color 0.2s}
  .kms-input:focus{border-color:#3F7DF5}
  .kms-btn{padding:11px 18px;background:#3F7DF5;color:#fff;border:none;border-radius:12px;font-weight:700;font-size:13px;cursor:pointer}

  .mant-list{display:flex;flex-direction:column;gap:8px;margin-top:12px}
  .mant-item{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:var(--bg-inner);border-radius:14px;cursor:pointer;border:1px solid var(--border-card);transition:border-color 0.15s}
  .mant-item:active{border-color:var(--text-faint)}
  .mant-nombre{font-size:13px;font-weight:600;color:var(--text)}
  .mant-sub{font-family:'DM Mono',monospace;font-size:11px;color:var(--text-muted);margin-top:3px}
  .mbadge{font-size:11px;font-weight:700;padding:4px 10px;border-radius:100px;text-transform:uppercase}
  .mbadge-ok{background:#0B1A3A;color:#7EB1FF}.mbadge-cambiar{background:#1A0A0A;color:#EF4444}

  .cal-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
  .cal-nav-btn{width:38px;height:38px;border-radius:50%;background:var(--bg-inner);border:none;color:var(--text);font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center}
  .cal-month-label{font-size:17px;font-weight:700;letter-spacing:-0.3px;color:var(--text);padding:0 14px}
  .cal-legend{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px}
  .leg-item{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-sub)}
  .leg-dot{width:8px;height:8px;border-radius:2px;flex-shrink:0}

  .filter-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
  .filter-chip{padding:6px 14px;border-radius:100px;border:1px solid var(--border);background:var(--bg-dark);color:var(--text-muted);font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.15s;white-space:nowrap}
  .filter-chip:active{opacity:0.7}
  .fchip-active{background:var(--text);color:var(--bg);border-color:var(--text)}

  .cal-table{width:100%;table-layout:fixed;border-collapse:separate;border-spacing:2px}
  .cal-th{font-family:'DM Mono',monospace;font-size:11px;color:var(--text-muted);text-align:center;padding:4px 1px;font-weight:600}
  .cal-td{padding:1px;vertical-align:top;cursor:pointer;width:calc(100%/7);min-width:0}.cal-td.empty{cursor:default}
  .day-cell{border-radius:8px;background:var(--bg-dark);border:1px solid transparent;padding:4px 2px 3px;min-height:60px;display:flex;flex-direction:column;align-items:center;gap:2px;overflow:hidden;width:100%;box-sizing:border-box}
  .day-cell-empty{min-height:60px}
  .day-cell.today{border-color:var(--text)}.day-cell.has-debe{border-color:#3A1515}.day-cell.all-franco{background:#080D14;border-color:#0F2040}.day-cell.future{opacity:0.25}
  .day-num{font-family:'DM Mono',monospace;font-size:11px;font-weight:600;color:var(--text-muted);line-height:1}
  .day-cell.today .day-num{color:var(--text);font-weight:700}
  .day-choferes{display:flex;flex-direction:column;gap:2px;width:100%;min-width:0}
  .chofer-pill{border-radius:3px;font-family:'DM Mono',monospace;font-size:8px;font-weight:700;padding:2px 2px;text-align:center;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%;display:block;box-sizing:border-box}
  .pill-completo{background:#0A1A10;color:#10B981}.pill-parcial{background:#1A1000;color:#F59E0B}.pill-debe{background:#1A0808;color:#EF4444}.pill-franco{background:#08111F;color:#60A5FA}.pill-futuro{background:var(--border);color:var(--text-dim)}

  .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:500;display:flex;align-items:flex-end}
  .modal-sheet{background:var(--bg-modal);border-radius:24px 24px 0 0;width:100%;padding:24px 20px 48px;max-height:88dvh;overflow-y:auto;border-top:1px solid var(--border)}
  .modal-date{font-family:'DM Mono',monospace;font-size:12px;color:var(--text-sub);margin-bottom:4px;text-transform:uppercase;letter-spacing:1px}
  .modal-title{font-size:22px;font-weight:700;margin-bottom:18px;letter-spacing:-0.3px;color:var(--text)}
  .modal-back{background:none;border:none;color:var(--text-muted);font-size:14px;cursor:pointer;padding:0;margin-bottom:4px}
  .modal-close{width:100%;padding:14px;background:transparent;color:var(--text-muted);border:1px solid var(--border);border-radius:14px;font-size:14px;cursor:pointer;margin-top:12px}

  .auto-pick-btn{display:flex;align-items:center;justify-content:space-between;padding:16px;background:var(--bg-elem);border:1px solid var(--border);border-radius:14px;margin-bottom:8px;cursor:pointer;transition:border-color 0.15s}
  .auto-pick-btn:active{border-color:var(--text-faint)}

  .chofer-section{margin-bottom:10px;background:var(--bg-elem);border-radius:14px;padding:16px}
  .chofer-sec-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
  .chofer-sec-name{font-size:16px;font-weight:600;color:var(--text)}
  .eb{font-family:'DM Mono',monospace;font-size:11px;font-weight:700;padding:4px 10px;border-radius:100px;text-transform:uppercase}
  .eb-completo{background:#0A1A10;color:#10B981}.eb-parcial{background:#1A1000;color:#F59E0B}.eb-debe{background:#1A0808;color:#EF4444}.eb-franco{background:#08111F;color:#60A5FA}.eb-futuro{background:var(--bg-inner);color:var(--text-muted)}

  .action-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
  .action-btn{padding:12px 8px;border-radius:12px;border:1px solid var(--border);background:var(--bg-dark);color:var(--text);font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;cursor:pointer;text-align:center;transition:opacity 0.15s}
  .action-btn:active{opacity:0.7}.action-btn:disabled{opacity:0.35;cursor:not-allowed}
  .ab-primary{background:var(--text);color:var(--bg);border-color:var(--text);font-weight:700}
  .ab-franco{background:#08111F;color:#60A5FA;border-color:#0F2040}
  .ab-quitar{background:#1A0808;color:#F59E0B;border-color:#2A1010}

  .monto-row{display:flex;gap:8px}
  .monto-input{flex:1;padding:12px 14px;background:var(--bg-dark);border:1px solid var(--border);border-radius:12px;color:var(--text);font-family:'DM Mono',monospace;font-size:15px;outline:none;-webkit-appearance:none;transition:border-color 0.2s}
  .monto-input:focus{border-color:#3F7DF5}.monto-input::placeholder{color:var(--text-dim)}
  .monto-btn{padding:12px 18px;background:var(--bg-inner);color:var(--text);border:1px solid var(--border-card);border-radius:12px;font-weight:600;font-size:13px;cursor:pointer;transition:background 0.15s}
  .monto-btn:active{background:var(--text);color:var(--bg)}.monto-btn:disabled{opacity:0.4}

  .tabs{display:flex;gap:6px;margin-bottom:18px;background:var(--bg-modal);padding:4px;border-radius:14px;border:1px solid var(--border)}
  .tab{flex:1;padding:10px;border-radius:10px;border:none;background:transparent;color:var(--text-sub);font-family:'DM Sans',sans-serif;font-size:14px;font-weight:500;cursor:pointer;text-align:center;transition:all 0.2s}
  .tab.active{background:var(--text);color:var(--bg);font-weight:700}

  .gasto-item{display:flex;align-items:center;padding:14px 16px;background:var(--bg-modal);border:1px solid var(--border);border-radius:14px;margin-bottom:8px}
  .gasto-desc{font-size:14px;font-weight:600;color:var(--text)}.gasto-auto{font-size:12px;color:var(--text-sub);margin-top:2px}
  .gasto-monto{font-family:'DM Mono',monospace;font-size:14px;color:#EF4444;font-weight:500;white-space:nowrap}
  .gasto-del-btn{width:30px;height:30px;border-radius:10px;border:1px solid #2A1010;background:#1A0808;color:#EF4444;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .gasto-del-btn:disabled{opacity:0.4;cursor:not-allowed}

  .form-label{font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:var(--text-sub);display:block;margin-bottom:8px}
  .form-input{width:100%;padding:14px 16px;background:var(--bg-dark);border:1px solid var(--border);border-radius:14px;color:var(--text);font-family:'DM Sans',sans-serif;font-size:15px;outline:none;-webkit-appearance:none;transition:border-color 0.2s}
  .form-input:focus{border-color:#3F7DF5}.form-input::placeholder{color:var(--text-dim)}
  .form-group{margin-bottom:14px}
  select.form-input{cursor:pointer}
  .radio-group{display:flex;gap:8px}
  .radio-opt{flex:1;padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--bg-dark);text-align:center;cursor:pointer;transition:all 0.15s}
  .radio-opt.sel{border-color:#3F7DF5;background:#0B1A3A}
  .rl{font-size:13px;font-weight:600;color:var(--text)}

  .btn-primary{width:100%;padding:16px;background:var(--text);color:var(--bg);border:none;border-radius:14px;font-family:'DM Sans',sans-serif;font-size:15px;font-weight:700;cursor:pointer;margin-top:8px;transition:opacity 0.15s}
  .btn-primary:active{opacity:0.85}.btn-primary:disabled{opacity:0.4;cursor:not-allowed}

  .toast{position:fixed;bottom:92px;left:50%;transform:translateX(-50%) translateY(16px);background:var(--bg-inner);border:1px solid var(--border-card);color:var(--text);padding:12px 20px;border-radius:100px;font-size:13px;font-weight:600;opacity:0;transition:all 0.25s;z-index:999;white-space:nowrap;max-width:92vw;text-align:center}
  .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}.toast.success{border-color:#3F7DF5;color:#3F7DF5}.toast.error{border-color:#EF4444;color:#EF4444}

  .bottom-nav{position:fixed;bottom:0;left:0;right:0;display:flex;background:var(--nav-bg);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border-top:1px solid var(--border-nav);padding:10px 0 26px;z-index:200}
  .bnav-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;padding:4px 0;background:none;border:none;cursor:pointer;color:var(--text-faint);transition:color 0.2s}
  .bnav-btn svg{width:22px;height:22px}.bnav-label{font-size:9px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase}
  .bnav-btn.active{color:var(--text)}
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
  .skel{background:linear-gradient(90deg,var(--bg-modal) 25%,var(--bg-inner) 50%,var(--bg-modal) 75%);background-size:200% 100%;animation:shimmer 1.6s ease-in-out infinite;border-radius:8px}

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

  /* ── Responsive ──────────────────────────────────────────────── */
  /* Pantallas pequeñas (<360px) */
  @media(max-width:359px){
    .header{padding:48px 10px 12px}
    .page{padding:0 10px 100px}
    .page-cal{padding:0 6px 100px}
    .sync-btn{width:30px;height:30px;font-size:13px}
    .modal-sheet{padding:20px 14px 40px}
    .cal-table{border-spacing:1px}
    .day-cell{padding:3px 1px 2px;min-height:52px;border-radius:6px}
    .day-num{font-size:9px}
    .chofer-pill{font-size:7px;padding:1px 1px}
  }
  /* Tablet / desktop (>520px) — centra header y nav */
  @media(min-width:560px){
    .header{left:calc(50% - 260px);right:calc(50% - 260px);width:520px;border-radius:0 0 20px 20px;border-left:1px solid var(--border-nav);border-right:1px solid var(--border-nav)}
    .bottom-nav{left:calc(50% - 260px);right:calc(50% - 260px);width:520px;border-radius:20px 20px 0 0;border-left:1px solid var(--border-nav);border-right:1px solid var(--border-nav)}
    .toast{bottom:110px}
    .modal-overlay{justify-content:center;align-items:flex-end}
    .modal-sheet{max-width:520px;width:100%;border-radius:20px 20px 0 0;border-left:1px solid var(--border);border-right:1px solid var(--border)}
  }

  /* ── Light-mode overrides for hardcoded dark colors ─────────────────── */
  [data-theme="light"] .tag-auto{background:#DBEAFE;color:#1E40AF;border-color:#93C5FD}
  [data-theme="light"] .alert-banner{background:#FFFBEB;border-color:#FDE68A;color:#92400E}
  [data-theme="light"] .alert-warn{background:#FFFBEB;border-color:#FDE68A;color:#92400E}
  [data-theme="light"] .alert-danger{background:#FEF2F2;border-color:#FECACA;color:#991B1B}
  [data-theme="light"] .total-value{color:#1D4ED8}
  [data-theme="light"] .gan-value{color:#1D4ED8}
  [data-theme="light"] .neto-row{background:#EFF6FF;border-color:#BFDBFE}
  [data-theme="light"] .neto-label{color:#1E40AF}
  [data-theme="light"] .neto-value{color:#1D4ED8}
  [data-theme="light"] .ab-danger{background:#FEF2F2;color:#DC2626;border-color:#FECACA}
  [data-theme="light"] .mbadge-ok{background:#DBEAFE;color:#1E40AF}
  [data-theme="light"] .mbadge-cambiar{background:#FEE2E2;color:#991B1B}
  [data-theme="light"] .day-cell.has-debe{border-color:#FCA5A5}
  [data-theme="light"] .day-cell.all-franco{background:#EFF6FF;border-color:#BFDBFE}
  [data-theme="light"] .pill-completo{background:#D1FAE5;color:#065F46}
  [data-theme="light"] .pill-parcial{background:#FEF3C7;color:#92400E}
  [data-theme="light"] .pill-debe{background:#FEE2E2;color:#991B1B}
  [data-theme="light"] .pill-franco{background:#DBEAFE;color:#1E40AF}
  [data-theme="light"] .eb-completo{background:#D1FAE5;color:#065F46}
  [data-theme="light"] .eb-parcial{background:#FEF3C7;color:#92400E}
  [data-theme="light"] .eb-debe{background:#FEE2E2;color:#991B1B}
  [data-theme="light"] .eb-franco{background:#DBEAFE;color:#1E40AF}
  [data-theme="light"] .ab-franco{background:#EFF6FF;color:#1D4ED8;border-color:#BFDBFE}
  [data-theme="light"] .ab-quitar{background:#FFF7ED;color:#C2410C;border-color:#FED7AA}
  [data-theme="light"] .gasto-del-btn{background:#FEF2F2;border-color:#FECACA;color:#EF4444}
  [data-theme="light"] .radio-opt.sel{background:#EFF6FF;border-color:#3F7DF5}

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
