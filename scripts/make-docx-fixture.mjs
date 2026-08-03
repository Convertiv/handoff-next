/**
 * Build `test/fixtures/copy-deck.docx`.
 *
 *   node scripts/make-docx-fixture.mjs
 *
 * A generator rather than a committed binary, for two reasons. A `.docx` in git is an opaque blob nobody
 * can review or extend — and the interesting cases here are precisely the ones nobody writes by hand:
 * mammoth emits `<td><p>text</p></td>` for a table cell, which is what broke the cell prefix, and it was
 * only visible converting a real zip.
 *
 * Minimal but genuinely valid OOXML: a `[Content_Types].xml`, package rels, `word/document.xml` and a
 * `word/numbering.xml` so mammoth can tell a bulleted list from a numbered one. Uses `jszip`, which
 * mammoth already depends on, so this adds nothing.
 */

import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const para = (text, style) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}` +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

/** A list item. `numId` 1 is the bulleted abstract numbering, 2 the decimal one. */
const listItem = (text, numId) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>` +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const cell = (text) => `<w:tc>${para(text)}</w:tc>`;

const document = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${para('Phone systems built for campus scale', 'Heading1')}
${para('One platform for every building, department and dorm.')}
${para('Why universities choose us', 'Heading2')}
${listItem('Runs on the network you already have', 1)}
${listItem('One bill for every campus', 1)}
${listItem('First, audit the lines', 2)}
${listItem('Then port the numbers', 2)}
<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Research &amp; teaching</w:t></w:r><w:r><w:t xml:space="preserve"> stay connected.</w:t></w:r></w:p>
<w:tbl>
  <w:tr>${cell('Section')}${cell('Copy')}</w:tr>
  <w:tr>${cell('Hero')}${cell('Talk to every building')}</w:tr>
</w:tbl>
</w:body></w:document>`;

const numbering = `<?xml version="1.0" encoding="UTF-8"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="10"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
  <w:abstractNum w:abstractNumId="20"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="20"/></w:num>
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

const out = path.join(import.meta.dirname, '../test/fixtures/copy-deck.docx');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer' }));
console.log(`wrote ${path.relative(process.cwd(), out)}`);
