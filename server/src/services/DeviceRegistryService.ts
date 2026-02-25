/**
 * @file DeviceRegistryService.ts
 * @description Device certificate registry for CRA Annex I compliance.
 *   Manages X.509 device certificates: registration, verification, revocation.
 * @feature security
 */

import crypto from 'node:crypto';
import { prisma } from '../database/client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegisterCertificateInput {
  robotId: string;
  certificate: string; // PEM
  publicKey: string; // PEM
  fingerprint: string;
  expiresAt?: string; // ISO 8601
}

export interface DeviceCertificateRecord {
  id: string;
  robotId: string;
  fingerprint: string;
  publicKey: string;
  certificate: string;
  issuedAt: string;
  expiresAt: string | null;
  status: string;
}

export interface VerifyResult {
  valid: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class DeviceRegistryService {
  /**
   * Register (or update) a device certificate.
   * If the robot already has a certificate, it is replaced.
   */
  async registerCertificate(input: RegisterCertificateInput): Promise<DeviceCertificateRecord> {
    const { robotId, certificate, publicKey, fingerprint, expiresAt } = input;

    // Validate fingerprint matches the certificate
    const computedFingerprint = this.computeFingerprint(certificate);
    if (computedFingerprint !== fingerprint) {
      throw new Error(`Fingerprint mismatch: expected ${computedFingerprint}, got ${fingerprint}`);
    }

    const record = await prisma.deviceCertificate.upsert({
      where: { robotId },
      create: {
        robotId,
        fingerprint,
        publicKey,
        certificate,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        status: 'active',
      },
      update: {
        fingerprint,
        publicKey,
        certificate,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        status: 'active',
        issuedAt: new Date(),
      },
    });

    console.log(`[DeviceRegistry] Certificate registered for robot ${robotId} (fingerprint: ${fingerprint.slice(0, 20)}...)`);

    return this.toRecord(record);
  }

  /**
   * Verify a device by checking its fingerprint against the stored certificate.
   */
  async verifyDevice(robotId: string, fingerprint: string): Promise<VerifyResult> {
    const cert = await prisma.deviceCertificate.findUnique({ where: { robotId } });

    if (!cert) {
      return { valid: false, reason: 'No certificate registered for this device' };
    }

    if (cert.status === 'revoked') {
      return { valid: false, reason: 'Certificate has been revoked' };
    }

    if (cert.status === 'expired' || (cert.expiresAt && cert.expiresAt < new Date())) {
      return { valid: false, reason: 'Certificate has expired' };
    }

    if (cert.fingerprint !== fingerprint) {
      return { valid: false, reason: 'Fingerprint does not match registered certificate' };
    }

    return { valid: true };
  }

  /**
   * Verify a challenge-response signature using the stored public key.
   */
  async verifyChallengeResponse(
    robotId: string,
    nonce: string,
    signature: string,
    algorithm: string = 'RSA-SHA256',
  ): Promise<VerifyResult> {
    const cert = await prisma.deviceCertificate.findUnique({ where: { robotId } });

    if (!cert) {
      return { valid: false, reason: 'No certificate registered for this device' };
    }

    if (cert.status !== 'active') {
      return { valid: false, reason: `Certificate status: ${cert.status}` };
    }

    try {
      const verify = crypto.createVerify(algorithm);
      verify.update(nonce);
      const isValid = verify.verify(cert.publicKey, signature, 'base64');
      return isValid
        ? { valid: true }
        : { valid: false, reason: 'Signature verification failed' };
    } catch {
      return { valid: false, reason: 'Signature verification error' };
    }
  }

  /**
   * Revoke a device certificate.
   */
  async revokeCertificate(robotId: string): Promise<DeviceCertificateRecord | null> {
    const cert = await prisma.deviceCertificate.findUnique({ where: { robotId } });
    if (!cert) return null;

    const updated = await prisma.deviceCertificate.update({
      where: { robotId },
      data: { status: 'revoked' },
    });

    console.log(`[DeviceRegistry] Certificate revoked for robot ${robotId}`);
    return this.toRecord(updated);
  }

  /**
   * List all device certificates.
   */
  async listCertificates(status?: string): Promise<DeviceCertificateRecord[]> {
    const where = status ? { status } : {};
    const certs = await prisma.deviceCertificate.findMany({
      where,
      orderBy: { issuedAt: 'desc' },
    });
    return certs.map((c) => this.toRecord(c));
  }

  /**
   * Get a single device certificate by robotId.
   */
  async getCertificate(robotId: string): Promise<DeviceCertificateRecord | null> {
    const cert = await prisma.deviceCertificate.findUnique({ where: { robotId } });
    return cert ? this.toRecord(cert) : null;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private computeFingerprint(certPem: string): string {
    const b64 = certPem
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s/g, '');
    const der = Buffer.from(b64, 'base64');
    const hash = crypto.createHash('sha256').update(der).digest('hex');
    return hash.match(/.{2}/g)!.join(':').toUpperCase();
  }

  private toRecord(cert: {
    id: string;
    robotId: string;
    fingerprint: string;
    publicKey: string;
    certificate: string;
    issuedAt: Date;
    expiresAt: Date | null;
    status: string;
  }): DeviceCertificateRecord {
    return {
      id: cert.id,
      robotId: cert.robotId,
      fingerprint: cert.fingerprint,
      publicKey: cert.publicKey,
      certificate: cert.certificate,
      issuedAt: cert.issuedAt.toISOString(),
      expiresAt: cert.expiresAt ? cert.expiresAt.toISOString() : null,
      status: cert.status,
    };
  }
}

// Singleton
export const deviceRegistryService = new DeviceRegistryService();
