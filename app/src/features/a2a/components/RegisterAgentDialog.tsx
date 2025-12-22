/**
 * @file RegisterAgentDialog.tsx
 * @description Dialog for registering a new A2A agent
 * @feature a2a
 */

import { memo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/components/ui/Modal';
import { Button } from '@/shared/components/ui/Button';
import { Input } from '@/shared/components/ui/Input';
import { Spinner } from '@/shared/components/ui/Spinner';

interface RegisterAgentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onRegister: (url: string) => Promise<void>;
}

/**
 * Register agent dialog component
 */
export const RegisterAgentDialog = memo(function RegisterAgentDialog({
  isOpen,
  onClose,
  onRegister,
}: RegisterAgentDialogProps) {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      await onRegister(url.trim());
      setUrl('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register agent');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      setUrl('');
      setError(null);
      onClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Register A2A Agent"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="agent-url"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Agent URL
          </label>
          <Input
            id="agent-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            disabled={isLoading}
            className="w-full"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Enter the base URL of the A2A agent. The agent card will be fetched from
            /.well-known/a2a/agent_card.json
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-50/50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm border border-red-100 dark:border-red-900/30">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!url.trim() || isLoading}
          >
            {isLoading ? <Spinner size="sm" /> : 'Register'}
          </Button>
        </div>
      </form>
    </Modal>
  );
});
