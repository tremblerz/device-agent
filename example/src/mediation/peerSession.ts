import type { LlamaEngine, ToolRegistry } from 'react-native-device-agent';
import { MediationAgent } from './mediationAgent';
import type { Channel } from './channel';
import type { Role, WireMsg } from './protocol';
import {
  otherParty,
  roleToParty,
  type ConsensusProposal,
  type MediationAction,
  type Party,
  type Phase,
  type TranscriptEntry,
} from './types';

export interface Vote {
  accept: boolean;
  counter?: string;
}

export type PeerEvent =
  | { type: 'phase'; phase: Phase }
  | { type: 'peerName'; name: string }
  | { type: 'agenda'; topic: string }
  | { type: 'thinking'; on: boolean }
  | { type: 'peerActivity'; text: string }
  | { type: 'transcript'; entry: TranscriptEntry }
  | { type: 'tool'; text: string }
  /** Open/close this device's local input composer (optionally with the agent's question). */
  | { type: 'composer'; open: boolean; prompt?: { summary: string; questions: string[] } }
  | { type: 'consensus'; proposal: ConsensusProposal }
  | { type: 'resolved'; proposal: ConsensusProposal }
  | { type: 'note'; text: string };

export interface PeerSessionOptions {
  channel: Channel;
  role: Role;
  localName: string;
  engine: LlamaEngine;
  contextTools?: ToolRegistry;
  onEvent: (e: PeerEvent) => void;
  nudgeAfter?: number;
  hardCap?: number;
}

let _eid = 0;
const eid = () => `e${++_eid}`;

/**
 * One device's half of the mediation. Runs the local user's counselor, mirrors
 * the transcript from the channel, and coordinates turn-taking with the peer.
 *
 * Turns are gated by three things, all checked together so races resolve
 * safely: the `floor` (whose turn it is), a `pausedBy` latch (set of parties
 * currently collecting user input — no agent runs while it's non-empty), and a
 * `gen` counter that invalidates an in-flight inference if state changed while
 * the model was thinking. Either user can open their composer at any time to
 * talk to their own counselor; doing so pauses BOTH devices until they finish.
 */
export class PeerSession {
  private channel: Channel;
  private role: Role;
  private localName: string;
  private engine: LlamaEngine;
  private contextTools?: ToolRegistry;
  private onEvent: (e: PeerEvent) => void;
  private nudgeAfter: number;
  private hardCap: number;

  private readonly localParty: Party;
  private readonly peerParty: Party;
  private peerName = 'the other party';
  private topic = '';
  private localContext = '';

  private agent: MediationAgent | null = null;
  private transcript: TranscriptEntry[] = [];
  private standingProposal: ConsensusProposal | null = null;

  private phase: Phase = 'connecting';
  private floor: Party = 'A';
  private pausedBy = new Set<Party>();
  private gen = 0;
  private running = false;
  private composerOpen = false;
  private started = false;
  private localReady = false;
  private remoteReady = false;
  private localVote: Vote | null = null;
  private remoteVote: Vote | null = null;

  private unsub: (() => void) | null = null;

  constructor(opts: PeerSessionOptions) {
    this.channel = opts.channel;
    this.role = opts.role;
    this.localName = opts.localName;
    this.engine = opts.engine;
    this.contextTools = opts.contextTools;
    this.onEvent = opts.onEvent;
    this.nudgeAfter = opts.nudgeAfter ?? 6;
    this.hardCap = opts.hardCap ?? 16;
    this.localParty = roleToParty(opts.role);
    this.peerParty = otherParty(this.localParty);
  }

  // ---- lifecycle ----

  start(): void {
    this.unsub = this.channel.onMessage((m) => this.handle(m));
    this.channel.send({ t: 'hello', name: this.localName, role: this.role });
    if (this.role === 'host') {
      this.setPhase('setup');
    } else {
      this.setPhase('waiting');
      this.emit({ type: 'note', text: 'Waiting for the host to set the agenda…' });
    }
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
  }

  onPeerDisconnected(): void {
    this.composerOpen = false;
    this.emit({ type: 'composer', open: false });
    this.setPhase('disconnected');
  }

  // ---- UI-driven actions ----

  submitSetup(input: { topic?: string; context: string }): void {
    if (this.role === 'host' && input.topic) {
      this.topic = input.topic;
      this.channel.send({ t: 'agenda', topic: input.topic });
    }
    this.localContext = input.context;
    this.localReady = true;
    this.channel.send({ t: 'ready' });
    this.setPhase('waiting');
    this.emit({ type: 'note', text: 'Ready. Waiting for the other side…' });
    this.maybeBegin();
  }

