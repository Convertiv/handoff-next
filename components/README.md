# Exported components (git-tracked)

This directory receives **exports from the Handoff database** (dynamic mode) via **System → Export all to code** or per-component **Export to code** on a component page.

- Files are written in the same layout as legacy integration components (`<id>/<id>.js` manifest, `template.hbs`, `style.scss`, `script.js`).
- An automatic `git commit` runs after export when the repo is a git checkout.

Add this path to `handoff.config.js` → `entries.components` alongside your integration folder so the build pipeline can resolve them.
