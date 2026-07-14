/**
 * @file test-ollama-provider.ts
 * @description Temporary smoke test: verifies the 'ollama' LLM provider works
 *              through the agent's real Genkit setup, incl. tool calling.
 *              Run: LLM_PROVIDER=ollama npx tsx test-ollama-provider.ts
 */

import { ai, configuredModel, z } from './src/agent/genkit.js';
import { getActiveModelName, config } from './src/config/config.js';

const getRobotStatus = ai.defineTool(
  {
    name: 'getRobotStatus',
    description: 'Get the current status of the robot (battery level and current zone)',
    inputSchema: z.object({}),
    outputSchema: z.object({ batteryPercent: z.number(), zone: z.string() }),
  },
  async () => {
    console.log('[TOOL] getRobotStatus was called by the model ✓');
    return { batteryPercent: 87, zone: 'Warehouse A' };
  }
);

console.log(`Provider: ${config.llmProvider}`);
console.log(`Model:    ${getActiveModelName()} (${String(configuredModel)})`);
console.log(`Base URL: ${config.ollamaBaseUrl}`);

console.log('\n--- Test 1: plain generation ---');
const t0 = Date.now();
const r1 = await ai.generate({
  prompt: 'Reply with exactly one short sentence: what is a humanoid robot?',
});
console.log(`(${Date.now() - t0} ms) ${r1.text.trim()}`);

console.log('\n--- Test 2: tool calling ---');
const t1 = Date.now();
const r2 = await ai.generate({
  prompt: 'Check the robot status and report battery level and current zone in one sentence.',
  tools: [getRobotStatus],
});
console.log(`(${Date.now() - t1} ms) ${r2.text.trim()}`);
