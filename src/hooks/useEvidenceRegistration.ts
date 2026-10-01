'use client';

import { useCallback, useState } from 'react';
import { useAccount, useChainId } from 'wagmi';
import {
  getContractAddress,
  getProtocolVersion,
  getReleaseChainId,
} from '@/lib/contracts/registry';
import { evaluateWriteTarget } from '@/lib/contracts/write-gate';
import { validateEvidenceUri } from '@/lib/validation/evidenceUri';

// Types
export interface EvidencePayload {
  claimId: string;
  evidenceUri: string;
  evidenceDigest?: string; // e.g. SHA-256 hash of the content
}

export interface EvidenceValidation {
  isValid: boolean;
  errors: string[];
}

export interface EvidenceTransaction {
  hash: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
}

interface UseEvidenceRegistrationConfig {
  contractAddress?: string;
  expectedChainId?: number;
  artifactVersion?: string;
}

const SUBMIT_EVIDENCE_SELECTOR = '0x1a2b3c4d'; // Mock selector for submitEvidence

export function useEvidenceRegistration(config: UseEvidenceRegistrationConfig = {}) {
  const contractAddress = config.contractAddress ?? getContractAddress('TruthBountyWeighted');
  const expectedChainId = config.expectedChainId ?? getReleaseChainId();
  const artifactVersion = config.artifactVersion ?? getProtocolVersion();

  const { address: userAddress, isConnected } = useAccount();
  const currentChainId = useChainId();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateEvidence = useCallback((payload: EvidencePayload): EvidenceValidation => {
    const errors: string[] = [];

    if (!isConnected || !userAddress) {
      errors.push('Wallet not connected');
    }

    if (currentChainId !== expectedChainId) {
      errors.push(`Wrong network. Expected chain ${expectedChainId}, got ${currentChainId}`);
    }

    const writeTarget = evaluateWriteTarget({
      activeChainId: currentChainId,
      contractAddress,
      expectedProtocolVersion: artifactVersion,
    });
    if (!writeTarget.ok) {
      errors.push(...writeTarget.errors);
    }

    if (!payload.claimId || !payload.claimId.match(/^[0-9a-fA-F]{64}$/)) {
      errors.push('Invalid claim mismatch: claimId must be a 32-byte hex string (without 0x)');
    }

    if (!payload.evidenceUri) {
      errors.push('Evidence URI is required');
    } else {
      try {
        const url = new URL(payload.evidenceUri);
        if (url.protocol !== 'https:' && url.protocol !== 'ipfs:') {
          errors.push('Unsupported scheme: only https and ipfs are allowed');
        }
        if (payload.evidenceUri.length > 1024) {
          errors.push('Oversized input: evidence URI must be under 1024 characters');
        }
      } catch (err) {
        errors.push('Invalid Evidence URI');
      }
    }

    if (payload.evidenceUri.match(/(password|secret|key|token)=/i)) {
      errors.push('Raw secrets detected in URI. Please remove sensitive information.');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }, [isConnected, userAddress, currentChainId, expectedChainId, contractAddress, artifactVersion]);

  const encodeEvidenceCall = useCallback((payload: EvidencePayload): string => {
    // Mock encoding for now
    const encodedClaimId = payload.claimId.padStart(64, '0');
    const encodedUri = Buffer.from(payload.evidenceUri).toString('hex').padEnd(64, '0');
    return SUBMIT_EVIDENCE_SELECTOR + encodedClaimId + encodedUri;
  }, []);

  const submitEvidence = useCallback(async (payload: EvidencePayload): Promise<EvidenceTransaction> => {
    setIsSubmitting(true);
    setError(null);
    try {
      const validation = validateEvidence(payload);
      if (!validation.isValid) {
        throw new Error(validation.errors.join('; '));
      }

      // Encode canonical add or version action
      const calldata = encodeEvidenceCall(payload);

      // Submission requires a wallet writeContract call
      throw new Error('Evidence registration requires wallet writeContract integration; no synthetic transaction hash is emitted.');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Submission failed';
      setError(errorMsg);
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  }, [validateEvidence, encodeEvidenceCall]);

  return {
    validateEvidence,
    submitEvidence,
    isSubmitting,
    error,
    artifactVersion
  };
}
