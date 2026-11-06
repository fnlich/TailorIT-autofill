// Lint config: TailorIT's base rules, plus the layer and purity rules that keep page content away from authority.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/** Globals the pure core may never touch: pass the value in, or return an effect for the orchestrator. */
const IMPURE_GLOBALS = ['window', 'self', 'document', 'navigator', 'location', 'history', 'chrome', 'browser', 'fetch',
  'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'crypto', 'performance',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame', 'requestIdleCallback',
  'queueMicrotask', 'structuredClone', 'MutationObserver', 'IntersectionObserver', 'ResizeObserver', 'Element',
  'HTMLElement', 'Node', 'Event', 'CustomEvent', 'EventTarget', 'DOMParser', 'TextEncoder', 'TextDecoder', 'Blob',
  'File', 'FileReader', 'DataTransfer', 'URL', 'URLSearchParams', 'atob', 'btoa', 'getComputedStyle', 'process',
  'Buffer', 'require', 'module', '__dirname', 'global'];

/** v3 Phase 4 (docs/SPEC-AMENDMENTS.md §12 Decision 6): the Submit exception's one door, dom/fillers/not-submit.ts's
 *  clickAdapterSubmit, is named nowhere but src/content/press.ts (imported, re-exported or read off a namespace). */
const SUBMIT_PRESS_RULE = {
  selector: "ImportSpecifier[imported.name='clickAdapterSubmit'], ExportSpecifier[local.name='clickAdapterSubmit'], "
    + "MemberExpression[property.name='clickAdapterSubmit']",
  message: 'Only src/content/press.ts presses the page\'s Submit (the person\'s Submit application, Submit mode Auto).',
};

/** v3 Phase 5: the auto-apply agent's press on a posting page's declared entry control (Apply, Application), named
 *  nowhere but src/content/press.ts, as clickAdapterSubmit is. */
const ENTRY_PRESS_RULE = {
  selector: "ImportSpecifier[imported.name='clickAdapterEntry'], ExportSpecifier[local.name='clickAdapterEntry'], "
    + "MemberExpression[property.name='clickAdapterEntry']",
  message: "Only src/content/press.ts presses a posting's entry control (the auto-apply agent's agent/enter).",
};

/** v3 Phase 5: Sign-in mode Auto's press on a sign-in form's button, named nowhere but src/content/sign-in.ts. */
const SIGN_IN_PRESS_RULE = {
  selector: "ImportSpecifier[imported.name='clickAdapterSignIn'], ExportSpecifier[local.name='clickAdapterSignIn'], "
    + "MemberExpression[property.name='clickAdapterSignIn']",
  message: "Only src/content/sign-in.ts presses a sign-in form's button (Sign-in mode Auto).",
};

/** v3 Phase 7b: Sign-in mode Auto's press on the control that shows a wall's form (Workday's "Sign in with email"),
 *  named nowhere but src/content/sign-in.ts, as clickAdapterSignIn is. */
const SIGN_IN_PRELUDE_RULE = {
  selector: "ImportSpecifier[imported.name='clickAdapterSignInPrelude'], "
    + "ExportSpecifier[local.name='clickAdapterSignInPrelude'], MemberExpression[property.name='clickAdapterSignInPrelude']",
  message: "Only src/content/sign-in.ts presses a sign-in page's prelude control (Sign-in mode Auto).",
};

/** v3 Phase 5 review: the wrappers around those two doors, press.ts pressEntry and sign-in.ts signIn, are called by
 *  src/content/runtime.ts alone (the agent's agent/enter from the worker, a run's sign-in pause), so no other module can
 *  reach a door through them. */