  /** User proactively wants to tell their counselor something. Pauses both sides. */
  beginUserInput(): void {
    if (this.phase !== 'negotiating' || this.composerOpen) return;
    this.openComposer();
  }

  submitUserInput(text: string): void {
    if (!this.composerOpen) return;
    if (text.trim()) this.agent?.addUserInfo(text); // stays on this device
    this.closeComposer();
    this.tryRunTurn();
  }

  cancelUserInput(): void {
    if (!this.composerOpen) return;
    this.closeComposer();
    this.tryRunTurn();
  }

  submitVote(vote: Vote): void {
    this.localVote = vote;
    this.channel.send({ t: 'vote', accept: vote.accept, counter: vote.counter });
    this.emit({ type: 'note', text: 'Your decision is in. Waiting for the other side…' });
    this.evaluateConsensus();
  }

  // ---- incoming wire messages ----

  private handle(m: WireMsg): void {
    switch (m.t) {
      case 'hello':
        this.peerName = m.name;
        this.emit({ type: 'peerName', name: m.name });
        break;
      case 'agenda':
        if (this.role === 'guest') {
          this.topic = m.topic;
          this.emit({ type: 'agenda', topic: m.topic });
          this.setPhase('setup');
        }
        break;
      case 'ready':
        this.remoteReady = true;
        this.maybeBegin();
        break;
      case 'say':
        this.addEntry(this.peerParty, m.kind, m.text);
        if (m.kind === 'proposal') this.standingProposal = { by: this.peerParty, proposal: m.text };
        this.emit({ type: 'peerActivity', text: '' });
        this.setFloor(this.localParty);
        this.tryRunTurn();
        break;
      case 'agree':
        if (this.standingProposal && this.standingProposal.by === this.localParty) {
          this.enterConsensus(this.standingProposal);
        }
        break;
      case 'vote':
        this.remoteVote = { accept: m.accept, counter: m.counter };
        this.evaluateConsensus();
        break;
      case 'pause':
        this.pauseAdd(this.peerParty);
        this.emit({ type: 'peerActivity', text: `${this.peerName} is adding input…` });
        break;
      case 'resume':
        this.pauseRemove(this.peerParty);
        this.emit({ type: 'peerActivity', text: '' });
        this.tryRunTurn();
        break;
      case 'status':
        this.emit({
          type: 'peerActivity',
          text:
            m.state === 'consulting_user'
              ? `${this.peerName} is consulting their user…`
              : `${this.peerName}'s counselor is thinking…`,
        });
        break;
    }
  }

  // ---- negotiation ----

  private maybeBegin(): void {
    if (this.started || !this.localReady || !this.remoteReady) return;
    this.started = true;
    this.agent = new MediationAgent(
      {
        engine: this.engine,
        party: this.localParty,
        name: this.localName,
        otherName: this.peerName,
        topic: this.topic,
        contextTools: this.contextTools,
        onTool: (text) => this.emit({ type: 'tool', text }),
      },
      this.localContext,
    );
    this.setPhase('negotiating');
    this.setFloor('A'); // host opens
    this.tryRunTurn();
  }

  /** Run the local agent's turn iff it's our floor and nothing is holding us. */
  private tryRunTurn(): void {
    if (
      this.running ||
      !this.agent ||
      this.phase !== 'negotiating' ||
      this.pausedBy.size > 0 ||
      this.floor !== this.localParty
    ) {
      return;
    }
    void this.runTurn();
  }

  private async runTurn(): Promise<void> {
    this.running = true;
    const myGen = this.gen;
    this.channel.send({ t: 'status', state: 'thinking' });
    this.emit({ type: 'thinking', on: true });
    try {
      const n = this.transcript.length;
      const hint =
        !this.standingProposal && n >= this.hardCap
          ? 'You must now propose a single concrete, fair resolution.'
          : !this.standingProposal && n >= this.nudgeAfter
            ? 'Enough has likely been discussed — propose a fair resolution if you can.'
            : undefined;

      let action = await this.agent!.takeTurn(this.transcript, hint);

      // Discard if state changed while the model was thinking (pause, disconnect,
      // floor change, a newer turn) — a transition will re-trigger tryRunTurn.
      if (
        this.gen !== myGen ||
        this.phase !== 'negotiating' ||
        this.pausedBy.size > 0 ||
        this.floor !== this.localParty
      ) {
        return;
      }

      if (action.kind === 'message' && !this.standingProposal && n >= this.hardCap) {
        action = { kind: 'propose', proposal: action.text };
      }
      this.applyAction(action);
    } finally {
      this.running = false;
      this.emit({ type: 'thinking', on: false });
    }
  }

