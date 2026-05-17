export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.MOBBEX_API_KEY
  const accessToken = process.env.MOBBEX_ACCESS_TOKEN

  if (!apiKey || !accessToken) {
    return res.status(200).json({ error: 'not_configured' })
  }

  const { userId, userEmail } = req.body || {}
  if (!userId || !userEmail) {
    return res.status(400).json({ error: 'missing_params' })
  }

  const price = parseInt(process.env.MOBBEX_PRICE || '5000', 10)
  const reference = `sub_${userId}_${Date.now()}`

  try {
    const response = await fetch('https://mobbex.com/p/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'x-access-token': accessToken,
        'cache-control': 'no-cache',
      },
      body: JSON.stringify({
        total: price,
        description: 'TuFlota - Suscripción mensual',
        reference,
        return_url: 'https://flota-v2.vercel.app',
        webhook: 'https://flota-v2.vercel.app/api/mobbex-webhook',
        items: [
          {
            image: '',
            description: 'TuFlota - Suscripción mensual',
            quantity: 1,
            price,
          },
        ],
        customer: {
          email: userEmail,
        },
      }),
    })

    const data = await response.json()

    if (!data || !data.data || !data.data.url) {
      return res.status(500).json({ error: 'invalid_mobbex_response', details: data })
    }

    return res.status(200).json({ checkoutUrl: data.data.url })
  } catch (err) {
    return res.status(500).json({ error: 'fetch_failed', details: err.message })
  }
}
