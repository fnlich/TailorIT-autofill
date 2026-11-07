/*
 * v4 ui (the owner, 2026-11-07: "all explanation will be tooltip. if user hover on ?button, show the explanation like
 * tooltip"): a small "?" ring button beside a heading or a control, whose explanation shows in a black bubble while the
 * pointer is over the button or the bubble, or while the button has the keyboard's focus (Jobright's look, screenshot
 * 6, in TailorIT's words). Escape hides it until the pointer or the focus comes back. The bubble is the button's
 * description (role="tooltip", aria-describedby), so a screen reader says it with the button whether it shows or not.
 *
 * Where it shows: centred over the "?", with its arrow pointing at it, at most 260px wide; below the "?" when there is
 * no room above; moved sideways to stay inside the window (the side panel is narrow), its arrow still on the "?". It is
 * placed with fixed coordinates through the CSSOM (no style attribute a page's CSP would govern), read again while it
 * shows when the page scrolls or the window resizes. The side panel and the options page draw it; the in-page panel
 * never does. It holds only the extension's own words.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { COPY } from '../../shared/copy';
import { Icon } from '../brand/Icon';

/** The room kept between the "?" and the bubble, and between the bubble and the window's edges. */
const GAP = 8;
const EDGE = 4;

export interface HelpTipProps {
  /** The explanation. */
  text: string;
  /** What it explains ("Autofill after page turn"): the button's accessible name says "About …". */
  topic: string;
  /** The bubble's id, for a group the explanation describes too (aria-describedby); one of its own otherwise. */
  id?: string;
  className?: string;
}

export function HelpTip({ text, topic, id: given, className }: HelpTipProps) {
  const own = useId();
  const id = given ?? own;
  const button = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  /** Escape hid it: it stays hidden until the pointer and the focus have both left and one comes back. */
  const [dismissed, setDismissed] = useState(false);
  const open = (hovered || focused) && !dismissed;

  const place = useCallback(() => {
    const anchor = button.current;
    const tip = bubble.current;
    const view = anchor?.ownerDocument.defaultView;
    if (!anchor || !tip || !view) return;
    const box = anchor.getBoundingClientRect();
    const size = tip.getBoundingClientRect();
    const above = box.top - size.height - GAP >= EDGE;
    const centre = box.left + box.width / 2;
    const left = Math.max(EDGE, Math.min(centre - size.width / 2, view.innerWidth - size.width - EDGE));
    tip.style.top = `${above ? box.top - size.height - GAP : box.bottom + GAP}px`;
    tip.style.left = `${left}px`;
    tip.style.setProperty('--tia-tip-arrow', `${Math.round(centre - left)}px`);
    tip.dataset.place = above ? 'above' : 'below';
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place, text]);

  useEffect(() => {
    if (!open) return undefined;
    const doc = button.current?.ownerDocument;
    const view = doc?.defaultView;
    if (!doc || !view) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDismissed(true);
    };
    doc.addEventListener('keydown', onKey);
    view.addEventListener('scroll', place, true);
    view.addEventListener('resize', place);
    return () => {
      doc.removeEventListener('keydown', onKey);
      view.removeEventListener('scroll', place, true);
      view.removeEventListener('resize', place);
    };
  }, [open, place]);

  return (
    <span className={`tia-helptip${className === undefined ? '' : ` ${className}`}`} data-helptip=""
      onPointerEnter={() => setHovered(true)} onPointerLeave={() => {
        setHovered(false);
        // Both gone: the next hover or focus shows it again.
        if (!focused) setDismissed(false);
      }}>
      <button type="button" ref={button} className="tia-helptip__button" aria-label={COPY.help.about(topic)}
        aria-describedby={id} data-open={open ? '' : undefined} onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (!hovered) setDismissed(false);
        }}
        onClick={() => setDismissed(false)}>
        <Icon name="help" size={15} className="tia-icon" />
      </button>
      <span ref={bubble} className="tia-helptip__bubble" role="tooltip" id={id} hidden={!open}>{text}</span>
    </span>
  );
}
