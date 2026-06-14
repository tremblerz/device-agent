/**
 * Types for the dual-device, on-device conflict-resolution demo.
 *
 * Each phone runs ONE counselor agent for its own user and talks to the other
 * phone over a {@link Channel} (MultipeerConnectivity). The two impartial
 * counselors negotiate a fair resolution, pausing to ask their own user for
 * more information when needed. A user's raw private context never leaves their
 * device — only the agent's utterances cross the channel.
 */

import type { Role } from './protocol';

/** Host is Party A, guest is Party B. */
export type Party = 'A' | 'B';

export const roleToParty = (r: Role): Party => (r === 'host' ? 'A' : 'B');
export const otherParty = (p: Party): Party => (p === 'A' ? 'B' : 'A');

/** One structured action an agent can take on its turn. */
export type MediationAction =
  | { kind: 'message'; text: string }
  | { kind: 'ask_user'; summary: string; questions: string[] }
  | { kind: 'propose'; proposal: string }
  | { kind: 'agree' };

/** A line in the mirrored transcript shown on both devices. */
export interface TranscriptEntry {
  id: string;
  from: Party;
  kind: 'message' | 'proposal';
  text: string;
}

export type Phase =
  | 'lobby'
  | 'connecting'
  | 'setup'
  | 'waiting'
  | 'negotiating'
  | 'awaiting_user'
  | 'consensus'
  | 'resolved'
  | 'disconnected';

/** Emitted when this device's agent pauses to consult its own user. */
export interface UserInputRequest {
  summary: string;
  questions: string[];
}

export interface ConsensusProposal {
  by: Party;
  proposal: string;
}
