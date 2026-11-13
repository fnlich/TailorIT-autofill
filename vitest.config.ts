import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';
import { PROJECT_FILES } from './vitest.projects.ts';

// WxtVitest does not apply wxt.config.ts's vite() block, so every project defines the build constants itself.
// jr7 INT-7: __PROVENANCE__ true here alone, so the configured rules' provenance is read by the tests (configProblems).
const define = { __E2E__: 'false', __TAILORIT_ORIGIN__: JSON.stringify('http://localhost:3100'), __PROVENANCE__: 'true' };

export default defineConfig({
  test: {
    projects: [
      { define, test: { name: 'core', environment: 'node', include: [...PROJECT_FILES.core.include] } },
      {
        plugins: [WxtVitest()],
        define,
        test: { name: 'ext', environment: 'node', include: [...PROJECT_FILES.ext.include], exclude: [...PROJECT_FILES.ext.exclude] },
      },
      {
        define,
        // Pre-bundled, so Vite does not discover React mid-run and reload the browser page under a running test.
        optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-select',
          '@emotion/react', '@emotion/cache'] },
        test: {
          name: 'dom',
          // On Windows 'localhost' can resolve to ::1 while the server listens on 127.0.0.1: name the address.
          api: { host: '127.0.0.1' },
          include: [...PROJECT_FILES.dom.include],
          testTimeout: 30_000,
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
            viewport: { width: 1280, height: 900 },
          },
        },
      },
    ],
  },
});
