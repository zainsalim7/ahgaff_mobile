import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  Pressable,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';

interface QuickNavItem {
  title: string;
  icon: string;
  route: string;
  color: string;
  adminOnly?: boolean;
  teacherOnly?: boolean;
}

const NAV_ITEMS: QuickNavItem[] = [
  // الصفحات الرئيسية
  { title: 'الرئيسية', icon: 'home', route: '/', color: '#1565c0' },
  { title: 'الإدارة', icon: 'settings', route: '/admin', color: '#1565c0', adminOnly: true },
  { title: 'المقررات', icon: 'book', route: '/courses', color: '#ff9800' },
  { title: 'حسابي', icon: 'person', route: '/profile', color: '#4caf50' },
  
  // إدارة النظام
  { title: 'الإعدادات العامة', icon: 'cog', route: '/general-settings', color: '#607d8b', adminOnly: true },
  { title: 'إدارة المستخدمين', icon: 'people', route: '/manage-users', color: '#9c27b0', adminOnly: true },
  { title: 'إدارة الأدوار', icon: 'shield', route: '/manage-roles', color: '#673ab7', adminOnly: true },
  
  // إدارة الأكاديمية
  { title: 'إدارة الأقسام', icon: 'business', route: '/add-department', color: '#e91e63', adminOnly: true },
  { title: 'إدارة المقررات', icon: 'library', route: '/add-course', color: '#ff9800', adminOnly: true },
  { title: 'إدارة الطلاب', icon: 'school', route: '/add-student', color: '#2196f3', adminOnly: true },
  { title: 'إدارة المعلمين', icon: 'person-add', route: '/add-teacher', color: '#009688', adminOnly: true },
  
  // الحضور
  { title: 'تسجيل الحضور', icon: 'checkbox', route: '/take-attendance', color: '#4caf50', teacherOnly: true },
  { title: 'جدول المحاضرات', icon: 'calendar', route: '/schedule', color: '#00bcd4' },
  
  // التقارير
  { title: 'التقارير', icon: 'stats-chart', route: '/reports', color: '#ff5722', adminOnly: true },
  { title: 'تقرير الحضور الشامل', icon: 'pie-chart', route: '/report-attendance-overview', color: '#795548' },
  { title: 'تقرير الإنذارات', icon: 'warning', route: '/report-warnings', color: '#f44336' },
  
  // الأوفلاين
  { title: 'إدارة الأوفلاين', icon: 'cloud-offline', route: '/offline-sync', color: '#009688', teacherOnly: true },
];

interface QuickNavProps {
  currentRoute?: string;
}

