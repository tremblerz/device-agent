import React, { useCallback, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { warmColors } from './warmColors';
import type { AgentMove, DebriefInsight, IntakeAnswer, PersonId, Screen, SessionContext, VerdictResult } from './types';

import { Screen0a } from './screens/Screen0a';
import { Screen0b } from './screens/Screen0b';
import { Screen1 } from './screens/Screen1';
import { Screen2 } from './screens/Screen2';
import { Screen3, MOCK_INSIGHT } from './screens/Screen3';
import { Screen4, MOCK_VERDICT } from './screens/Screen4';
import { ModelLoader } from './agent/ModelLoader';
import { betweenUsAgent } from './agent/BetweenUsAgent';
import { useBetweenUsBluetooth } from './bluetooth/useBetweenUsBluetooth';

function Landing({ onHost, onJoin }: { onHost: () => void; onJoin: () => void }) {
  return (
    <View style={landingStyles.screen}>
      <Text style={landingStyles.wordmark}>between us</Text>
      <View style={{ height: 40 }} />
      <TouchableOpacity style={landingStyles.primaryBtn} onPress={onHost} activeOpacity={0.8}>
        <Text style={landingStyles.primaryLabel}>start a conversation</Text>
      </TouchableOpacity>
      <View style={{ height: 12 }} />
      <TouchableOpacity style={landingStyles.ghostBtn} onPress={onJoin} activeOpacity={0.8}>
        <Text style={landingStyles.ghostLabel}>someone invited me</Text>
      </TouchableOpacity>
    </View>
  );
}

const landingStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: warmColors.bgPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  wordmark: {
    fontSize: 24,
    fontFamily: 'Georgia',
    color: warmColors.textPrimary,
    letterSpacing: 0.3,
  },
  primaryBtn: {
    width: '100%',
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: warmColors.accentA,
  },
  primaryLabel: { fontSize: 15, fontWeight: '500', color: warmColors.bgPrimary },
  ghostBtn: {
    width: '100%',
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: warmColors.bgSecondary,
    borderWidth: 0.5,
    borderColor: warmColors.borderMedium,
  },
  ghostLabel: { fontSize: 15, fontWeight: '500', color: warmColors.accentA },
});

type AnyScreen = Screen | 'landing' | 'loading';

export function BetweenUsApp() {
  const [screen, setScreen] = useState<AnyScreen>('loading');
  const [personId, setPersonId] = useState<PersonId>('A');
  const [sessionCtx, setSessionCtx] = useState<SessionContext | null>(null);
  const [intakeAnswers, setIntakeAnswers] = useState<IntakeAnswer | null>(null);
  const [moves, setMoves] = useState<AgentMove[]>([]);
  const [debrief, setDebrief] = useState<DebriefInsight>(MOCK_INSIGHT);
  const [verdict, setVerdict] = useState<VerdictResult>(MOCK_VERDICT);
  const [_round, setRound] = useState(1);
  const [peerId, setPeerId] = useState<string | null>(null);

  const [otherPersonDebriefReady, setOtherPersonDebriefReady] = useState(false);
  const [otherPersonAccepted, setOtherPersonAccepted] = useState(false);

  const bt = useBetweenUsBluetooth({
    // Host: joiner connected → send them the session context
    onPeerJoined: async (id) => {
      setPeerId(id);
      if (sessionCtx) await bt.sendContext(id, sessionCtx);
    },
    // Joiner: received context from host → move to intake
    onContextReceived: (ctx) => {
      setSessionCtx(ctx);
      navigate('intake');
    },
    // Both: incoming agent move → add to moves list
    onMoveReceived: (move) => {
      setMoves((prev) => [...prev, move]);
    },
    // Both: other person accepted the verdict
    onPeerAccepted: () => setOtherPersonAccepted(true),
  });

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const transitioning = useRef(false);

  const navigate = useCallback(
    (next: AnyScreen) => {
      if (transitioning.current) return;
      transitioning.current = true;
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }).start(() => {
        setScreen(next);
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 250,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }).start(() => {
          transitioning.current = false;
        });
      });
    },
    [fadeAnim]
  );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={warmColors.bgPrimary} />

      <Animated.View style={[styles.fill, { opacity: fadeAnim }]}>

        {screen === 'loading' && (
          <ModelLoader
            onReady={async (engine) => {
              await betweenUsAgent.load(engine);
              navigate('landing');
            }}
          />
        )}

        {screen === 'landing' && (
          <Landing
            onHost={() => navigate('host')}
            onJoin={() => navigate('join')}
          />
        )}

        {screen === 'host' && (
          <Screen0a
            onSessionReady={async (ctx) => {
              setPersonId('A');
              setSessionCtx(ctx);
              // Advertise over Bluetooth so the joiner can find us
              await bt.startHosting(ctx);
              navigate('intake');
            }}
          />
        )}

        {screen === 'join' && (
          <Screen0b
            peers={bt.peers}
            btRunning={bt.running}
            onStartScan={async (name) => bt.startScanning(name)}
            onJoinPeer={async (id) => {
              setPeerId(id);
              await bt.joinHost(id);
              setPersonId('B');
              // Context arrives via onContextReceived → navigate('intake')
            }}
            onJoin={(ctx) => {
              // Fallback for manual/mock join without Bluetooth
              setPersonId('B');
              setSessionCtx(ctx);
              navigate('intake');
            }}
            onDecline={() => navigate('landing')}
          />
        )}

        {screen === 'intake' && (
          <Screen1
            agent={betweenUsAgent}
            sessionCtx={sessionCtx}
            onComplete={async (answers) => {
              setIntakeAnswers(answers);
              if (sessionCtx) {
                betweenUsAgent.setContext(sessionCtx, answers, personId);
              }
              setOtherPersonDebriefReady(false);
              navigate('negotiation');
            }}
          />
        )}

        {screen === 'negotiation' && (
          <Screen2
            personId={personId}
            agent={betweenUsAgent}
            incomingMoves={moves}
            onSendMove={async (move) => {
              if (peerId) await bt.sendMove(peerId, move);
              setMoves((prev) => [...prev, move]);
            }}
            onRoundComplete={async (r, roundMoves) => {
              setRound(r);
              setMoves(roundMoves);
              const insight = await betweenUsAgent.generateDebrief(roundMoves);
              setDebrief(insight);
              setOtherPersonDebriefReady(true);
              navigate('debrief');
            }}
          />
        )}

        {screen === 'debrief' && (
          <Screen3
            insight={debrief}
            otherPersonReady={otherPersonDebriefReady}
            onNextRound={async (_followUp) => {
              const v = await betweenUsAgent.generateVerdict(moves);
              setVerdict(v);
              navigate('verdict');
            }}
          />
        )}

        {screen === 'verdict' && (
          <Screen4
            verdict={verdict}
            personId={personId}
            otherPersonAccepted={otherPersonAccepted}
            onAccept={async () => {
              if (peerId) await bt.sendAccepted(peerId);
              // Demo fallback: simulate other side accepting after a delay
              if (!peerId) setTimeout(() => setOtherPersonAccepted(true), 2500);
            }}
            onDispute={() => navigate('debrief')}
          />
        )}

      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: warmColors.bgPrimary },
  fill: { flex: 1 },
});
