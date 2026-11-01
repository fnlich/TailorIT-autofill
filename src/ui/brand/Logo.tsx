/*
 * TailorIT's mark and wordmark, as TailorIT draws them (apps/web/src/components/shell/Logo.tsx): the teal tile with its
 * white "T", and "TailorIT" extra-bold and tightly tracked. The "IT" is always TailorIT's ink (#08758c), never the
 * teal: the teal is a background colour, 2.97:1 on the side panel's canvas. The words come from COPY.brand, so the
 * name reads "TailorIT" to a screen reader and to the tests.
 */
import { COPY } from '../../shared/copy';
import { LOGO_MARK } from '../../shared/icons';
import { SvgIcon } from './Icon';

/** The mark, `size` CSS pixels square (decorative: the wordmark beside it names it). */
export function LogoMark({ size = 28 }: { size?: number }) {
  return <SvgIcon def={LOGO_MARK} size={size} className="tia-mark" />;
}

/** "TailorIT", its "IT" in the ink. `large`: the side panel's and the options page's header size. */
export function Wordmark({ large = false }: { large?: boolean }) {
  return (
    <span className={large ? 'tia-wordmark tia-wordmark--large' : 'tia-wordmark'}>
      {COPY.brand.name[0]}
      <span className="tia-wordmark__it">{COPY.brand.name[1]}</span>
    </span>
  );
}

/** The mark, the wordmark and the product's name ("TailorIT Autofill"), as a heading's content. */
export function Brand({ markSize, large = false }: { markSize: number; large?: boolean }) {
  return (
    <>
      <LogoMark size={markSize} />
      <span className="tia-brand__name">
        <Wordmark large={large} />
        {' '}
        <span className="tia-brand__product">{COPY.brand.product}</span>
      </span>
    </>
  );
}
