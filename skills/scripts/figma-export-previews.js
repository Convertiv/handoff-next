#!/usr/bin/env node
/**
 * Export design preview screenshots for all components using their figma: node IDs.
 *
 * Run from the root of a handoff project:
 *   npx figma-export-previews [flags]
 *
 * Output: public/images/components/design/{id}/preview.png
 *
 * Flags:
 *   --overwrite        Re-download even if preview.png already exists
 *   --component <id>   Only process a single component (repeatable)
 *   --scale <n>        Export scale factor (default: 1, max: 4)
 *   --dry-run          Print what would be downloaded without writing anything
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

// ---------------------------------------------------------------------------
// Project root / config
// ---------------------------------------------------------------------------

const PROJECT_ROOT = process.cwd();
require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env') });

const configPath = path.join(PROJECT_ROOT, 'figma-config.js');
if (!fs.existsSync(configPath)) {
  console.error('figma-config.js not found. Run: npx figma-init');
  process.exit(1);
}

const TOKEN  = process.env.HANDOFF_DEV_ACCESS_TOKEN;
const config = require(configPath);

const PUBLIC_ROOT     = path.join(PROJECT_ROOT, 'public');
const COMPONENTS_ROOT = path.join(PROJECT_ROOT, config.componentsDir);

if (!TOKEN) { console.error('Missing HANDOFF_DEV_ACCESS_TOKEN in .env'); process.exit(1); }

const args      = process.argv.slice(2);
const OVERWRITE = args.includes('--overwrite');
const DRY_RUN   = args.includes('--dry-run');
const SCALE     = (() => { const i = args.indexOf('--scale'); return i !== -1 ? parseFloat(args[i+1]) || 1 : 1; })();
const ONLY_IDS  = (() => {
  const ids = [];
  for (let i = 0; i < args.length; i++) if (args[i] === '--component' && args[i+1]) ids.push(args[i+1]);
  return ids.length ? new Set(ids) : null;
})();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function figmaGet(endpoint) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.figma.com/v1${endpoint}`, { headers: { 'X-Figma-Token': TOKEN } }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`Figma ${res.statusCode}: ${body.slice(0, 300)}`));
        resolve(JSON.parse(body));
      });
    }).on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close(); fs.unlink(dest, () => {});
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close(); fs.unlink(dest, () => {});
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Parse fileKey + nodeId from a figma: URL
// https://www.figma.com/design/{fileKey}/{fileName}?node-id={id}
function extractFigmaIds(figmaUrl) {
  const m = figmaUrl && figmaUrl.match(/\/design\/([^/]+)\/[^?]*\?node-id=([0-9]+-[0-9]+)/);
  if (!m) return null;
  return { fileKey: m[1], nodeId: m[2].replace('-', ':') };
}

const BATCH_SIZE  = 10;
const BATCH_DELAY = 2000;

// ---------------------------------------------------------------------------
// Discover components
// ---------------------------------------------------------------------------

function loadComponent(jsPath) {
  try {
    const src = fs.readFileSync(jsPath, 'utf8');
    const mod = { exports: {} };
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', src)(mod, mod.exports);
    return mod.exports;
  } catch { return null; }
}

function discoverComponents() {
  const entries = [];
  const dirs = fs.readdirSync(COMPONENTS_ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory()).map(d => d.name);

  for (const dir of dirs) {
    const jsFile = path.join(COMPONENTS_ROOT, dir, `${dir}.js`);
    if (!fs.existsSync(jsFile)) continue;
    const comp = loadComponent(jsFile);
    if (!comp || !comp.figma) continue;
    const ids = extractFigmaIds(comp.figma);
    if (!ids) { console.warn(`  WARN ${dir}: could not parse fileKey/nodeId from figma URL`); continue; }
    if (ONLY_IDS && !ONLY_IDS.has(dir)) continue;
    entries.push({ id: comp.id || dir, fileKey: ids.fileKey, nodeId: ids.nodeId });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  console.log('figma-export-previews: discovering components…\n');

  const components = discoverComponents();
  if (components.length === 0) { console.log('No components found with figma: URLs.'); return; }
  console.log(`Found ${components.length} component(s).\n`);

  const toDownload = components.filter(({ id }) => {
    const dest = path.join(PUBLIC_ROOT, 'images', 'components', 'design', id, 'preview.png');
    if (!OVERWRITE && fs.existsSync(dest)) {
      console.log(`  SKIP ${id} (preview.png exists)`);
      return false;
    }
    return true;
  });

  if (toDownload.length === 0) { console.log('\nAll components already have preview.png.'); return; }

  if (DRY_RUN) {
    console.log('\n[dry-run] Would export:');
    toDownload.forEach(({ id, fileKey, nodeId }) => console.log(`  ${id}  file:${fileKey}  node:${nodeId}`));
    return;
  }

  // Group by fileKey — one batch call per Figma file
  const byFile = {};
  for (const comp of toDownload) (byFile[comp.fileKey] = byFile[comp.fileKey] || []).push(comp);

  console.log(`\nExporting ${toDownload.length} component(s) from ${Object.keys(byFile).length} file(s)…\n`);

  let ok = 0, skipped = 0, failed = 0;

  for (const [fileKey, comps] of Object.entries(byFile)) {
    console.log(`--- File: ${fileKey} (${comps.length} components) ---`);

    for (let i = 0; i < comps.length; i += BATCH_SIZE) {
      if (i > 0) await sleep(BATCH_DELAY);
      const batch = comps.slice(i, i + BATCH_SIZE);
      console.log(`  Batch ${Math.floor(i/BATCH_SIZE)+1}/${Math.ceil(comps.length/BATCH_SIZE)} (${batch.length} nodes)…`);

      let imageUrls;
      try {
        const ids = batch.map(c => c.nodeId).join(',');
        const data = await figmaGet(`/images/${fileKey}?ids=${encodeURIComponent(ids)}&format=png&scale=${SCALE}`);
        if (data.err) throw new Error(data.err);
        imageUrls = data.images ?? {};
      } catch (err) {
        console.error(`  Batch failed: ${err.message}`);
        failed += batch.length; continue;
      }

      for (const comp of batch) {
        const url  = imageUrls[comp.nodeId];
        const dest = path.join(PUBLIC_ROOT, 'images', 'components', 'design', comp.id, 'preview.png');
        if (!url) { console.warn(`  SKIP ${comp.id} — no URL`); skipped++; continue; }
        process.stdout.write(`  ${comp.id} … `);
        try {
          await downloadFile(url, dest);
          console.log(`${Math.round(fs.statSync(dest).size / 1024)}KB`);
          ok++;
        } catch (err) { console.log(`FAILED (${err.message})`); failed++; }
      }
    }
  }

  console.log(`\nDone. ${ok} downloaded, ${skipped} skipped, ${failed} failed.`);
})();
