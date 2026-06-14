/**
 * ModelLoader — shown once on first launch while Qwen 2.5 3B downloads.
 * After load, calls onReady(engine) and never appears again.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { loadLlamaEngine } from 'react-native-device-agent';
import * as FileSystem from 'expo-file-system';
import { warmColors } from '../warmColors';
import { MODEL_URL, MODEL_FILENAME } from './BetweenUsAgent';
import type { LlamaEngine } from 'react-native-device-agent';

interface Props {
  onReady: (engine: LlamaEngine) => void;
}

type Phase = 'checking' | 'downloading' | 'loading' | 'error';

export function ModelLoader({ onReady }: Props) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const barWidth = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(barWidth, {
      toValue: progress,
      duration: 300,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: false,
    }).start();
  }, [progress]);

  useEffect(() => {
    run();
  }, []);

  async function run() {
    try {
      const modelDir = FileSystem.documentDirectory + 'between-us/';
      const modelPath = modelDir + MODEL_FILENAME;

      await FileSystem.makeDirectoryAsync(modelDir, { intermediates: true });

      const info = await FileSystem.getInfoAsync(modelPath);

      if (!info.exists) {
        setPhase('downloading');
        const dl = FileSystem.createDownloadResumable(
          MODEL_URL,
          modelPath,
          {},
          ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
            if (totalBytesExpectedToWrite > 0) {
              setProgress(totalBytesWritten / totalBytesExpectedToWrite);
            }
          }
        );
        await dl.downloadAsync();
      }

      setPhase('loading');
      const engine = await loadLlamaEngine({ modelPath, nCtx: 4096 });
      onReady(engine);
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong');
      setPhase('error');
    }
  }

  const label: Record<Phase, string> = {
    checking: 'checking for model…',
    downloading: `downloading Qwen 2.5 3B — ${Math.round(progress * 100)}%`,
    loading: 'loading model into memory…',
    error: error ?? 'something went wrong',
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.wordmark}>between us</Text>
      <View style={styles.gap32} />
      <Text style={styles.label}>{label[phase]}</Text>
      <View style={styles.gap16} />
      {phase === 'downloading' && (
        <View style={styles.track}>
          <Animated.View
            style={[
              styles.fill,
              {
                width: barWidth.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                }),
              },
            ]}
          />
        </View>
      )}
      <View style={styles.gap16} />
      <Text style={styles.note}>
        {phase === 'downloading'
          ? 'this only happens once — the model lives on your device'
          : phase === 'loading'
          ? 'almost there…'
          : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
  },
  label: {
    fontSize: 14,
    color: warmColors.textSecondary,
    textAlign: 'center',
    lineHeight: 14 * 1.6,
  },
  track: {
    width: '100%',
    height: 3,
    borderRadius: 2,
    backgroundColor: warmColors.bgTertiary,
    overflow: 'hidden',
  },
  fill: {
    height: 3,
    borderRadius: 2,
    backgroundColor: warmColors.accentA,
  },
  note: {
    fontSize: 12,
    color: warmColors.textTertiary,
    textAlign: 'center',
    lineHeight: 12 * 1.6,
  },
  gap16: { height: 16 },
  gap32: { height: 32 },
});
