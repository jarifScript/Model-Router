// Vite configuration for the React application.
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  let supabaseOrigin = 'https://YOUR_PROJECT_REF.supabase.co'
  if (env.VITE_SUPABASE_URL) {
    try {
      supabaseOrigin = new URL(env.VITE_SUPABASE_URL).origin
    } catch {
      throw new Error('VITE_SUPABASE_URL must be an absolute URL.')
    }
  }
  const contentSecurityPolicy = [
    "default-src 'self'",
    "script-src 'self'",
    `connect-src 'self' ${supabaseOrigin}`,
    "img-src 'self' data:",
    "style-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')

  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalizedId = id.replace(/\\/g, '/')
            if (!normalizedId.includes('/node_modules/')) return
            if (normalizedId.includes('/node_modules/react-dom/')
              || normalizedId.includes('/node_modules/react/')
              || normalizedId.includes('/node_modules/scheduler/')) return 'react-vendor'
            if (normalizedId.includes('/node_modules/react-router')) return 'router-vendor'
            if (normalizedId.includes('/node_modules/@supabase/')) return 'supabase-vendor'
            if (normalizedId.includes('/node_modules/@tanstack/')) return 'query-vendor'
            if (normalizedId.includes('/node_modules/zustand/')) return 'state-vendor'
          },
        },
      },
    },
    preview: {
      headers: {
        'Content-Security-Policy': contentSecurityPolicy,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'X-Frame-Options': 'DENY',
      },
    },
  }
})
