import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LlamaEngine,
  ToolRegistry,
  defineTool,
  createCalendarTools,
} from 'react-native-device-agent';
import { MODEL } from './config';
import { ensureModel } from './modelManager';
import { useNearby } from './useNearby';
import { PeerSession, type Vote } from './mediation/peerSession';
import type { ConsensusProposal, Phase } from './mediation/types';

export interface ComposerState {
  open: boolean;
  prompt?: { summary: string; questions: string[] };
}

export type ModelStatus = 'idle' | 'downloading' | 'loading' | 'ready' | 'error';

export interface FeedItem {
  id: string;
  type: 'message' | 'proposal' | 'tool' | 'note';
  party?: 'A' | 'B';
  text: string;
}

let _fid = 0;
const fid = () => `f${++_fid}`;

/** Read-only device-context tools this device's counselor may consult. */
function buildContextTools(): ToolRegistry {
  const calendar = createCalendarTools().filter((t) => t.name === 'list_calendar_events');
  return new ToolRegistry([
    defineTool({
      name: 'get_current_time',
      description: 'Get the current date and time on the device.',
      parameters: { type: 'object', properties: {} },
      execute: () => ({ iso: new Date().toISOString() }),
    }),
    ...calendar,
  ]);
}

export function useCounsel(myName: string) {
  const nearby = useNearby(myName);

  const [modelStatus, setModelStatus] = useState<ModelStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [modelError, setModelError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase | null>(null);
  const [topic, setTopic] = useState('');
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [thinking, setThinking] = useState(false);
  const [peerActivity, setPeerActivity] = useState('');
  const [composer, setComposer] = useState<ComposerState>({ open: false });
  const [consensus, setConsensus] = useState<ConsensusProposal | null>(null);
  const [resolved, setResolved] = useState<ConsensusProposal | null>(null);

  const engineRef = useRef<LlamaEngine | null>(null);
  const sessionRef = useRef<PeerSession | null>(null);

  const pushFeed = useCallback((item: Omit<FeedItem, 'id'>) => {
    setFeed((prev) => [...prev, { id: fid(), ...item }]);
  }, []);

  /** Download (if needed) and load the model. */
  const initialize = useCallback(async () => {
    try {
      setModelError(null);
      setModelStatus('downloading');
      const uri = await ensureModel((f) => setProgress(f));
      setModelStatus('loading');
      engineRef.current = await LlamaEngine.load({ model: uri, n_ctx: MODEL.nCtx });
      setModelStatus('ready');
    } catch (e) {
      setModelError((e as Error).message);
      setModelStatus('error');
    }
  }, []);

  // When connected (and the model is loaded), spin up this device's PeerSession.
  useEffect(() => {
    if (nearby.state !== 'connected') return;
    if (sessionRef.current) return;
    const channel = nearby.channel.current;
    const role = nearby.role;
    const engine = engineRef.current;
    if (!channel || !role || !engine) return;

    const session = new PeerSession({
      channel,
      role,
      localName: myName,
      engine,
      contextTools: buildContextTools(),
      onEvent: (e) => {
        switch (e.type) {
          case 'phase':
            setPhase(e.phase);
            break;
          case 'agenda':
            setTopic(e.topic);
            break;
          case 'thinking':
            setThinking(e.on);
            break;
          case 'peerActivity':
            setPeerActivity(e.text);
            break;
          case 'transcript':
            pushFeed({ type: e.entry.kind, party: e.entry.from, text: e.entry.text });
            break;
          case 'tool':
            pushFeed({ type: 'tool', text: e.text });
            break;
          case 'note':
            pushFeed({ type: 'note', text: e.text });
            break;
          case 'composer':
            setComposer({ open: e.open, prompt: e.prompt });
            break;
          case 'consensus':
            setComposer({ open: false });
            setConsensus(e.proposal);
            break;
          case 'resolved':
            setConsensus(null);
            setResolved(e.proposal);
            break;
        }
      },
    });
    sessionRef.current = session;
    session.start();
  }, [nearby.state, nearby.role, nearby.channel, myName, pushFeed]);

  // Reflect a peer disconnect into the session.
  useEffect(() => {
    if (nearby.state === 'disconnected') sessionRef.current?.onPeerDisconnected();
  }, [nearby.state]);

  const submitSetup = useCallback((input: { topic?: string; context: string }) => {
    if (input.topic) setTopic(input.topic);
    sessionRef.current?.submitSetup(input);
  }, []);

  const beginInput = useCallback(() => sessionRef.current?.beginUserInput(), []);
  const submitInput = useCallback((text: string) => {
    setComposer({ open: false });
    sessionRef.current?.submitUserInput(text);
  }, []);
  const cancelInput = useCallback(() => {
    setComposer({ open: false });
    sessionRef.current?.cancelUserInput();
  }, []);

  const submitVote = useCallback((vote: Vote) => {
    setConsensus(null);
    sessionRef.current?.submitVote(vote);
  }, []);

  const reset = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    nearby.leave();
    setPhase(null);
    setTopic('');
    setFeed([]);
    setThinking(false);
    setPeerActivity('');
    setComposer({ open: false });
    setConsensus(null);
    setResolved(null);
  }, [nearby]);

  return {
    // model
    modelStatus,
    progress,
    modelError,
    initialize,
    // connectivity
    nearby,
    // session
    phase,
    topic,
    feed,
    thinking,
    peerActivity,
    composer,
    consensus,
    resolved,
    submitSetup,
    beginInput,
    submitInput,
    cancelInput,
    submitVote,
    reset,
  };
}
