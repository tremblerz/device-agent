import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useBluetoothExchange, type BluetoothMessage, type BluetoothPeer } from 'react-native-device-agent';

export function BluetoothPanel() {
  const { supported, running, peers, messages, error, start, stop, connect, disconnect, send } =
    useBluetoothExchange();
  const [outbound, setOutbound] = useState('');
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null);
  const [busyPeerId, setBusyPeerId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const selectedPeer = useMemo(
    () => peers.find((peer) => peer.id === selectedPeerId) ?? peers[0] ?? null,
    [peers, selectedPeerId],
  );

  const sortedMessages = useMemo(() => messages.slice().reverse(), [messages]);

  const onStart = async () => {
    setStarting(true);
    try {
      const granted = await ensureBluetoothPermissions();
      if (!granted) return;
      await start({ displayName: 'Device Agent' });
    } finally {
      setStarting(false);
    }
  };

  const onConnect = async (peerId: string) => {
    setBusyPeerId(peerId);
    try {
      await connect(peerId);
      setSelectedPeerId(peerId);
    } finally {
      setBusyPeerId(null);
    }
  };

  const onDisconnect = async (peerId: string) => {
    setBusyPeerId(peerId);
    try {
      await disconnect(peerId);
      if (selectedPeerId === peerId) {
        setSelectedPeerId(null);
      }
    } finally {
      setBusyPeerId(null);
    }
  };

  const onSend = async () => {
    const text = outbound.trim();
    if (!text || !selectedPeer) return;
    setOutbound('');
    await send(selectedPeer.id, text);
  };

  if (!supported) {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Bluetooth Exchange</Text>
        <Text style={styles.helperText}>Bluetooth is not available on this device or simulator.</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.sectionTitle}>Bluetooth Exchange</Text>
          <Text style={styles.helperText}>
            {running ? 'Advertising and scanning nearby phones' : 'Start to find nearby phones'}
          </Text>
        </View>
        {starting ? <ActivityIndicator color="#0f766e" /> : null}
      </View>

      <View style={styles.actionRow}>
        {!running ? (
          <Pressable style={styles.primaryBtn} onPress={onStart}>
            <Text style={styles.primaryBtnText}>Start Bluetooth</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.secondaryBtn} onPress={stop}>
            <Text style={styles.secondaryBtnText}>Stop</Text>
          </Pressable>
        )}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Text style={styles.subheading}>Nearby peers</Text>
      <FlatList
        data={peers}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.peerList}
        renderItem={({ item }) => (
          <PeerChip
            peer={item}
            selected={selectedPeerId === item.id}
            busy={busyPeerId === item.id}
            onConnect={() => onConnect(item.id)}
            onDisconnect={() => onDisconnect(item.id)}
            onSelect={() => setSelectedPeerId(item.id)}
          />
        )}
        ListEmptyComponent={<Text style={styles.helperText}>No peers yet. Have another phone start too.</Text>}
      />

      <Text style={styles.subheading}>
        Chat {selectedPeer ? `with ${selectedPeer.name ?? selectedPeer.id.slice(0, 8)}` : ''}
      </Text>
      <FlatList<BluetoothMessage>
        data={sortedMessages}
        keyExtractor={(item) => item.id}
        style={styles.messageList}
        contentContainerStyle={styles.messageListContent}
        renderItem={({ item }) => (
          <View style={[styles.messageBubble, item.direction === 'outgoing' ? styles.outgoing : styles.incoming]}>
            <Text style={styles.messageMeta}>
              {item.direction === 'outgoing' ? 'You' : item.peerName ?? item.peerId.slice(0, 8)}
            </Text>
            <Text style={styles.messageText}>{item.text}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.helperText}>Send a message to see it appear here.</Text>}
      />

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={outbound}
          onChangeText={setOutbound}
          placeholder="Type a Bluetooth message"
          placeholderTextColor="#94a3b8"
          multiline
        />
        <Pressable
          style={[styles.sendBtn, (!selectedPeer || !outbound.trim()) && styles.sendBtnDisabled]}
          onPress={onSend}
          disabled={!selectedPeer || !outbound.trim()}
        >
          <Text style={styles.sendBtnText}>Send</Text>
        </Pressable>
      </View>
    </View>
  );
}

function PeerChip(props: {
  peer: BluetoothPeer;
  selected: boolean;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onSelect: () => void;
}) {
  const { peer, selected, busy, onConnect, onDisconnect, onSelect } = props;
  return (
    <Pressable style={[styles.peerChip, selected && styles.peerChipSelected]} onPress={onSelect}>
      <Text style={styles.peerName}>{peer.name ?? peer.id.slice(0, 8)}</Text>
      <Text style={styles.peerSubtext}>RSSI {peer.rssi ?? 'n/a'}</Text>
      <Text style={styles.peerSubtext}>{peer.connected ? 'Connected' : 'Discovered'}</Text>
      <View style={styles.peerActions}>
        {!peer.connected ? (
          <Pressable style={styles.peerActionBtn} onPress={onConnect} disabled={busy}>
            <Text style={styles.peerActionText}>{busy ? '...' : 'Connect'}</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.peerActionBtn} onPress={onDisconnect} disabled={busy}>
            <Text style={styles.peerActionText}>{busy ? '...' : 'Disconnect'}</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

async function ensureBluetoothPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  if (Number(Platform.Version) < 31) {
    const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }
  const results = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
  ]);
  return Object.values(results).every((value) => value === PermissionsAndroid.RESULTS.GRANTED);
}

const styles = StyleSheet.create({
  card: {
    margin: 16,
    padding: 16,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#cbd5e1',
    shadowColor: '#020617',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
    gap: 14,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  helperText: { color: '#475569', lineHeight: 20 },
  subheading: { marginTop: 6, fontSize: 14, fontWeight: '700', color: '#0f172a', textTransform: 'uppercase', letterSpacing: 0.6 },
  actionRow: { flexDirection: 'row', gap: 10 },
  primaryBtn: { backgroundColor: '#0f766e', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14 },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  secondaryBtn: { backgroundColor: '#e2e8f0', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14 },
  secondaryBtnText: { color: '#0f172a', fontWeight: '700' },
  errorText: { color: '#b91c1c', fontWeight: '600' },
  peerList: { gap: 10, paddingVertical: 6 },
  peerChip: {
    width: 180,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    padding: 14,
    gap: 6,
    backgroundColor: '#f8fafc',
  },
  peerChipSelected: { borderColor: '#0f766e', backgroundColor: '#ecfeff' },
  peerName: { fontSize: 15, fontWeight: '800', color: '#0f172a' },
  peerSubtext: { color: '#475569', fontSize: 12 },
  peerActions: { marginTop: 6 },
  peerActionBtn: { backgroundColor: '#0f766e', alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  peerActionText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  messageList: { maxHeight: 240 },
  messageListContent: { gap: 8, paddingBottom: 4 },
  messageBubble: { borderRadius: 16, padding: 12, maxWidth: '92%' },
  incoming: { alignSelf: 'flex-start', backgroundColor: '#f1f5f9' },
  outgoing: { alignSelf: 'flex-end', backgroundColor: '#dbeafe' },
  messageMeta: { fontSize: 11, fontWeight: '700', color: '#475569', marginBottom: 4 },
  messageText: { color: '#0f172a', fontSize: 15, lineHeight: 21 },
  composer: { flexDirection: 'row', gap: 10, alignItems: 'flex-end' },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
  },
  sendBtn: { backgroundColor: '#0f172a', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12 },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: '#fff', fontWeight: '700' },
});