const ENTRY_WRAPPER_RULE = {
  selector: "ImportSpecifier[imported.name='pressEntry'], ExportSpecifier[local.name='pressEntry'], "
    + "MemberExpression[property.name='pressEntry']",
  message: "Only src/content/runtime.ts calls press.ts's pressEntry (the agent's agent/enter, from the worker alone).",
};
const SIGN_IN_WRAPPER_RULE = {
  selector: "ImportDeclaration[source.value=/(^|\\/)sign-in$/] > ImportSpecifier[imported.name='signIn'], "
    + "ImportDeclaration[source.value=/(^|\\/)sign-in$/] > ImportNamespaceSpecifier, ExportSpecifier[local.name='signIn']",
  message: "Only src/content/runtime.ts calls sign-in.ts's signIn (Sign-in mode Auto at a run's pause, or the agent's entry).",
};

/** Raw HTML, eval and form submission, banned everywhere in src: nothing may submit, and nothing parses markup. */
const UNSAFE_SYNTAX = [
  SUBMIT_PRESS_RULE,
  ENTRY_PRESS_RULE,
  SIGN_IN_PRESS_RULE,
  SIGN_IN_PRELUDE_RULE,
  ENTRY_WRAPPER_RULE,
  SIGN_IN_WRAPPER_RULE,
  { selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]", message: 'Build DOM nodes; never assign markup.' },
  { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: 'Build DOM nodes; never insert markup.' },
  { selector: "CallExpression[callee.object.name='document'][callee.property.name=/^write(ln)?$/]", message: 'No document.write.' },
  { selector: "CallExpression[callee.name='eval']", message: 'No eval.' },
  { selector: "NewExpression[callee.name='Function']", message: 'No new Function.' },
  { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'No raw HTML in React.' },
  { selector: "CallExpression[callee.property.name=/^(submit|requestSubmit)$/]", message: 'The extension never submits a form.' },
  { selector: 'DebuggerStatement', message: 'No debugger statements.' },
];

const TIMERS = ['setTimeout', 'setInterval'].map((name) => ({
  name,
  message: 'Timers live only in src/dom/time.ts and src/background/timers.ts: no fixed sleeps in fill logic.',
}));

const restrictImports = (patterns) => ['error', { patterns }];

