/**
 * @file genkit.ts
 * @description Genkit AI setup with configurable LLM provider (Gemini or OpenRouter)
 */

import { googleAI } from "@genkit-ai/googleai";
import { openAICompatible } from "@genkit-ai/compat-oai";
import { genkit } from "genkit";
import type { ModelArgument } from "genkit";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { config, DEFAULT_GEMINI_MODEL, DEFAULT_OPENROUTER_MODEL } from "../config/config.js";

function resolveModel(): ModelArgument {
  if (config.llmProvider === "openrouter") {
    const modelName = config.llmModel || DEFAULT_OPENROUTER_MODEL;
    return `openrouter/${modelName}`;
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

export const configuredModel = resolveModel();

export const ai = genkit({
  plugins: openrouterPlugin
    ? [googleAIPlugin, openrouterPlugin]
    : [googleAIPlugin],
  model: configuredModel,
  promptDir: dirname(fileURLToPath(import.meta.url)) + "/../prompts",
});

export { z } from "genkit";
