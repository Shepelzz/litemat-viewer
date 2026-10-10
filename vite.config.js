import { defineConfig } from 'vite';
import { SHOWCASES } from './src/showcases.js';

// OG/Twitter crawlers need absolute URLs. Render exposes RENDER_EXTERNAL_URL at build time;
// SITE_URL overrides it (e.g. a custom domain). Without either, tags fall back to root-relative paths.
const SITE_URL = (process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const siteUrl = { name: 'site-url', transformIndexHtml: html => html.replaceAll('__SITE_URL__', SITE_URL) };

// /demo/ and the showcase pages (src/showcases.js): copies of the page under their own URL — link previews are
// cached per URL, and a showcase opens its own build. <base href="../"> makes assets and samples load from the root.
const pages = {
  name: 'pages', enforce: 'post',
  generateBundle(_, bundle) {
    const html = bundle['index.html']?.source;
    if (typeof html !== 'string') return;
    const page = (dir, title) => {
      let out = html.replace('<head>', '<head>\n<base href="../">')
        .replace(`property="og:url" content="${SITE_URL}/"`, `property="og:url" content="${SITE_URL}/${dir}/"`);
      if (title) out = out.replace(/(property="og:title" content=")[^"]*/, `$1${title} — Litematica Viewer`)
        .replace(/(name="twitter:title" content=")[^"]*/, `$1${title} — Litematica Viewer`);
      this.emitFile({ type: 'asset', fileName: `${dir}/index.html`, source: out });
    };
    page('demo');
    for (const [dir, s] of Object.entries(SHOWCASES)) page(dir, s.title);
  },
};

// base: './' makes the build work from any path (domain root, GitHub Pages subfolder, file share)
export default defineConfig({
  base: './',
  plugins: [siteUrl, pages],
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
});
