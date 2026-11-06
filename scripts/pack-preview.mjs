// Packs dist-preview/ into one self-contained HTML page (preview/voltline-preview.html)
// in the format claude.ai Artifacts expect (no <html>/<head>/<body>; those are added on publish).
import fs from 'node:fs';
import path from 'node:path';

const dir = 'dist-preview/assets';
const files = fs.readdirSync(dir);
const css = fs.readFileSync(path.join(dir, files.find((f) => f.endsWith('.css'))), 'utf8');
const js = fs.readFileSync(path.join(dir, files.find((f) => f.endsWith('.js'))), 'utf8').replace(/<\/script/gi, '<\\/script');

const html = `<title>Voltline Preview</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">
<style>
:root { color-scheme: light; }
${css}
</style>
<div id="root"><div class="boot">Loading Voltline…</div></div>
<script type="module">
${js}
</script>
`;
fs.mkdirSync('preview', { recursive: true });
fs.writeFileSync('preview/voltline-preview.html', html);
console.log(`preview/voltline-preview.html ${(html.length / 1024 / 1024).toFixed(2)} MB`);
