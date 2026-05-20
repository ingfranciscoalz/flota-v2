// api/send-reminders.js — Vercel Cron: daily at 9:00 AM UTC
// Sends push notifications to fleet owners when a driver still owes yesterday's shift
//
// Required env vars (set in Vercel dashboard):
//   VITE_SUPABASE_URL         — ya la tenés (misma que usa el frontend)
//   SUPABASE_SERVICE_ROLE_KEY — service role key (bypasses RLS) — creá esta nueva
//   VAPID_PUBLIC_KEY          — BNfezjUZkM6Fl0ZuTM6gU25Atne4ezKvu06TYeSY7jNuZqcko7Kh2UGi7WUsiTdFBx2RSWT4-7_kH6eEc_YWBU8
//   VAPID_PRIVATE_KEY         — 2iwOFG6OqhLsAITlz1FS6hAnOTE6q9ZHz2rqo84RP2E
//   VAPID_SUBJECT             — la URL de tu app, ej: https://flota-v2.vercel.app
//                               (NO es el mail de los usuarios — es solo un contacto admin
//                                para que los servidores push puedan escribirte si algo falla)
//   CRON_SECRET               — cualquier string random, ej: flota-cron-2026

import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

export const config = { maxDuration: 30 }

export default async function handler(req, res) {
  // Vercel Cron sends a GET with Authorization header — verify it
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,          // misma variable que usa el frontend
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  )

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'https://flota-v2.vercel.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  )

  // Yesterday's date string
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().split('T')[0]

  // Get all turnos from yesterday that are still 'debe'
  const { data: turnos, error: turnosError } = await supabase
    .from('turnos')
    .select('chofer_id, choferes(nombre, user_id)')
    .eq('fecha', yesterdayStr)
    .eq('estado', 'debe')

  if (turnosError) {
    console.error('Error fetching turnos:', turnosError)
    return res.status(500).json({ error: turnosError.message })
  }

  if (!turnos || turnos.length === 0) {
    return res.status(200).json({ sent: 0, message: 'No hay deudas para notificar' })
  }

  // Group by user_id (fleet owner) — each owner gets one notification per driver
  const byUser = {}
  for (const turno of turnos) {
    const userId = turno.choferes?.user_id
    if (!userId) continue
    if (!byUser[userId]) byUser[userId] = []
    byUser[userId].push(turno.choferes.nombre)
  }

  // Fetch push subscriptions for these users
  const userIds = Object.keys(byUser)
  const { data: subs, error: subsError } = await supabase
    .from('push_subscriptions')
    .select('user_id, subscription')
    .in('user_id', userIds)

  if (subsError) {
    console.error('Error fetching subscriptions:', subsError)
    return res.status(500).json({ error: subsError.message })
  }

  let sent = 0
  const errors = []

  for (const sub of (subs || [])) {
    const drivers = byUser[sub.user_id] || []
    if (drivers.length === 0) continue

    const driverList = drivers.length === 1
      ? drivers[0]
      : drivers.slice(0, -1).join(', ') + ' y ' + drivers[drivers.length - 1]

    const payload = JSON.stringify({
      title: `Flota · ${drivers.length} turno${drivers.length > 1 ? 's' : ''} sin cobrar`,
      body: `${driverList} todavía no pagó el turno de ayer.`,
      tag: `reminder-${yesterdayStr}`,
      url: '/',
    })

    try {
      const subscription = JSON.parse(sub.subscription)
      await webpush.sendNotification(subscription, payload)
      sent++
    } catch (e) {
      console.error(`Push error for user ${sub.user_id}:`, e.statusCode, e.message)
      // If subscription expired (410), remove it
      if (e.statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('user_id', sub.user_id)
      }
      errors.push({ user_id: sub.user_id, error: e.message })
    }
  }

  return res.status(200).json({ sent, errors, yesterday: yesterdayStr })
}
