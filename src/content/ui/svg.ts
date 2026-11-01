/*
 * Draws an icon of src/shared/icons.ts in the page's closed root: built node by node (createElementNS, setAttribute),
 * never parsed from markup, and only with the shapes and attributes icons.ts allows, so a drawing can carry no event
 * handler, link or style attribute. Every drawing is decorative (aria-hidden, not focusable, no <title>): the words
 * beside it say what it means, so a notice's text stays exactly its sentence.
 */
import { iconRootAttributes, SVG_ATTRIBUTES, SVG_TAGS, type IconDef } from '../../shared/icons';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** An <svg> of `def`, `size` CSS pixels square, in the text's colour. */
export function svgOf(doc: Document, def: IconDef, size: number, className = 'icon'): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', def.viewBox);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', className);
  for (const [name, value] of Object.entries(iconRootAttributes(def))) svg.setAttribute(name, value);
  for (const part of def.parts) {
    if (!SVG_TAGS.has(part.tag)) continue;
    const shape = doc.createElementNS(SVG_NS, part.tag);
    for (const [name, value] of Object.entries(part.attrs)) if (SVG_ATTRIBUTES.has(name)) shape.setAttribute(name, value);
    svg.append(shape);
  }
  return svg;
}
