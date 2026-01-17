/**
 * @file NewContributionPage.tsx
 * @description Page for creating a new contribution using the wizard
 * @feature contributions
 */

import { useNavigate } from 'react-router-dom';
import { ContributionWizard } from '../components/ContributionWizard';
import { useContributionsStore } from '../store/contributionsStore';

// ============================================================================
// COMPONENT
// ============================================================================

export function NewContributionPage() {
  const navigate = useNavigate();

  // Store actions
  const initiateContribution = useContributionsStore((state) => state.initiateContribution);
  const uploadContributionData = useContributionsStore((state) => state.uploadContributionData);
  const submitForReview = useContributionsStore((state) => state.submitForReview);
  const isLoading = useContributionsStore((state) => state.isLoading);
  const error = useContributionsStore((state) => state.error);

  const handleComplete = (contributionId: string) => {
    navigate(`/contributions/${contributionId}`);
  };

  const handleCancel = () => {
    navigate('/contributions');
  };

  const handleInitiate = async (data: Parameters<typeof initiateContribution>[0]) => {
    const result = await initiateContribution(data);
    return { id: result.id };
  };

  const handleUpload = async (id: string, data: Parameters<typeof uploadContributionData>[1]) => {
    const result = await uploadContributionData(id, data);
    return { estimatedCredits: result.estimatedCredits };
  };

  const handleSubmit = async (id: string) => {
    await submitForReview(id);
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          New Contribution
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Follow the steps below to contribute your training data
        </p>
      </div>

      {/* Wizard */}
      <ContributionWizard
        onComplete={handleComplete}
        onCancel={handleCancel}
        initiateContribution={handleInitiate}
        uploadData={handleUpload}
        submitForReview={handleSubmit}
        isLoading={isLoading}
        error={error}
      />
    </div>
  );
}
