/* global window, document */
/*
 * The React-controlled form (index.html says why). Every input is controlled: its value comes from React's state and
 * changes only through its onChange. On every render the state is written to window.__reactState, which the React
 * spec reads from the page's main world and compares with what the fill wrote. The labels are ones the core's label
 * rules classify, so the golden profile answers every field.
 */
import { createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';

const INITIAL = { first: '', last: '', email: '', phone: '', degree: '', source: '', skills: [] };
const DEGREES = [['', 'Select...'], ['hs', 'High school'], ['bachelor', "Bachelor's Degree"], ['master', "Master's Degree"]];
const SOURCES = [['linkedin', 'LinkedIn'], ['indeed', 'Indeed'], ['other', 'Other']];
const SKILLS = [['typescript', 'TypeScript'], ['ruby', 'Ruby'], ['postgresql', 'PostgreSQL'], ['kubernetes', 'Kubernetes'],
  ['scala', 'Scala']];

function Form() {
  const [state, setState] = useState(INITIAL);
  window.__reactState = state;
  const set = (patch) => setState((previous) => ({ ...previous, ...patch }));
  const text = (key, label, type) => [
    h('label', { key: `${key}-label`, htmlFor: key }, label),
    h('input', { key, id: key, name: key, type, value: state[key], onChange: (event) => set({ [key]: event.target.value }) }),
  ];
  const toggle = (skill) => set({ skills: state.skills.includes(skill) ? state.skills.filter((held) => held !== skill)
    : [...state.skills, skill] });
  return h('form', { action: '/__submitted', method: 'post', onSubmit: (event) => event.preventDefault() },
    ...text('first', 'First name', 'text'),
    ...text('last', 'Last name', 'text'),
    ...text('email', 'Email', 'email'),
    ...text('phone', 'Phone', 'tel'),
    h('label', { htmlFor: 'degree' }, 'Degree'),
    h('select', { id: 'degree', name: 'degree', value: state.degree, onChange: (event) => set({ degree: event.target.value }) },
      ...DEGREES.map(([value, label]) => h('option', { key: value, value }, label))),
    h('fieldset', { id: 'source' }, h('legend', null, 'How did you hear about us?'),
      ...SOURCES.map(([value, label]) => h('label', { key: value },
        h('input', { type: 'radio', name: 'source', value, checked: state.source === value, onChange: () => set({ source: value }) }),
        ` ${label}`))),
    h('fieldset', { id: 'skills' }, h('legend', null, 'Which of these skills have you used?'),
      ...SKILLS.map(([value, label]) => h('label', { key: value },
        h('input', { type: 'checkbox', name: 'skills', value, checked: state.skills.includes(value), onChange: () => toggle(value) }),
        ` ${label}`))),
    h('button', { type: 'submit' }, 'Submit application'));
}

createRoot(document.getElementById('root')).render(h(Form));
