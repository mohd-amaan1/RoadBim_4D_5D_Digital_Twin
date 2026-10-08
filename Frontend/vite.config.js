import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The API is proxied through this dev server rather than called directly.
 *
 * That is what makes a single ngrok tunnel enough. Tunnelling only the frontend and
 * leaving the client pointed at http://localhost:5000 would break for everyone but you:
 * a teammate's browser resolves "localhost" to *their* machine, where nothing is
 * listening. Proxying puts the API on the same origin as the page, so it travels down
 * the same tunnel — and, as a side effect, there is no cross-origin request left for
 * CORS to reject.
 *
 *   npm run share          tunnel-friendly: any host allowed, HMR off
 *   npm run dev            unchanged local development
 *
 * Sharing is selected by Vite's own `--mode share` rather than an environment variable.
 * The previous script set SHARE=1 and re-spawned `npx.cmd` from Node to carry it across —
 * which Node 18.20.2+/20.12.2+/21.7.3+ refuse outright on Windows (`spawn EINVAL`, the
 * CVE-2024-27980 fix), so `npm run share` died before Vite ever started. `--mode` needs no
 * subprocess and no shell quoting, so it works the same on every platform and Node version.
 *
 * SHARE=1 is still honoured, so the bash form documented in docs/SHARING_WITH_NGROK.md
 * keeps working.
 */
const isSharing = (mode) => mode === 'share' || process.env.SHARE === '1'

const apiProxy = {
  '/api': {
    target: process.env.API_TARGET || 'http://localhost:5000',
    changeOrigin: true,
  },
  '/swagger': {
    target: process.env.API_TARGET || 'http://localhost:5000',
    changeOrigin: true,
  },
}

// ngrok gives a different random hostname each run, and Vite blocks unknown hosts by
// default (a DNS-rebinding protection added in 5.4.12). The leading dot matches any
// subdomain of the tunnel domains.
const TUNNEL_HOSTS = ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.io', '.ngrok.app', 'localhost']

export default defineConfig(({ mode }) => {
  const SHARING = isSharing(mode)

  return {
    plugins: [react()],

    server: {
      port: 3000,
      open: !SHARING,
      proxy: apiProxy,

      allowedHosts: SHARING ? TUNNEL_HOSTS : undefined,

      // The websocket cannot reach a random https tunnel without extra configuration, and a
      // failed HMR socket produces a stream of console errors that look like real faults.
      // Sharing is for looking at the app, not editing it, so it is simply off.
      hmr: SHARING ? false : undefined,
    },

    // `vite preview` serves the production build and needs the same proxy
    preview: {
      port: 3000,
      proxy: apiProxy,
      allowedHosts: SHARING ? TUNNEL_HOSTS : undefined,
    },
  }
})
