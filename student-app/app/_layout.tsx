import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '../src/store/authStore';
import { View, StyleSheet, I18nManager } from 'react-native';

I18nManager.allowRTL(true);
I18nManager.forceRTL(true);

export default function RootLayout() {
  const loadAuth = useAuthStore((state) => state.loadAuth);

  useEffect(() => {
    loadAuth();
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0d47a1' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
          headerBackTitle: 'رجوع',
          animation: 'slide_from_left',
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="notifications" options={{ title: 'الإشعارات' }} />
        <Stack.Screen name="change-password" options={{ title: 'تغيير كلمة المرور', headerShown: false }} />
        <Stack.Screen name="student-card" options={{ title: 'بطاقة الطالب' }} />
        <Stack.Screen name="excuses" options={{ title: 'أعذار الغياب' }} />
      </Stack>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d47a1',
  },
});
