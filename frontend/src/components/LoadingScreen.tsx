import React, { memo, useEffect, useRef } from 'react';
import { View, ActivityIndicator, StyleSheet, Text, Animated } from 'react-native';
import { startTimer, endTimer } from '../utils/performanceUtils';

interface LoadingScreenProps {
  message?: string;
  /** Optional label used to measure how long the loading screen is shown */
  perfLabel?: string;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = memo(
  ({ message = 'جاري التحميل...', perfLabel }) => {
    const fadeAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
      // Fade in smoothly to avoid jarring flash
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();

      // Start perf timer if a label was provided
      if (perfLabel) startTimer(perfLabel);
      return () => {
        if (perfLabel) endTimer(perfLabel);
      };
    }, [perfLabel]);

    return (
      <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
        <ActivityIndicator size="large" color="#1565c0" />
        <Text style={styles.text}>{message}</Text>
      </Animated.View>
    );
  },
);

LoadingScreen.displayName = 'LoadingScreen';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  text: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
    fontFamily: 'System',
  },
});
