import { createElement as h, useState, type ChangeEvent } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WriteValue } from '../core/types/intent';
import { fill } from './fillers';
import { loadFixture, logEvents, removeFixtures, untrustedViolations, type Fixture } from './fixture.testkit';
import { scan } from './scan';

/**
 * A real React 19 form with controlled inputs, rendered into the fixture's frame (docs/design/runtime.md §11.e,
 * react-controlled). React tracks each controlled input's value on the element itself; the fillers' prototype setters
 * and plain events must still reach its onChange, so after filling, React's state equals the filled values.
 */
interface FormState {
  first: string;
  email: string;
  about: string;
  degree: string;
  skills: string[];
  relocate: string;
  agree: boolean;
  tools: string[];
  start: string;
  stubborn: string;
}

const INITIAL: FormState = { first: '', email: '', about: '', degree: '', skills: [], relocate: '', agree: false,
  tools: ['go'], start: '', stubborn: '' };

const seen: { state: FormState } = { state: INITIAL };

function Form() {
  const [state, setState] = useState(INITIAL);
  seen.state = state;
  const set = (patch: Partial<FormState>) => setState((previous) => ({ ...previous, ...patch }));
  const text = (key: 'first' | 'email' | 'about' | 'start') =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set({ [key]: event.target.value });
  const toggleTool = (tool: string) => set({ tools: state.tools.includes(tool) ? state.tools.filter((t) => t !== tool)
    : [...state.tools, tool] });
  return h('form', { action: '/__submitted', method: 'post', onSubmit: (event) => event.preventDefault() },
    h('label', { htmlFor: 'first' }, 'First name'),
    h('input', { id: 'first', value: state.first, onChange: text('first') }),
    h('label', { htmlFor: 'email' }, 'Email'),
    h('input', { id: 'email', type: 'email', value: state.email, onChange: text('email') }),
    h('label', { htmlFor: 'about' }, 'Additional information'),
    h('textarea', { id: 'about', value: state.about, onChange: text('about') }),
    h('label', { htmlFor: 'degree' }, 'Degree'),
    h('select', { id: 'degree', value: state.degree, onChange: (event: ChangeEvent<HTMLSelectElement>) =>
      set({ degree: event.target.value }) },
      h('option', { value: '' }, 'Select...'), h('option', { value: 'bs' }, "Bachelor's Degree"),
      h('option', { value: 'ms' }, "Master's Degree")),
    h('label', { htmlFor: 'skills' }, 'Skills'),
    h('select', { id: 'skills', multiple: true, value: state.skills, onChange: (event: ChangeEvent<HTMLSelectElement>) =>
      set({ skills: Array.from(event.target.selectedOptions).map((option) => option.value) }) },
      h('option', { value: 'ts' }, 'TypeScript'), h('option', { value: 'pg' }, 'PostgreSQL'),
      h('option', { value: 'k8s' }, 'Kubernetes')),
    h('fieldset', null, h('legend', null, 'Are you willing to relocate?'),
      ...['yes', 'no'].map((value) => h('label', { key: value },
        h('input', { type: 'radio', name: 'relocate', value, checked: state.relocate === value,
          onChange: () => set({ relocate: value }) }), value === 'yes' ? ' Yes' : ' No'))),
    h('label', null, h('input', { type: 'checkbox', id: 'agree', checked: state.agree,
      onChange: (event: ChangeEvent<HTMLInputElement>) => set({ agree: event.target.checked }) }),
    ' I agree to the privacy policy'),
    h('fieldset', null, h('legend', null, 'Which tools do you use?'),
      ...[['go', 'Go'], ['rust', 'Rust'], ['java', 'Java']].map(([value, label]) => h('label', { key: value },
        h('input', { type: 'checkbox', name: 'tools', value, checked: state.tools.includes(value!),
          onChange: () => toggleTool(value!) }), ` ${label}`))),
    h('label', { htmlFor: 'start' }, 'Available start date'),
    h('input', { id: 'start', type: 'date', value: state.start, onChange: text('start') }),
    // A controlled input whose handler drops the change: React puts the old value back.
    h('label', { htmlFor: 'stubborn' }, 'Middle name'),
    h('input', { id: 'stubborn', value: state.stubborn, onChange: () => undefined }),
  );
}

describe('the fillers against a real React 19 controlled form', () => {
  let root: Root | null = null;
  afterEach(() => {
    root?.unmount();
    root = null;
    removeFixtures(document);
  });

  async function render(): Promise<Fixture> {
    const fixture = await loadFixture(document, '<!doctype html><body><div id="app"></div></body>');
    root = createRoot(fixture.doc.getElementById('app')!);
    flushSync(() => root!.render(h(Form)));
    return fixture;
  }

  it("leaves React's state equal to the filled values", async () => {
    const fixture = await render();
    const form = fixture.doc.querySelector('form')!;
    const log = logEvents(fixture.doc);
    const plan: Array<[string, WriteValue]> = [
      ['First name', { kind: 'text', text: 'Alex' }],
      ['Email', { kind: 'text', text: 'alex.rivera.f7q2@example.com' }],
      ['Additional information', { kind: 'text', text: 'Happy to share more.' }],
      ['Degree', { kind: 'option', index: 1, cleanLabel: "Bachelor's Degree" }],
      ['Skills', { kind: 'options', indices: [0, 1] }],
      ['Are you willing to relocate?', { kind: 'option', index: 0, cleanLabel: 'Yes' }],
      ['I agree to the privacy policy', { kind: 'check' }],
      ['Which tools do you use?', { kind: 'options', indices: [0, 1] }],
      ['Available start date', { kind: 'date', iso: '2026-12-01' }],
    ];
    for (const [label, value] of plan) {
      // Re-found by key before every write: React may have replaced nodes since the last one.
      const result = scan(form, null, { platform: 'greenhouse' });
      const field = result.fields.find((candidate) => candidate.label === label)!;
      expect([label, fill(result.target(field.key)!, value, { adapter: null, root: form }).verification])
        .toEqual([label, 'verified']);
    }
    await vi.waitFor(() => expect(seen.state).toEqual({
      first: 'Alex', email: 'alex.rivera.f7q2@example.com', about: 'Happy to share more.', degree: 'bs',
      skills: ['ts', 'pg'], relocate: 'yes', agree: true, tools: ['go', 'rust'], start: '2026-12-01', stubborn: '',
    }));
    expect((fixture.doc.getElementById('first') as HTMLInputElement).value).toBe('Alex');
    expect(untrustedViolations(log.events)).toEqual([]);
  });

  it('reports a controlled input whose handler drops the change as needs-your-click', async () => {
    const fixture = await render();
    const form = fixture.doc.querySelector('form')!;
    const result = scan(form, null, { platform: 'greenhouse' });
    const field = result.fields.find((candidate) => candidate.label === 'Middle name')!;
    expect(fill(result.target(field.key)!, { kind: 'text', text: 'Quinn' }, { adapter: null, root: form }))
      .toEqual({ wrote: false, verification: 'not-checked', reason: 'needs-your-click', needsUserAction: true });
    expect((fixture.doc.getElementById('stubborn') as HTMLInputElement).value).toBe('');
  });
});
