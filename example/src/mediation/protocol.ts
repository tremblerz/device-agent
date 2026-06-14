/**
 * The wire protocol between the two devices. Only the agents' utterances and
 * control signals cross the channel — never a user's raw private context. Each
 * device keeps its own mirrored transcript by applying these messages.
 */

export type Role = 'host' | 'guest';

export type WireMsg =
  /** Sent right after connecting: exchange display names + roles. */
  | { t: 'hello'; name: string; role: Role }
  /** Host sets the agenda for the guest. */
  | { t: 'agenda'; topic: string }
  /** This side finished entering its private context and is ready to begin. */
  | { t: 'ready' }
  /** An agent utterance; receiving it passes the turn to the other side. */
  | { t: 'say'; kind: 'message' | 'proposal'; text: string }
  /** This side's agent accepts the other's standing proposal. */
  | { t: 'agree' }
  /** This side's user voted on the proposed resolution. */
  | { t: 'vote'; accept: boolean; counter?: string }
  /** This side's user started giving input — the peer must hold all turns. */
  | { t: 'pause'; by: 'A' | 'B' }
  /** This side's user finished giving input — release the hold. */
  | { t: 'resume'; by: 'A' | 'B' }
  /** Lightweight presence so the peer UI can show what's happening. */
  | { t: 'status'; state: 'thinking' | 'consulting_user' };

export function encode(msg: WireMsg): string {
  return JSON.stringify(msg);
}

export function decode(text: string): WireMsg | null {
  try {
    const obj = JSON.parse(text);
    return obj && typeof obj.t === 'string' ? (obj as WireMsg) : null;
  } catch {
    return null;
  }
}
