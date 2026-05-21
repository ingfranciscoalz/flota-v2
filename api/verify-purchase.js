// api/verify-purchase.js
// POST { purchaseToken, subscriptionId, userId }
// Verifica el token con Google Play Developer API y actualiza el plan en Supabase.
//
// Env vars necesarias (Vercel dashboard):
//   GOOGLE_SERVICE_ACCOUNT   — JSON de la service account (como string)
//   PLAY_PACKAGE_NAME        — com.flota.app
//   PLAY_SUBSCRIPTION_ID     — flota_pro_mensual
//   VITE_SUPABASE_URL        — ya la tenés
//   SUPABASE_SERVICE_ROLE_KEY — ya la tenés

import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { purchaseToken, subscriptionId, userId } = req.body
  if (!purchaseToken || !userId) return res.status(400).json({ error: 'Faltan parámetros' })

  const packageName = process.env.PLAY_PACKAGE_NAME || 'com.flota.app'
  const subId = subscriptionId || process.env.PLAY_SUBSCRIPTION_ID || 'flota_pro_mensual'

  // ── Autenticar con Google ────────────────────────────────────────
  let credentials
  try {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT)
  } catch {
    return res.status(500).json({ error: 'GOOGLE_SERVICE_ACCOUNT mal configurado' })
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  })
  const androidpublisher = google.androidpublisher({ version: 'v3', auth })

  // ── Verificar la compra ──────────────────────────────────────────
  let sub
  try {
    const { data } = await androidpublisher.purchases.subscriptions.get({
      packageName,
      subscriptionId: subId,
      token: purchaseToken,
    })
    sub = data
  } catch (e) {
    console.error('Error verificando compra:', e.message)
    return res.status(400).json({ error: 'Token de compra inválido o vencido' })
  }

  // paymentState: 0=pendiente, 1=recibido, 2=prueba gratis, 3=diferido
  if (sub.paymentState !== 1 && sub.paymentState !== 2) {
    return res.status(400).json({ error: 'Pago no confirmado', paymentState: sub.paymentState })
  }

  const expiryMs = parseInt(sub.expiryTimeMillis)
  if (expiryMs < Date.now()) {
    return res.status(400).json({ error: 'Suscripción vencida' })
  }

  // ── Acknowledge (obligatorio dentro de las 72hs) ─────────────────
  try {
    await androidpublisher.purchases.subscriptions.acknowledge({
      packageName,
      subscriptionId: subId,
      token: purchaseToken,
      requestBody: {},
    })
  } catch (e) {
    // Si ya fue acknowledged, Google devuelve error — ignorar
    if (!e.message?.includes('already acknowledged')) {
      console.warn('Acknowledge warning:', e.message)
    }
  }

  // ── Actualizar Supabase ──────────────────────────────────────────
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  )

  const { error: dbError } = await supabase.from('profiles').update({
    plan: 'pro',
    play_token: purchaseToken,
    play_expiry: new Date(expiryMs).toISOString(),
  }).eq('id', userId)

  if (dbError) {
    console.error('Supabase update error:', dbError)
    return res.status(500).json({ error: 'Error al actualizar el plan' })
  }

  return res.status(200).json({
    plan: 'pro',
    expiry: new Date(expiryMs).toISOString(),
  })
}
