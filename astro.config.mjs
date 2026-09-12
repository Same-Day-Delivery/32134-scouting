// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  // Listen on every interface so phones and laptops on the same network can
  // reach the dev server, not just localhost.
  server: { host: true },
  vite: {
    server: {
      // Vite rejects requests whose Host header it does not recognise, which
      // otherwise blocks the tailnet hostnames. The leading dot covers every
      // machine on the tailnet; it stays scoped rather than allowing any host.
      allowedHosts: ['*.tail2a9e18.ts.net'],
    },
  },
});
