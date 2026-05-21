// api/play-webhook.js
// Recibe notificaciones de Google Play via Pub/Sub (Real-time Developer Notifications).
// Google las manda automáticamente cuando una suscripción se renueva, cancela, vence, etc.
//
// Setup en Google Cloud Console:
//   1. Crear un topic en Pub/Sub: ej "play-notifications"
//   2. Crear una suscripción Push que apunte a https://tu-app.vercel.app/api/play-webhook
//   3. En Play Console → Monetización → Real-time notifications → poner el topic

import { createClient } from '@supabase/supabase-js'

// Tipos de notificación de Google Play
const NOTIF = {
  RECOVERED: 1,    // Recuperada de account hold
  RENEWED: 2,      // Renovada
  CANCELED: 3,     // Cancelada por el usuario
  PURCHASED: 4,    // Nueva compra
  ON_HOLD: 5,      // Cuenta suspendida (pago fallido)
  GRACE_PERIOD: 6, // En período de gracia (último intento de cobro)
  RESTARTED: 7,    // Reactivada
  PRICE_CHANGE_CONFIRMED: 8,
  DEFERRED: 9,
  PAUSED: 10,
  PAUSE_SCHEDULE_CHANGED: 11,
  EXPIRED: 12,     // Vencida definitivamente
  REVOKED: 13,     // Revocada por Google (reembolso, fraude)
}

const PRO_EVENTS = [NOTIF.RECOVERED, NOTIF.RENEWED, NOTIF.PURCHASED, NOTIF.RESTARTED, NOTIF.GRACE_PERIOD]
const FREE_EVENTS = [NOTIF.CANCELED, NOTIF.EXPIRED, NOTIF.REVOKED, NOTIF.ON_HOLD]

export default async function handler(req, res) {
  // Siempre responder 200 rápido para que Pub/Sub no reintente
  res.status(200).end()

  if (req.method !== 'POST') return

  try {
    const message = req.body?.message
    if (!message?.data) return

    const payload = JSON.parse(Buffer.from(message.data, 'base64').toString('utf-8'))
    const { subscriptionNotification } = payload

    if (!subscriptionNotification) return

    const { notificationType, purchaseToken } = subscriptionNotification
    if (!purchaseToken) return

    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    )

    if (FREE_EVENTS.includes(notificationType)) {
      // Cancelada / vencida / revocada → bajar a free
      await supabase.from('profiles')
        .update({ plan: 'free', play_expiry: null })
        .eq('play_token', purchaseToken)

      console.log(`Plan → free (token: ${purchaseToken.slice(0, 20)}... notif: ${notificationType})`)

    } else if (PRO_EVENTS.includes(notificationType)) {
      // Renovada / nueva / recuperada → mantener pro
      await supabase.from('profiles')
        .update({ plan: 'pro' })
        .eq('play_token', purchaseToken)

      console.log(`Plan → pro (token: ${purchaseToken.slice(0, 20)}... notif: ${notificationType})`)
    }

  } catch (e) {
    console.error('play-webhook error:', e.message)
    // Ya respondimos 200, no hay nada más que hacer
  }
}
