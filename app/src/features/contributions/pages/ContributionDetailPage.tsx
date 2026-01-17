/**
 * @file ContributionDetailPage.tsx
 * @description Page for viewing a single contribution's details
 * @feature contributions
 */

import { useParams, useNavigate } from 'react-router-dom';
import { ContributionDetail } from '../components/ContributionDetail';
import { useContribution } from '../hooks/contributions';
import { Loader2, AlertCircle } from 'lucide-react';

// ============================================================================
// COMPONENT
// ============================================================================

export function ContributionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const {
    contribution,
    isLoading,
    error,
    submitForReview,
    revokeContribution,
    fetchImpact,
  } = useContribution(id!);

  const handleBack = () => {
    navigate('/contributions');
  };

  const handleSubmit = async () => {
    await submitForReview();
  };

  const handleRevoke = async (reason: string) => {
    await revokeContribution(reason);
  };

  // Loading state
  if (isLoading && !contribution) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-5xl">
        <div className="flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      </div>
    );
  }

  // Error state
  if (error && !contribution) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-5xl">
        <div className="flex flex-col items-center justify-center text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Error Loading Contribution
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
          <button
            onClick={handleBack}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            Back to Contributions
          </button>
        </div>
      </div>
    );
  }

  // Not found state
  if (!contribution) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-5xl">
        <div className="flex flex-col items-center justify-center text-center">
          <AlertCircle className="w-12 h-12 text-gray-400 mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Contribution Not Found
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            The contribution you're looking for doesn't exist or has been removed.
          </p>
          <button
            onClick={handleBack}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            Back to Contributions
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      <ContributionDetail
        contribution={contribution}
        onBack={handleBack}
        onSubmit={handleSubmit}
        onRevoke={handleRevoke}
        fetchImpact={fetchImpact}
        isLoading={isLoading}
      />
    </div>
  );
}
