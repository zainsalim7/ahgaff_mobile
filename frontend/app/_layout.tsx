import React, { useEffect, useState, Suspense } from 'react';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '../src/store/authStore';
import { useOfflineSyncStore } from '../src/store/offlineSyncStore';
import { View, StyleSheet, I18nManager, TouchableOpacity, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AuthProvider } from '../src/contexts/AuthContext';
import { SideMenu } from '../src/components/SideMenu';
import { observeWebVitals } from '../src/utils/performanceUtils';

// Enable RTL for Arabic
I18nManager.allowRTL(true);
I18nManager.forceRTL(true);

// Load Arabic font on web to fix rendering issues in some Chrome browsers
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  // تحميل خط Cairo مع preconnect للسرعة
  const preconnect = document.createElement('link');
  preconnect.rel = 'preconnect';
  preconnect.href = 'https://fonts.googleapis.com';
  document.head.appendChild(preconnect);

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700;800&display=swap';
  document.head.appendChild(link);

  // تطبيق الخط على كل العناصر مع الحفاظ على خطوط الأيقونات
  const style = document.createElement('style');
  style.textContent = `
    * {
      font-family: 'Cairo', 'Ionicons', 'Material Design Icons', 'MaterialCommunityIcons', 'FontAwesome', 'Segoe UI', Tahoma, Arial, sans-serif !important;
    }
  `;
  document.head.appendChild(style);
}

export default function RootLayout() {
  const loadAuth = useAuthStore((state) => state.loadAuth);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { loadFromStorage, startNetworkMonitoring } = useOfflineSyncStore();
  const [menuVisible, setMenuVisible] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    loadAuth();
    loadFromStorage();
    
    // بدء مراقبة حالة الاتصال
    const unsubscribe = startNetworkMonitoring();

    // بدء مراقبة Core Web Vitals (ويب فقط)
    observeWebVitals();
    
    return () => {
      unsubscribe();
    };
  }, []);

  // لا تظهر القائمة في صفحات تسجيل الدخول والتحميل
  const isLoginPage = pathname === '/login' || pathname === '/change-password';
  const showMenu = isAuthenticated && !isLoginPage;

  return (
    <AuthProvider>
      <View style={styles.container}>
        <StatusBar style="light" />
        <Suspense
          fallback={
            <View style={styles.suspenseFallback}>
              <ActivityIndicator size="large" color="#fff" />
            </View>
          }
        >
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
          <Stack.Screen name="add-department" options={{ title: 'إدارة الأقسام' }} />
          <Stack.Screen name="reports" options={{ title: 'التقارير' }} />
          <Stack.Screen name="course-lectures" options={{ title: 'محاضرات المقرر' }} />
          <Stack.Screen name="permissions" options={{ title: 'الصلاحيات' }} />
          <Stack.Screen name="general-settings" options={{ title: 'الإعدادات العامة' }} />
          <Stack.Screen name="change-password" options={{ title: 'تغيير كلمة المرور', headerShown: false }} />
          <Stack.Screen name="manage-teachers" options={{ title: 'إدارة المعلمين' }} />
          <Stack.Screen name="manage-users" options={{ title: 'إدارة المستخدمين' }} />
          <Stack.Screen name="manage-roles" options={{ title: 'الأدوار والصلاحيات' }} />
          <Stack.Screen name="manage-notifications" options={{ title: 'إدارة الإشعارات' }} />
          <Stack.Screen name="department-dashboard" options={{ title: 'لوحة تحكم الأقسام' }} />
          <Stack.Screen name="report-attendance-overview" options={{ title: 'تقرير الحضور' }} />
          <Stack.Screen name="report-student" options={{ title: 'تقرير الطالب' }} />
          <Stack.Screen name="report-warnings" options={{ title: 'الإنذارات' }} />
          <Stack.Screen name="report-daily" options={{ title: 'التقرير اليومي' }} />
          <Stack.Screen name="report-course" options={{ title: 'تقرير المقرر' }} />
          <Stack.Screen name="activity-logs" options={{ title: 'سجلات النشاط' }} />
          <Stack.Screen name="course-students" options={{ title: 'طلاب المقرر' }} />
          <Stack.Screen name="notifications" options={{ title: 'الإشعارات' }} />
        </Stack>
        </Suspense>

        {/* زر القائمة العائم - يظهر في جميع الصفحات عند تسجيل الدخول */}
        {showMenu && (
          <TouchableOpacity
            onPress={() => setMenuVisible(true)}
            testID="floating-menu-btn"
            style={styles.floatingMenuBtn}
          >
            <Ionicons name="menu" size={20} color="#1565c0" />
          </TouchableOpacity>
        )}

        {/* القائمة الجانبية */}
        <SideMenu
          visible={menuVisible}
          onClose={() => setMenuVisible(false)}
        />
      </View>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1565c0',
  },
  suspenseFallback: {
    flex: 1,
    backgroundColor: '#1565c0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  floatingMenuBtn: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 8 : 50,
    left: 8,
    zIndex: 9999,
    backgroundColor: '#ffffff',
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
});
