// The TailorIT mock as scripts/e2e.mjs runs it: node:http only (mock.mjs holds the mock itself), loopback only, on port
// 3190 (MOCK_PORT overrides), at both 127.0.0.1 and ::1, because the e2e build calls http://localhost:3190 and
// localhost may resolve to either. It never uses TailorIT's own ports (3100, 4100, 3300, 4300). SIGINT or SIGTERM
// stops it.
import { startMock } from './mock.mjs';

const port = Number(process.env.MOCK_PORT ?? 3190);
const mock = await startMock({ port });
console.log(`mock TailorIT listening on ${mock.origin}`);
const stop = () => {
  void mock.close().finally(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
