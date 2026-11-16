// Builds the OBC Dance Card manual: content.mjs -> manual.html -> PDF (two passes, so the
// contents page can carry real page numbers). Run: node build.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.OBC_REPO ?? path.resolve(HERE, '../../..');
const require = createRequire(path.join(REPO, 'web/package.json'));
const { chromium } = require('@playwright/test');
const OUT = path.join(HERE, '..', 'OBC-Dance-Card-Manual.pdf');

function pngSize(name) {
  const b = fs.readFileSync(path.join(HERE, 'shots', name + '.png'));
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

let figNo = 0;
function figure(name, caption, widthMm, maxHmm, bottom = false) {
  const { w, h } = pngSize(name);
  const naturalH = (widthMm * h) / w;
  const clipped = maxHmm && naturalH > maxHmm;
  const boxH = clipped ? maxHmm : naturalH;
  figNo += 1;
  return `<figure style="width:${widthMm}mm">
    <div class="shot${clipped ? (bottom ? ' clipped-top' : ' clipped') : ''}" style="height:${boxH.toFixed(1)}mm"><img src="shots/${name}.png" alt=""${clipped && bottom ? ` style="margin-top:${(boxH - naturalH).toFixed(1)}mm"` : ''}></div>
    <figcaption><b>Figure ${figNo}.</b> ${caption}</figcaption></figure>`;
}
/** A row of phone-sized screenshots. items: [name, caption, maxHeightMm?] */
const phones = (...items) => {
  const width = items.length >= 3 ? 54 : items.length === 2 ? 60 : 64;
  const maxH = items.length >= 3 ? 100 : items.length === 2 ? 112 : 125;
  return `<div class="figrow">${items.map(([n, c, m]) => figure(n, c, width, m ?? maxH)).join('')}</div>`;
};
/** One wide (desktop) screenshot, captured at 2x; 700 CSS px prints 120 mm wide. */
const wide = (name, caption, maxHmm = 120, bottom = false) => {
  const widthMm = Math.min(172, pngSize(name).w * 0.0857);
  return `<div class="figrow">${figure(name, caption, widthMm, maxHmm, bottom)}</div>`;
};
/** Several small dialog screenshots side by side. */
const dialogs = (...items) => `<div class="figrow">${items.map(([n, c, wmm]) => figure(n, c, wmm ?? 80, 120)).join('')}</div>`;
const tip = (html) => `<div class="box tip"><span class="tag">Tip</span>${html}</div>`;
const note = (html) => `<div class="box note"><span class="tag">Note</span>${html}</div>`;
const warn = (html) => `<div class="box warn"><span class="tag">Important</span>${html}</div>`;

const { content, VERSION_DATE } = await import('./content.mjs');
const css = fs.readFileSync(path.join(HERE, 'manual.css'), 'utf8');

// Headings get ids and (pass 1 only) an invisible marker so pdftotext can tell us the page.
function assemble(body, pageOf) {
  // "text beside a figure" blocks: float the figure so the text can run on across pages.
  body = body.replace(
    /<div class="cols"><div>([\s\S]*?)<\/div>\n(<div class="figrow">[\s\S]*?<\/figure><\/div>)\n<\/div>/g,
    (m, text, fig) => `<div class="side"><div class="float">${fig}</div><div class="txt">${text}</div></div>`,
  );
  const heads = [];
  let i = 0;
  body = body.replace(/<(h1|h2)( class="[^"]*")?>([\s\S]*?)<\/\1>/g, (m, tag, cls, text) => {
    if ((cls ?? '').includes('notoc')) return m;
    const id = `h${++i}`;
    const part = /<span class="part">([\s\S]*?)<\/span>/.exec(text)?.[1] ?? '';
    heads.push({ id, tag, part, text: text.replace(/<span class="part">[\s\S]*?<\/span>/, '').replace(/<[^>]+>/g, '') });
    const marker = pageOf ? '' : `<span class="marker">@@${id}@@</span>`;
    return `<${tag}${cls ?? ''} id="${id}">${text}${marker}</${tag}>`;
  });
  let lastPart = '';
  const toc = heads
    .map((h) => {
      let pre = '';
      if (h.tag === 'h1' && h.part !== lastPart) {
        lastPart = h.part;
        if (h.part) pre = `<div class="toc-part">${h.part}</div>`;
      }
      return `${pre}<a class="toc-${h.tag}" href="#${h.id}"><span>${h.text}</span><i></i><b>${pageOf ? pageOf[h.id] ?? '' : '00'}</b></a>`;
    })
    .join('\n');
  return `<!doctype html><html lang="en-NZ"><head><meta charset="utf-8"><title>OBC Dance Card — User Manual</title><style>${css}</style></head><body>${body.replace('<!--TOC-->', toc)}</body></html>`;
}

const browser = await chromium.launch();
async function render(html, file) {
  const htmlPath = path.join(HERE, 'manual.html');
  fs.writeFileSync(htmlPath, html);
  const page = await browser.newPage();
  await page.goto('file://' + htmlPath, { waitUntil: 'load' });
  await page.pdf({
    path: file,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `<div style="width:100%;font:8pt 'Noto Sans',sans-serif;color:#667;padding:0 16mm;display:flex;justify-content:space-between"><span>Orewa Bridge Club — Dance Card User Manual</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
    margin: { top: '17mm', bottom: '19mm', left: '16mm', right: '16mm' },
    outline: true,
    tagged: true,
  });
  await page.close();
}

figNo = 0;
const body = content({ phones, wide, dialogs, tip, note, warn });
const tmp = path.join(HERE, 'pass1.pdf');
await render(assemble(body, null), tmp);
const text = execFileSync('pdftotext', ['-layout', tmp, '-'], { maxBuffer: 1 << 28 }).toString();
const pageOf = {};
text.split('\f').forEach((pg, idx) => {
  for (const m of pg.matchAll(/@@(h\d+)@@/g)) pageOf[m[1]] = idx + 1;
});
await render(assemble(body, pageOf), OUT);
fs.rmSync(tmp);
await browser.close();
console.log('wrote', OUT, 'figures:', figNo, 'headings mapped:', Object.keys(pageOf).length, 'date', VERSION_DATE);
