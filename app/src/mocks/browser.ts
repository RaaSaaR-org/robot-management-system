/**
 * @file browser.ts
 * @description MSW browser worker setup for demo mode
 * @feature mocks
 */

import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);
