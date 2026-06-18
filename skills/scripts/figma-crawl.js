#!/usr/bin/env node
/**
 * Figma full-design crawl — four passes over all page sections.
 *
 * Run from the root of a handoff project (where figma-config.js lives):
 *   npx figma-crawl [flags]
 *
 * Flags:
 *   --no-download    skip Pass 1 (image download)
 *   --no-links       skip Pass 2 (figma URL writes)
 *   --no-sizes       skip Pass 3 (placeholder dimension report)
 *   --apply-sizes    Pass 3: write the dimension changes (default: report only)
 *   --no-image-map   skip Pass 4 (design preview image mapping)
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');

// ---------------------------------------------------------------------------
// Resolve project root and config
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
const MANIFEST_PATH   = path.join(PROJECT_ROOT, 'figma-crawl.manifest.json');

if (!TOKEN) { console.error('Missing HANDOFF_DEV_ACCESS_TOKEN in .env'); process.exit(1); }
if (!config.files || config.files.length === 0) {
  console.error('figma-config.js must define at least one entry in files[]');
  process.exit(1);
}

const args = process.argv.slice(2);
const RUN_DOWNLOAD  = !args.includes('--no-download');
const RUN_LINKS     = !args.includes('--no-links');
const RUN_SIZES     = !args.includes('--no-sizes');
const APPLY_SIZES   = args.includes('--apply-sizes');
const RUN_IMAGE_MAP = !args.includes('--no-image-map');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function figmaGet(endpoint) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.figma.com/v1${endpoint}`, { headers: { 'X-Figma-Token': TOKEN } }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`Figma ${res.statusCode}: ${body.slice(0, 200)}`));
        resolve(JSON.parse(body));
      });
    }).on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    const mod = url.startsWith('https') ? https : require('http');
    mod.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close(); fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function figmaUrl(fileKey, fileName, nodeId) {
  return `https://www.figma.com/design/${fileKey}/${fileName}?node-id=${nodeId.replace(':', '-')}`;
}

// ---------------------------------------------------------------------------
// Node tree helpers
// ---------------------------------------------------------------------------

function nodeWidth(node) { return node.absoluteBoundingBox?.width ?? 0; }
function nodeDims(node) {
  const bb = node.absoluteBoundingBox;
  return bb ? { width: Math.round(bb.width), height: Math.round(bb.height) } : null;
}

function findNodeById(node, targetId) {
  if (node.id === targetId) return node;
  if (node.children) {
    for (const c of node.children) {
      const found = findNodeById(c, targetId);
      if (found) return found;
    }
  }
  return null;
}

function collectImageFills(node, fills = [], containerDims = null) {
  const dims = nodeDims(node) ?? containerDims;
  if (node.fills && Array.isArray(node.fills)) {
    node.fills.filter(f => f.type === 'IMAGE' && f.imageRef).forEach(f => {
      fills.push({ hash: f.imageRef, nodeId: node.id, nodeName: node.name, dims });
    });
  }
  if (node.children) node.children.forEach(c => collectImageFills(c, fills, dims));
  return fills;
}

function collectInstances(node, depth = 0, results = []) {
  if (depth > 0 && node.type === 'INSTANCE') {
    results.push({ name: node.name, nodeId: node.id, dims: nodeDims(node) });
    return results;
  }
  if (depth < 6 && node.children) {
    node.children.forEach(c => collectInstances(c, depth + 1, results));
  }
  return results;
}

function find1920Frame(doc) {
  if (!doc.children) return null;
  return doc.children.find(n => n.type === 'FRAME' && nodeWidth(n) >= 1800) ?? null;
}

// ---------------------------------------------------------------------------
// Component .js helpers
// ---------------------------------------------------------------------------

function readComponentJs(componentId) {
  const p = path.join(COMPONENTS_ROOT, componentId, `${componentId}.js`);
  return fs.existsSync(p) ? { path: p, src: fs.readFileSync(p, 'utf8') } : null;
}

function upsertFigmaField(src, url) {
  if (/figma\s*:\s*['"]/.test(src)) {
    return src.replace(/figma\s*:\s*['"][^'"]*['"]/, `figma: '${url}'`);
  }
  return src.replace(/(image\s*:\s*'[^']*',?\n)/, `$1  figma: '${url}',\n`);
}

function parsePlaceholders(src) {
  const matches = [];
  const re = /https?:\/\/placehold\.co\/(\d+)x(\d+)[^\s'"`)]+/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    matches.push({ url: m[0], width: parseInt(m[1]), height: parseInt(m[2]), index: m.index });
  }
  return matches;
}

function replacePlaceholderDims(src, oldUrl, newW, newH) {
  const updated = oldUrl.replace(/(\d+)x(\d+)/, `${newW}x${newH}`);
  return { src: src.replace(oldUrl, updated), changed: oldUrl !== updated };
}

function figmaNodeIdFromSrc(src) {
  const m = src.match(/figma:\s*['"]https?:\/\/[^'"]*node-id=([\w%-]+)['"]/);
  if (!m) return null;
  const raw = decodeURIComponent(m[1]);
  return raw.replace(/^(\d+)-(\d+)$/, '$1:$2');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const fileLabels = config.files.map(f => f.label || f.name || f.key).join(', ');
  const totalSections = config.files.reduce((n, f) => n + f.sections.length, 0);
  console.log(`\n=== Figma Crawl — ${config.projectName} ===`);
  console.log(`    ${config.files.length} file(s): ${fileLabels}`);
  console.log(`    ${totalSections} section(s)\n`);

  // ── Step 0: Fetch all section node data (per file) ─────────────────────
  const allNodeData = {};
  console.log(`Fetching sections…`);
  for (const file of config.files) {
    const ids = file.sections.map(s => s.id).join(',');
    const { nodes } = await figmaGet(`/files/${file.key}/nodes?ids=${encodeURIComponent(ids)}`);
    Object.assign(allNodeData, nodes);
    console.log(`  ${file.label || file.name}: ${file.sections.length} fetched`);
  }
  console.log();

  const allSections = config.files.flatMap(file =>
    file.sections.map(section => ({ ...section, fileKey: file.key, fileName: file.name }))
  );

  const sectionResults = [];

  for (const section of allSections) {
    const nodeData = allNodeData[section.id];
    if (!nodeData) { console.warn(`  SKIP ${section.name}: not in response`); continue; }

    const sectionSlug = slug(section.name);
    const frame1920   = find1920Frame(nodeData.document);

    if (!frame1920) {
      console.warn(`  SKIP ${section.name}: no 1920px frame found`);
      continue;
    }

    const rawFills = collectImageFills(frame1920);
    const seenHashes = new Set();
    const fills = rawFills.filter(f => {
      if (seenHashes.has(f.hash)) return false;
      seenHashes.add(f.hash);
      return true;
    });

    const instances = collectInstances(frame1920);
    console.log(`  ${section.name}: ${fills.length} image(s), ${instances.length} instance(s)`);

    sectionResults.push({
      section, sectionSlug, frame1920, fills, instances,
      fileKey: section.fileKey, fileName: section.fileName,
    });
  }

  // ── Pass 1: IMAGE DOWNLOAD ────────────────────────────────────────────
  const allHashes = new Set(sectionResults.flatMap(r => r.fills.map(f => f.hash)));
  let imageManifest = [];

  if (RUN_DOWNLOAD && allHashes.size > 0) {
    console.log(`\n--- Pass 1: Images (${allHashes.size} unique) ---\n`);

    let imageUrls = {};
    console.log('Fetching download URLs…');
    for (const file of config.files) {
      const fileHasFills = sectionResults.some(r => r.fileKey === file.key && r.fills.length > 0);
      if (!fileHasFills) continue;
      const { meta } = await figmaGet(`/files/${file.key}/images`);
      const count = Object.keys(meta?.images ?? {}).length;
      console.log(`  ${file.label || file.name}: ${count} URL(s)`);
      Object.assign(imageUrls, meta?.images ?? {});
    }

    const hashToFile = new Map();

    for (const { sectionSlug, fills } of sectionResults) {
      for (let i = 0; i < fills.length; i++) {
        const { hash, nodeName, dims } = fills[i];

        if (hashToFile.has(hash)) {
          imageManifest.push({ sectionSlug, hash, file: hashToFile.get(hash), dims, alias: true });
          continue;
        }

        const url = imageUrls[hash];
        if (!url) { console.warn(`  SKIP ${hash.slice(0,12)}… — no download URL`); continue; }

        const safeName = slug(nodeName) || 'image';
        const filename = `${safeName}-${i + 1}.png`;
        const relPath  = `images/figma-export/${sectionSlug}/${filename}`;
        const dest     = path.join(PUBLIC_ROOT, relPath);

        process.stdout.write(`  /${relPath} … `);
        await downloadFile(url, dest);
        console.log('done');

        hashToFile.set(hash, `/${relPath}`);
        imageManifest.push({ sectionSlug, hash, file: `/${relPath}`, dims, nodeName });
      }
    }

    console.log(`\n  ${imageManifest.filter(m => !m.alias).length} images downloaded.`);
  } else if (!RUN_DOWNLOAD) {
    try {
      const existing = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
      imageManifest = existing.images ?? [];
      console.log(`\n  Pass 1 skipped; loaded ${imageManifest.length} entries from manifest.`);
    } catch {
      console.warn('  Pass 1 skipped; could not load existing manifest.');
    }
  }

  // ── Pass 2: FIGMA LINKS ───────────────────────────────────────────────
  const linkResults = [];
  const linkedComponents = new Set();

  if (RUN_LINKS) {
    console.log('\n--- Pass 2: Figma links ---\n');

    for (const { section, sectionSlug, instances, fileKey, fileName } of sectionResults) {
      for (const inst of instances) {
        const specificKey = `${sectionSlug}/${inst.name}`;
        const globalKey   = inst.name;

        let componentId = config.componentMap[specificKey] ?? config.componentMap[globalKey];
        if (componentId === undefined) componentId = config.componentMapByNodeId?.[inst.nodeId];

        if (componentId === undefined) {
          console.log(`  UNMAPPED  [${section.name}]  "${inst.name}"  (${inst.nodeId})`);
          continue;
        }
        if (componentId === null) continue;
        if (linkedComponents.has(componentId)) continue;

        const url  = figmaUrl(fileKey, fileName, inst.nodeId);
        const comp = readComponentJs(componentId);

        if (!comp) {
          console.warn(`  WARN: component file not found for "${componentId}"`);
          linkResults.push({ componentId, nodeId: inst.nodeId, url, status: 'missing' });
          continue;
        }

        const alreadySet = comp.src.includes(url);
        if (!alreadySet) {
          fs.writeFileSync(comp.path, upsertFigmaField(comp.src, url), 'utf8');
          console.log(`  LINKED    ${componentId}  →  ${url}`);
          linkResults.push({ componentId, nodeId: inst.nodeId, url, status: 'written' });
        } else {
          console.log(`  SKIP      ${componentId}  (already set)`);
          linkResults.push({ componentId, nodeId: inst.nodeId, url, status: 'unchanged' });
        }
        linkedComponents.add(componentId);
      }
    }
  }

  // ── Pass 3: IMAGE SIZE CHECK ──────────────────────────────────────────
  const sizeResults = [];

  if (RUN_SIZES) {
    const modeLabel = APPLY_SIZES ? '(writing changes)' : '(report only — add --apply-sizes to write)';
    console.log(`\n--- Pass 3: Size check ${modeLabel} ---\n`);

    const componentDirs = fs.readdirSync(COMPONENTS_ROOT, { withFileTypes: true })
      .filter(e => e.isDirectory()).map(e => e.name);

    for (const componentId of componentDirs) {
      const comp = readComponentJs(componentId);
      if (!comp) continue;
      const placeholders = parsePlaceholders(comp.src);
      if (placeholders.length === 0) continue;

      const nodeId = figmaNodeIdFromSrc(comp.src);
      if (!nodeId) { console.log(`  ${componentId}: no figma link — skip`); continue; }

      let instNode = null;
      for (const { frame1920 } of sectionResults) {
        instNode = findNodeById(frame1920, nodeId);
        if (instNode) break;
      }
      if (!instNode) { console.log(`  ${componentId}: node ${nodeId} not found`); continue; }

      const refFills = collectImageFills(instNode).filter(f => f.dims);
      let src = comp.src, changed = false;

      for (let i = 0; i < placeholders.length; i++) {
        const ph = placeholders[i];
        const figmaDims = refFills[i]?.dims ?? null;
        if (!figmaDims) continue;
        if (ph.width === figmaDims.width && ph.height === figmaDims.height) continue;

        const result = replacePlaceholderDims(src, ph.url, figmaDims.width, figmaDims.height);
        if (result.changed) {
          src = result.src; changed = true;
          console.log(`  ${componentId}  ${ph.width}x${ph.height}  →  ${figmaDims.width}x${figmaDims.height}  (${APPLY_SIZES ? 'UPDATED' : 'WOULD UPDATE'})`);
          sizeResults.push({ componentId, before: `${ph.width}x${ph.height}`, after: `${figmaDims.width}x${figmaDims.height}` });
        }
      }

      if (changed && APPLY_SIZES) fs.writeFileSync(comp.path, src, 'utf8');
    }

    if (sizeResults.length === 0) console.log('  All placeholder dimensions look correct.');
  }

  // ── Pass 4: DESIGN IMAGE MAPPING ─────────────────────────────────────
  const imageMappingResults = [];

  if (RUN_IMAGE_MAP && config.componentImageMap && Object.keys(config.componentImageMap).length > 0) {
    console.log('\n--- Pass 4: Design image mapping ---\n');

    const hashToFile = new Map();
    imageManifest.filter(m => !m.alias).forEach(m => hashToFile.set(m.hash, m.file));

    for (const [componentId, ref] of Object.entries(config.componentImageMap)) {
      const { fileKey, nodeId } = ref;
      const comp = readComponentJs(componentId);
      if (!comp) { console.log(`  ${componentId}: component file not found`); continue; }

      let instNode = null;
      for (const result of sectionResults) {
        if (result.fileKey !== fileKey) continue;
        instNode = findNodeById(result.frame1920, nodeId);
        if (instNode) break;
      }
      if (!instNode) { console.log(`  ${componentId}: node ${nodeId} not found`); continue; }

      const seenHashes = new Set();
      const fills = collectImageFills(instNode).filter(f => {
        if (seenHashes.has(f.hash)) return false;
        seenHashes.add(f.hash);
        return true;
      });
      if (fills.length === 0) { console.log(`  ${componentId}: no image fills`); continue; }

      const designIdx = comp.src.lastIndexOf('    design:');
      if (designIdx === -1) { console.log(`  ${componentId}: no design preview block`); continue; }

      const phRe = /https?:\/\/placehold\.co\/[^\s'"`)]+/g;
      const designPlaceholders = [];
      let m;
      while ((m = phRe.exec(comp.src.slice(designIdx))) !== null) {
        designPlaceholders.push({ url: m[0], globalIndex: designIdx + m.index });
      }
      if (designPlaceholders.length === 0) { console.log(`  ${componentId}: no placeholders in design section`); continue; }

      let src = comp.src, changed = false;

      for (let i = 0; i < Math.min(fills.length, designPlaceholders.length); i++) {
        const newFile = hashToFile.get(fills[i].hash);
        if (!newFile) { console.log(`  ${componentId}: fill ${i + 1} not in manifest`); continue; }
        if (!fs.existsSync(path.join(PUBLIC_ROOT, newFile))) { console.log(`  ${componentId}: file missing: ${newFile}`); continue; }

        const before = src;
        src = src.replace(designPlaceholders[i].url, newFile);
        if (src !== before) {
          console.log(`  ${componentId}  img ${i + 1}  →  ${newFile}`);
          changed = true;
          imageMappingResults.push({ componentId, fill: i + 1, file: newFile });
        }
      }

      if (changed) {
        fs.writeFileSync(comp.path, src, 'utf8');
        console.log(`  ${componentId}: updated`);
      }
    }

    if (imageMappingResults.length === 0) console.log('  No design images updated.');
  }

  // ── Manifest ──────────────────────────────────────────────────────────
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify({
    images: imageManifest, links: linkResults, sizes: sizeResults, imageMappings: imageMappingResults,
  }, null, 2));
  console.log(`\nManifest → figma-crawl.manifest.json\n`);
}

main().catch(err => { console.error('\nError:', err.message, err.stack); process.exit(1); });
