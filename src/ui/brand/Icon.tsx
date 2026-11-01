/*
 * The icons of src/shared/icons.ts in the extension's pages (the side panel, the options page, and the in-page panel's
 * React tree): the same data the page's own UI draws with svgOf, with only the shapes and attributes icons.ts allows,
 * renamed for React (stroke-width is strokeWidth). Decorative: aria-hidden, not focusable, never a <title>.
 */
import { createElement } from 'react';
import { ICONS, iconRootAttributes, SVG_ATTRIBUTES, SVG_TAGS, type IconDef, type IconName } from '../../shared/icons';

/** An SVG attribute's React name: kebab-case to camelCase. */
const reactName = (name: string) => name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());

/** The allowed attributes of `attrs`, by their React names. */
function propsOf(attrs: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(attrs).filter(([name]) => SVG_ATTRIBUTES.has(name))
    .map(([name, value]) => [reactName(name), value]));
}

/** A drawing, `size` CSS pixels square, in the text's colour. */
export function SvgIcon({ def, size, className }: { def: IconDef; size: number; className?: string }) {
  return (
    <svg viewBox={def.viewBox} width={size} height={size} aria-hidden="true" focusable="false" className={className}
      {...propsOf(iconRootAttributes(def))}>
      {def.parts.filter((part) => SVG_TAGS.has(part.tag)).map((part, index) => createElement(part.tag, { key: index, ...propsOf(part.attrs) }))}
    </svg>
  );
}

/** One of the extension's icons. */
export function Icon({ name, size = 16, className = 'tia-icon' }: { name: IconName; size?: number; className?: string }) {
  return <SvgIcon def={ICONS[name]} size={size} className={className} />;
}
