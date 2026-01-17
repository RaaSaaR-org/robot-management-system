/**
 * @file embodiment-loader.ts
 * @description Singleton loader for YAML embodiment configurations with hot-reload support
 * @feature vla
 */

import { EventEmitter } from 'events';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';
import type { FSWatcher } from 'chokidar';
import {
  type EmbodimentConfig,
  type EmbodimentLoaderEvent,
  type EmbodimentEventData,
  validateEmbodimentConfig,
  safeValidateEmbodimentConfig,
} from './types.js';

// Get the directory of this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Default configs directory
const DEFAULT_CONFIGS_DIR = join(__dirname, 'configs');

/**
 * Configuration options for EmbodimentLoader
 */
export interface EmbodimentLoaderOptions {
  /** Directory containing YAML config files */
  configsDir?: string;
  /** Whether to enable file watching for hot-reload */
  watchEnabled?: boolean;
  /** Default embodiment tag to use when none specified */
  defaultTag?: string;
}

/**
 * EmbodimentLoader is a singleton that manages loading and caching
 * of embodiment configurations from YAML files.
 *
 * Features:
 * - Loads configurations from YAML files
 * - Validates configs against Zod schema
 * - Caches loaded configurations
 * - Hot-reload via chokidar file watching
 * - Event emission for config changes
 *
 * @example
 * ```typescript
 * const loader = EmbodimentLoader.getInstance();
 *
 * // Load a specific embodiment
 * const h1Config = await loader.loadEmbodiment('unitree_h1');
 *
 * // List available embodiments
 * const tags = loader.listEmbodiments();
 *
 * // Listen for hot-reload events
 * loader.on('embodiment:reloaded', (data) => {
 *   console.log(`Config reloaded: ${data.tag}`);
 * });
 *
 * // Start file watching
 * loader.startWatching();
 * ```
 */
export class EmbodimentLoader extends EventEmitter {
  private static instance: EmbodimentLoader;

  private configsDir: string;
  private watchEnabled: boolean;
  private defaultTag: string;
  private cache: Map<string, EmbodimentConfig> = new Map();
  private fileToTag: Map<string, string> = new Map();
  private watcher: FSWatcher | null = null;
  private initialized = false;

  private constructor(options: EmbodimentLoaderOptions = {}) {
    super();
    this.configsDir = options.configsDir ?? DEFAULT_CONFIGS_DIR;
    this.watchEnabled = options.watchEnabled ?? false;
    this.defaultTag = options.defaultTag ?? 'generic';
  }

  /**
   * Get the singleton instance.
   *
   * @param options Options for initialization (only used on first call)
   * @returns EmbodimentLoader instance
   */
  static getInstance(options?: EmbodimentLoaderOptions): EmbodimentLoader {
    if (!EmbodimentLoader.instance) {
      EmbodimentLoader.instance = new EmbodimentLoader(options);
    }
    return EmbodimentLoader.instance;
  }

  /**
   * Reset the singleton (mainly for testing).
   */
  static resetInstance(): void {
    if (EmbodimentLoader.instance) {
      EmbodimentLoader.instance.stopWatching();
    }
    EmbodimentLoader.instance = undefined as unknown as EmbodimentLoader;
  }

  /**
   * Initialize the loader by scanning the configs directory.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Pre-load all configurations
    await this.scanAndLoadConfigs();

    this.initialized = true;
    console.log(
      `[EmbodimentLoader] Initialized with ${this.cache.size} embodiments from ${this.configsDir}`
    );
  }

  /**
   * Check if the loader is initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Load an embodiment configuration by tag.
   *
   * @param tag Embodiment tag (e.g., 'unitree_h1', 'so101_arm')
   * @returns Validated embodiment configuration
   * @throws Error if config not found or invalid
   */
  async loadEmbodiment(tag: string): Promise<EmbodimentConfig> {
    // Check cache first
    const cached = this.cache.get(tag);
    if (cached) {
      return cached;
    }

    // Ensure initialized
    if (!this.initialized) {
      await this.initialize();
    }

    // Check cache again after initialization
    const afterInit = this.cache.get(tag);
    if (afterInit) {
      return afterInit;
    }

    // Try to load from file directly
    const config = await this.loadFromFile(tag);
    if (config) {
      this.cache.set(tag, config);
      return config;
    }

    throw new Error(`Embodiment configuration not found: ${tag}`);
  }

