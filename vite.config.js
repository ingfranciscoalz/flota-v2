import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  build: {
    // App.jsx es monolítico; el chunk de 538 kB → 147 kB gzipped es aceptable para una PWA
    chunkSizeWarningLimit: 600,
  },
})
