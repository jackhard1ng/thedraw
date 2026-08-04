/**
 * Client wrappers for Cloud Functions callables.
 *
 * Anything that touches money or advances a bracket runs in a Cloud Function;
 * clients never write those documents (§3). Even the Phase-1 writes that COULD
 * be client-side — joining a post, blocking, reporting, account deletion — go
 * through functions so slot counts, moderation routing, and anonymized deletion
 * stay authoritative and can't be forged past the security rules.
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import type { ReportTargetType } from '@/types/models';

export const joinRound = httpsCallable<{ postId: string }, { status: string }>(
  functions,
  'joinRound',
);

export const leaveRound = httpsCallable<{ postId: string }, { status: string }>(
  functions,
  'leaveRound',
);

export const submitReport = httpsCallable<
  { targetType: ReportTargetType; targetId: string; reason: string; context?: string },
  { reportId: string }
>(functions, 'submitReport');

export const blockUser = httpsCallable<{ blockedId: string }, { ok: boolean }>(
  functions,
  'blockUser',
);

export const unblockUser = httpsCallable<{ blockedId: string }, { ok: boolean }>(
  functions,
  'unblockUser',
);

export const deleteAccount = httpsCallable<Record<string, never>, { ok: boolean }>(
  functions,
  'deleteAccount',
);
