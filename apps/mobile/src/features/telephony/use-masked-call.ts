import { useMutation } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { ApiError } from '../../lib/api/errors';
import { hapticError, hapticSuccess } from '../../lib/haptics';
import { startBridge } from './api';
import type { StartedBridge } from '../jobs/types';

/**
 * Call the job's client without ever holding their number.
 *
 * The phone sends a descriptor — job, contact, "ring my cell" — and the server
 * resolves the number and bridges the two legs. The technician's own handset
 * rings first (about 15 seconds), then the client is dialled, so the client
 * sees the company's number and the technician never sees theirs
 * (docs/ARCHITECTURE.md §1.6).
 *
 * This is the one action that cannot be queued: a call is only worth placing
 * now, and placing it needs a connection anyway.
 */
export function useMaskedCall() {
  return useMutation<StartedBridge, unknown, { dealId: string; contactId: string }>({
    mutationFn: ({ dealId, contactId }) =>
      startBridge({ dealId, contactId, via: 'cell' }),
    onSuccess: (bridge) => {
      hapticSuccess();
      Alert.alert(
        'Calling',
        `Your phone will ring in a moment. Answer it and we'll connect you to ${
          bridge.clientName || 'the client'
        }.`,
      );
    },
    onError: (error) => {
      hapticError();
      const offline = error instanceof ApiError && error.status === 0;
      Alert.alert(
        offline ? 'No signal' : 'Could not start the call',
        offline
          ? 'A masked call needs a connection — the number is resolved on the server, never on the phone.'
          : error instanceof ApiError
            ? error.message
            : 'Please try again.',
      );
    },
  });
}
