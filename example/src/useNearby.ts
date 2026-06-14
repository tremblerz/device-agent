import { useCallback, useEffect, useRef, useState } from 'react';
import {
  startAdvertise,
  stopAdvertise,
  startDiscovery,
  stopDiscovery,
  requestConnection,
  acceptConnection,
  disconnect,
  onPeerFound,
  onPeerLost,
  onInvitationReceived,
  onConnected,
  onDisconnected,
  type BasePeer,
} from 'expo-nearby-connections';
import { NearbyChannel } from './mediation/channel';
import type { Role } from './mediation/protocol';

export type LinkState =
  | 'idle'
  | 'hosting'
  | 'browsing'
  | 'connecting'
  | 'connected'
  | 'disconnected';

/**
 * Lobby connectivity over MultipeerConnectivity. One device hosts (advertises &
 * auto-accepts), the other browses & connects. On connection it produces a
 * {@link NearbyChannel} bound to the peer plus the agreed role.
 */
export function useNearby(localName: string) {
  const [state, setState] = useState<LinkState>('idle');
  const [role, setRole] = useState<Role | null>(null);
  const [peers, setPeers] = useState<BasePeer[]>([]);
  const [peerName, setPeerName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const channelRef = useRef<NearbyChannel | null>(null);
  const connectedIdRef = useRef<string | null>(null);
  const subs = useRef<Array<() => void>>([]);

  const cleanup = useCallback(() => {
    subs.current.forEach((u) => u());
    subs.current = [];
    void stopAdvertise().catch(() => {});
    void stopDiscovery().catch(() => {});
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const onLink = useCallback((peer: BasePeer) => {
    connectedIdRef.current = peer.peerId;
    channelRef.current = new NearbyChannel(peer.peerId);
    setPeerName(peer.name);
    setState('connected');
    void stopAdvertise().catch(() => {});
    void stopDiscovery().catch(() => {});
  }, []);

  const watchDisconnect = useCallback(() => {
    subs.current.push(
      onDisconnected(({ peerId }) => {
        if (peerId === connectedIdRef.current) setState('disconnected');
      }),
    );
  }, []);

  /** Host: advertise and auto-accept the first inviter. Becomes Party A. */
  const host = useCallback(async () => {
    try {
      setError(null);
      setRole('host');
      setState('hosting');
      watchDisconnect();
      subs.current.push(onInvitationReceived(({ peerId }) => void acceptConnection(peerId)));
      subs.current.push(onConnected(onLink));
      await startAdvertise(localName);
    } catch (e) {
      setError((e as Error).message);
      setState('idle');
    }
  }, [localName, onLink, watchDisconnect]);

  /** Guest: browse for hosts; connect to a chosen one. Becomes Party B. */
  const browse = useCallback(async () => {
    try {
      setError(null);
      setRole('guest');
      setState('browsing');
      setPeers([]);
      watchDisconnect();
      subs.current.push(onPeerFound((peer) => setPeers((p) => (p.some((x) => x.peerId === peer.peerId) ? p : [...p, peer]))));
      subs.current.push(onPeerLost(({ peerId }) => setPeers((p) => p.filter((x) => x.peerId !== peerId))));
      subs.current.push(onConnected(onLink));
      await startDiscovery(localName);
    } catch (e) {
      setError((e as Error).message);
      setState('idle');
    }
  }, [localName, onLink, watchDisconnect]);

  const connect = useCallback(async (peerId: string) => {
    try {
      setState('connecting');
      await requestConnection(peerId);
    } catch (e) {
      setError((e as Error).message);
      setState('browsing');
    }
  }, []);

  const leave = useCallback(() => {
    cleanup();
    const id = connectedIdRef.current;
    if (id) void disconnect(id).catch(() => {});
    channelRef.current?.close();
    channelRef.current = null;
    connectedIdRef.current = null;
    setState('idle');
    setRole(null);
    setPeers([]);
    setPeerName(null);
  }, [cleanup]);

  return {
    state,
    role,
    peers,
    peerName,
    error,
    channel: channelRef,
    host,
    browse,
    connect,
    leave,
  };
}
