// @ts-check
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  // Images are served by Cloudinary (f_auto,q_auto), so the Cloudflare Images binding is not needed.
  adapter: cloudflare({ imageService: 'passthrough' }),
  site: process.env.PUBLIC_SITE_URL ?? 'http://localhost:4321',
  server: { port: 4321 },
  vite: {
    plugins: [tailwindcss()],
  },
});