  /**
   * Get embodiment synchronously from cache.
   *
   * @param tag Embodiment tag
   * @returns Cached config or undefined
   */
  getEmbodiment(tag: string): EmbodimentConfig | undefined {
    return this.cache.get(tag);
  }

  /**
   * List all available embodiment tags.
   *
   * @returns Array of embodiment tags
   */
  listEmbodiments(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get the default embodiment configuration.
   *
   * @returns Default embodiment config (falls back to generic)
   */
  async getDefault(): Promise<EmbodimentConfig> {
    try {
      return await this.loadEmbodiment(this.defaultTag);
    } catch {
      // Fallback to generic
      if (this.defaultTag !== 'generic') {
        return await this.loadEmbodiment('generic');
      }
      throw new Error('No default embodiment configuration available');
    }
  }

  /**
   * Start file watching for hot-reload.
   */
  async startWatching(): Promise<void> {
    if (this.watcher) {
      return; // Already watching
    }

    try {
      // Dynamic import of chokidar (optional dependency)
      const chokidar = await import('chokidar');

      this.watcher = chokidar.watch(join(this.configsDir, '*.yaml'), {
        persistent: true,
        ignoreInitial: true,
      });

      this.watcher.on('change', (path: string) => this.handleFileChange(path));
      this.watcher.on('add', (path: string) => this.handleFileAdd(path));
      this.watcher.on('unlink', (path: string) => this.handleFileRemove(path));

      console.log(`[EmbodimentLoader] File watching started for ${this.configsDir}`);
    } catch (error) {
      console.warn('[EmbodimentLoader] chokidar not available, hot-reload disabled');
      this.watchEnabled = false;
    }
  }

  /**
   * Stop file watching.
   */
  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      console.log('[EmbodimentLoader] File watching stopped');
    }
  }

  /**
   * Reload a specific embodiment from file.
   *
   * @param tag Embodiment tag to reload
   * @returns Updated configuration or undefined on failure
   */
  async reloadEmbodiment(tag: string): Promise<EmbodimentConfig | undefined> {
    const config = await this.loadFromFile(tag);
    if (config) {
      this.cache.set(tag, config);
      this.emitEvent('embodiment:reloaded', { tag, config });
      console.log(`[EmbodimentLoader] Reloaded embodiment: ${tag}`);
    }
    return config;
  }

  /**
   * Reload all embodiments from files.
   */
  async reloadAll(): Promise<void> {
    this.cache.clear();
    this.fileToTag.clear();
    await this.scanAndLoadConfigs();
    console.log(`[EmbodimentLoader] Reloaded all embodiments (${this.cache.size} loaded)`);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Scan configs directory and load all YAML files.
   */
  private async scanAndLoadConfigs(): Promise<void> {
    if (!existsSync(this.configsDir)) {
      console.warn(`[EmbodimentLoader] Configs directory not found: ${this.configsDir}`);
      return;
    }

    const files = readdirSync(this.configsDir).filter(f => f.endsWith('.yaml'));

    for (const file of files) {
      const filePath = join(this.configsDir, file);
      try {
        const config = await this.loadAndValidateFile(filePath);
        if (config) {
          this.cache.set(config.embodiment_tag, config);
          this.fileToTag.set(filePath, config.embodiment_tag);
          this.emitEvent('embodiment:loaded', { tag: config.embodiment_tag, config, path: filePath });
        }
      } catch (error) {
        console.error(`[EmbodimentLoader] Failed to load ${file}:`, error);
        this.emitEvent('embodiment:error', {
          tag: file,
          error: error instanceof Error ? error : new Error(String(error)),
          path: filePath,
        });
      }
    }
  }

  /**
   * Load a configuration from file by tag name.
   */
  private async loadFromFile(tag: string): Promise<EmbodimentConfig | undefined> {
    // Try direct file name match
    const directPath = join(this.configsDir, `${tag}.yaml`);
    if (existsSync(directPath)) {
      return this.loadAndValidateFile(directPath);
    }

    // Try finding by embodiment_tag in existing files
    const files = readdirSync(this.configsDir).filter(f => f.endsWith('.yaml'));
    for (const file of files) {
      const filePath = join(this.configsDir, file);
      const config = await this.loadAndValidateFile(filePath);
      if (config?.embodiment_tag === tag) {
        return config;
      }
    }

    return undefined;
  }

  /**
   * Load and validate a YAML file.
   */
  private async loadAndValidateFile(filePath: string): Promise<EmbodimentConfig | undefined> {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const parsed = parseYaml(content);

      const result = safeValidateEmbodimentConfig(parsed);
      if (result.success) {
        return result.data;
      } else {
        console.error(
          `[EmbodimentLoader] Validation failed for ${filePath}:`,
          result.error.errors
        );
        return undefined;
      }
    } catch (error) {
      console.error(`[EmbodimentLoader] Error loading ${filePath}:`, error);
      return undefined;
    }
  }

  /**
   * Handle file change event (hot-reload).
   */
  private async handleFileChange(filePath: string): Promise<void> {
    console.log(`[EmbodimentLoader] File changed: ${filePath}`);

    const existingTag = this.fileToTag.get(filePath);
    const config = await this.loadAndValidateFile(filePath);

    if (config) {
      // Remove old tag if it changed
      if (existingTag && existingTag !== config.embodiment_tag) {
        this.cache.delete(existingTag);
      }

      this.cache.set(config.embodiment_tag, config);
      this.fileToTag.set(filePath, config.embodiment_tag);

      this.emitEvent('embodiment:reloaded', { tag: config.embodiment_tag, config, path: filePath });
      this.emitEvent('config:changed', { tag: config.embodiment_tag, config, path: filePath });
    }
  }

  /**
   * Handle new file added.
   */
  private async handleFileAdd(filePath: string): Promise<void> {
    console.log(`[EmbodimentLoader] File added: ${filePath}`);

    const config = await this.loadAndValidateFile(filePath);
    if (config) {
      this.cache.set(config.embodiment_tag, config);
      this.fileToTag.set(filePath, config.embodiment_tag);
      this.emitEvent('embodiment:loaded', { tag: config.embodiment_tag, config, path: filePath });
    }
  }

  /**
   * Handle file removed.
   */
  private handleFileRemove(filePath: string): void {
    console.log(`[EmbodimentLoader] File removed: ${filePath}`);

    const tag = this.fileToTag.get(filePath);
    if (tag) {
      this.cache.delete(tag);
      this.fileToTag.delete(filePath);
      this.emitEvent('embodiment:error', {
        tag,
        error: new Error('Configuration file removed'),
        path: filePath,
      });
    }
  }

  /**
   * Emit a typed event.
   */
  private emitEvent(event: EmbodimentLoaderEvent, data: EmbodimentEventData): void {
    this.emit(event, data);
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get the configs directory path.
   */
  getConfigsDir(): string {
    return this.configsDir;
  }

  /**
   * Check if an embodiment exists.
   */
  hasEmbodiment(tag: string): boolean {
    return this.cache.has(tag);
  }

  /**
   * Get number of loaded embodiments.
   */
  getLoadedCount(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics.
   */
  getStats(): { loadedCount: number; tags: string[]; watchEnabled: boolean } {
    return {
      loadedCount: this.cache.size,
      tags: this.listEmbodiments(),
      watchEnabled: this.watcher !== null,
    };
  }
}
