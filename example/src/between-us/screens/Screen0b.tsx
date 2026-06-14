import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { warmColors } from '../warmColors';
import { Wordmark } from '../components/Wordmark';
import { PhasePill } from '../components/PhasePill';
import { DisplayTitle } from '../components/DisplayTitle';
import { WarmButton } from '../components/WarmButton';
import type { SessionContext } from '../types';

interface BTPeer {
  id: string;
  name: string | null;
  connected: boolean;
}

interface Props {
  onJoin: (ctx: SessionContext) => void;
  onDecline: () => void;
  peers?: BTPeer[];
  btRunning?: boolean;
  onStartScan?: (name: string) => Promise<void>;
  onJoinPeer?: (peerId: string) => Promise<void>;
}

export function Screen0b({ onJoin, onDecline, peers = [], btRunning = false, onStartScan, onJoinPeer }: Props) {
  const [name, setName] = useState('');
  const [scanning, setScanning] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  // Filter to peers that look like Between Us hosts (display name starts with "BU:")
  const buPeers = peers.filter((p) => p.name?.startsWith('BU:'));

  const handleStartScan = async () => {
    if (!name.trim() || !onStartScan) return;
    setScanning(true);
    await onStartScan(name.trim());
  };

  const handleJoinPeer = async (id: string) => {
    if (!onJoinPeer) return;
    setJoiningId(id);
    await onJoinPeer(id);
    // Navigation happens via onContextReceived in BetweenUsApp
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Wordmark />
      <View style={styles.gap8} />
      <PhasePill label="joining a session" tone="sage" />

      <View style={styles.gap20} />
      <DisplayTitle>Someone invited you</DisplayTitle>
      <View style={styles.gap8} />
      <Text style={styles.subtitle}>
        Enter your name, then tap Scan to find them nearby over Bluetooth.
      </Text>

      <View style={styles.gap28} />

      <Text style={styles.fieldLabel}>Your name</Text>
      <View style={styles.gap6} />
      <TextInput
        style={styles.textField}
        value={name}
        onChangeText={setName}
        placeholder="what should your agent call you?"
        placeholderTextColor={warmColors.textTertiary}
        autoCapitalize="words"
        returnKeyType="done"
      />
      <View style={styles.gap20} />

      {!btRunning ? (
        <WarmButton
          label="scan for nearby sessions"
          disabled={!name.trim()}
          onPress={handleStartScan}
        />
      ) : (
        <>
          <View style={styles.scanningRow}>
            <ActivityIndicator size="small" color={warmColors.accentB} />
            <Text style={styles.scanningText}>looking for nearby sessions…</Text>
          </View>

          {buPeers.length === 0 ? (
            <View style={styles.emptyPeers}>
              <Text style={styles.emptyText}>no sessions found yet — ask them to open the app</Text>
            </View>
          ) : (
            <View style={styles.peerList}>
              {buPeers.map((p) => {
                const hostName = p.name?.replace('BU:', '') ?? 'unknown';
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.peerRow, joiningId === p.id && styles.peerRowActive]}
                    onPress={() => handleJoinPeer(p.id)}
                    activeOpacity={0.8}
                    disabled={joiningId !== null}
                  >
                    <View style={styles.peerIcon}>
                      <Text style={styles.peerIconText}>{hostName.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={styles.peerInfo}>
                      <Text style={styles.peerName}>{hostName}</Text>
                      <Text style={styles.peerHint}>tap to connect</Text>
                    </View>
                    {joiningId === p.id && (
                      <ActivityIndicator size="small" color={warmColors.accentB} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </>
      )}

      <View style={styles.gap20} />
      <Text style={styles.noteText}>
        Your side of things stays with you — your agent will ask you about it next.
      </Text>

      <View style={styles.gap28} />
      <WarmButton label="this isn't for me" variant="ghost" onPress={onDecline} />

      <View style={styles.gap40} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: warmColors.bgPrimary },
  scroll: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 40 },
  subtitle: {
    fontSize: 14,
    color: warmColors.textSecondary,
    lineHeight: 14 * 1.6,
  },
  noteText: {
    fontSize: 12,
    color: warmColors.textTertiary,
    textAlign: 'center',
    lineHeight: 12 * 1.6,
  },
  fieldLabel: {
    fontSize: 12,
    color: warmColors.textSecondary,
    fontWeight: '500',
  },
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
  scanningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    justifyContent: 'center',
    paddingVertical: 12,
  },
  scanningText: { fontSize: 13, color: warmColors.textSecondary },
  emptyPeers: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: warmColors.textTertiary,
    textAlign: 'center',
    lineHeight: 13 * 1.6,
  },
  peerList: { gap: 8, marginTop: 12 },
  peerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: warmColors.bgSecondary,
    borderRadius: 14,
    padding: 14,
    borderWidth: 0.5,
    borderColor: warmColors.borderMedium,
  },
  peerRowActive: { borderColor: warmColors.accentB },
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
  gap6: { height: 6 },
  gap8: { height: 8 },
  gap10: { height: 10 },
  gap12: { height: 12 },
  gap20: { height: 20 },
  gap28: { height: 28 },
  gap40: { height: 40 },
});