export function QuickNav({ currentRoute }: QuickNavProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const router = useRouter();
  const { user, isAdmin } = useAuth();
  const userRole = user?.role;

  const handleNavigate = (route: string) => {
    setModalVisible(false);
    router.push(route as any);
  };

  const filteredItems = NAV_ITEMS.filter(item => {
    if (item.adminOnly && userRole !== 'admin') return false;
    if (item.teacherOnly && userRole !== 'teacher' && userRole !== 'admin') return false;
    if (item.route === currentRoute) return false;
    return true;
  });

  // تجميع العناصر حسب الفئة
  const mainItems = filteredItems.slice(0, 4);
  const adminItems = filteredItems.filter(i => i.adminOnly).slice(0, 6);
  const otherItems = filteredItems.filter(i => !i.adminOnly && !mainItems.includes(i));

  return (
    <>
      {/* زر فتح القائمة */}
      <Pressable
        style={styles.floatingBtn}
        onPress={() => setModalVisible(true)}
      >
        <Ionicons name="grid" size={24} color="#fff" />
      </Pressable>

      {/* Modal التنقل */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <Pressable 
          style={styles.modalOverlay}
          onPress={() => setModalVisible(false)}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>التنقل السريع</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.navList}>
              {/* الصفحات الرئيسية */}
              <Text style={styles.sectionTitle}>الصفحات الرئيسية</Text>
              <View style={styles.navGrid}>
                {mainItems.map((item) => (
                  <TouchableOpacity
                    key={item.route}
                    style={styles.navItem}
                    onPress={() => handleNavigate(item.route)}
                  >
                    <View style={[styles.navIcon, { backgroundColor: item.color + '20' }]}>
                      <Ionicons name={item.icon as any} size={24} color={item.color} />
                    </View>
                    <Text style={styles.navText}>{item.title}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* إدارة النظام - للمدير فقط */}
              {userRole === 'admin' && adminItems.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>إدارة النظام</Text>
                  <View style={styles.navGrid}>
                    {adminItems.map((item) => (
                      <TouchableOpacity
                        key={item.route}
                        style={styles.navItem}
                        onPress={() => handleNavigate(item.route)}
                      >
                        <View style={[styles.navIcon, { backgroundColor: item.color + '20' }]}>
                          <Ionicons name={item.icon as any} size={24} color={item.color} />
                        </View>
                        <Text style={styles.navText}>{item.title}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              {/* صفحات أخرى */}
              {otherItems.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>صفحات أخرى</Text>
                  <View style={styles.navGrid}>
                    {otherItems.map((item) => (
                      <TouchableOpacity
                        key={item.route}
                        style={styles.navItem}
                        onPress={() => handleNavigate(item.route)}
                      >
                        <View style={[styles.navIcon, { backgroundColor: item.color + '20' }]}>
                          <Ionicons name={item.icon as any} size={24} color={item.color} />
                        </View>
                        <Text style={styles.navText}>{item.title}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

// مكون زر العودة المحسن
interface BackButtonProps {
  onBack?: () => void;
  title?: string;
  showHome?: boolean;
}

export function BackButton({ onBack, title, showHome = true }: BackButtonProps) {
  const router = useRouter();

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      router.back();
    }
  };

  const handleHome = () => {
    router.replace('/');
  };

  return (
    <View style={styles.backContainer}>
      <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
        <Ionicons name="arrow-forward" size={24} color="#1565c0" />
        {title && <Text style={styles.backTitle}>{title}</Text>}
      </TouchableOpacity>
      
      {showHome && (
        <TouchableOpacity onPress={handleHome} style={styles.homeBtn}>
          <Ionicons name="home" size={20} color="#666" />
        </TouchableOpacity>
      )}
    </View>
  );
}

// مكون Header مع تنقل
interface NavigationHeaderProps {
  title: string;
  showBack?: boolean;
  showQuickNav?: boolean;
  rightComponent?: React.ReactNode;
}

export function NavigationHeader({ 
  title, 
  showBack = true, 
  showQuickNav = true,
  rightComponent 
}: NavigationHeaderProps) {
  const router = useRouter();

  return (
    <View style={styles.header}>
      {showBack ? (
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-forward" size={24} color="#333" />
        </TouchableOpacity>
      ) : (
        <View style={styles.headerBtn} />
      )}
      
      <Text style={styles.headerTitle}>{title}</Text>
      
      {rightComponent || (
        showQuickNav ? (
          <TouchableOpacity onPress={() => router.push('/')} style={styles.headerBtn}>
            <Ionicons name="home-outline" size={24} color="#333" />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerBtn} />
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // زر التنقل العائم
  floatingBtn: {
    position: 'absolute',
    bottom: 90,
    left: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1565c0',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 9999,
  },
  
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  
  // Navigation List
  navList: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginTop: 16,
    marginBottom: 12,
  },
  navGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  navItem: {
    width: '30%',
    alignItems: 'center',
    paddingVertical: 12,
  },
  navIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  navText: {
    fontSize: 12,
    color: '#333',
    textAlign: 'center',
  },
  
  // Back Button
  backContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    gap: 8,
  },
  backTitle: {
    fontSize: 16,
    color: '#1565c0',
    fontWeight: '500',
  },
  homeBtn: {
    padding: 8,
  },
  
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
  },
});
