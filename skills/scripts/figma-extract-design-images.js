#!/usr/bin/env node
/**
 * Extract real image fills from Figma nodes and replace placehold.co URLs
 * in each component's design preview.
 *
 * Run from the root of a handoff project:
 *   npx figma-extract-design-images [flags]
 *
 * Flags:
 *   --overwrite          Re-download even if images already exist
 *   --component <id>     Only process one component (repeatable)
 *   --dry-run            Print what would happen without writing
 *   --report-only        Download images but don't modify component JS
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

const args        = process.argv.slice(2);
const OVERWRITE   = args.includes('--overwrite');
const DRY_RUN     = args.includes('--dry-run');
const REPORT_ONLY = args.includes('--report-only');
const ONLY_IDS    = (() => {
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
    const req = (url.startsWith('https') ? https : require('http')).get(url, (res) => {
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
    });
    req.on('error', err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Parse fileKey + nodeId from a figma: URL
function extractFigmaIds(figmaUrl) {
  const m = figmaUrl && figmaUrl.match(/\/design\/([^/]+)\/[^?]*\?node-id=([0-9]+-[0-9]+)/);
  if (!m) return null;
  return { fileKey: m[1], nodeId: m[2].replace('-', ':') };
}

// ---------------------------------------------------------------------------
// Tree walker
// ---------------------------------------------------------------------------

function collectFills(node, fills = []) {
  if (node.fills && Array.isArray(node.fills)) {
    node.fills.filter(f => f.type === 'IMAGE' && f.imageRef).forEach(f => {
      if (!fills.find(x => x.hash === f.imageRef))
        fills.push({ hash: f.imageRef, nodeId: node.id, nodeName: node.name });
    });
  }
  if (node.children) for (const child of node.children) collectFills(child, fills);
  return fills;
}

// ---------------------------------------------------------------------------
// Component JS helpers
// ---------------------------------------------------------------------------

function countDesignPlaceholders(src) {
  const designStart = src.indexOf("design: {");
  if (designStart === -1) return 0;
  const after = src.slice(designStart);
  let depth = 0, end = 0;
  for (let i = after.indexOf('{'); i < after.length; i++) {
    if (after[i] === '{') depth++;
    else if (after[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return (after.slice(0, end + 1).match(/https:\/\/placehold\.co[^'"]+/g) || []).length;
}

function replaceDesignPlaceholders(src, imagePaths) {
  const designStart = src.indexOf("design: {");
  if (designStart === -1) return src;
  const after = src.slice(designStart);
  let depth = 0, end = 0;
  for (let i = after.indexOf('{'); i < after.length; i++) {
    if (after[i] === '{') depth++;
    else if (after[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  let idx = 0;
  const block = after.slice(0, end + 1).replace(/https:\/\/placehold\.co[^'"]+/g, () => {
    const img = imagePaths[idx++];
    return img || 'https://placehold.co/640x480/e6e7e8/414042?text=image';
  });
  return src.slice(0, designStart) + block + after.slice(end + 1);
}

// ---------------------------------------------------------------------------
// Discover targets
// ---------------------------------------------------------------------------

function discoverTargets() {
  const targets = [];
  const dirs = fs.readdirSync(COMPONENTS_ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory()).map(d => d.name);

  for (const dir of dirs) {
    const jsFile = path.join(COMPONENTS_ROOT, dir, `${dir}.js`);
    if (!fs.existsSync(jsFile)) continue;
    const src = fs.readFileSync(jsFile, 'utf8');
    const count = countDesignPlaceholders(src);
    if (count === 0) continue;

    const figmaMatch = src.match(/figma:\s*'([^']+)'/);
    if (!figmaMatch) { console.warn(`  WARN ${dir}: has placehold but no figma: URL`); continue; }
    const ids = extractFigmaIds(figmaMatch[1]);
    if (!ids) { console.warn(`  WARN ${dir}: could not parse ids from ${figmaMatch[1]}`); continue; }
    if (ONLY_IDS && !ONLY_IDS.has(dir)) continue;

    targets.push({ id: dir, fileKey: ids.fileKey, nodeId: ids.nodeId, jsFile, placeholderCount: count });
  }
  return targets;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  console.log('figma-extract-design-images: scanning components…\n');

  const targets = discoverTargets();
  if (targets.length === 0) {
    console.log('No components with placehold.co in design preview.');
    return;
  }

  console.log(`Found ${targets.length} component(s):\n`);
  targets.forEach(({ id, placeholderCount }) => console.log(`  ${id}: ${placeholderCount} placeholder(s)`));

  if (DRY_RUN) { console.log('\n[dry-run] Exiting.'); return; }

  console.log('\nFetching node trees…\n');

  const trees = {};
  for (let i = 0; i < targets.length; i++) {
    const { id, fileKey, nodeId } = targets[i];
    if (i > 0) await sleep(400);
    process.stdout.write(`  ${id} … `);
    try {
      let data = await figmaGet(`/files/${fileKey}/nodes?ids=${nodeId}&depth=8`);
      let nodeKey = Object.keys(data.nodes || {})[0];
      let doc = nodeKey ? data.nodes[nodeKey].document : null;
      if (doc && collectFills(doc).length === 0) {
        process.stdout.write('(deep) … ');
        await sleep(600);
        data = await figmaGet(`/files/${fileKey}/nodes?ids=${nodeId}`);
        nodeKey = Object.keys(data.nodes || {})[0];
        doc = nodeKey ? data.nodes[nodeKey].document : doc;
      }
      trees[id] = doc;
      console.log(trees[id] ? 'ok' : 'empty');
    } catch (err) { console.log(`FAILED (${err.message})`); trees[id] = null; }
  }

  const componentFills = {};
  const hashesByFile   = {};

  for (const { id, fileKey } of targets) {
    const node = trees[id];
    if (!node) { componentFills[id] = []; continue; }
    const fills = collectFills(node);
    componentFills[id] = fills;
    if (!hashesByFile[fileKey]) hashesByFile[fileKey] = new Set();
    fills.forEach(({ hash }) => hashesByFile[fileKey].add(hash));
  }

  const totalHashes = Object.values(hashesByFile).reduce((n, s) => n + s.size, 0);
  if (totalHashes === 0) {
    console.log('\nNo IMAGE fills found. Components may use vector fills or external URLs.');
    return;
  }

  console.log(`\nFound ${totalHashes} fill(s). Fetching download URLs…\n`);

  const fillUrls = {};
  for (const [fileKey] of Object.entries(hashesByFile)) {
    try {
      const data = await figmaGet(`/files/${fileKey}/images`);
      const urls = data.meta?.images ?? {};
      console.log(`  File ${fileKey}: ${Object.keys(urls).length} URL(s)`);
      Object.assign(fillUrls, urls);
    } catch (err) { console.error(`Failed for file ${fileKey}: ${err.message}`); }
  }

  let totalOk = 0, totalFailed = 0, totalSkipped = 0;

  for (const { id, jsFile, placeholderCount } of targets) {
    const fills = componentFills[id];
    console.log(`\n--- ${id} (${placeholderCount} placeholder(s), ${fills.length} fill(s)) ---`);

    if (fills.length === 0) { console.log('  No fills — skipping.'); totalSkipped++; continue; }

    const designDir = path.join(PUBLIC_ROOT, 'images', 'components', 'design', id);
    const downloadedPaths = [];

    for (let i = 0; i < fills.length; i++) {
      const { hash, nodeName } = fills[i];
      const filename = `image-${i + 1}.png`;
      const dest     = path.join(designDir, filename);
      const webPath  = `/images/components/design/${id}/${filename}`;

      if (!OVERWRITE && fs.existsSync(dest)) {
        console.log(`  SKIP ${filename} (exists)`); downloadedPaths.push(webPath); continue;
      }

      const url = fillUrls[hash];
      if (!url) {
        console.warn(`  MISSING URL for fill ${i + 1}`); downloadedPaths.push(null); totalFailed++; continue;
      }

      process.stdout.write(`  ${filename} (${nodeName || hash.slice(0, 8)}) … `);
      try {
        await downloadFile(url, dest);
        console.log(`${Math.round(fs.statSync(dest).size / 1024)}KB`);
        downloadedPaths.push(webPath); totalOk++;
      } catch (err) {
        console.log(`FAILED (${err.message})`); downloadedPaths.push(null); totalFailed++;
      }
    }

    // Cycle fills when fewer fills than placeholders
    if (fills.length > 0 && fills.length < placeholderCount) {
      console.log(`  NOTE: cycling ${fills.length} fill(s) across ${placeholderCount} slots.`);
      while (downloadedPaths.length < placeholderCount)
        downloadedPaths.push(downloadedPaths[downloadedPaths.length % fills.length]);
    } else {
      while (downloadedPaths.length < placeholderCount) downloadedPaths.push(null);
    }

    if (REPORT_ONLY) { console.log('  [report-only] Would update JS with:', downloadedPaths); continue; }

    if (!downloadedPaths.some(Boolean)) { console.log('  No valid paths — skipping JS.'); continue; }

    const src    = fs.readFileSync(jsFile, 'utf8');
    const newSrc = replaceDesignPlaceholders(src, downloadedPaths);
    if (newSrc === src) {
      console.log('  No changes (placeholders not matched).');
    } else {
      fs.writeFileSync(jsFile, newSrc, 'utf8');
      const replaced = (src.match(/https:\/\/placehold\.co[^'"]+/g) || []).length
        - (newSrc.match(/https:\/\/placehold\.co[^'"]+/g) || []).length;
      console.log(`  Updated: ${replaced} placeholder(s) replaced.`);
    }
  }

  console.log(`\nDone. ${totalOk} downloaded, ${totalSkipped} skipped (no fills), ${totalFailed} failed.`);
})();
