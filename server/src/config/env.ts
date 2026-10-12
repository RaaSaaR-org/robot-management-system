/**
 * @file env.ts
 * @description Side-effect import: loads `server/.env`. It is the first import
 *              of `src/index.ts`, so every later module sees the values
 *              (ES imports evaluate in order). See load-env.ts (TASK-389).
 * @feature config
 */

import { loadServerEnv } from './load-env.js';

loadServerEnv();
