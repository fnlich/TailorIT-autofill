/*
 * MV3's content security policy refuses zod's `new Function` probe, so zod runs without its JIT. Every entrypoint
 * imports this module first (test/entrypoints.test.ts checks the order).
 */
import { z } from 'zod';

z.config({ jitless: true });