export default tseslint.config(
  { ignores: ['node_modules/**', '.output*/**', '.wxt/**', 'e2e/artifacts/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'error',
      'no-restricted-syntax': ['error', ...UNSAFE_SYNTAX],
      'no-restricted-globals': ['error', ...TIMERS],
      'no-restricted-properties': ['error',
        { object: 'window', property: 'setTimeout', message: TIMERS[0].message },
        { object: 'window', property: 'setInterval', message: TIMERS[0].message }],
      '@typescript-eslint/no-restricted-imports': restrictImports([
        { group: ['wxt/browser', '@wxt-dev/browser'], message: 'Only src/platform touches the browser APIs.' },
      ]),
    },
  },
  { files: ['src/shared/log.ts'], rules: { 'no-console': 'off' } },
  { files: ['src/dom/time.ts', 'src/background/timers.ts'], rules: { 'no-restricted-globals': 'off', 'no-restricted-properties': 'off' } },
  { files: ['src/platform/**'], rules: { '@typescript-eslint/no-restricted-imports': 'off' } },
  {
    files: ['src/core/**/*.ts'],
    // *.testkit.ts: Node-side helpers for the core's tests (they load the bundled vocabularies from disk).
    ignores: ['src/core/**/*.test.ts', 'src/core/**/*.testkit.ts'],
    // No disable comments in the core: purity is not negotiable file by file.
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-restricted-globals': ['error', ...IMPURE_GLOBALS.map((name) => ({
        name, message: 'The core is pure: pass the value in, or return an effect for the orchestrator.' }))],
      'no-restricted-properties': ['error',
        { object: 'Math', property: 'random', message: 'No randomness in the core.' },
        { object: 'Date', property: 'now', message: 'Time is injected as `now`.' },
        { object: 'globalThis', message: 'No ambient globals in the core.' }],
      'no-restricted-syntax': ['error', ...UNSAFE_SYNTAX,
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'Time is injected as `now`.' },
        { selector: "CallExpression[callee.name='Date']", message: 'Date() reads the clock.' },
        { selector: 'ImportExpression', message: 'No dynamic import in the core.' }],
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [
          { group: ['wxt', 'wxt/*', '@wxt-dev/*', 'react', 'react-dom', 'react/*', 'react-dom/*', 'zod', 'zod/*'],
            message: 'The core imports no framework, browser API or zod: it works on validated data.' },
          { group: ['**/dom/**', '**/platform/**', '**/adapters/**', '**/content/**', '**/background/**', '**/ui/**',
            '**/entrypoints/**', '**/messaging/**', '**/shared/**', '@/*', '~/*', '#imports'],
            message: 'The core never imports impure layers.' },
          { group: ['node:*', 'fs', 'path', 'crypto'], message: 'No Node APIs in the core.' },
          { group: ['**/contract/**'], allowTypeImports: true, message: 'The core may only import types from the contract.' },
        ],
      }],
    },
  },
  {
    // The adapters' URL parsers and the application key run in the core's Vitest project, and are pure like it.
    files: ['src/adapters/**/url.ts', 'src/adapters/application-key.ts'],
    rules: {
      'no-restricted-globals': ['error', ...IMPURE_GLOBALS.map((name) => ({
        name, message: 'URL parsing is pure: it reads the address it is given, never the page, the clock or the browser.' }))],
      '@typescript-eslint/no-restricted-imports': restrictImports([
        { group: ['**/dom/**', '**/platform/**', '**/content/**', '**/background/**', '**/ui/**', '**/entrypoints/**',
          '**/messaging/**', '**/shared/**', 'wxt', 'wxt/*', '@wxt-dev/*', 'react', 'react-dom', 'zod', 'node:*'],
          message: 'URL parsing imports only the core and the application key.' },
      ]),
    },
  },
  {
    files: ['src/dom/**/*.ts'],
    ignores: ['src/dom/**/*.test.ts'],
    rules: {
      'no-restricted-globals': ['error', ...TIMERS, ...['chrome', 'browser', 'window', 'document', 'fetch'].map((name) => ({
        name, message: 'The DOM layer works from el.ownerDocument and its defaultView, never page globals.' }))],
      '@typescript-eslint/no-restricted-imports': restrictImports([
        { group: ['**/platform/**', '**/background/**', '**/ui/**', '**/content/**', 'react', 'react-dom', 'wxt/*', '#imports'],
          message: 'The DOM layer imports only core types.' },
      ]),
    },
  },
  { files: ['src/dom/time.ts'], rules: { 'no-restricted-globals': 'off' } },
  {
    // The page-world bridge runs in the page's own world (docs/SPEC-AMENDMENTS.md §12): it imports its protocol and
    // nothing else of the app, no framework and no browser API, so it stays tiny and can hold no data.
    files: ['src/page/**/*.ts'],
    ignores: ['src/page/**/*.test.ts'],
    rules: {
      'no-restricted-globals': ['error', ...TIMERS, ...['chrome', 'browser', 'window', 'document', 'postMessage', 'fetch',
        'XMLHttpRequest', 'localStorage', 'sessionStorage', 'indexedDB'].map((name) => ({
        name, message: 'The page-world bridge works from the document it is given, and reaches no extension or network API.' }))],
      '@typescript-eslint/no-restricted-imports': restrictImports([
        { regex: String.raw`^(?!\.\./dom/bridge-protocol$)`, message: 'The page-world bridge imports only its protocol.' },
      ]),
    },
  },
  {
    files: ['src/background/**/*.ts'],
    ignores: ['src/background/**/*.test.ts'],
    rules: {
      'no-restricted-globals': ['error', ...TIMERS, { name: 'document', message: 'The worker has no document.' },
        { name: 'window', message: 'The worker has no window.' }],
      '@typescript-eslint/no-restricted-imports': restrictImports([
        { group: ['**/dom/**', '**/content/**', '**/ui/**', 'react', 'react-dom'], message: 'The worker never imports the DOM layer or the UI.' },
        { group: ['wxt/browser', '@wxt-dev/browser'], message: 'Only src/platform touches the browser APIs.' },
      ]),
    },
  },
  { files: ['src/background/timers.ts'], rules: { 'no-restricted-globals': ['error',
    { name: 'document', message: 'The worker has no document.' }, { name: 'window', message: 'The worker has no window.' }] } },
  {
    files: ['src/content/**/*.{ts,tsx}'],
    ignores: ['src/content/ui/panel.tsx'],
    rules: {
      '@typescript-eslint/no-restricted-imports': restrictImports([
        // src/ui as seen from src/content (../ui) and from src/content/ui (../../ui); the content's own ./ui is allowed.
        { group: ['react', 'react-dom', 'react/*', 'react-dom/*', '../ui', '../ui/**', '../../ui', '../../ui/**'],
          message: 'Only content/ui/panel.tsx may import React and the report.' },
        { group: ['wxt/browser', '@wxt-dev/browser'], message: 'Only src/platform touches the browser APIs.' },
      ]),
    },
  },
  // The one module that presses the page's Submit for the person, and (v3 Phase 5) a posting's entry control for the
  // agent (content/press.ts's header).
  { files: ['src/content/press.ts'], rules: { 'no-restricted-syntax': ['error',
    ...UNSAFE_SYNTAX.filter((rule) => rule !== SUBMIT_PRESS_RULE && rule !== ENTRY_PRESS_RULE)] } },
  // v3 Phase 5: the one module that presses a sign-in form's button, and (v3 Phase 7b) a sign-in page's prelude control
  // (content/sign-in.ts's header).
  { files: ['src/content/sign-in.ts'], rules: { 'no-restricted-syntax': ['error',
    ...UNSAFE_SYNTAX.filter((rule) => rule !== SIGN_IN_PRESS_RULE && rule !== SIGN_IN_PRELUDE_RULE)] } },
  // v3 Phase 5 review: the one module that calls the doors' wrappers (the agent's entry, a run's sign-in).
  { files: ['src/content/runtime.ts'], rules: { 'no-restricted-syntax': ['error',
    ...UNSAFE_SYNTAX.filter((rule) => rule !== ENTRY_WRAPPER_RULE && rule !== SIGN_IN_WRAPPER_RULE)] } },
  // Tests drive the wrappers directly (never the doors).
  { files: ['src/**/*.test.{ts,tsx}'], rules: { 'no-restricted-syntax': ['error',
    ...UNSAFE_SYNTAX.filter((rule) => rule !== ENTRY_WRAPPER_RULE && rule !== SIGN_IN_WRAPPER_RULE)] } },
  // But for the one test of Sign-in mode Auto's two doors on their own (the v3 Phase 6/7b review, C2).
  { files: ['src/dom/fillers/sign-in-doors.browser.test.ts'], rules: { 'no-restricted-syntax': ['error',
    ...UNSAFE_SYNTAX.filter((rule) => ![ENTRY_WRAPPER_RULE, SIGN_IN_WRAPPER_RULE, SIGN_IN_PRESS_RULE,
      SIGN_IN_PRELUDE_RULE].includes(rule))] } },
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': restrictImports([
        { group: ['**/dom/**', '**/content/**', '**/background/**', '**/platform/chrome'], message: 'The UI talks to the worker through messaging only.' },
        { group: ['wxt/browser', '@wxt-dev/browser'], message: 'Only src/platform touches the browser APIs.' },
      ]),
    },
  },
  { files: ['src/ui/**/*.tsx', 'src/entrypoints/**/*.tsx', 'src/content/ui/panel.tsx'], ...reactHooks.configs.flat.recommended },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly', Buffer: 'readonly', setTimeout: 'readonly',
        clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', fetch: 'readonly', AbortSignal: 'readonly' },
    },
  },
);
