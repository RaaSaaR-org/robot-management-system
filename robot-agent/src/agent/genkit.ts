/**
 * @file genkit.ts
 * @description Genkit AI setup with configurable LLM provider (Gemini, OpenRouter or local Ollama)
 * @status live
 */

import { googleAI } from "@genkit-ai/googleai";
import { openAICompatible } from "@genkit-ai/compat-oai";
import { genkit } from "genkit";
import type { ModelArgument } from "genkit";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { config, DEFAULT_GEMINI_MODEL, DEFAULT_OPENROUTER_MODEL, DEFAULT_OLLAMA_MODEL } from "../config/config.js";

function resolveModel(): ModelArgument {
  if (config.llmProvider === "openrouter") {
    const modelName = config.llmModel || DEFAULT_OPENROUTER_MODEL;
    return `openrouter/${modelName}`;
  }
  if (config.llmProvider === "ollama") {
    const modelName = config.llmModel || DEFAULT_OLLAMA_MODEL;
    return `ollama/${modelName}`;
  }
  const modelName = config.llmModel || DEFAULT_GEMINI_MODEL;
  return googleAI.model(modelName);
}

// Build plugins list
const googleAIPlugin = googleAI();

// OpenRouter plugin (only if key exists)
const openrouterPlugin = config.openrouterApiKey
  ? openAICompatible({
      name: "openrouter",
      apiKey: config.openrouterApiKey,
      baseURL: "https://openrouter.ai/api/v1",
    })
  : null;

// Ollama plugin (local, OpenAI-compatible endpoint).
//
// TASK-194: constructed UNCONDITIONALLY, not only when `llmProvider === 'ollama'`.
// Agent Mode always plans/sees through local Ollama models, even when the main
// agent runs on Gemini or OpenRouter, so `ollama/<model>` refs must resolve in
// every provider configuration. Building the plugin is free — it is a keyless
// local endpoint and no connection is opened until a model is actually called.
const ollamaPlugin = openAICompatible({
  name: "ollama",
  apiKey: "ollama", // Ollama ignores the key, but the OpenAI client requires one
  baseURL: config.ollamaBaseUrl,
});

// Agent Mode may point at a *different* Ollama host (AGENT_OLLAMA_BASE_URL).
// Only then is a second, separately-named plugin registered; otherwise agent
// model refs reuse the `ollama/` prefix above. Consumers must build their model
// refs via AGENT_OLLAMA_PREFIX rather than hardcoding "ollama/".
const agentOllamaSeparate = config.agentMode.ollamaBaseUrl !== config.ollamaBaseUrl;

/** Model-ref prefix agent-mode calls must use, e.g. `${AGENT_OLLAMA_PREFIX}/gemma3:4b`. */
export const AGENT_OLLAMA_PREFIX = agentOllamaSeparate ? "agentollama" : "ollama";

const agentOllamaPlugin = agentOllamaSeparate
  ? openAICompatible({
      name: AGENT_OLLAMA_PREFIX,
      apiKey: "ollama",
      baseURL: config.agentMode.ollamaBaseUrl,
    })
  : null;

export const configuredModel = resolveModel();

export const ai = genkit({
  plugins: [googleAIPlugin, openrouterPlugin, ollamaPlugin, agentOllamaPlugin].filter(
    (p): p is NonNullable<typeof p> => p !== null
  ),
  model: configuredModel,
  promptDir: dirname(fileURLToPath(import.meta.url)) + "/../prompts",
});

export { z } from "genkit";
