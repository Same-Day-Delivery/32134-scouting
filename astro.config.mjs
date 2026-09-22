// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  // Astro's own origin check builds the expected origin from the container's
  // socket, so behind a TLS-terminating proxy it compares the browser's
  // https:// Origin against its own http:// and refuses every form post.
  // src/lib/origin.ts does the same check against the forwarded host instead.
  security: { checkOrigin: false },
  // Listen on every interface so phones and laptops on the same network can
  // reach the dev server, not just localhost.
  server: { host: true },
  vite: {
    server: {
      // Vite rejects requests whose Host header it does not recognise, which
      // otherwise blocks the tailnet hostnames. The leading dot covers every
      // machine on the tailnet; it stays scoped rather than allowing any host.
      allowedHosts: ['.tail2a9e18.ts.net'],
    },
  },
});
