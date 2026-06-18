# Figma Integration Setup

Bootstrap the Figma image pipeline for this handoff project. Run this when:
- Setting up a new handoff project from scratch
- Adding a new Figma file to an existing project
- The componentMap is empty or incomplete and you want to auto-fill it

## What this skill does

1. Validates `figma-config.js` exists and has the minimum required fields
2. Runs the crawl in discovery mode to find all Figma instances
3. Reads the component directory to understand available handoff components
4. Auto-matches Figma instances to component IDs using semantic reasoning
5. Writes the completed `componentMap` and `componentMapByNodeId` back to `figma-config.js`
6. Runs the full pipeline in the correct order
7. Wires the image browser into the build

---

## Step 1 — Validate config

Read `figma-config.js`. Check that:
- `files[]` has at least one entry with `key` and `sections`
- `componentsDir` points to a real directory
- `projectId` and `projectName` are set

If `figma-config.js` is missing, tell the user to copy it from the Cynosure project and fill in their project values. Do not proceed until the file exists with at least one file key and one section.

If `files[].sections` is empty, tell the user to open their Figma file, navigate to the top-level page, and grab the node IDs for each full-page section frame. The section ID is in the Figma URL when the frame is selected: `?node-id=15803-11136` → `15803:11136`.

---

## Step 2 — Discovery crawl

Run the crawl in discovery mode (no writes, no downloads):

```bash
cd src/handoff && node scripts/figma-crawl.js --no-sizes --no-image-map 2>&1 | head -200
```

Capture the full output. Look for two things:

**A. Section fetch results** — lines like:
```
  Home: 14 image(s), 8 instance(s)
  Solution > Product: 6 image(s), 3 instance(s)
```
This confirms sections are resolving. If a section says `SKIP: not in response`, the node ID in `figma-config.js` is wrong — tell the user to re-copy it from Figma.

**B. UNMAPPED instances** — lines like:
```
  UNMAPPED  [Home]  "Main Hero"  (15803:11205)
  UNMAPPED  [Home]  "ScrollSlider"  (15803:11291)
  UNMAPPED  [Solution > Product]  "Hero"  (15822:19098)
```
Collect every UNMAPPED line into a list: `{ sectionName, instanceName, nodeId }`.

If there are zero UNMAPPED lines, the componentMap is already complete — skip to Step 4.

---

## Step 3 — Auto-match instances to components

Read the components directory (from `config.componentsDir`). For each component, read its `.js` file and extract:
- `id` — the component identifier
- `title` — human-readable name
- `description` — what the component does (if present)

Now perform semantic matching between the UNMAPPED Figma instances and the available component IDs.

**Matching rules (in priority order):**

1. **Exact ID match** — instance name lowercased + underscored equals a component ID (`"Main Hero"` → `main_hero`)
2. **Semantic match** — instance name clearly describes the same UI pattern as a component's title/description (e.g. `"ScrollSlider"` → `media_slider`, `"Card Grid"` → `treatment_grid`)
3. **Section + name** — the same instance name in different sections maps to different components (e.g. `"Hero"` in `Solution > Product` → `split_hero`, `"Hero"` in `About Us` → `simple_header`)
4. **Null** — instance name matches a UI primitive (Button, Icon, List Item, Pagination, Search) that doesn't have a handoff component — map to `null`
5. **Unknown** — you genuinely cannot determine the match — leave as a comment for the user to fill in

For cases where the same instance name appears in multiple sections with different meanings, use section-specific keys: `'solution-product/Hero': 'split_hero'`.

For cases where the same generic instance name (like "Card") appears multiple times in one section, use `componentMapByNodeId` with the node ID as the key, mapping only the FIRST occurrence to the real component and the rest to `null`.

Build a complete `componentMap` and `componentMapByNodeId` object from your matches. Where you are unsure, add an inline comment `// TODO: verify`.

---

## Step 4 — Write the config

Update `figma-config.js` with the matched maps. Do not touch `files[]`, `projectId`, `projectName`, `componentsDir`, or `componentImageMap`.

Show the user a summary of your matches:
- How many instances matched automatically
- How many were set to `null` (primitives)
- How many are `// TODO: verify` (uncertain)

Ask the user to review the uncertain ones before continuing. If they approve, proceed.

---

## Step 5 — Run the full pipeline

Run each step in order, checking for errors before moving to the next:

### Pass 1: Download Figma section images
```bash
cd src/handoff && node scripts/figma-crawl.js --no-links --no-sizes --no-image-map
```
Expect: images downloaded to `public/images/figma-export/`. Report count per section.

### Pass 2: Write figma: URLs to component JS files
```bash
cd src/handoff && node scripts/figma-crawl.js --no-download --no-sizes --no-image-map
```
Expect: LINKED lines for each matched component. Any remaining UNMAPPED lines need manual attention.

### Pass 3: Check placeholder dimensions (report only)
```bash
cd src/handoff && node scripts/figma-crawl.js --no-download --no-links --no-image-map
```
Review the output. If mismatches look significant, run again with `--apply-sizes` to write them.

### Pass 4: Export component preview screenshots
```bash
cd src/handoff && node scripts/figma-export-previews.js
```
Expect: `preview.png` written for each component with a `figma:` URL.

### Pass 5: Replace placehold.co with real image fills
```bash
cd src/handoff && node scripts/figma-extract-design-images.js
```
Expect: `image-1.png`, `image-2.png` etc. written for components that have image placeholders in their design preview. Report which components were updated and which were skipped (no fills found).

### Pass 6: Build the image browser
```bash
cd src/handoff && node build/generate-image-browser.js --skip-zip
```
Expect: `out/{projectId}/image-browser/index.html` generated.

---

## Step 6 — Wire up the build

Check `src/handoff/package.json`. Ensure these scripts exist:

```json
"build:image-browser": "node build/generate-image-browser.js",
"build:app": "... && node build/generate-image-browser.js"
```

Add them if missing. Also check `build/generate-visual-reports-index.js` — if it exists, add a link to the image browser in the visual reports subtitle section.

---

## Step 7 — Report results

Tell the user:
- How many components now have a `figma:` URL
- How many have `preview.png`
- How many had placehold.co replaced with real images
- How many sections are in the image browser
- Any components that still need manual attention (UNMAPPED or TODO)

If any components could not be matched, list them with their Figma instance name and node ID so the user can decide whether to map them or mark them `null`.
