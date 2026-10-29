import { afterEach, describe, expect, it } from 'vitest';

/** A same-origin srcdoc iframe with its own viewport and styles, the way DOM tests load fixtures. */
async function loadFixture(html: string): Promise<HTMLIFrameElement> {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width:1280px;height:800px;border:0';
  frame.srcdoc = html;
  const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  document.body.append(frame);
  await loaded;
  return frame;
}

describe('the browser-mode harness', () => {
  afterEach(() => document.querySelectorAll('iframe').forEach((frame) => frame.remove()));

  it('lays fixtures out in a real engine, inside their own frame', async () => {
    const frame = await loadFixture('<label for="first">First name</label><input id="first" style="width:200px">');
    const input = frame.contentDocument!.getElementById('first')!;
    const box = input.getBoundingClientRect();
    expect(box.width).toBeGreaterThan(100);
    expect(box.height).toBeGreaterThan(4);
  });

  it('has checkVisibility, which the visibility rules use where the browser offers it', async () => {
    const frame = await loadFixture('<p id="shown">Shown</p><p id="gone" style="display:none">Gone</p>');
    const doc = frame.contentDocument!;
    expect(typeof doc.getElementById('shown')!.checkVisibility).toBe('function');
    expect(doc.getElementById('shown')!.checkVisibility()).toBe(true);
    expect(doc.getElementById('gone')!.checkVisibility()).toBe(false);
  });

  it('marks events the code dispatches as untrusted, which is all the filler ever sends', async () => {
    const frame = await loadFixture('<input id="name">');
    const input = frame.contentDocument!.getElementById('name') as HTMLInputElement;
    let trusted: boolean | null = null;
    input.addEventListener('input', (event) => {
      trusted = event.isTrusted;
    });
    input.dispatchEvent(new (frame.contentWindow as unknown as typeof globalThis).Event('input', { bubbles: true }));
    expect(trusted).toBe(false);
  });
});
