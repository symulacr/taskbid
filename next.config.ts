import type { NextConfig } from 'next'

const config: NextConfig = {
  // API routes handle all backend logic; static frontend served from /public
  async rewrites() {
    return [
      // Serve the vanilla JS dashboard at /dashboard
      { source: '/dashboard', destination: '/index.html' },
    ]
  },
}

export default config
