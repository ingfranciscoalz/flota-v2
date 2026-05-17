import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  // Always respond 200 to Mobbex so it doesn't retry
  if (req.method !== 'POST') {
    return res.status(200).json({ received: true })
  }

  try {
    const body = req.body || {}

    // Check payment status
    const statusCode = body?.data?.payment?.status?.code
    const statusTop = body?.status
    const isPaid = statusCode === '200' || statusCode === 200 || statusTop === 200

    if (!isPaid) {
      return res.status(200).json({ received: true, processed: false, reason: 'not_paid' })
    }

    // Extract userId from reference: "sub_{userId}_{timestamp}"
    // UUID contains hyphens, timestamp uses underscores as delimiter
    const reference = body?.data?.payment?.reference || body?.reference || ''
    // reference format: sub_<uuid>_<timestamp>
    // split on '_' gives: ['sub', uuid-part1, uuid-part2, ...uuid-parts, timestamp]
    // UUID is 5 groups joined by hyphens, so we reassemble parts 1 through 5
    const parts = reference.split('_')
    // parts[0] = 'sub', parts[1..5] = UUID segments, parts[6] = timestamp
    // UUID: 8-4-4-4-12 hex chars → 5 hyphen-separated groups
    // However the reference stores UUID as-is (with hyphens), so split('_') on
    // "sub_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx_1234567890" gives exactly 3 items.
    // Double-check: if userId is a UUID like "abc-def", split('_') yields ['sub','abc-def','ts']
    if (parts.length < 3) {
      return res.status(200).json({ received: true, processed: false, reason: 'bad_reference' })
    }
    // userId is everything between the first and last underscore
    const userId = parts.slice(1, parts.length - 1).join('_')

    if (!userId) {
      return res.status(200).json({ received: true, processed: false, reason: 'no_user_id' })
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(200).json({ received: true, processed: false, reason: 'missing_env' })
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const vence = new Date()
    vence.setDate(vence.getDate() + 30)

    const { error } = await supabase
      .from('profiles')
      .update({
        suscripcion_activa: true,
        suscripcion_vence: vence.toISOString(),
        activo: true,
      })
      .eq('id', userId)

    if (error) {
      console.error('Supabase update error:', error)
      return res.status(200).json({ received: true, processed: false, reason: 'db_error' })
    }

    return res.status(200).json({ received: true, processed: true })
  } catch (err) {
    console.error('Webhook handler error:', err)
    return res.status(200).json({ received: true, processed: false, reason: 'exception' })
  }
}
