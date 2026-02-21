import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '../src/store/authStore';
import { useOfflineSyncStore } from '../src/store/offlineSyncStore';
import { View, StyleSheet, I18nManager } from 'react-native';
import { AuthProvider } from '../src/contexts/AuthContext';

// Enable RTL for Arabic
I18nManager.allowRTL(true);
I18nManager.forceRTL(true);

export default function RootLayout() {
  const loadAuth = useAuthStore((state) => state.loadAuth);
  const { loadFromStorage, startNetworkMonitoring } = useOfflineSyncStore();

  useEffect(() => {
    loadAuth();
    loadFromStorage();
    
    // بدء مراقبة حالة الاتصال
    const unsubscribe = startNetworkMonitoring();
    
    return () => {
      unsubscribe();
    };
  }, []);

  return (
    <AuthProvider>
      <View style={styles.container}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: '#1565c0' },
            headerTintColor: '#fff',
            headerTitleStyle: { fontWeight: 'bold' },
            headerBackTitle: 'رجوع',
            animation: 'slide_from_left',
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="take-attendance" options={{ title: 'تسجيل الحضور' }} />
          <Stack.Screen name="qr-scanner" options={{ title: 'مسح QR' }} />
          <Stack.Screen name="course-stats" options={{ title: 'إحصائيات المقرر' }} />
          <Stack.Screen name="student-details" options={{ title: 'تفاصيل الطالب' }} />
          <Stack.Screen name="student-card" options={{ title: 'بطاقة الطالب' }} />
          <Stack.Screen name="schedule" options={{ title: 'جدول المحاضرات' }} />
          <Stack.Screen name="students" options={{ title: 'الطلاب' }} />
          <Stack.Screen name="add-course" options={{ title: 'إضافة مقرر' }} />
          <Stack.Screen name="add-teacher" options={{ title: 'إضافة معلم' }} />
          <Stack.Screen name="add-department" options={{ title: 'إضافة قسم' }} />
          <Stack.Screen name="reports" options={{ title: 'التقارير' }} />
          <Stack.Screen name="course-lectures" options={{ title: 'محاضرات المقرر' }} />
          <Stack.Screen name="permissions" options={{ title: 'الصلاحيات' }} />
          <Stack.Screen name="general-settings" options={{ title: 'الإعدادات العامة' }} />
          <Stack.Screen name="change-password" options={{ title: 'تغيير كلمة المرور', headerShown: false }} />
        </Stack>
      </View>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1565c0',
  },
});
