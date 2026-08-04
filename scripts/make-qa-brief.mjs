/**
 * Build `test/fixtures/qa-partner-brief.docx` — the input the QA script uses.
 *
 *   node scripts/make-qa-brief.mjs
 *
 * A generated fixture rather than a committed binary, for the same reasons as `make-docx-fixture.mjs`:
 * a `.docx` in git is an opaque blob nobody can review, and what this one contains is the whole point.
 * It is built to exercise three things at once, so one upload answers three questions:
 *
 * - **A three-column rewrite table** (Section / Old Copy / New Copy). The copy that must appear is in
 *   "New Copy"; anything from "Old Copy" appearing on the page is the bug this replaced.
 * - **A Component column** naming blocks in words the catalog does not use verbatim — "Split Content"
 *   against `content-split`, reversed — so name resolution is genuinely exercised rather than matched
 *   by luck.
 * - **One component that does not exist** ("Zig Zag Timeline"), so the substitution notice can be
 *   checked. Silent substitution was the reported failure.
 *
 * Headings and a bulleted list sit outside the table, so the structural conversion is visible too.
 */

import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const para = (text, style) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}` +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const listItem = (text, numId) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>` +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const cell = (text) => `<w:tc>${para(text)}</w:tc>`;
const row = (...cells) => `<w:tr>${cells.map(cell).join('')}</w:tr>`;

const document = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${para('8x8 Partner Programme — page copy', 'Heading1')}
${para('Draft 3. Use the New Copy column only.', 'Heading2')}
${listItem('All links go to # for now', 1)}
${listItem('Every CTA label reads Learn More', 1)}
<w:tbl>
  ${row('Section', 'Component', 'Old Copy', 'New Copy')}
  ${row('Hero', 'Hero Split', 'Become an 8x8 reseller', 'Partner with 8x8')}
  ${row('Why partner', 'Split Content', 'We have a partner scheme', 'Grow your business with the 8x8 partner programme.')}
  ${row('Benefits', 'Two Column Content', 'Margins are good', 'Higher margins, faster deal registration and dedicated support.')}
  ${row('Tiers', 'Card Rows', 'Three tiers', 'Silver, Gold and Platinum tiers with rising margins.')}
  ${row('Proof', 'Stats', 'We are big', '99.999% uptime. 180 countries. 3m seats under management.')}
  ${row('Questions', 'FAQ', 'Questions', 'How do I apply? How long does onboarding take?')}
  ${row('Close', 'Zig Zag Timeline', 'Sign up', 'Ready to apply?')}
</w:tbl>
</w:body></w:document>`;

const numbering = `<?xml version="1.0" encoding="UTF-8"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="10"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num>
</w:numbering>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

const packageRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const documentRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;

const zip = new JSZip();
zip.file('[Content_Types].xml', contentTypes);
zip.file('_rels/.rels', packageRels);
zip.file('word/document.xml', document);
zip.file('word/numbering.xml', numbering);
zip.file('word/_rels/document.xml.rels', documentRels);

const out = path.join(import.meta.dirname, '../test/fixtures/qa-partner-brief.docx');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer' }));
console.log(`wrote ${path.relative(process.cwd(), out)}`);
