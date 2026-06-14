import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Speech from 'expo-speech';
import { StatusBar } from 'expo-status-bar';
import { MODEL } from './src/config';
import { useCounsel, type FeedItem } from './src/useCounsel';
import type { Party } from './src/mediation/types';

export default function App() {
  const [myName, setMyName] = useState('');
  const c = useCounsel(myName.trim() || 'Me');
  const localParty: Party = c.nearby.role === 'guest' ? 'B' : 'A';

  const nameOf = (p: Party) =>
    p === localParty ? `${myName.trim() || 'You'} (you)` : c.nearby.peerName ?? 'Other party';

  let body: React.ReactNode;
  if (c.modelStatus !== 'ready' && c.phase === null) {
    body = <Gate c={c} myName={myName} setMyName={setMyName} />;
  } else if (c.phase === null) {
    body = <Lobby c={c} />;
  } else if (c.phase === 'disconnected') {
    body = <Centered title="Disconnected" text="The other device left the session." onReset={c.reset} />;
  } else if (c.phase === 'setup') {
    body = <SetupScreen c={c} />;
  } else if (c.phase === 'waiting') {
    body = <Waiting c={c} />;
  } else {
    body = <SessionScreen c={c} nameOf={nameOf} localParty={localParty} />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.title}>On-Device Counsel</Text>
        <Text style={styles.subtitle}>{headerSub(c)}</Text>
      </View>
      {body}
    </SafeAreaView>
  );
}

type C = ReturnType<typeof useCounsel>;

function headerSub(c: C): string {
  if (c.modelStatus !== 'ready' && c.phase === null) return 'Two phones, two private AI counselors';
  if (c.phase === null) return c.nearby.state === 'connected' ? 'Connected · starting…' : 'Find the other device';
  switch (c.phase) {
    case 'setup':
      return 'Tell your counselor your side';
    case 'waiting':
      return 'Syncing…';
    case 'negotiating':
      return c.thinking ? 'Your counselor is thinking…' : 'Counselors are talking';
    case 'awaiting_user':
      return 'Your counselor needs you';
    case 'consensus':
      return 'A resolution is on the table';
    case 'resolved':
      return 'Resolved';
    default:
      return '';
  }
}

/* -------------------------------- gate ----------------------------------- */

