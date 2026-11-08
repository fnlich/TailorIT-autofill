/*
 * Whether a trusted click on one of our boxes landed on what the person could see (the Phase 6 review, E1), for the
 * in-page panel (panel.ts) and, since v5, the sidebar (sidebar.ts): the visibility watch speaks for the box only, so the
 * click's point (a keyboard's click: the control's centre) must lie inside that box, inside its scrolling body for a
 * control there, and on the control itself (the nearest button on the event's path, else the box).
 */

/** Slack for a box's edges, in CSS pixels (sub-pixel layout). */
const EDGE_PX = 1;

/** Whether a point lies inside a box. */
function within(x: number, y: number, box: DOMRect): boolean {
  return x >= box.left - EDGE_PX && x <= box.right + EDGE_PX && y >= box.top - EDGE_PX && y <= box.bottom + EDGE_PX;
}

/**
 * Whether `event` reached a control inside `box` at a point the person could see: inside the box, on the control, and
 * inside the box's scrolling body (the element `bodySelector` finds in it) for a control in that body. A pointer's click
 * is judged at its point; a keyboard's (detail 0, no point) at the control's centre.
 */
export function landedInside(event: Event, box: HTMLElement, bodySelector: string): boolean {
  const path = event.composedPath();
  const at = path.indexOf(box);
  if (at < 0) return false;
  const control = (path.slice(0, at).find((node) => (node as Node).nodeType === 1
    && (node as Element).tagName === 'BUTTON') ?? box) as Element;
  const own = control.getBoundingClientRect();
  const mouse = event as MouseEvent;
  const pointer = typeof mouse.detail === 'number' && mouse.detail > 0;
  const x = pointer ? mouse.clientX : own.left + own.width / 2;
  const y = pointer ? mouse.clientY : own.top + own.height / 2;
  if (!within(x, y, box.getBoundingClientRect()) || !within(x, y, own)) return false;
  const body = box.querySelector(bodySelector);
  return body === null || !body.contains(control) || within(x, y, body.getBoundingClientRect());
}
