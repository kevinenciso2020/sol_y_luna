// @ts-check
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, envField } from 'astro/config';

const TURNSTILE = 'https://challenges.cloudflare.com';

export default defineConfig({
  output: 'server',
  // Images are served by Cloudinary (f_auto,q_auto), so the Cloudflare Images binding is not needed.
  adapter: cloudflare({ imageService: 'passthrough' }),
  site: process.env.PUBLIC_SITE_URL ?? 'http://localhost:4321',
  server: { port: 4321 },
  env: {
    schema: {
      API_INTERNAL_URL: envField.string({ context: 'server', access: 'secret', url: true }),
      BFF_SHARED_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      PUBLIC_SITE_URL: envField.string({ context: 'client', access: 'public', optional: true }),
      PUBLIC_TURNSTILE_SITE_KEY: envField.string({
        context: 'client',
        access: 'public',
        optional: true,
      }),
      PUBLIC_WHATSAPP_NUMBER: envField.string({
        context: 'client',
        access: 'public',
        optional: true,
      }),
    },
  },
  security: {
    checkOrigin: true,
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data: https://res.cloudinary.com",
        "font-src 'self'",
        `connect-src 'self' ${TURNSTILE}`,
        `frame-src ${TURNSTILE}`,
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
      scriptDirective: { resources: ["'self'", TURNSTILE] },
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
