/**
 * @file RegisterAgentDialog.tsx
 * @description FormModal for registering a new A2A agent by its URL
 * @feature a2a
 */

import { useEffect, useState } from 'react';
import { FormField, FormModal, Input, toast } from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils/error';

interface RegisterAgentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onRegister: (url: string) => Promise<unknown>;
}

/**
 * Register agent dialog: one URL field, field-level validation, form-level server error.
 */
export function RegisterAgentDialog({ isOpen, onClose, onRegister }: RegisterAgentDialogProps) {
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setUrl('');
    setUrlError(undefined);
    setFormError(undefined);
  }, [isOpen]);

  const handleSubmit = async () => {
    const value = url.trim();
    if (!value) {
      setUrlError('Enter the agent URL.');
      return;
    }
    if (!/^https?:\/\/\S+$/i.test(value)) {
      setUrlError('Use a full URL, starting with http:// or https://.');
      return;
    }
    setSaving(true);
    setFormError(undefined);
    try {
      const result = await onRegister(value);
      const name =
        result && typeof result === 'object' && 'name' in result ? String(result.name) : value;
      toast.success('Agent registered', { description: name });
      onClose();
    } catch (err) {
      const message = getErrorMessage(err, '');
      setFormError(
        message && message !== 'Error'
          ? message
          : "Couldn't reach an A2A agent at this URL. Check that the agent is running and the address is right.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      title="Register agent"
      description="Add a robot agent the server can talk to over A2A."
      submitLabel="Register agent"
      submittingLabel="Registering…"
      isSubmitting={saving}
      error={formError}
      onSubmit={handleSubmit}
      noValidate
    >
      <FormField
        label="Agent URL"
        required
        error={urlError}
        hint="The server reads the agent card from /.well-known/agent.json at this address."
      >
        <Input
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (urlError) setUrlError(undefined);
          }}
          placeholder="http://localhost:41243"
          autoComplete="off"
          spellCheck={false}
        />
      </FormField>
    </FormModal>
  );
}
