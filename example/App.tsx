import React, { useCallback, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useCounsel } from './src/useCounsel';
import { warmColors } from './src/between-us/warmColors';
import { Wordmark } from './src/between-us/components/Wordmark';
import { WarmButton } from './src/between-us/components/WarmButton';
import { PhasePill } from './src/between-us/components/PhasePill';
import { DisplayTitle } from './src/between-us/components/DisplayTitle';
import { Screen1 } from './src/between-us/screens/Screen1';
import type { SessionContext } from './src/between-us/types';

// ── Fade hook ────────────────────────────────────────────────────────────────

function useFade() {
  const anim = useRef(new Animated.Value(1)).current;
  const active = useRef(false);
  const transition = useCallback(
    (cb: () => void) => {
      if (active.current) return;
      active.current = true;
      Animated.timing(anim, {
        toValue: 0,
        duration: 200,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }).start(() => {
        cb();
        Animated.timing(anim, {
          toValue: 1,
          duration: 250,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }).start(() => {
          active.current = false;
        });
      });
    },
    [anim]
  );
  return { anim, transition };
}

// ── Gate: name + model download ──────────────────────────────────────────────

function GateScreen({
  myName,
  setMyName,
  c,
}: {
  myName: string;
  setMyName: (s: string) => void;
  c: ReturnType<typeof useCounsel>;
}) {
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.gate}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Wordmark />
        <View style={styles.gap32} />
        <Text style={styles.gateTagline}>
          Two people. Two private AI counselors on-device. No cloud.
        </Text>
        <View style={styles.gap28} />

        <Text style={styles.fieldLabel}>Your name</Text>
        <View style={styles.gap6} />
        <TextInput
          style={styles.textField}
          value={myName}
          onChangeText={setMyName}
          placeholder="what should your counselor call you?"
          placeholderTextColor={warmColors.textTertiary}
          autoCapitalize="words"
          returnKeyType="done"
        />
        <View style={styles.gap20} />

        {c.modelStatus === 'idle' && (
          <WarmButton
            label="get started"
            disabled={!myName.trim()}
            onPress={c.initialize}
          />
        )}

        {c.modelStatus === 'downloading' && (
          <View style={styles.progressWrap}>
            <Text style={styles.progressLabel}>
              downloading model — {Math.round(c.progress * 100)}%
            </Text>
            <View style={styles.progressTrack}>
              <View
                style={[styles.progressFill, { width: `${Math.round(c.progress * 100)}%` }]}
              />
            </View>
            <Text style={styles.progressNote}>
              this only happens once — the model lives on your device
            </Text>
          </View>
        )}

        {c.modelStatus === 'loading' && (
          <View style={styles.centeredRow}>
            <ActivityIndicator size="small" color={warmColors.accentA} />
            <Text style={styles.loadingText}>loading model into memory…</Text>
          </View>
        )}

        {c.modelStatus === 'error' && (
          <>
            <Text style={styles.errorText}>{c.modelError ?? 'Something went wrong'}</Text>
            <View style={styles.gap12} />
            <WarmButton label="try again" onPress={c.initialize} />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Lobby: find the other device ─────────────────────────────────────────────

function LobbyScreen({
  myName,
  c,
}: {
  myName: string;
  c: ReturnType<typeof useCounsel>;
}) {
  const nearby = c.nearby;
  const isIdle = nearby.state === 'idle';
  const isHosting = nearby.state === 'hosting';
  const isBrowsing = nearby.state === 'browsing';
  const isConnecting = nearby.state === 'connecting';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.lobbyScroll}
      showsVerticalScrollIndicator={false}
    >
      <Wordmark />
      <View style={styles.gap8} />
      <PhasePill label="finding the other person" tone="taupe" />
      <View style={styles.gap20} />
      <DisplayTitle>Ready when you are, {myName}.</DisplayTitle>
      <View style={styles.gap8} />
      <Text style={styles.subtitle}>
        One of you starts the conversation, the other joins. The phones connect
        directly — nothing leaves your devices.
      </Text>
      <View style={styles.gap32} />

      {isIdle && (
        <>
          <WarmButton label="I want to start the conversation" onPress={nearby.host} />
          <View style={styles.gap12} />
          <WarmButton label="someone invited me" variant="ghost" onPress={nearby.browse} />
        </>
      )}

      {isHosting && (
        <View style={styles.waitingCard}>
          <ActivityIndicator size="small" color={warmColors.accentA} />
          <View style={styles.gap12} />
          <Text style={styles.waitingTitle}>waiting for the other person…</Text>
          <Text style={styles.waitingBody}>
            Ask them to open the app and tap "someone invited me".
          </Text>
          <View style={styles.gap16} />
          <WarmButton label="cancel" variant="ghost" onPress={nearby.leave} />
        </View>
      )}

      {isBrowsing && (
        <View style={styles.waitingCard}>
          <ActivityIndicator size="small" color={warmColors.accentB} />
          <View style={styles.gap12} />
          <Text style={styles.waitingTitle}>looking for nearby sessions…</Text>
          {nearby.peers.length === 0 ? (
            <Text style={styles.waitingBody}>
              No sessions found yet — ask them to open the app first.
            </Text>
          ) : (
            <View style={styles.peerList}>
              {nearby.peers.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={styles.peerRow}
                  onPress={() => nearby.connect(p.id)}
                  activeOpacity={0.8}
                >
                  <View style={styles.peerIcon}>
                    <Text style={styles.peerIconText}>
                      {(p.name ?? '?').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.peerInfo}>
                    <Text style={styles.peerName}>{p.name ?? 'Unknown'}</Text>
                    <Text style={styles.peerHint}>tap to connect</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <View style={styles.gap16} />
          <WarmButton label="cancel" variant="ghost" onPress={nearby.leave} />
        </View>
      )}

      {isConnecting && (
        <View style={styles.centeredRow}>
          <ActivityIndicator size="small" color={warmColors.accentB} />
          <Text style={styles.loadingText}>connecting…</Text>
        </View>
      )}
    </ScrollView>
  );
}

// ── Setup: tell your counselor your side ─────────────────────────────────────

function SetupScreen({ c, myName }: { c: ReturnType<typeof useCounsel>; myName: string }) {
  const sessionCtx: SessionContext = {
    name: myName,
    situation: c.topic,
    conversationType: 'Personal',
    desiredOutcome: '',
  };

  return (
    <Screen1
      sessionCtx={sessionCtx}
      onComplete={(answers) => {
        c.submitSetup({
          topic: c.topic || undefined,
          context: [
            answers.goodOutcome,
            answers.hardLimit,
            answers.wiggleRoom,
            answers.personalContext,
          ]
            .filter(Boolean)
            .join('\n\n'),
        });
      }}
    />
  );
}

// ── Waiting: syncing with peer ────────────────────────────────────────────────

function WaitingScreen() {
  const pulse = useRef(new Animated.Value(0.5)).current;
  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.5,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  return (
    <View style={styles.centered}>
      <Wordmark />
      <View style={styles.gap32} />
      <Animated.Text style={[styles.waitingTitle, { opacity: pulse }]}>
        waiting for the other person to finish…
      </Animated.Text>
      <View style={styles.gap8} />
      <Text style={styles.waitingBody}>
        Your counselor is ready. Syncing when they are.
      </Text>
    </View>
  );
}

// ── Session: negotiation feed ─────────────────────────────────────────────────

function SessionScreen({
  c,
  localParty,
}: {
  c: ReturnType<typeof useCounsel>;
  localParty: 'A' | 'B';
}) {
  const scrollRef = useRef<ScrollView>(null);
  React.useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [c.feed]);

  return (
    <View style={styles.screen}>
      <View style={styles.sessionHeader}>
        <Wordmark />
        <View style={styles.gap8} />
        <PhasePill
          label={c.thinking ? 'your counselor is thinking…' : 'counselors are talking'}
          tone="taupe"
        />
        {c.topic ? (
          <>
            <View style={styles.gap8} />
            <Text style={styles.topicText}>{c.topic}</Text>
          </>
        ) : null}
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.feedContent}
        showsVerticalScrollIndicator={false}
      >
        {c.feed.map((item) => {
          const isOwn = item.party === localParty;
          const isShared = item.type === 'proposal' || item.type === 'note';
          return (
            <View
              key={item.id}
              style={[
                styles.feedBubbleWrap,
                isShared
                  ? styles.feedBubbleCenter
                  : isOwn
                  ? styles.feedBubbleRight
                  : styles.feedBubbleLeft,
              ]}
            >
              <View
                style={[
                  styles.feedBubble,
                  isShared
                    ? styles.feedBubbleShared
                    : isOwn
                    ? styles.feedBubbleOwn
                    : styles.feedBubbleOther,
                ]}
              >
                <Text
                  style={[
                    styles.feedText,
                    isShared ? styles.feedTextShared : styles.feedTextNormal,
                  ]}
                >
                  {item.text}
                </Text>
              </View>
            </View>
          );
        })}

        {c.peerActivity ? (
          <Text style={styles.peerActivityText}>{c.peerActivity}</Text>
        ) : null}

        <View style={styles.gap40} />
      </ScrollView>

      {c.composer.open && <ComposerBar c={c} />}
      {c.consensus && <ConsensusCard c={c} />}
    </View>
  );
}

function ComposerBar({ c }: { c: ReturnType<typeof useCounsel> }) {
  const [text, setText] = useState('');
  const prompt = c.composer.prompt;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.composerWrap}>
        {prompt && (
          <View style={styles.composerPrompt}>
            <Text style={styles.composerPromptTitle}>{prompt.summary}</Text>
            {prompt.questions.map((q, i) => (
              <Text key={i} style={styles.composerQuestion}>
                • {q}
              </Text>
            ))}
          </View>
        )}
        <View style={styles.composerRow}>
          <TextInput
            style={styles.composerField}
            value={text}
            onChangeText={setText}
            placeholder="type your response…"
            placeholderTextColor={warmColors.textTertiary}
            multiline
            autoFocus
          />
          <TouchableOpacity
            style={[styles.composerSend, !text.trim() && styles.composerSendDisabled]}
            onPress={() => {
              c.submitInput(text);
              setText('');
            }}
            disabled={!text.trim()}
          >
            <Text style={styles.composerSendText}>→</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={c.cancelInput}>
          <Text style={styles.cancelText}>never mind</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function ConsensusCard({ c }: { c: ReturnType<typeof useCounsel> }) {
  const p = c.consensus!;
  return (
    <View style={styles.consensusCard}>
      <Text style={styles.consensusLabel}>a resolution is on the table</Text>
      <View style={styles.gap12} />
      <Text style={styles.consensusTitle}>{p.summary}</Text>
      {p.terms?.map((t: string, i: number) => (
        <Text key={i} style={styles.consensusTerm}>
          • {t}
        </Text>
      ))}
      <View style={styles.gap16} />
      <WarmButton label="this works for me" onPress={() => c.submitVote('accept')} />
      <View style={styles.gap8} />
      <WarmButton label="not quite right" variant="ghost" onPress={() => c.submitVote('reject')} />
    </View>
  );
}

// ── Resolved ──────────────────────────────────────────────────────────────────

function ResolvedScreen({ c }: { c: ReturnType<typeof useCounsel> }) {
  const p = c.resolved!;
  const flash = useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.sequence([
      Animated.timing(flash, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
        easing: Easing.inOut(Easing.ease),
      }),
      Animated.timing(flash, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
        easing: Easing.inOut(Easing.ease),
      }),
    ]).start();
  }, []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.resolvedScroll}>
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: warmColors.successLight, opacity: flash }]}
        pointerEvents="none"
      />
      <Wordmark />
      <View style={styles.gap8} />
      <PhasePill label="you worked it out" tone="sage" />
      <View style={styles.gap24} />
      <DisplayTitle>You found common ground.</DisplayTitle>
      <View style={styles.gap20} />

      <View style={styles.verdictCard}>
        <Text style={styles.verdictCardLabel}>what you agreed on</Text>
        <View style={styles.gap8} />
        <Text style={styles.verdictCardBody}>{p.summary}</Text>
        {p.terms?.map((t: string, i: number) => (
          <Text key={i} style={styles.verdictTerm}>
            • {t}
          </Text>
        ))}
      </View>

      <View style={styles.gap20} />
      <WarmButton label="start a new conversation" variant="ghost" onPress={c.reset} />
      <View style={styles.gap40} />
    </ScrollView>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [myName, setMyName] = useState('');
  const c = useCounsel(myName.trim() || 'Me');
  const localParty: 'A' | 'B' = c.nearby.role === 'guest' ? 'B' : 'A';
  const { anim } = useFade();

  const modelReady = c.modelStatus === 'ready';

  let body: React.ReactNode;

  if (!modelReady) {
    body = <GateScreen myName={myName} setMyName={setMyName} c={c} />;
  } else if (c.phase === null) {
    body = <LobbyScreen myName={myName.trim() || 'Me'} c={c} />;
  } else if (c.phase === 'disconnected') {
    body = (
      <View style={styles.centered}>
        <Wordmark />
        <View style={styles.gap32} />
        <Text style={styles.waitingTitle}>The other device left the session.</Text>
        <View style={styles.gap20} />
        <WarmButton label="start over" onPress={c.reset} />
      </View>
    );
  } else if (c.phase === 'setup') {
    body = <SetupScreen c={c} myName={myName.trim() || 'Me'} />;
  } else if (c.phase === 'waiting') {
    body = <WaitingScreen />;
  } else if (c.resolved) {
    body = <ResolvedScreen c={c} />;
  } else {
    body = <SessionScreen c={c} localParty={localParty} />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <Animated.View style={[styles.flex, { opacity: anim }]}>{body}</Animated.View>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: warmColors.bgPrimary },
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: warmColors.bgPrimary },

  gate: {
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 60,
    backgroundColor: warmColors.bgPrimary,
  },
  gateTagline: {
    fontSize: 15,
    color: warmColors.textSecondary,
    lineHeight: 15 * 1.6,
    textAlign: 'center',
  },

  lobbyScroll: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 40,
    backgroundColor: warmColors.bgPrimary,
  },

  resolvedScroll: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 60,
    backgroundColor: warmColors.bgPrimary,
  },

  centered: {
    flex: 1,
    backgroundColor: warmColors.bgPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  centeredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },

  fieldLabel: { fontSize: 12, color: warmColors.textSecondary, fontWeight: '500' },
  textField: {
    backgroundColor: warmColors.bgSecondary,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: warmColors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    color: warmColors.textPrimary,
    height: 44,
  },

  subtitle: { fontSize: 14, color: warmColors.textSecondary, lineHeight: 14 * 1.6 },
  topicText: {
    fontSize: 13,
    color: warmColors.textSecondary,
    textAlign: 'center',
    fontStyle: 'italic',
  },

  progressWrap: { alignItems: 'center', gap: 8 },
  progressLabel: { fontSize: 13, color: warmColors.textSecondary },
  progressTrack: {
    width: '100%',
    height: 3,
    borderRadius: 2,
    backgroundColor: warmColors.bgTertiary,
    overflow: 'hidden',
  },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: warmColors.accentA },
  progressNote: { fontSize: 11, color: warmColors.textTertiary, textAlign: 'center' },
  loadingText: { fontSize: 13, color: warmColors.textSecondary },
  errorText: { fontSize: 13, color: '#C0392B', textAlign: 'center' },

  waitingCard: {
    backgroundColor: warmColors.bgSecondary,
    borderRadius: 16,
    padding: 20,
    borderWidth: 0.5,
    borderColor: warmColors.borderMedium,
    alignItems: 'center',
  },
  waitingTitle: {
    fontSize: 16,
    fontFamily: 'Georgia',
    color: warmColors.textPrimary,
    textAlign: 'center',
  },
  waitingBody: {
    fontSize: 13,
    color: warmColors.textSecondary,
    textAlign: 'center',
    lineHeight: 13 * 1.6,
  },

  peerList: { width: '100%', gap: 8, marginTop: 12 },
  peerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: warmColors.bgPrimary,
    borderRadius: 12,
    padding: 12,
    borderWidth: 0.5,
    borderColor: warmColors.borderMedium,
  },
  peerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: warmColors.accentBLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  peerIconText: { fontSize: 16, color: warmColors.accentB, fontWeight: '600' },
  peerInfo: { flex: 1 },
  peerName: { fontSize: 14, color: warmColors.textPrimary, fontWeight: '500' },
  peerHint: { fontSize: 11, color: warmColors.textTertiary, marginTop: 2 },

  sessionHeader: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: warmColors.border,
  },

  feedContent: { paddingHorizontal: 16, paddingTop: 16, gap: 12 },
  feedBubbleWrap: { maxWidth: '82%' },
  feedBubbleLeft: { alignSelf: 'flex-start' },
  feedBubbleRight: { alignSelf: 'flex-end' },
  feedBubbleCenter: { alignSelf: 'center', maxWidth: '92%' },
  feedBubble: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
  feedBubbleOwn: { backgroundColor: warmColors.accentALight },
  feedBubbleOther: {
    backgroundColor: warmColors.bgSecondary,
    borderWidth: 0.5,
    borderColor: warmColors.borderMedium,
    borderStyle: 'dashed',
  },
  feedBubbleShared: {
    backgroundColor: warmColors.sharedLight,
    borderWidth: 0.5,
    borderColor: warmColors.shared,
  },
  feedText: { fontSize: 13, lineHeight: 13 * 1.6 },
  feedTextNormal: { color: warmColors.textPrimary },
  feedTextShared: { color: warmColors.textPrimary, fontStyle: 'italic' },
  peerActivityText: {
    fontSize: 11,
    color: warmColors.textTertiary,
    textAlign: 'center',
    fontStyle: 'italic',
  },

  composerWrap: {
    backgroundColor: warmColors.bgSecondary,
    borderTopWidth: 0.5,
    borderTopColor: warmColors.borderMedium,
    padding: 16,
    paddingBottom: 32,
    gap: 10,
  },
  composerPrompt: {
    backgroundColor: warmColors.accentALight,
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  composerPromptTitle: { fontSize: 13, fontWeight: '500', color: warmColors.textPrimary },
  composerQuestion: { fontSize: 12, color: warmColors.textSecondary, lineHeight: 12 * 1.6 },
  composerRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  composerField: {
    flex: 1,
    backgroundColor: warmColors.bgPrimary,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: warmColors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: warmColors.textPrimary,
    minHeight: 44,
    maxHeight: 100,
  },
  composerSend: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: warmColors.accentA,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerSendDisabled: { backgroundColor: warmColors.bgTertiary },
  composerSendText: { color: warmColors.bgPrimary, fontSize: 18 },
  cancelText: { fontSize: 12, color: warmColors.textTertiary, textAlign: 'center' },

  consensusCard: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: warmColors.bgSecondary,
    borderTopWidth: 0.5,
    borderTopColor: warmColors.borderMedium,
    padding: 20,
    paddingBottom: 40,
  },
  consensusLabel: {
    fontSize: 11,
    color: warmColors.shared,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.44,
  },
  consensusTitle: {
    fontSize: 15,
    fontFamily: 'Georgia',
    color: warmColors.textPrimary,
    lineHeight: 15 * 1.6,
  },
  consensusTerm: { fontSize: 13, color: warmColors.textSecondary, lineHeight: 13 * 1.6 },

  verdictCard: {
    backgroundColor: warmColors.successLight,
    borderRadius: 16,
    padding: 20,
    borderWidth: 0.5,
    borderColor: warmColors.success + '40',
  },
  verdictCardLabel: {
    fontSize: 11,
    color: warmColors.success,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.44,
  },
  verdictCardBody: {
    fontSize: 15,
    fontFamily: 'Georgia',
    color: warmColors.textPrimary,
    lineHeight: 15 * 1.6,
  },
  verdictTerm: { fontSize: 13, color: warmColors.textSecondary, lineHeight: 13 * 1.6, marginTop: 4 },

  gap6: { height: 6 },
  gap8: { height: 8 },
  gap12: { height: 12 },
  gap16: { height: 16 },
  gap20: { height: 20 },
  gap24: { height: 24 },
  gap28: { height: 28 },
  gap32: { height: 32 },
  gap40: { height: 40 },
});
