import { useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { bluetoothBridge } from './native';
import type { BluetoothMessage, BluetoothPeer, BluetoothStartOptions } from './types';

export interface BluetoothExchangeState {
  supported: boolean;
  running: boolean;
  peers: BluetoothPeer[];
  messages: BluetoothMessage[];
  error: string | null;
}

export function useBluetoothExchange() {
  const [supported, setSupported] = useState(Platform.OS === 'android' || Platform.OS === 'ios');
  const [running, setRunning] = useState(false);
  const [peers, setPeers] = useState<BluetoothPeer[]>([]);
  const [messages, setMessages] = useState<BluetoothMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    bluetoothBridge.isSupported()
      .then((value) => {
        if (mounted) setSupported(value);
      })
      .catch((err) => {
        if (mounted) setError(String(err));
      });

    const subscriptions = [
      bluetoothBridge.addListener<BluetoothPeer>('peerFound', (peer) => {
        setPeers((current) => upsertPeer(current, peer));
      }),
      bluetoothBridge.addListener<{ peerId: string }>('peerLost', ({ peerId }) => {
        setPeers((current) => current.filter((peer) => peer.id !== peerId));
      }),
      bluetoothBridge.addListener<BluetoothPeer>('peerConnected', (peer) => {
        setPeers((current) => upsertPeer(current, { ...peer, connected: true }));
      }),
      bluetoothBridge.addListener<BluetoothPeer>('peerDisconnected', (peer) => {
        setPeers((current) => upsertPeer(current, { ...peer, connected: false }));
      }),
      bluetoothBridge.addListener<BluetoothMessage>('messageReceived', (message) => {
        setMessages((current) => [...current, message]);
      }),
      bluetoothBridge.addListener<{ error: string }>('error', ({ error }) => {
        setError(error);
      }),
    ];

    void bluetoothBridge.getPeers().then((initialPeers) => {
      if (mounted) setPeers(initialPeers);
    });

    return () => {
      mounted = false;
      subscriptions.forEach((subscription) => subscription.remove());
    };
  }, []);

  const api = useMemo(
    () => ({
      supported,
      running,
      peers,
      messages,
      error,
      async start(options: BluetoothStartOptions = {}) {
        setError(null);
        await bluetoothBridge.start(options);
        setRunning(true);
        setPeers(await bluetoothBridge.getPeers());
      },
      async stop() {
        await bluetoothBridge.stop();
        setRunning(false);
      },
      async connect(peerId: string) {
        setError(null);
        await bluetoothBridge.connect(peerId);
        setPeers(await bluetoothBridge.getPeers());
      },
      async disconnect(peerId: string) {
        await bluetoothBridge.disconnect(peerId);
        setPeers(await bluetoothBridge.getPeers());
      },
      async send(peerId: string, text: string) {
        const trimmed = text.trim();
        if (!trimmed) return;
        await bluetoothBridge.sendMessage(peerId, trimmed);
        const now = Date.now();
        setMessages((current) => [
          ...current,
          {
            id: `${now}-${Math.random().toString(16).slice(2)}`,
            peerId,
            peerName: peers.find((peer) => peer.id === peerId)?.name ?? null,
            text: trimmed,
            direction: 'outgoing',
            timestamp: now,
          },
        ]);
      },
    }),
    [error, messages, peers, running, supported],
  );

  return api;
}

function upsertPeer(current: BluetoothPeer[], next: BluetoothPeer): BluetoothPeer[] {
  const index = current.findIndex((peer) => peer.id === next.id);
  if (index === -1) {
    return [...current, next].sort(sortPeers);
  }
  const copy = current.slice();
  copy[index] = { ...copy[index], ...next };
  return copy.sort(sortPeers);
}

function sortPeers(a: BluetoothPeer, b: BluetoothPeer): number {
  return (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0) || a.id.localeCompare(b.id);
}
