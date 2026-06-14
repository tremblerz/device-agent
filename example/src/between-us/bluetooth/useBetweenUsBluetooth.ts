/**
 * useBetweenUsBluetooth — wraps useBluetoothExchange for the Between Us flow.
 *
 * Host phone:   call startHosting(ctx) → advertises session context over BLE.
 *               onPeerJoined fires when the other person connects.
 *
 * Joiner phone: call startScanning(name) → discovers nearby hosts.
 *               call joinHost(peerId) → connects and receives session context.
 *               onContextReceived fires with the decoded SessionContext.
 *
 * Both phones:  call sendMove(move) to exchange AgentMove objects.
 *               onMoveReceived fires for each incoming move.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useBluetoothExchange } from 'react-native-device-agent';
import type { AgentMove, SessionContext } from '../types';

const SERVICE_UUID = 'between-us-v1';

type MessageEnvelope =
  | { type: 'context'; payload: SessionContext }
  | { type: 'move'; payload: AgentMove }
  | { type: 'accepted' }
  | { type: 'ping' };

interface Options {
  onPeerJoined?: (peerId: string, peerName: string | null) => void;
  onContextReceived?: (ctx: SessionContext) => void;
  onMoveReceived?: (move: AgentMove) => void;
  onPeerAccepted?: () => void;
}

export function useBetweenUsBluetooth(opts: Options = {}) {
  const bt = useBluetoothExchange();
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Watch incoming messages and route by envelope type
  const lastSeenId = useRef<string | null>(null);
  useEffect(() => {
    const incoming = bt.messages.filter((m) => m.direction === 'incoming');
    if (!incoming.length) return;
    const latest = incoming[incoming.length - 1];
    if (latest.id === lastSeenId.current) return;
    lastSeenId.current = latest.id;

    try {
      const env: MessageEnvelope = JSON.parse(latest.text);
      if (env.type === 'context') {
        optsRef.current.onContextReceived?.(env.payload);
      } else if (env.type === 'move') {
        optsRef.current.onMoveReceived?.(env.payload);
      } else if (env.type === 'accepted') {
        optsRef.current.onPeerAccepted?.();
      }
    } catch {
      // not a Between Us message — ignore
    }
  }, [bt.messages]);

  // Watch for newly connected peers
  const lastConnectedId = useRef<string | null>(null);
  useEffect(() => {
    const connected = bt.peers.filter((p) => p.connected);
    if (!connected.length) return;
    const latest = connected[connected.length - 1];
    if (latest.id === lastConnectedId.current) return;
    lastConnectedId.current = latest.id;
    optsRef.current.onPeerJoined?.(latest.id, latest.name);
  }, [bt.peers]);

  // ── Host ─────────────────────────────────────────────────────────────────

  const startHosting = useCallback(
    async (ctx: SessionContext) => {
      await bt.start({
        displayName: `BU:${ctx.name}`,
        serviceUuid: SERVICE_UUID,
      });
    },
    [bt]
  );

  const sendContext = useCallback(
    async (peerId: string, ctx: SessionContext) => {
      const env: MessageEnvelope = { type: 'context', payload: ctx };
      await bt.send(peerId, JSON.stringify(env));
    },
    [bt]
  );

  // ── Joiner ───────────────────────────────────────────────────────────────

  const startScanning = useCallback(
    async (name: string) => {
      await bt.start({
        displayName: `BU:${name}`,
        serviceUuid: SERVICE_UUID,
      });
    },
    [bt]
  );

  const joinHost = useCallback(
    async (peerId: string) => {
      await bt.connect(peerId);
      // Send ping so host knows someone joined
      const env: MessageEnvelope = { type: 'ping' };
      await bt.send(peerId, JSON.stringify(env));
    },
    [bt]
  );

  // ── Both ─────────────────────────────────────────────────────────────────

  const sendMove = useCallback(
    async (peerId: string, move: AgentMove) => {
      const env: MessageEnvelope = { type: 'move', payload: move };
      await bt.send(peerId, JSON.stringify(env));
    },
    [bt]
  );

  const sendAccepted = useCallback(
    async (peerId: string) => {
      const env: MessageEnvelope = { type: 'accepted' };
      await bt.send(peerId, JSON.stringify(env));
    },
    [bt]
  );

  const stop = useCallback(() => bt.stop(), [bt]);

  return {
    supported: bt.supported,
    running: bt.running,
    peers: bt.peers,
    error: bt.error,
    // host
    startHosting,
    sendContext,
    // joiner
    startScanning,
    joinHost,
    // both
    sendMove,
    sendAccepted,
    stop,
  };
}
