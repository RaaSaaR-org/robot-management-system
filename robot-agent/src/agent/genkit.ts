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

// Ollama plugin (local, OpenAI-compatible endpoint; only when selected as provider)
const ollamaPlugin = config.llmProvider === "ollama"
  ? openAICompatible({
      name: "ollama",
      apiKey: "ollama", // Ollama ignores the key, but the OpenAI client requires one
      baseURL: config.ollamaBaseUrl,
    })
  : null;

export const configuredModel = resolveModel();

export const ai = genkit({
  plugins: [googleAIPlugin, openrouterPlugin, ollamaPlugin].filter(
    (p): p is NonNullable<typeof p> => p !== null
  ),
  model: configuredModel,
  promptDir: dirname(fileURLToPath(import.meta.url)) + "/../prompts",
});

export { z } from "genkit";