  private applyAction(action: MediationAction): void {
    switch (action.kind) {
      case 'message':
        this.addEntry(this.localParty, 'message', action.text);
        this.channel.send({ t: 'say', kind: 'message', text: action.text });
        this.setFloor(this.peerParty);
        break;
      case 'propose':
        this.addEntry(this.localParty, 'proposal', action.proposal);
        this.standingProposal = { by: this.localParty, proposal: action.proposal };
        this.channel.send({ t: 'say', kind: 'proposal', text: action.proposal });
        this.setFloor(this.peerParty);
        break;
      case 'agree':
        if (this.standingProposal && this.standingProposal.by !== this.localParty) {
          this.channel.send({ t: 'agree' });
          this.enterConsensus(this.standingProposal);
        } else {
          const text = 'Let us aim for a concrete proposal we can both accept.';
          this.addEntry(this.localParty, 'message', text);
          this.channel.send({ t: 'say', kind: 'message', text });
          this.setFloor(this.peerParty);
        }
        break;
      case 'ask_user':
        // The agent needs its own user — open the composer (which pauses both).
        this.channel.send({ t: 'status', state: 'consulting_user' });
        this.openComposer({ summary: action.summary, questions: action.questions });
        break;
    }
  }

  // ---- user-input composer (the pause latch) ----

  private openComposer(prompt?: { summary: string; questions: string[] }): void {
    if (this.composerOpen) return;
    this.composerOpen = true;
    this.pauseAdd(this.localParty);
    this.channel.send({ t: 'pause', by: this.localParty });
    this.emit({ type: 'composer', open: true, prompt });
  }

  private closeComposer(): void {
    if (!this.composerOpen) return;
    this.composerOpen = false;
    this.pauseRemove(this.localParty);
    this.channel.send({ t: 'resume', by: this.localParty });
    this.emit({ type: 'composer', open: false });
  }

  // ---- consensus ----

  private enterConsensus(proposal: ConsensusProposal): void {
    // A hard interrupt: clear any input/pause state so both devices line up.
    if (this.composerOpen) {
      this.composerOpen = false;
      this.emit({ type: 'composer', open: false });
    }
    this.pausedBy.clear();
    this.gen++;
    this.standingProposal = proposal;
    this.localVote = null;
    this.remoteVote = null;
    this.setPhase('consensus');
    this.emit({ type: 'consensus', proposal });
  }

  private evaluateConsensus(): void {
    if (!this.localVote || !this.remoteVote || !this.standingProposal) return;

    if (this.localVote.accept && this.remoteVote.accept) {
      this.setPhase('resolved');
      this.emit({ type: 'resolved', proposal: this.standingProposal });
      return;
    }

    const counters: Record<Party, string | undefined> = {
      [this.localParty]: this.localVote.counter?.trim() || undefined,
      [this.peerParty]: this.remoteVote.counter?.trim() || undefined,
    } as Record<Party, string | undefined>;
    (['A', 'B'] as Party[]).forEach((p) => {
      const c = counters[p];
      if (!c) return;
      this.addEntry(p, 'message', c);
      if (p === this.localParty) this.agent?.addUserInfo(`New point raised at review: ${c}`);
    });

    this.emit({ type: 'note', text: 'Not yet agreed — the counselors will keep working.' });
    this.standingProposal = null;
    this.localVote = null;
    this.remoteVote = null;
    this.setPhase('negotiating');
    this.setFloor('A');
    this.tryRunTurn();
  }

  // ---- helpers ----

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.emit({ type: 'phase', phase });
  }

  private setFloor(p: Party): void {
    if (this.floor !== p) {
      this.floor = p;
      this.gen++;
    }
  }

  private pauseAdd(p: Party): void {
    this.pausedBy.add(p);
    this.gen++;
  }

  private pauseRemove(p: Party): void {
    this.pausedBy.delete(p);
    this.gen++;
  }

  private addEntry(from: Party, kind: TranscriptEntry['kind'], text: string): void {
    const entry: TranscriptEntry = { id: eid(), from, kind, text };
    this.transcript.push(entry);
    this.emit({ type: 'transcript', entry });
  }

  private emit(e: PeerEvent): void {
    this.onEvent(e);
  }
}
