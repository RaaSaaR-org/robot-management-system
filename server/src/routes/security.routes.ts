/**
 * @file security.routes.ts
 * @description Device identity and certificate management API endpoints.
 *   CRA Annex I, EN 18031, MR Annex III compliance.
 * @feature security
 */

import { Router, type Request, type Response } from 'express';
import { deviceRegistryService } from '../services/DeviceRegistryService.js';

export const securityRoutes = Router();

/**
 * POST /register - Register a device certificate
 * Body: { robotId, certificate, publicKey, fingerprint, expiresAt? }
 */
securityRoutes.post('/devices/register', async (req: Request, res: Response) => {
  try {
    const { robotId, certificate, publicKey, fingerprint, expiresAt } = req.body;

    if (!robotId || !certificate || !publicKey || !fingerprint) {
      res.status(400).json({
        error: 'Missing required fields: robotId, certificate, publicKey, fingerprint',
      });
      return;
    }

    const record = await deviceRegistryService.registerCertificate({
      robotId,
      certificate,
      publicKey,
      fingerprint,
      expiresAt,
    });

    res.status(201).json(record);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Registration failed';
    console.error('[SecurityRoutes] Registration error:', error);
    res.status(400).json({ error: message });
  }
});

/**
 * GET /devices - List all registered device certificates
 * Query: ?status=active|revoked|expired
 */
securityRoutes.get('/devices', async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const certificates = await deviceRegistryService.listCertificates(status);
    res.json({ certificates, total: certificates.length });
  } catch (error) {
    console.error('[SecurityRoutes] List error:', error);
    res.status(500).json({ error: 'Failed to list certificates' });
  }
});

/**
 * GET /devices/:robotId - Get a specific device certificate
 */
securityRoutes.get('/devices/:robotId', async (req: Request, res: Response) => {
  try {
    const cert = await deviceRegistryService.getCertificate(req.params.robotId);
    if (!cert) {
      res.status(404).json({ error: 'No certificate found for this device' });
      return;
    }
    res.json(cert);
  } catch (error) {
    console.error('[SecurityRoutes] Get error:', error);
    res.status(500).json({ error: 'Failed to get certificate' });
  }
});

/**
 * POST /devices/:robotId/verify - Verify device identity
 * Body: { fingerprint } or { nonce, signature, algorithm? }
 */
securityRoutes.post('/devices/:robotId/verify', async (req: Request, res: Response) => {
  try {
    const { robotId } = req.params;
    const { fingerprint, nonce, signature, algorithm } = req.body;

    // Challenge-response verification
    if (nonce && signature) {
      const result = await deviceRegistryService.verifyChallengeResponse(
        robotId,
        nonce,
        signature,
        algorithm,
      );
      res.json(result);
      return;
    }

    // Simple fingerprint verification
    if (fingerprint) {
      const result = await deviceRegistryService.verifyDevice(robotId, fingerprint);
      res.json(result);
      return;
    }

    res.status(400).json({
      error: 'Provide either { fingerprint } or { nonce, signature } for verification',
    });
  } catch (error) {
    console.error('[SecurityRoutes] Verify error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

/**
 * DELETE /devices/:robotId - Revoke a device certificate
 */
securityRoutes.delete('/devices/:robotId', async (req: Request, res: Response) => {
  try {
    const result = await deviceRegistryService.revokeCertificate(req.params.robotId);
    if (!result) {
      res.status(404).json({ error: 'No certificate found for this device' });
      return;
    }
    res.json({ message: 'Certificate revoked', certificate: result });
  } catch (error) {
    console.error('[SecurityRoutes] Revoke error:', error);
    res.status(500).json({ error: 'Failed to revoke certificate' });
  }
});
