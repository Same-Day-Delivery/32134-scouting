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
});
