import { BadRequestException } from '@nestjs/common';
import { SaxesParser } from 'saxes';

const tags = new Set([
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'defs',
  'linearGradient',
  'radialGradient',
  'stop',
]);
const attrs = new Set([
  'viewBox',
  'width',
  'height',
  'd',
  'x',
  'y',
  'x1',
  'x2',
  'y1',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'points',
  'fill',
  'stroke',
  'stroke-width',
  'opacity',
  'transform',
  'id',
  'offset',
  'stop-color',
]);
const escape = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Small static SVG subset only: no links, CSS, entities, images, animation or script. */
export function safeSvg(source: string): string {
  let output = '';
  let skip = 0;
  let depth = 0;
  const parser = new SaxesParser({ xmlns: false });
  parser.on('doctype', () => {
    throw new Error('DOCTYPE forbidden');
  });
  parser.on('error', (error) => {
    throw error;
  });
  parser.on('opentag', (tag) => {
    if (++depth > 64) throw new Error('SVG nesting limit exceeded');
    if (depth === 1 && tag.name !== 'svg') throw new Error('SVG root required');
    if (skip || !tags.has(tag.name)) {
      skip++;
      return;
    }
    output += `<${tag.name}`;
    if (depth === 1) output += ' xmlns="http://www.w3.org/2000/svg"';
    for (const [key, value] of Object.entries(tag.attributes)) {
      if (!attrs.has(key)) continue;
      if (
        ['fill', 'stroke', 'stop-color'].includes(key) &&
        !/^(none|currentColor|transparent|[a-z]+|#[0-9a-f]{3,8}|rgba?\([0-9.,%\s]+\)|url\(#[a-z0-9_-]+\))$/i.test(
          value,
        )
      )
        continue;
      output += ` ${key}="${escape(value)}"`;
    }
    output += '>';
  });
  parser.on('closetag', (tag) => {
    if (skip) skip--;
    else output += `</${tag.name}>`;
    depth--;
  });
  // Text, comments, processing instructions and CDATA are intentionally discarded.
  try {
    parser.write(source).close();
  } catch {
    throw new BadRequestException('Invalid or unsafe SVG');
  }
  if (!output.startsWith('<svg'))
    throw new BadRequestException('SVG root required');
  return output;
}
