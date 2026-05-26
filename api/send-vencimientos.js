// api/send-vencimientos.js — Vercel Cron: daily at 13:00 UTC (~10:00 AR)
// Sends push notifications to fleet owners when:
//   - VTV expires in 7, 3, 1 days or today
//   - Insurance expires in 7, 3, 1 days or today
//   - Anything already expired (every Monday)
//   - Maintenance item ≤ 500 km from next service (every Monday)
//
// Required env vars (same as send-reminders.js):
//   VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   VAPID_PUBLIC_KEY
//   VAPID_PRIVATE_KEY
//   VAPID_SUBJECT
//   CRON_SECRET

import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

export const config = { maxDuration: 30 }

// Días previos al vencimiento que disparan notificación
const ALERT_DAYS = [7, 3, 1, 0]
// KMs faltantes que disparan notificación de mantenimiento
const ALERT_KMS = [500, 100, 0]

function daysBetween(fromDateStr, toDateStr) {
  if (!fromDateStr) return null
  const a = new Date(fromDateStr + 'T00:00:00Z')
  const b = new Date(toDateStr + 'T00:00:00Z')
  return Math.round((a - b) / (1000 * 60 * 60 * 24))
}

export default async function handler(req, res) {
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  )

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'https://flota-v2.vercel.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  )

  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]
  const isMonday = today.getUTCDay() === 1 // recordatorio semanal de vencidos y mant

  // 1. Traer todos los autos con vencimientos
  const { data: autos, error: autosError } = await supabase
    .from('autos')
    .select('id, user_id, nombre, vtv_vence, seguro_vence')

  if (autosError) return res.status(500).json({ error: autosError.message })

  // 2. Traer kms actuales
  const { data: kmsData } = await supabase
    .from('kms')
    .select('auto_id, kms_actuales')
  const kmsByAuto = {}
  for (const k of kmsData || []) kmsByAuto[k.auto_id] = k.kms_actuales

  // 3. Traer items de mantenimiento del usuario + último mantenimiento realizado
  const { data: mantItems } = await supabase
    .from('user_mant_items')
    .select('id, user_id, nombre, frecuencia_kms, auto_id')

  const { data: mantRealizado } = await supabase
    .from('mantenimiento')
    .select('user_id, auto_id, tipo, kms_en_service')

  // último service por auto+tipo
  const lastMantMap = {} // key = `${auto_id}|${tipo}` → max kms
  for (const m of mantRealizado || []) {
    const key = `${m.auto_id}|${m.tipo}`
    if (!lastMantMap[key] || m.kms_en_service > lastMantMap[key]) {
      lastMantMap[key] = m.kms_en_service
    }
  }

  // 4. Construir notificaciones a enviar (agrupadas por user_id)
  const notifsByUser = {} // user_id → [{title, body, tag}]

  for (const auto of autos || []) {
    // VTV
    const dVtv = daysBetween(auto.vtv_vence, todayStr)
    if (dVtv !== null) {
      const shouldAlert = (dVtv >= 0 && ALERT_DAYS.includes(dVtv)) || (dVtv < 0 && isMonday)
      if (shouldAlert) {
        const msg = dVtv < 0
          ? `VTV de ${auto.nombre} vencida hace ${Math.abs(dVtv)} día${Math.abs(dVtv) !== 1 ? 's' : ''}`
          : dVtv === 0
            ? `VTV de ${auto.nombre} vence HOY`
            : `VTV de ${auto.nombre} vence en ${dVtv} día${dVtv !== 1 ? 's' : ''}`
        if (!notifsByUser[auto.user_id]) notifsByUser[auto.user_id] = []
        notifsByUser[auto.user_id].push({
          title: dVtv < 0 ? '🔴 VTV vencida' : (dVtv === 0 ? '🟠 VTV vence hoy' : '🟡 VTV próxima'),
          body: msg,
          tag: `vto-vtv-${auto.id}-${todayStr}`,
        })
      }
    }

    // Seguro
    const dSeg = daysBetween(auto.seguro_vence, todayStr)
    if (dSeg !== null) {
      const shouldAlert = (dSeg >= 0 && ALERT_DAYS.includes(dSeg)) || (dSeg < 0 && isMonday)
      if (shouldAlert) {
        const msg = dSeg < 0
          ? `Seguro de ${auto.nombre} vencido hace ${Math.abs(dSeg)} día${Math.abs(dSeg) !== 1 ? 's' : ''}`
          : dSeg === 0
            ? `Seguro de ${auto.nombre} vence HOY`
            : `Seguro de ${auto.nombre} vence en ${dSeg} día${dSeg !== 1 ? 's' : ''}`
        if (!notifsByUser[auto.user_id]) notifsByUser[auto.user_id] = []
        notifsByUser[auto.user_id].push({
          title: dSeg < 0 ? '🔴 Seguro vencido' : (dSeg === 0 ? '🟠 Seguro vence hoy' : '🟡 Seguro próximo'),
          body: msg,
          tag: `vto-seg-${auto.id}-${todayStr}`,
        })
      }
    }

    // Mantenimiento (solo los lunes para no spammear)
    if (isMonday) {
      const kmsAct = kmsByAuto[auto.id] || 0
      const itemsForAuto = (mantItems || []).filter(m =>
        m.user_id === auto.user_id && (!m.auto_id || m.auto_id === auto.id)
      )
      for (const item of itemsForAuto) {
        const ultimoKms = lastMantMap[`${auto.id}|${item.nombre}`] || 0
        const proximoKms = ultimoKms + item.frecuencia_kms
        const faltanKms = proximoKms - kmsAct
        const shouldAlert = ALERT_KMS.some(threshold => faltanKms <= threshold) || faltanKms < 0
        if (shouldAlert) {
          const msg = faltanKms < 0
            ? `${item.nombre} de ${auto.nombre}: ${Math.abs(faltanKms).toLocaleString('es-AR')} km vencidos`
            : faltanKms === 0
              ? `${item.nombre} de ${auto.nombre}: corresponde ahora`
              : `${item.nombre} de ${auto.nombre}: faltan ${faltanKms.toLocaleString('es-AR')} km`
          if (!notifsByUser[auto.user_id]) notifsByUser[auto.user_id] = []
          notifsByUser[auto.user_id].push({
            title: faltanKms < 0 ? '🔴 Mantenimiento vencido' : '🟡 Mantenimiento próximo',
            body: msg,
            tag: `vto-mant-${auto.id}-${item.id}-${todayStr}`,
          })
        }
      }
    }
  }

  // 5. Traer subscriptions de esos usuarios
  const userIds = Object.keys(notifsByUser)
  if (userIds.length === 0) {
    return res.status(200).json({ sent: 0, message: 'Sin vencimientos para notificar' })
  }

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('user_id, subscription')
    .in('user_id', userIds)

  // 6. Enviar (una notificación por evento, no agrupadas — el SO las apila por tag)
  let sent = 0
  const errors = []

  for (const sub of (subs || [])) {
    const notifs = notifsByUser[sub.user_id] || []
    if (notifs.length === 0) continue

    let subscription
    try {
      subscription = JSON.parse(sub.subscription)
    } catch (e) {
      continue
    }

    for (const n of notifs) {
      const payload = JSON.stringify({
        title: n.title,
        body: n.body,
        tag: n.tag,
        url: '/',
      })

      try {
        await webpush.sendNotification(subscription, payload)
        sent++
      } catch (e) {
        if (e.statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('user_id', sub.user_id)
          break // sub muerta, no intentar más con este user
        }
        errors.push({ user_id: sub.user_id, error: e.message })
      }
    }
  }

  return res.status(200).json({
    sent,
    errors,
    today: todayStr,
    users_notified: userIds.length,
  })
}