function Gate({ c, myName, setMyName }: { c: C; myName: string; setMyName: (s: string) => void }) {
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.gate} keyboardShouldPersistTaps="handled">
        <Text style={styles.gateText}>
          Two people, two iPhones. Each runs a private AI counselor on-device ({MODEL.sizeLabel}); the
          phones talk directly over Bluetooth/Wi-Fi — no cloud, no uploads.
        </Text>
        <Text style={styles.label}>Your name</Text>
        <TextInput style={styles.field} value={myName} onChangeText={setMyName} placeholder="e.g. Alex" />

        {c.modelStatus === 'idle' && (
          <Pressable
            style={[styles.primaryBtn, !myName.trim() && styles.btnDisabled]}
            onPress={c.initialize}
            disabled={!myName.trim()}
          >
            <Text style={styles.primaryText}>Download &amp; load model</Text>
          </Pressable>
        )}
        {c.modelStatus === 'downloading' && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#2563eb" />
            <Text style={styles.gateText}>Downloading model… {Math.round(c.progress * 100)}%</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(c.progress * 100)}%` }]} />
            </View>
          </View>
        )}
        {c.modelStatus === 'loading' && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#2563eb" />
            <Text style={styles.gateText}>Loading model…</Text>
          </View>
        )}
        {c.modelStatus === 'error' && (
          <>
            <Text style={[styles.gateText, styles.errorText]}>Error: {c.modelError}</Text>
            <Pressable style={styles.primaryBtn} onPress={c.initialize}>
              <Text style={styles.primaryText}>Retry</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* -------------------------------- lobby ---------------------------------- */

function Lobby({ c }: { c: C }) {
  const n = c.nearby;
  return (
    <View style={styles.gate}>
      {n.state === 'idle' && (
        <>
          <Text style={styles.gateText}>One of you hosts the session; the other joins it.</Text>
          <Pressable style={styles.primaryBtn} onPress={n.host}>
            <Text style={styles.primaryText}>Host a session</Text>
          </Pressable>
          <Pressable style={styles.secondaryBtn} onPress={n.browse}>
            <Text style={styles.secondaryText}>Join a session</Text>
          </Pressable>
        </>
      )}
      {n.state === 'hosting' && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={styles.gateText}>Waiting for someone to join…</Text>
          <Pressable style={styles.secondaryBtn} onPress={n.leave}>
            <Text style={styles.secondaryText}>Cancel</Text>
          </Pressable>
        </View>
      )}
      {n.state === 'browsing' && (
        <View style={styles.flex}>
          <Text style={styles.gateText}>Nearby sessions:</Text>
          {n.peers.length === 0 && <Text style={styles.dim}>Searching…</Text>}
          {n.peers.map((p) => (
            <Pressable key={p.peerId} style={styles.peerRow} onPress={() => n.connect(p.peerId)}>
              <Text style={styles.peerName}>{p.name}</Text>
              <Text style={styles.peerJoin}>Join →</Text>
            </Pressable>
          ))}
          <Pressable style={styles.secondaryBtn} onPress={n.leave}>
            <Text style={styles.secondaryText}>Cancel</Text>
          </Pressable>
        </View>
      )}
      {n.state === 'connecting' && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={styles.gateText}>Connecting…</Text>
        </View>
      )}
      {n.error && <Text style={[styles.gateText, styles.errorText]}>{n.error}</Text>}
    </View>
  );
}

/* -------------------------------- setup ---------------------------------- */

function SetupScreen({ c }: { c: C }) {
  const isHost = c.nearby.role === 'host';
  const [topic, setTopic] = useState('');
  const [context, setContext] = useState('');

  const submit = () =>
    c.submitSetup(isHost ? { topic: topic.trim(), context: context.trim() } : { context: context.trim() });

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.setup} keyboardShouldPersistTaps="handled">
        {isHost ? (
          <>
            <Text style={styles.label}>What needs resolving?</Text>
            <TextInput
              style={styles.field}
              value={topic}
              onChangeText={setTopic}
              placeholder="The agenda for this session…"
              multiline
            />
          </>
        ) : (
          <View style={styles.agendaCard}>
            <Text style={styles.agendaLabel}>Agenda (set by host)</Text>
            <Text style={styles.agendaText}>{c.topic || '…'}</Text>
          </View>
        )}

        <Text style={styles.label}>Your side of it (stays on this phone)</Text>
        <TextInput
          style={styles.field}
          value={context}
          onChangeText={setContext}
          placeholder="Explain your perspective to your own counselor…"
          multiline
        />

        <Pressable
          style={[styles.primaryBtn, (isHost ? !topic.trim() || !context.trim() : !context.trim()) && styles.btnDisabled]}
          onPress={submit}
          disabled={isHost ? !topic.trim() || !context.trim() : !context.trim()}
        >
          <Text style={styles.primaryText}>{isHost ? 'Set agenda & begin' : "I'm ready"}</Text>
        </Pressable>
        <Text style={styles.fineprint}>
          Only your counselor's messages travel to the other phone — never this raw text.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Waiting({ c }: { c: C }) {
  const text =
    c.nearby.role === 'guest' && !c.topic
      ? 'Waiting for the host to set the agenda…'
      : 'Waiting for the other side to be ready…';
  return <Centered title="Almost there" text={text} spinner />;
}

/* ------------------------------- session --------------------------------- */

function SessionScreen({
  c,
  nameOf,
  localParty,
}: {
  c: C;
  nameOf: (p: Party) => string;
  localParty: Party;
}) {
  const listRef = useRef<FlatList<FeedItem>>(null);
  const [speechOn, setSpeechOn] = useState(false);
  const speechCursorRef = useRef(0);

  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, [c.feed, c.thinking]);

  useEffect(() => {
    if (!speechOn) return;

    const newMessages = c.feed.slice(speechCursorRef.current).filter((item) => item.type === 'message');
    speechCursorRef.current = c.feed.length;

    if (newMessages.length === 0) return;

    const text = newMessages.map((item) => item.text).join('. ');
    Speech.stop();
    Speech.speak(text, { language: 'en-US' });
  }, [c.feed, speechOn]);

  useEffect(
    () => () => {
      Speech.stop();
    },
    [],
  );

  return (
    <View style={styles.flex}>
      {Platform.OS === 'ios' && (
        <View style={styles.speakerBar}>
          <Pressable
            style={[styles.speakerBtn, speechOn ? styles.speakerBtnOn : styles.speakerBtnOff]}
            onPress={() => {
              if (speechOn) {
                Speech.stop();
                setSpeechOn(false);
                return;
              }

              speechCursorRef.current = c.feed.length;
              setSpeechOn(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={speechOn ? 'Stop reading messages' : 'Read new messages aloud'}
          >
            <View style={styles.speakerIcon}>
              <Text style={styles.speakerGlyph}>🔊</Text>
              {!speechOn && <View style={styles.speakerSlash} />}
            </View>
          </Pressable>
        </View>
      )}
      <FlatList
        ref={listRef}
        style={styles.flex}
        contentContainerStyle={styles.feed}
        data={c.feed}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => <FeedRow item={item} nameOf={nameOf} localParty={localParty} />}
        ListFooterComponent={
          c.thinking ? (
            <View style={styles.footRow}>
              <ActivityIndicator size="small" color="#64748b" />
              <Text style={styles.footText}>Your counselor is thinking…</Text>
            </View>
          ) : c.peerActivity ? (
            <Text style={styles.footText}>{c.peerActivity}</Text>
          ) : null
        }
      />

      {c.composer.open ? (
        <Composer prompt={c.composer.prompt} onSubmit={c.submitInput} onCancel={c.cancelInput} />
      ) : c.phase === 'negotiating' && !c.consensus && !c.resolved ? (
        <View style={styles.addBar}>
          <Pressable style={styles.addBtn} onPress={c.beginInput}>
            <Text style={styles.addBtnText}>✋ Tell your counselor something</Text>
          </Pressable>
        </View>
      ) : null}
      {c.consensus && !c.resolved && <VotePanel proposal={c.consensus.proposal} onVote={c.submitVote} />}
      {c.resolved && (
        <View style={styles.resolvedBar}>
          <Text style={styles.resolvedTitle}>✓ Both accepted</Text>
          <Text style={styles.resolvedText}>{c.resolved.proposal}</Text>
          <Pressable style={styles.secondaryBtn} onPress={c.reset}>
            <Text style={styles.secondaryText}>End session</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function FeedRow({
  item,
  nameOf,
  localParty,
}: {
  item: FeedItem;
  nameOf: (p: Party) => string;
  localParty: Party;
}) {
  if (item.type === 'tool') {
    return (
      <View style={styles.toolRow}>
        <Text style={styles.toolText}>{item.text}</Text>
      </View>
    );
  }
  if (item.type === 'note') {
    return (
      <View style={styles.noteRow}>
        <Text style={styles.noteText}>{item.text}</Text>
      </View>
    );
  }
  if (item.type === 'proposal') {
    return (
      <View style={styles.proposalCard}>
        <Text style={styles.proposalLabel}>Proposed by {item.party ? nameOf(item.party) : '—'}</Text>
        <Text style={styles.proposalText}>{item.text}</Text>
      </View>
    );
  }
  const mine = item.party === localParty;
  return (
    <View style={[styles.msgRow, mine ? styles.rowRight : styles.rowLeft]}>
      <View style={[styles.msgBubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        <Text style={[styles.msgWho, mine ? styles.whoMine : styles.whoTheirs]}>
          {item.party ? nameOf(item.party) : ''}
        </Text>
        <Text style={styles.msgText}>{item.text}</Text>
      </View>
    </View>
  );
}

function Composer(props: {
  prompt?: { summary: string; questions: string[] };
  onSubmit: (t: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const asked = !!props.prompt;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>
          {asked ? 'Your counselor needs your input' : 'Tell your counselor something'}
        </Text>
        {!!props.prompt?.summary && <Text style={styles.panelSummary}>{props.prompt.summary}</Text>}
        {props.prompt?.questions.map((q, i) => (
          <Text key={i} style={styles.panelQuestion}>
            • {q}
          </Text>
        ))}
        <Text style={styles.fineprint}>Both counselors are paused while you type. This stays on your phone.</Text>
        <TextInput
          style={styles.field}
          value={text}
          onChangeText={setText}
          placeholder={asked ? 'Your answer…' : 'A new point, a clarification, a constraint…'}
          multiline
          autoFocus
        />
        <Pressable
          style={[styles.primaryBtn, !text.trim() && styles.btnDisabled]}
          onPress={() => {
            props.onSubmit(text.trim());
            setText('');
          }}
          disabled={!text.trim()}
        >
          <Text style={styles.primaryText}>Send to my counselor</Text>
        </Pressable>
        <Pressable style={styles.secondaryBtn} onPress={props.onCancel}>
          <Text style={styles.secondaryText}>Cancel</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function VotePanel(props: { proposal: string; onVote: (v: { accept: boolean; counter?: string }) => void }) {
  const [counter, setCounter] = useState('');
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.panelScroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.panelTitle}>Proposed resolution</Text>
        <Text style={styles.panelSummary}>{props.proposal}</Text>
        <Pressable style={styles.primaryBtn} onPress={() => props.onVote({ accept: true })}>
          <Text style={styles.primaryText}>Accept ✓</Text>
        </Pressable>
        <Text style={styles.panelQuestion}>…or push back:</Text>
        <TextInput style={styles.fieldSm} value={counter} onChangeText={setCounter} placeholder="What you'd change…" />
        <Pressable
          style={[styles.secondaryBtn, !counter.trim() && styles.btnDisabled]}
          onPress={() => props.onVote({ accept: false, counter: counter.trim() })}
          disabled={!counter.trim()}
        >
          <Text style={styles.secondaryText}>Send counter</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Centered({ title, text, spinner, onReset }: { title: string; text: string; spinner?: boolean; onReset?: () => void }) {
  return (
    <View style={styles.gate}>
      {spinner && <ActivityIndicator size="large" color="#2563eb" />}
      <Text style={styles.panelTitle}>{title}</Text>
      <Text style={styles.gateText}>{text}</Text>
      {onReset && (
        <Pressable style={styles.primaryBtn} onPress={onReset}>
          <Text style={styles.primaryText}>Back to start</Text>
        </Pressable>
      )}
    </View>
  );
}

/* -------------------------------- styles --------------------------------- */

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  flex: { flex: 1 },
  center: { alignItems: 'center', gap: 12 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  title: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 2 },

  gate: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  gateText: { fontSize: 15, color: '#334155', textAlign: 'center', lineHeight: 21 },
  dim: { fontSize: 14, color: '#94a3b8' },
  errorText: { color: '#dc2626' },
  progressTrack: { width: 220, height: 8, backgroundColor: '#e2e8f0', borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: '#2563eb' },

  label: { fontSize: 14, fontWeight: '600', color: '#334155', alignSelf: 'stretch' },
  field: {
    alignSelf: 'stretch',
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#cbd5e1',
    padding: 12,
    fontSize: 15,
    color: '#0f172a',
    minHeight: 56,
  },
  fieldSm: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#cbd5e1',
    padding: 10,
    fontSize: 14,
    color: '#0f172a',
    marginTop: 4,
  },

  setup: { padding: 16, gap: 10, paddingBottom: 40 },
  agendaCard: { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 12, padding: 12, gap: 4 },
  agendaLabel: { fontSize: 12, fontWeight: '700', color: '#1d4ed8' },
  agendaText: { fontSize: 15, color: '#0f172a', lineHeight: 21 },
  fineprint: { fontSize: 12, color: '#94a3b8', textAlign: 'center', marginTop: 4, lineHeight: 17 },

  peerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignSelf: 'stretch',
    marginTop: 8,
  },
  peerName: { fontSize: 16, fontWeight: '600', color: '#0f172a' },
  peerJoin: { fontSize: 15, color: '#2563eb', fontWeight: '600' },

  feed: { padding: 14, gap: 8, paddingBottom: 24 },
  msgRow: { width: '100%', flexDirection: 'row' },
  rowLeft: { justifyContent: 'flex-start' },
  rowRight: { justifyContent: 'flex-end' },
  msgBubble: { maxWidth: '82%', borderRadius: 16, paddingHorizontal: 13, paddingVertical: 9 },
  bubbleMine: { backgroundColor: '#dbeafe', borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: '#f1f5f9', borderBottomLeftRadius: 4 },
  msgWho: { fontSize: 11, fontWeight: '700', marginBottom: 2 },
  whoMine: { color: '#1d4ed8' },
  whoTheirs: { color: '#475569' },
  msgText: { fontSize: 15, color: '#0f172a', lineHeight: 20 },

  footRow: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'center', paddingVertical: 6 },
  footText: { fontSize: 13, color: '#64748b', alignSelf: 'center', paddingVertical: 6 },

  proposalCard: { backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 14, padding: 13, gap: 4 },
  proposalLabel: { fontSize: 11, fontWeight: '700', color: '#b45309' },
  proposalText: { fontSize: 15, color: '#0f172a', lineHeight: 21 },

  toolRow: { alignSelf: 'center', backgroundColor: '#f1f5f9', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 5, maxWidth: '92%' },
  toolText: { fontSize: 11, color: '#64748b', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  noteRow: { alignSelf: 'center', paddingVertical: 4 },
  noteText: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic' },

  speakerBar: {
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
    padding: 10,
    alignItems: 'flex-end',
  },
  speakerBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  speakerBtnOff: { backgroundColor: '#f8fafc', borderColor: '#cbd5e1' },
  speakerBtnOn: { backgroundColor: '#dbeafe', borderColor: '#93c5fd' },
  speakerIcon: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  speakerGlyph: { fontSize: 18, lineHeight: 20, color: '#0f172a' },
  speakerSlash: {
    position: 'absolute',
    width: 26,
    height: 2,
    backgroundColor: '#dc2626',
    transform: [{ rotate: '-45deg' }],
  },
  addBar: { backgroundColor: '#fff', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e2e8f0', padding: 10 },
  addBtn: { backgroundColor: '#eef2ff', borderRadius: 12, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: '#c7d2fe' },
  addBtnText: { color: '#4338ca', fontSize: 15, fontWeight: '600' },
  panel: { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e2e8f0', padding: 16, gap: 8 },
  panelScroll: { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e2e8f0', padding: 16, maxHeight: 340 },
  panelTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  panelSummary: { fontSize: 14, color: '#334155', lineHeight: 20, marginBottom: 4 },
  panelQuestion: { fontSize: 14, color: '#475569', marginTop: 4 },

  primaryBtn: { backgroundColor: '#2563eb', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 8, alignSelf: 'stretch' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  btnDisabled: { opacity: 0.4 },
  secondaryBtn: { paddingVertical: 12, borderRadius: 12, alignItems: 'center', marginTop: 6, alignSelf: 'stretch' },
  secondaryText: { color: '#2563eb', fontSize: 15, fontWeight: '600' },

  resolvedBar: { backgroundColor: '#ecfdf5', borderTopWidth: 1, borderTopColor: '#a7f3d0', padding: 16, gap: 6 },
  resolvedTitle: { fontSize: 16, fontWeight: '700', color: '#047857' },
  resolvedText: { fontSize: 14, color: '#065f46', lineHeight: 20 },
});
