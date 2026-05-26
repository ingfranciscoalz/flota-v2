// api/weekly-report.js — Vercel Cron: every Monday at 10:00 UTC (~7:00 AR)
// Checks comprobantes received in the past 7 days and sends a push notification
// to each fleet owner so they can review them.
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

  // Past 7 days (lunes anterior → hoy)
  const weekAgo = new Date(today)
  weekAgo.setDate(weekAgo.getDate() - 7)
  const weekAgoStr = weekAgo.toISOString().split('T')[0]

  // Traer todos los turnos con comprobante de la semana pasada
  const { data: turnos, error } = await supabase
    .from('turnos')
    .select('user_id, chofer_id, fecha, monto, estado, choferes(nombre)')
    .gte('fecha', weekAgoStr)
    .lte('fecha', todayStr)
    .not('comprobante_url', 'is', null)

  if (error) {
    console.error('Error fetching turnos:', error)
    return res.status(500).json({ error: error.message })
  }

  if (!turnos || turnos.length === 0) {
    return res.status(200).json({ sent: 0, message: 'Sin comprobantes esta semana' })
  }

  // Agrupar por dueño
  const byUser = {}
  for (const t of turnos) {
    if (!t.user_id) continue
    if (!byUser[t.user_id]) byUser[t.user_id] = []
    byUser[t.user_id].push(t)
  }

  // Traer subscriptions de esos dueños
  const userIds = Object.keys(byUser)
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('user_id, subscription')
    .in('user_id', userIds)

  let sent = 0
  const errors = []

  for (const sub of (subs || [])) {
    const userTurnos = byUser[sub.user_id] || []
    if (userTurnos.length === 0) continue

    const choferesSet = new Set(userTurnos.map(t => t.choferes?.nombre).filter(Boolean))
    const choferesStr = [...choferesSet].join(', ')
    const totalMonto = userTurnos.reduce((acc, t) => acc + (t.monto || 0), 0)
    const montoStr = '$' + totalMonto.toLocaleString('es-AR', { maximumFractionDigits: 0 })

    const payload = JSON.stringify({
      title: `📋 Resumen semanal · ${userTurnos.length} comprobante${userTurnos.length !== 1 ? 's' : ''}`,
      body: `${choferesStr} — ${montoStr} cobrado. Tocá para revisar.`,
      tag: `weekly-report-${todayStr}`,
      url: '/?reporte=semana',
    })

    try {
      const subscription = JSON.parse(sub.subscription)
      await webpush.sendNotification(subscription, payload)
      sent++
    } catch (e) {
      console.error(`Push error for user ${sub.user_id}:`, e.statusCode, e.message)
      if (e.statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('user_id', sub.user_id)
      }
      errors.push({ user_id: sub.user_id, error: e.message })
    }
  }

  return res.status(200).json({
    sent,
    errors,
    comprobantes: turnos.length,
    desde: weekAgoStr,
    hasta: todayStr,
  })
}
