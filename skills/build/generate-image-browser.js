#!/usr/bin/env node
/**
 * Generate the Figma image-browser static page and pre-built zip files.
 *
 * Run from the root of a handoff project:
 *   npx figma-image-browser [--skip-zip]
 *
 * Output: out/{projectId}/image-browser/index.html
 */

const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = process.cwd();
const configPath   = path.join(PROJECT_ROOT, 'figma-config.js');

if (!fs.existsSync(configPath)) {
  console.error('figma-config.js not found. Run: npx figma-init');
  process.exit(1);
}

const config     = require(configPath);
const PROJECT_ID = config.projectId;
const EXPORT_DIR = path.join(PROJECT_ROOT, 'public', 'images', 'figma-export');
const OUT_DIR    = path.join(PROJECT_ROOT, 'out', PROJECT_ID, 'image-browser');
const SKIP_ZIP   = process.argv.includes('--skip-zip');

// Build slug → label from config (label field optional; falls back to section name)
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const SECTION_LABELS = {};
for (const file of config.files) {
  for (const section of file.sections) {
    const s = slugify(section.name);
    if (!SECTION_LABELS[s]) SECTION_LABELS[s] = section.label || section.name;
  }
}

const ZIP_NAME = slugify(config.projectName) + '-figma-assets.zip';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function titleCase(s) {
  return s.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getImageDimensions(filePath) {
  try {
    const out = execSync(`sips -g pixelWidth -g pixelHeight "${filePath}" 2>/dev/null`, {
      encoding: 'utf8', timeout: 5000,
    });
    const w = out.match(/pixelWidth:\s*(\d+)/)?.[1];
    const h = out.match(/pixelHeight:\s*(\d+)/)?.[1];
    return w && h ? { w: parseInt(w, 10), h: parseInt(h, 10) } : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Scan figma-export directory
// ---------------------------------------------------------------------------

function buildManifest() {
  const sections = [];
  const sectionDirs = fs.readdirSync(EXPORT_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory()).map(d => d.name).sort();

  let totalImages = 0, totalBytes = 0;

  for (const slug of sectionDirs) {
    const dir   = path.join(EXPORT_DIR, slug);
    const files = fs.readdirSync(dir).filter(f => /\.(png|jpg|jpeg|webp|svg)$/i.test(f)).sort();
    if (files.length === 0) continue;

    const images = [];
    for (const file of files) {
      const abs  = path.join(dir, file);
      const stat = fs.statSync(abs);
      const dims = getImageDimensions(abs);
      images.push({
        file, label: file.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
        bytes: stat.size, size: formatBytes(stat.size),
        w: dims?.w ?? null, h: dims?.h ?? null,
        src: `../images/figma-export/${slug}/${file}`,
        download: file,
      });
      totalImages++;
      totalBytes += stat.size;
    }

    sections.push({
      slug, label: SECTION_LABELS[slug] ?? titleCase(slug), images,
      totalBytes: images.reduce((s, i) => s + i.bytes, 0),
      totalSize:  formatBytes(images.reduce((s, i) => s + i.bytes, 0)),
    });
  }

  return { sections, totalImages, totalSize: formatBytes(totalBytes), totalBytes };
}

// ---------------------------------------------------------------------------
// Zip generation
// ---------------------------------------------------------------------------

function buildZips(manifest) {
  const imgPublicDir = path.join(PROJECT_ROOT, 'public', 'images');
  const fullZip = path.join(OUT_DIR, ZIP_NAME);

  console.log('  Building full zip…');
  try {
    execSync(`cd "${imgPublicDir}" && zip -r "${fullZip}" figma-export/ -x "*.DS_Store"`,
      { stdio: 'pipe', timeout: 120000 });
    console.log(`    ${ZIP_NAME}  ${formatBytes(fs.statSync(fullZip).size)}`);
  } catch (err) { console.warn('    Full zip failed:', err.message); }

  for (const section of manifest.sections) {
    const zipFile = path.join(OUT_DIR, `${section.slug}.zip`);
    try {
      execSync(
        `cd "${imgPublicDir}/figma-export" && zip -j "${zipFile}" "${section.slug}"/* -x "*.DS_Store"`,
        { stdio: 'pipe', timeout: 60000 });
      console.log(`    ${section.slug}.zip  ${formatBytes(fs.statSync(zipFile).size)}`);
    } catch (err) { console.warn(`    ${section.slug}.zip failed:`, err.message); }
  }
}

// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------

function generateHtml(manifest) {
  const { sections, totalImages, totalSize } = manifest;
  const projectName = config.projectName;

  const navLinks = sections.map(s =>
    `<a href="#${s.slug}" class="nav-link">${s.label} <span class="nav-count">${s.images.length}</span></a>`
  ).join('\n    ');

  const sectionBlocks = sections.map(s => {
    const cards = s.images.map(img => {
      const dims = img.w ? `${img.w} × ${img.h}` : '';
      return `
      <div class="card" data-name="${img.label.toLowerCase()}">
        <div class="thumb-wrap">
          <img class="thumb" loading="lazy" src="${img.src}" alt="${img.label}" />
        </div>
        <div class="card-meta">
          <span class="card-name" title="${img.file}">${img.file}</span>
          <span class="card-info">${dims ? dims + ' · ' : ''}${img.size}</span>
        </div>
        <a class="card-dl" href="${img.src}" download="${img.download}" title="Download ${img.file}">↓ Download</a>
      </div>`;
    }).join('');

    return `
  <section id="${s.slug}" class="section">
    <div class="section-header">
      <div>
        <h2 class="section-title">${s.label}</h2>
        <span class="section-meta">${s.images.length} image${s.images.length !== 1 ? 's' : ''} · ${s.totalSize}</span>
      </div>
      <a class="btn-secondary" href="${s.slug}.zip" download="${s.slug}-assets.zip">↓ Download section</a>
    </div>
    <div class="grid">${cards}</div>
  </section>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Figma Image Assets — ${projectName} Handoff</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f5f5f5; color: #1a1a1a; display: grid; grid-template-columns: 220px 1fr; grid-template-rows: auto 1fr; min-height: 100vh; }
    .site-header { grid-column: 1 / -1; background: #fff; border-bottom: 1px solid #ddd; padding: 16px 24px; display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
    .site-header h1 { font-size: 1.25rem; flex: 1; }
    .site-header .subtitle { color: #666; font-size: 0.875rem; margin-top: 2px; }
    .stats { display: flex; gap: 16px; }
    .stat { text-align: center; }
    .stat strong { display: block; font-size: 1.1rem; }
    .stat span { font-size: 0.75rem; color: #666; }
    .btn-primary { display: inline-flex; align-items: center; gap: 6px; background: #1565c0; color: #fff; border: none; padding: 8px 16px; border-radius: 5px; font-size: 0.875rem; font-weight: 600; text-decoration: none; white-space: nowrap; }
    .btn-primary:hover { background: #0d47a1; }
    .sidebar { background: #fff; border-right: 1px solid #ddd; padding: 16px 0; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
    .sidebar-title { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #999; padding: 0 16px 8px; }
    .search-wrap { padding: 0 12px 12px; }
    .search-input { width: 100%; padding: 6px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.8rem; outline: none; }
    .search-input:focus { border-color: #1565c0; }
    .nav-link { display: flex; justify-content: space-between; align-items: center; padding: 7px 16px; font-size: 0.8rem; color: #333; text-decoration: none; border-left: 3px solid transparent; }
    .nav-link:hover { background: #f5f5f5; color: #1565c0; }
    .nav-link.active { border-left-color: #1565c0; color: #1565c0; font-weight: 600; }
    .nav-count { background: #eee; color: #666; border-radius: 10px; font-size: 0.7rem; padding: 1px 6px; font-weight: normal; }
    main { padding: 24px; overflow-y: auto; }
    .section { margin-bottom: 40px; }
    .section-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 12px; flex-wrap: wrap; }
    .section-title { font-size: 1.1rem; font-weight: 700; margin-bottom: 2px; }
    .section-meta { font-size: 0.8rem; color: #666; }
    .btn-secondary { display: inline-flex; align-items: center; gap: 4px; background: #fff; color: #1565c0; border: 1px solid #1565c0; padding: 6px 12px; border-radius: 5px; font-size: 0.8rem; font-weight: 600; text-decoration: none; white-space: nowrap; }
    .btn-secondary:hover { background: #e3f2fd; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
    .card { background: #fff; border: 1px solid #ddd; border-radius: 6px; overflow: hidden; display: flex; flex-direction: column; transition: box-shadow 0.15s; }
    .card:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.12); }
    .card.hidden { display: none; }
    .thumb-wrap { background: #f0f0f0; aspect-ratio: 16 / 9; overflow: hidden; cursor: zoom-in; }
    .thumb { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; transition: transform 0.2s; }
    .card:hover .thumb { transform: scale(1.03); }
    .card-meta { padding: 8px 10px 4px; flex: 1; }
    .card-name { display: block; font-size: 0.75rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 2px; }
    .card-info { font-size: 0.7rem; color: #888; }
    .card-dl { display: block; text-align: center; padding: 6px; font-size: 0.75rem; font-weight: 600; color: #1565c0; text-decoration: none; border-top: 1px solid #eee; }
    .card-dl:hover { background: #e3f2fd; }
    .lightbox { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 1000; align-items: center; justify-content: center; }
    .lightbox.open { display: flex; }
    .lightbox img { max-width: 90vw; max-height: 90vh; object-fit: contain; border-radius: 4px; }
    .lightbox-close { position: absolute; top: 16px; right: 20px; color: #fff; font-size: 2rem; cursor: pointer; background: none; border: none; line-height: 1; }
    .lightbox-dl { position: absolute; bottom: 20px; color: #fff; font-size: 0.9rem; text-decoration: none; background: rgba(255,255,255,0.15); padding: 8px 16px; border-radius: 5px; backdrop-filter: blur(4px); }
    .lightbox-dl:hover { background: rgba(255,255,255,0.25); }
  </style>
</head>
<body>
<header class="site-header">
  <div style="flex:1">
    <h1>Figma Image Assets</h1>
    <div class="subtitle">${projectName} — extracted from Figma, grouped by page section</div>
  </div>
  <div class="stats">
    <div class="stat"><strong>${sections.length}</strong><span>Sections</span></div>
    <div class="stat"><strong>${totalImages}</strong><span>Images</span></div>
    <div class="stat"><strong>${totalSize}</strong><span>Total size</span></div>
  </div>
  <a class="btn-primary" href="${ZIP_NAME}" download="${ZIP_NAME}">↓ Download all images</a>
</header>
<nav class="sidebar">
  <div class="search-wrap">
    <input id="search" class="search-input" type="search" placeholder="Filter images…" autocomplete="off" />
  </div>
  <div class="sidebar-title">Sections</div>
  ${navLinks}
</nav>
<main id="main">
${sectionBlocks}
</main>
<div class="lightbox" id="lightbox" role="dialog" aria-modal="true">
  <button class="lightbox-close" id="lb-close" aria-label="Close">×</button>
  <img id="lb-img" src="" alt="" />
  <a class="lightbox-dl" id="lb-dl" href="" download="">↓ Download</a>
</div>
<script>
  const lb = document.getElementById('lightbox');
  const lbImg = document.getElementById('lb-img');
  const lbDl = document.getElementById('lb-dl');
  document.querySelectorAll('.thumb-wrap').forEach(wrap => {
    wrap.addEventListener('click', () => {
      const img = wrap.querySelector('.thumb');
      const dl = wrap.closest('.card').querySelector('.card-dl');
      lbImg.src = img.src; lbImg.alt = img.alt;
      lbDl.href = dl.href; lbDl.download = dl.download;
      lbDl.textContent = '↓ Download ' + dl.download;
      lb.classList.add('open');
    });
  });
  document.getElementById('lb-close').addEventListener('click', () => lb.classList.remove('open'));
  lb.addEventListener('click', e => { if (e.target === lb) lb.classList.remove('open'); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') lb.classList.remove('open'); });

  const searchInput = document.getElementById('search');
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    document.querySelectorAll('.section').forEach(section => {
      let visible = false;
      section.querySelectorAll('.card').forEach(card => {
        const show = !q || (card.dataset.name || '').includes(q);
        card.classList.toggle('hidden', !show);
        if (show) visible = true;
      });
      section.style.display = visible ? '' : 'none';
    });
  });

  const navLinks = document.querySelectorAll('.nav-link');
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        navLinks.forEach(l => l.classList.toggle('active', l.getAttribute('href') === '#' + id));
      }
    });
  }, { root: document.getElementById('main'), rootMargin: '-20% 0px -70% 0px' });
  document.querySelectorAll('.section[id]').forEach(s => observer.observe(s));
  navLinks.forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      document.getElementById(link.getAttribute('href').slice(1))
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  console.log(`generate-image-browser: ${config.projectName} (${PROJECT_ID})`);

  if (!fs.existsSync(EXPORT_DIR)) {
    console.error(`No figma-export directory found at public/images/figma-export/`);
    console.error('Run figma-crawl first to download the images.');
    process.exit(1);
  }

  console.log('  Reading image dimensions…');
  const manifest = buildManifest();
  console.log(`  ${manifest.totalImages} images across ${manifest.sections.length} sections (${manifest.totalSize})`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Copy figma-export into out/ so it's served alongside the HTML
  const outImagesDir = path.join(PROJECT_ROOT, 'out', PROJECT_ID, 'images', 'figma-export');
  if (!fs.existsSync(outImagesDir)) {
    console.log('  Copying figma-export to out/…');
    execSync(`cp -r "${EXPORT_DIR}" "${path.dirname(outImagesDir)}"`, { stdio: 'pipe' });
  } else {
    console.log('  figma-export already in out/ (delete to re-copy)');
  }

  if (SKIP_ZIP) {
    console.log('  Skipping zip generation (--skip-zip)');
  } else {
    console.log('  Building zip archives…');
    buildZips(manifest);
  }

  console.log('  Writing index.html…');
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), generateHtml(manifest), 'utf8');
  console.log(`  Written: out/${PROJECT_ID}/image-browser/index.html\n`);
})();
