/**
 * @file DifferentialPrivacy.ts
 * @description Differential privacy mechanisms for federated learning gradient protection
 * @feature Federated Learning
 */

/**
 * Differential privacy utility for gradient clipping and Gaussian noise injection.
 * Implements the Gaussian mechanism for (ε, δ)-differential privacy.
 */
export class DifferentialPrivacy {
  /**
   * Clip gradients to a maximum L2-norm per sample.
   * If the L2-norm of a gradient vector exceeds maxNorm, the vector is
   * scaled down to have exactly maxNorm as its L2-norm.
   *
   * @param gradients - 2D array where each row is a gradient vector
   * @param maxNorm - Maximum allowed L2-norm per gradient vector
   * @returns Clipped gradient vectors
   */
  clipGradients(gradients: number[][], maxNorm: number): number[][] {
    if (maxNorm <= 0) {
      throw new Error('maxNorm must be positive');
    }

    return gradients.map((gradient) => {
      const l2Norm = Math.sqrt(
        gradient.reduce((sum, val) => sum + val * val, 0),
      );

      if (l2Norm <= maxNorm) {
        return [...gradient];
      }

      const scale = maxNorm / l2Norm;
      return gradient.map((val) => val * scale);
    });
  }

  /**
   * Add calibrated Gaussian noise to clipped gradients for (ε, δ)-differential privacy.
   *
   * @param gradients - 2D array of (already clipped) gradient vectors
   * @param sensitivity - L2 sensitivity (typically the clipping norm)
   * @param epsilon - Privacy budget ε (smaller = more private)
   * @param delta - Privacy parameter δ (probability of privacy loss)
   * @returns Noised gradient vectors
   */
  addGaussianNoise(
    gradients: number[][],
    sensitivity: number,
    epsilon: number,
    delta: number,
  ): number[][] {
    const sigma = this.computeNoiseScale(sensitivity, epsilon, delta);

    return gradients.map((gradient) =>
      gradient.map((val) => val + this.sampleGaussian(0, sigma)),
    );
  }

  /**
   * Compute the noise standard deviation for the Gaussian mechanism.
   *
   * σ = sensitivity * sqrt(2 * ln(1.25 / δ)) / ε
   *
   * @param sensitivity - L2 sensitivity of the query
   * @param epsilon - Privacy budget ε
   * @param delta - Privacy parameter δ
   * @returns Standard deviation σ for Gaussian noise
   */
  computeNoiseScale(
    sensitivity: number,
    epsilon: number,
    delta: number,
  ): number {
    if (sensitivity <= 0) {
      throw new Error('sensitivity must be positive');
    }
    if (epsilon <= 0) {
      throw new Error('epsilon must be positive');
    }
    if (delta <= 0 || delta >= 1) {
      throw new Error('delta must be in (0, 1)');
    }

    return (sensitivity * Math.sqrt(2 * Math.log(1.25 / delta))) / epsilon;
  }

  /**
   * Compute the L2-norm of a vector.
   *
   * @param vector - Input vector
   * @returns L2-norm
   */
  computeL2Norm(vector: number[]): number {
    return Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  }

  /**
   * Sample from a Gaussian distribution using the Box-Muller transform.
   *
   * @param mean - Mean of the distribution
   * @param stddev - Standard deviation
   * @returns A single sample from N(mean, stddev²)
   */
  private sampleGaussian(mean: number, stddev: number): number {
    // Box-Muller transform
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return z0 * stddev + mean;
  }
}
