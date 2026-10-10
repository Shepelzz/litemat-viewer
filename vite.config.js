import { defineConfig } from 'vite';

// OG/Twitter crawlers need absolute URLs. Render exposes RENDER_EXTERNAL_URL at build time;
// SITE_URL overrides it (e.g. a custom domain). Without either, tags fall back to root-relative paths.
const SITE_URL = (process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const siteUrl = { name: 'site-url', transformIndexHtml: html => html.replaceAll('__SITE_URL__', SITE_URL) };

// /demo/ — a second URL for the same page, so link previews can be shared on a fresh address
// (Telegram caches previews per URL). <base href="../"> makes assets and sample.litematic load from the root.
const demoPage = {
  name: 'demo-page', enforce: 'post',
  generateBundle(_, bundle) {
    const html = bundle['index.html']?.source;
    if (typeof html !== 'string') return;
    const demo = html
      .replace('<head>', '<head>\n<base href="../">')
      .replace(`property="og:url" content="${SITE_URL}/"`, `property="og:url" content="${SITE_URL}/demo/"`);
    this.emitFile({ type: 'asset', fileName: 'demo/index.html', source: demo });
  },
};

// base: './' makes the build work from any path (domain root, GitHub Pages subfolder, file share)
export default defineConfig({
  base: './',
  plugins: [siteUrl, demoPage],
  // dev: the share API runs separately (`npm run api`, port 5231)
  // strictPort: if 5173 is taken, fail loudly instead of quietly sharing it with another server
  server: { port: 5173, strictPort: true, host: true, proxy: { '/api': 'http://localhost:5231' } },
  preview: { port: 4173, host: true },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
});
