import React, { useEffect, useState } from 'react';
import { Stack, usePathname, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '../src/store/authStore';
import { useOfflineSyncStore } from '../src/store/offlineSyncStore';
import { View, StyleSheet, I18nManager, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AuthProvider } from '../src/contexts/AuthContext';
import { SideMenu } from '../src/components/SideMenu';
import GlobalSearch from '../src/components/GlobalSearch';
import { injectResponsiveStyles } from '../src/utils/responsiveStyles';

// Enable RTL for Arabic
I18nManager.allowRTL(true);
I18nManager.forceRTL(true);

// حقن CSS Media Queries للتصميم العصري (مرة واحدة على Web)
injectResponsiveStyles();

// Load Arabic font on web to fix rendering issues in some Chrome browsers
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  // تحميل خط Cairo - فقط الأوزان المستخدمة
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap';
  document.head.appendChild(link);

  // إضافة فافيكون المتصفح
  const favicon = document.createElement('link');
  favicon.rel = 'icon';
  favicon.type = 'image/png';
  favicon.href = '/favicon.png';
  document.head.appendChild(favicon);

  // تطبيق الخط مع الحفاظ على خطوط الأيقونات
  const style = document.createElement('style');
  style.textContent = `
    * {
      font-family: 'Cairo', 'Ionicons', 'Material Design Icons', 'MaterialCommunityIcons', 'FontAwesome', 'Segoe UI', Tahoma, Arial, sans-serif !important;
    }
    [role="button"][aria-label],
    div[aria-label] {
      position: relative;
    }
    [role="button"][aria-label]:hover::after,
    div[aria-label]:hover::after {
      content: attr(aria-label);
      position: absolute;
      bottom: calc(100% + 6px);
      left: 50%;
      transform: translateX(-50%);
      background: #333;
      color: #fff;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      white-space: nowrap;
      z-index: 9999;
      pointer-events: none;
      opacity: 0;
      animation: tooltipFadeIn 0.15s ease forwards;
      font-family: 'Cairo', sans-serif !important;
    }
    [role="button"][aria-label]:hover::before,
    div[aria-label]:hover::before {
      content: '';
      position: absolute;
      bottom: calc(100% + 2px);
      left: 50%;
      transform: translateX(-50%);
      border: 4px solid transparent;
      border-top-color: #333;
      z-index: 9999;
      pointer-events: none;
      opacity: 0;
      animation: tooltipFadeIn 0.15s ease forwards;
    }
    @keyframes tooltipFadeIn {
      to { opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}

export default function RootLayout() {
  const loadAuth = useAuthStore((state) => state.loadAuth);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { loadFromStorage, startNetworkMonitoring } = useOfflineSyncStore();
  const [menuVisible, setMenuVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    loadAuth();
    loadFromStorage();
    
    // بدء مراقبة حالة الاتصال
    const unsubscribe = startNetworkMonitoring();
    
    return () => {
      unsubscribe();
    };
  }, []);

  // النطاق الرئيسي ahgaff.net مخصص للتحقق فقط — أي صفحة أخرى تُحوَّل لبوابة التحقق
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const host = window.location.hostname;
    const VERIFY_PATHS = ['/verify-portal', '/verify-statement', '/verify-card', '/verify-certificate'];
    if ((host === 'ahgaff.net' || host === 'www.ahgaff.net') && !VERIFY_PATHS.includes(pathname)) {
      router.replace('/verify-portal');
    }
  }, [pathname]);

  // لا تظهر القائمة في صفحات تسجيل الدخول والتحميل
  const isLoginPage = pathname === '/login' || pathname === '/change-password';
  const showMenu = isAuthenticated && !isLoginPage;

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
          <Stack.Screen name="verify-statement" options={{ headerShown: false }} />
          <Stack.Screen name="verify-card" options={{ headerShown: false }} />
          <Stack.Screen name="verify-certificate" options={{ headerShown: false }} />
          <Stack.Screen name="verify-portal" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="take-attendance" options={{ title: 'تسجيل الحضور' }} />
          <Stack.Screen name="qr-scanner" options={{ title: 'مسح QR' }} />
          <Stack.Screen name="course-stats" options={{ title: 'إحصائيات المقرر' }} />
          <Stack.Screen name="student-details" options={{ title: 'تفاصيل الطالب' }} />
          <Stack.Screen name="student-card" options={{ title: 'بطاقة الطالب' }} />
          <Stack.Screen name="card-settings" options={{ title: 'تصميم البطاقة الرقمية' }} />
          <Stack.Screen name="photo-approvals" options={{ title: 'اعتماد صور الطلاب' }} />
          <Stack.Screen name="batch-print" options={{ title: 'طباعة البطاقات دفعة واحدة' }} />
          <Stack.Screen name="statement-settings" options={{ title: 'إعدادات كليشة الإفادة' }} />
          <Stack.Screen name="statements-log" options={{ title: 'سجل الإفادات الصادرة' }} />
          <Stack.Screen name="schedule" options={{ title: 'جدول المحاضرات' }} />
          <Stack.Screen name="students" options={{ title: 'الطلاب' }} />
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
          <Stack.Screen name="report-attendance-overview" options={{ title: 'تقرير الحضور' }} />
          <Stack.Screen name="report-student" options={{ title: 'تقرير الطالب' }} />
          <Stack.Screen name="report-warnings" options={{ title: 'الإنذارات' }} />
          <Stack.Screen name="report-daily" options={{ title: 'التقرير اليومي' }} />
          <Stack.Screen name="report-course" options={{ title: 'تقرير المقرر' }} />
          <Stack.Screen name="activity-logs" options={{ title: 'سجلات النشاط' }} />
          <Stack.Screen name="teaching-load" options={{ title: 'العبء التدريسي' }} />
          <Stack.Screen name="teaching-load-report" options={{ title: 'تقارير العبء التدريسي' }} />
          <Stack.Screen name="weekly-schedule" options={{ title: 'الجدول الأسبوعي' }} />
          <Stack.Screen name="course-students" options={{ title: 'طلاب المقرر' }} />
          <Stack.Screen name="manage-study-plan" options={{ title: 'إدارة الخطة الدراسية' }} />
          <Stack.Screen name="backfill-lecture-semesters" options={{ title: 'إصلاح فصول المحاضرات' }} />
          <Stack.Screen name="student-references" options={{ title: 'الأرقام المرجعية للطلاب' }} />
          <Stack.Screen name="student-autofill" options={{ title: 'ملء بيانات الطلاب' }} />
          <Stack.Screen name="notifications" options={{ title: 'الإشعارات' }} />
        </Stack>

        {/* الأزرار العائمة - تظهر في جميع الصفحات عند تسجيل الدخول */}
        {showMenu && (
          <View style={styles.floatingBtnsRow} pointerEvents="box-none">
            <TouchableOpacity
              onPress={() => setMenuVisible(true)}
              testID="floating-menu-btn"
              style={styles.floatingMenuBtn}
            >
              <Ionicons name="menu" size={20} color="#1565c0" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setSearchVisible(true)}
              testID="floating-search-btn"
              accessibilityLabel="بحث شامل"
              style={styles.floatingSearchBtn}
            >
              <Ionicons name="search" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        )}

        {/* القائمة الجانبية */}
        <SideMenu
          visible={menuVisible}
          onClose={() => setMenuVisible(false)}
        />

        {/* البحث الشامل */}
        <GlobalSearch
          visible={searchVisible}
          onClose={() => setSearchVisible(false)}
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
  floatingBtnsRow: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 8 : 50,
    right: 8,
    zIndex: 9999,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  floatingMenuBtn: {
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
  floatingSearchBtn: {
    backgroundColor: '#1565c0',
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
    borderColor: 'rgba(255,255,255,0.4)',
  },
});
