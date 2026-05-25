import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js')

      // Cuando un nuevo SW termina de instalarse mientras el viejo controla la página,
      // le mandamos SKIP_WAITING para que active enseguida.
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing
        if (!newSW) return
        newSW.addEventListener('statechange', () => {
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            newSW.postMessage({ type: 'SKIP_WAITING' })
          }
        })
      })

      // Cuando el SW nuevo toma control, recargamos automáticamente.
      let refreshing = false
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return
        refreshing = true
        window.location.reload()
      })

      // Chequear actualizaciones cada hora y cuando la pestaña vuelve a foco
      setInterval(() => reg.update(), 60 * 60 * 1000)
      window.addEventListener('focus', () => reg.update())
    } catch (_) { /* ignore */ }
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
