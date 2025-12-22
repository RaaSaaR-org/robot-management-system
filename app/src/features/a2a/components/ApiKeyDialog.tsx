/**
 * @file ApiKeyDialog.tsx
 * @description Dialog for configuring Gemini API key for LLM-powered orchestration
 * @feature a2a
 */

import { memo, useState, useEffect, type FormEvent } from 'react';
import { Modal } from '@/shared/components/ui/Modal';
import { Button } from '@/shared/components/ui/Button';
import { Input } from '@/shared/components/ui/Input';

interface ApiKeyDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentKey: string | null;
  onSave: (key: string | null) => void;
}

const STORAGE_KEY = 'robo-mind-gemini-api-key';

/**
 * API key configuration dialog component
 */
export const ApiKeyDialog = memo(function ApiKeyDialog({
  isOpen,
  onClose,
  currentKey,
  onSave,
}: ApiKeyDialogProps) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  // Load key from localStorage on mount or when dialog opens
  useEffect(() => {
    if (isOpen) {
      const storedKey = localStorage.getItem(STORAGE_KEY);
      setApiKey(storedKey || currentKey || '');
    }
  }, [isOpen, currentKey]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const key = apiKey.trim();

    // Save to localStorage for persistence
    if (key) {
      localStorage.setItem(STORAGE_KEY, key);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }

    onSave(key || null);
    onClose();
  };

  const handleClear = () => {
    setApiKey('');
    localStorage.removeItem(STORAGE_KEY);
    onSave(null);
    onClose();
  };

  const handleClose = () => {
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Orchestration Settings"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="api-key"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Gemini API Key
          </label>
          <div className="relative">
            <Input
              id="api-key"
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your Gemini API key"
              className="w-full pr-20"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors px-2 py-1"
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Required for LLM-powered orchestration. Get your API key from{' '}
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-500 hover:text-primary-600 hover:underline"
            >
              Google AI Studio
            </a>
          </p>
        </div>

        <div className="glass-subtle rounded-lg p-3">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            How it works
          </h4>
          <ul className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
            <li>• In Orchestration mode, the LLM analyzes your message</li>
            <li>• It reads agent descriptions and capabilities</li>
            <li>• Automatically selects the best agent for your task</li>
            <li>• Without an API key, basic keyword matching is used</li>
          </ul>
        </div>

        {currentKey && (
          <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            API key configured - LLM orchestration active
          </div>
        )}

        <div className="flex justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClear}
            className="text-red-500 hover:text-red-600"
          >
            Clear Key
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
            >
              Cancel
            </Button>
            <Button type="submit">
              Save
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
});

/**
 * Hook to load API key from localStorage on app init
 */
export function useLoadApiKey(setGeminiApiKey: (key: string | null) => void) {
  useEffect(() => {
    const storedKey = localStorage.getItem(STORAGE_KEY);
    if (storedKey) {
      setGeminiApiKey(storedKey);
    }
  }, [setGeminiApiKey]);
}
