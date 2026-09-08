/**
 * @file ZoneFormModal.tsx
 * @description Modal form for creating and editing zones
 * @feature fleet
 * @dependencies @/shared/components/ui, @/features/fleet/hooks, @/features/fleet/types
 */

import { useState, useCallback, useEffect, useId } from 'react';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { Modal, Button, Input } from '@/shared/components/ui';
import { useZoneManagement, useZoneEditor } from '../hooks';
import type { Zone, ZoneType, ZoneBounds, CreateZoneRequest } from '../types/fleet.types';

// ============================================================================
// TYPES
// ============================================================================

export interface ZoneFormModalProps {
  /** Whether modal is open */
  isOpen: boolean;
  /** Zone being edited (null for create mode) */
  zone: Zone | null;
  /** Default bounds for new zone */
  defaultBounds?: ZoneBounds;
  /** Current floor */
  currentFloor: string;
  /** Close handler */
  onClose: () => void;
  /** Success handler */
  onSuccess?: (zone: Zone) => void;
}

interface FormData {
  name: string;
  type: ZoneType;
  floor: string;
  x: string;
  y: string;
  width: string;
  height: string;
  color: string;
  description: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const ZONE_TYPE_OPTIONS: { value: ZoneType; label: string }[] = [
  { value: 'operational', label: 'Operational' },
  { value: 'restricted', label: 'Restricted' },
  { value: 'charging', label: 'Charging' },
  { value: 'maintenance', label: 'Maintenance' },
];

const DEFAULT_FORM_DATA: FormData = {
  name: '',
  type: 'operational',
  floor: '1',
  x: '0',
  y: '0',
  width: '10',
  height: '10',
  color: '',
  description: '',
};

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Modal form for creating and editing zones.
 *
 * @example
 * ```tsx
 * <ZoneFormModal
 *   isOpen={showModal}
 *   zone={editingZone}
 *   currentFloor="1"
 *   onClose={() => setShowModal(false)}
 *   onSuccess={(zone) => console.log('Saved:', zone)}
 * />
 * ```
 */
export function ZoneFormModal({
  isOpen,
  zone,
  defaultBounds,
  currentFloor,
  onClose,
  onSuccess,
}: ZoneFormModalProps) {
  const typeId = useId();
  const { can } = useAuth();
  const canManage = can('fleet:manage');
  const { createZone, updateZone, isLoading, error } = useZoneManagement();
  const { closeFormModal } = useZoneEditor();
  const [formData, setFormData] = useState<FormData>(DEFAULT_FORM_DATA);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Initialize form data when modal opens or zone changes
  useEffect(() => {
    if (isOpen) {
      if (zone) {
        // Edit mode - populate from zone
        setFormData({
          name: zone.name,
          type: zone.type,
          floor: zone.floor,
          x: String(zone.bounds.x),
          y: String(zone.bounds.y),
          width: String(zone.bounds.width),
          height: String(zone.bounds.height),
          color: zone.color || '',
          description: zone.description || '',
        });
      } else if (defaultBounds) {
        // Create mode with default bounds
        setFormData({
          ...DEFAULT_FORM_DATA,
          floor: currentFloor,
          x: String(defaultBounds.x),
          y: String(defaultBounds.y),
          width: String(defaultBounds.width),
          height: String(defaultBounds.height),
        });
      } else {
        // Create mode without bounds
        setFormData({
          ...DEFAULT_FORM_DATA,
          floor: currentFloor,
        });
      }
      setValidationErrors({});
    }
  }, [isOpen, zone, defaultBounds, currentFloor]);

  const handleInputChange = useCallback(
    (field: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setFormData((prev) => ({
        ...prev,
        [field]: e.target.value,
      }));
      // Clear validation error for this field
      if (validationErrors[field]) {
        setValidationErrors((prev) => {
          const updated = { ...prev };
          delete updated[field];
          return updated;
        });
      }
    },
    [validationErrors]
  );

  const validateForm = useCallback((): boolean => {
    const errors: Record<string, string> = {};

    if (!formData.name.trim()) {
      errors.name = 'Name is required';
    }

    const x = parseFloat(formData.x);
    const y = parseFloat(formData.y);
    const width = parseFloat(formData.width);
    const height = parseFloat(formData.height);

    if (isNaN(x)) errors.x = 'X must be a number';
    if (isNaN(y)) errors.y = 'Y must be a number';
    if (isNaN(width) || width <= 0) errors.width = 'Width must be positive';
    if (isNaN(height) || height <= 0) errors.height = 'Height must be positive';

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }, [formData]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!canManage || !validateForm()) return;

      const bounds: ZoneBounds = {
        x: parseFloat(formData.x),
        y: parseFloat(formData.y),
        width: parseFloat(formData.width),
        height: parseFloat(formData.height),
      };

      try {
        let savedZone: Zone;

        if (zone) {
          // Update existing zone
          const updated = await updateZone(zone.id, {
            name: formData.name,
            type: formData.type,
            floor: formData.floor,
            bounds,
            color: formData.color || undefined,
            description: formData.description || undefined,
          });
          if (!updated) throw new Error('Failed to update zone');
          savedZone = updated;
        } else {
          // Create new zone
          const request: CreateZoneRequest = {
            name: formData.name,
            type: formData.type,
            floor: formData.floor,
            bounds,
            color: formData.color || undefined,
            description: formData.description || undefined,
          };
          savedZone = await createZone(request);
        }

        onSuccess?.(savedZone);
        handleClose();
      } catch (err) {
        console.error('Failed to save zone:', err);
      }
    },
    [canManage, formData, zone, validateForm, createZone, updateZone, onSuccess]
  );

  const handleClose = useCallback(() => {
    closeFormModal();
    onClose();
  }, [closeFormModal, onClose]);

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={zone ? 'Edit Zone' : 'Create Zone'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {!canManage && <p role="status" className="text-sm text-theme-secondary">An owner role is required to manage zones.</p>}
        {/* Name */}
        <div>
          <Input
            label="Name"
            value={formData.name}
            onChange={handleInputChange('name')}
            placeholder="Zone name"
            error={validationErrors.name}
          />
        </div>

        {/* Type */}
        <div>
          <label htmlFor={typeId} className="block text-sm font-medium text-theme-secondary mb-1">Type</label>
          <select
            id={typeId}
            value={formData.type}
            onChange={handleInputChange('type')}
            className="w-full px-3 py-2 bg-theme-card border border-theme rounded-lg text-theme-primary focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            {ZONE_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* Floor */}
        <div>
          <Input
            label="Floor"
            value={formData.floor}
            onChange={handleInputChange('floor')}
            placeholder="Floor identifier"
          />
        </div>

        {/* Bounds */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Input
              label="X"
              type="number"
              value={formData.x}
              onChange={handleInputChange('x')}
              error={validationErrors.x}
            />
          </div>
          <div>
            <Input
              label="Y"
              type="number"
              value={formData.y}
              onChange={handleInputChange('y')}
              error={validationErrors.y}
            />
          </div>
          <div>
            <Input
              label="Width"
              type="number"
              value={formData.width}
              onChange={handleInputChange('width')}
              error={validationErrors.width}
            />
          </div>
          <div>
            <Input
              label="Height"
              type="number"
              value={formData.height}
              onChange={handleInputChange('height')}
              error={validationErrors.height}
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <Input
            label="Description"
            value={formData.description}
            onChange={handleInputChange('description')}
            placeholder="Optional description"
          />
        </div>

        {/* Error display */}
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4">
          <Button type="button" variant="secondary" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button type="submit" disabled={isLoading || !canManage}>
            {isLoading ? 'Saving...' : zone ? 'Update Zone' : 'Create Zone'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
