// A small WordprocessingML writer, enough for a 教案: styled paragraphs, plain
// tables and a boxed area. Page, fonts and styles follow the course format
// (A4, 2.54 cm / 3.17 cm margins, SimSun body with SimHei labels, 小四 text).

import JSZip from 'jszip';

export type EaFont = 'SimSun' | 'SimHei' | 'KaiTi';

export interface Run {
  text: string;
  font?: EaFont;
  bold?: boolean;
}

export type StyleId = 'JTitle' | 'JItem' | 'JStage' | 'JSub' | 'JStep' | 'JBody' | 'JScript' | 'JCell';

export type Block =
  | { type: 'p'; style: StyleId; runs: Run[] }
  | { type: 'table'; widths: number[]; header?: string[]; rows: string[][] }
  | { type: 'box'; lines: string[] };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fonts = (ea: EaFont) => `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="${ea}" w:hint="eastAsia"/>`;

export const p = (style: StyleId, ...runs: (Run | string)[]): Block => ({ type: 'p', style, runs: runs.map((r) => (typeof r === 'string' ? { text: r } : r)) });

/** A numbered item such as "一、试讲人：张老师" with the label in SimHei. */
export const item = (label: string, value = ''): Block => p('JItem', { text: label, font: 'SimHei' }, value);

function runXml(r: Run) {
  const props = [r.font ? fonts(r.font) : '', r.bold ? '<w:b/>' : ''].join('');
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
}

function paraXml(style: StyleId, runs: Run[]) {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${runs.map(runXml).join('')}</w:p>`;
}

const BORDERS = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`).join('') + '</w:tblBorders>';

function tableXml(widths: number[], rows: { cells: string[]; bold?: boolean }[]) {
  const grid = `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
  const body = rows.map((row) => `<w:tr>${row.cells.map((cell, i) => {
    const paras = (cell || '').split('\n').map((line) => paraXml('JCell', [{ text: line, ...(row.bold ? { font: 'SimHei' as const } : {}) }])).join('');
    return `<w:tc><w:tcPr><w:tcW w:w="${widths[i]}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${paras}</w:tc>`;
  }).join('')}</w:tr>`).join('');
  const total = widths.reduce((a, b) => a + b, 0);
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:jc w:val="center"/>${BORDERS}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>${grid}${body}</w:tbl>`;
}

function blockXml(b: Block) {
  if (b.type === 'p') return paraXml(b.style, b.runs);
  if (b.type === 'table') {
    const rows = [...(b.header ? [{ cells: b.header, bold: true }] : []), ...b.rows.map((cells) => ({ cells }))];
    return tableXml(b.widths, rows) + paraXml('JBody', []);
  }
  return tableXml([8312], [{ cells: [b.lines.join('\n')] }]) + paraXml('JBody', []);
}

function style(id: StyleId, name: string, o: { font: EaFont; size: number; bold?: boolean; para: string }) {
  return `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:qFormat/>`
    + `<w:pPr>${o.para}</w:pPr><w:rPr>${fonts(o.font)}${o.bold ? '<w:b/>' : ''}<w:sz w:val="${o.size}"/><w:szCs w:val="${o.size}"/></w:rPr></w:style>`;
}

const BODY_INDENT = '<w:spacing w:line="360" w:lineRule="auto" w:after="0"/><w:ind w:firstLineChars="200" w:firstLine="480"/><w:jc w:val="both"/>';

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>${fonts('SimSun')}<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${style('JTitle', 'J Title', { font: 'SimHei', size: 30, para: '<w:jc w:val="center"/><w:spacing w:after="240"/>' })}
${style('JItem', 'J Item', { font: 'SimSun', size: 24, para: '<w:spacing w:line="360" w:lineRule="auto"/>' })}
${style('JStage', 'J Stage', { font: 'SimHei', size: 24, para: '<w:keepNext/><w:spacing w:before="120"/>' })}
${style('JSub', 'J Sub', { font: 'SimSun', size: 24, bold: true, para: '<w:keepNext/><w:spacing w:line="360" w:lineRule="auto"/><w:ind w:firstLineChars="200" w:firstLine="480"/>' })}
${style('JStep', 'J Step', { font: 'SimSun', size: 24, para: '<w:keepNext/><w:spacing w:line="360" w:lineRule="auto"/><w:ind w:firstLineChars="200" w:firstLine="480"/>' })}
${style('JBody', 'J Body', { font: 'SimSun', size: 24, para: BODY_INDENT })}
${style('JScript', 'J Script', { font: 'SimSun', size: 24, para: BODY_INDENT })}
${style('JCell', 'J Cell', { font: 'SimSun', size: 21, para: '<w:spacing w:line="300" w:lineRule="auto"/><w:jc w:val="left"/>' })}
</w:styles>`;

export async function buildDocx(blocks: Block[], meta: { title: string; creator?: string }): Promise<Blob> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`);
  zip.file('word/styles.xml', STYLES);
  zip.file('word/settings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="420"/><w:characterSpacingControl w:val="compressPunctuation"/></w:settings>`);
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(meta.title)}</dc:title><dc:creator>${esc(meta.creator ?? '')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`);
  const body = blocks.map(blockXml).join('');
  const sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1797" w:bottom="1440" w:left="1797" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>';
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}${sect}</w:body></w:document>`);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
