import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Platform,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { useAuth, PERMISSIONS } from '../contexts/AuthContext';
import { getRoleLabel } from '../utils/roleLabels';

interface MenuItem {
  id: string;
  label: string;
  icon: string;
  path: string;
  permissions: string[]; // أي صلاحية من هذه تكفي لإظهار العنصر
  adminOnly?: boolean;
  forAll?: boolean;
}

// قائمة العناصر مرتبطة بالصلاحيات
// 🔑 مبدأ ذهبي: كل عنصر مربوط فقط بصلاحياته الخاصة (الأم + الفرعية المباشرة)، بدون خلط مع صلاحيات لا تنتمي إليه
const MENU_ITEMS: MenuItem[] = [
  { id: 'home', label: 'الرئيسية', icon: 'home', path: '/(tabs)', permissions: [], forAll: true },
  
  { id: 'admin', label: 'الإعدادات الأساسية', icon: 'settings', path: '/(tabs)/admin', permissions: [
    PERMISSIONS.MANAGE_USERS, PERMISSIONS.MANAGE_DEPARTMENTS, PERMISSIONS.MANAGE_COURSES,
    PERMISSIONS.MANAGE_STUDENTS, PERMISSIONS.MANAGE_TEACHERS,
    PERMISSIONS.MANAGE_CURRICULUM, PERMISSIONS.MANAGE_SETTINGS, PERMISSIONS.MANAGE_ROLES,
    PERMISSIONS.SEND_NOTIFICATIONS, PERMISSIONS.MANAGE_NOTIFICATIONS,
    PERMISSIONS.MANAGE_ATTENDANCE, PERMISSIONS.MANAGE_SCHEDULE,
    PERMISSIONS.VIEW_REPORTS, PERMISSIONS.REPORT_COURSE, PERMISSIONS.REPORT_ABSENT_STUDENTS,
    PERMISSIONS.REPORT_DAILY, PERMISSIONS.REPORT_LESSON_COMPLETION
  ]},
  
  { id: 'my-lectures', label: 'محاضراتي', icon: 'calendar', path: '/(tabs)/my-lectures', permissions: [], teacherOnly: true },

  // 📋 إدارة الحضور — صفحة مستقلة للموظف الإداري لتسجيل/تعديل حضور الطلاب في المحاضرات
  { id: 'manage-attendance', label: 'إدارة الحضور', icon: 'checkbox', path: '/manage-attendance', permissions: [
    PERMISSIONS.MANAGE_ATTENDANCE, 'record_attendance', 'take_attendance', 'edit_attendance', 'view_attendance'
  ]},
  
  // 📚 المقررات — صلاحيات المقررات فقط
  { id: 'courses', label: 'المقررات', icon: 'book', path: '/(tabs)/courses', permissions: [
    PERMISSIONS.MANAGE_COURSES, 'view_courses', 'add_course', 'edit_course', 'delete_course'
  ]},

  // 🔄 ترحيل المقررات لفصل جديد — صلاحية مستقلة (الأدمن دائماً)
  { id: 'migrate-courses', label: 'ترحيل المقررات', icon: 'swap-horizontal', path: '/migrate-courses', permissions: [
    'migrate_courses'
  ]},

  // 📖 الخطة الدراسية — صلاحية الخطة الدراسية (إدارة أو عرض)
  { id: 'curriculum', label: 'الخطة الدراسية', icon: 'library', path: '/curriculum', permissions: [
    PERMISSIONS.MANAGE_CURRICULUM,
    PERMISSIONS.VIEW_CURRICULUM
  ]},

  // 📅 الجدول الدراسي اليومي — صلاحيات الجداول فقط (لا علاقة بالمقررات!)
  { id: 'schedule', label: 'الجدول الدراسي', icon: 'calendar-outline', path: '/schedule', permissions: [
    'view_schedule', 'manage_schedule'
  ]},

  // 📆 الجدول الأسبوعي — صلاحيات الجداول فقط
  { id: 'weekly-schedule', label: 'الجدول الأسبوعي', icon: 'calendar', path: '/weekly-schedule', permissions: [
    'view_schedule', 'manage_schedule'
  ]},

  // 👨‍🎓 إدارة الطلاب
  { id: 'students', label: 'إدارة الطلاب', icon: 'people', path: '/students', permissions: [
    PERMISSIONS.MANAGE_STUDENTS, 'view_students', 'add_student', 'edit_student', 'delete_student'
  ]},

  // 🎓 الخريجون
  { id: 'alumni', label: 'الخريجون', icon: 'school', path: '/alumni', permissions: [
    PERMISSIONS.MANAGE_STUDENTS, 'view_students'
  ]},

  // 📋 إدارة التسجيلات — صفحة مستقلة لتسجيل الطلاب في المقررات
  { id: 'enrollments', label: 'إدارة التسجيلات', icon: 'clipboard', path: '/manage-enrollments', permissions: [
    PERMISSIONS.MANAGE_ENROLLMENTS, 'view_enrollments', 'add_enrollment', 'delete_enrollment'
  ]},

  // 👨‍🏫 إدارة المعلمين
  { id: 'teachers', label: 'إدارة المعلمين', icon: 'school', path: '/manage-teachers', permissions: [
    PERMISSIONS.MANAGE_TEACHERS, 'view_teachers', 'add_teacher', 'edit_teacher', 'delete_teacher'
  ]},

  // 📊 العبء التدريسي
  { id: 'teaching-load', label: 'جدول العبء التدريسي', icon: 'grid', path: '/teaching-load', permissions: [
    PERMISSIONS.MANAGE_TEACHING_LOAD, PERMISSIONS.VIEW_TEACHING_LOAD
  ]},
  { id: 'teaching-load-report', label: 'تقارير العبء', icon: 'analytics', path: '/teaching-load-report', permissions: [
    PERMISSIONS.MANAGE_TEACHING_LOAD, PERMISSIONS.VIEW_TEACHING_LOAD
  ]},

  // 🏢 إدارة الأقسام
  { id: 'departments', label: 'إدارة الأقسام', icon: 'business', path: '/add-department', permissions: [
    PERMISSIONS.MANAGE_DEPARTMENTS, 'view_departments', 'add_department', 'edit_department', 'delete_department'
  ]},

  // 👤 إدارة المستخدمين
  { id: 'users', label: 'إدارة المستخدمين', icon: 'person-add', path: '/manage-users', permissions: [
    PERMISSIONS.MANAGE_USERS, 'view_users', 'add_user', 'edit_user', 'delete_user'
  ]},
  
  { id: 'reports-divider', label: 'التقارير', icon: 'stats-chart', path: '', permissions: [
    PERMISSIONS.VIEW_REPORTS, PERMISSIONS.EXPORT_REPORTS, PERMISSIONS.REPORT_STUDENT,
    PERMISSIONS.REPORT_ATTENDANCE_OVERVIEW, PERMISSIONS.REPORT_WARNINGS, PERMISSIONS.REPORT_COURSE,
    PERMISSIONS.REPORT_TEACHER_WORKLOAD
  ]},
  { id: 'reports', label: 'جميع التقارير', icon: 'document-text', path: '/reports', permissions: [
    PERMISSIONS.VIEW_REPORTS, PERMISSIONS.EXPORT_REPORTS
  ]},
  { id: 'report-attendance', label: 'تقرير الحضور', icon: 'checkmark-circle', path: '/report-attendance-overview', permissions: [
    PERMISSIONS.REPORT_ATTENDANCE_OVERVIEW
  ]},
  { id: 'report-student', label: 'تقرير الطالب', icon: 'person', path: '/report-student', permissions: [
    PERMISSIONS.REPORT_STUDENT
  ]},
  { id: 'report-workload', label: 'نصاب التدريس', icon: 'briefcase', path: '/report-teacher-workload', permissions: [
    PERMISSIONS.REPORT_TEACHER_WORKLOAD
  ]},
  { id: 'report-warnings', label: 'الإنذارات', icon: 'warning', path: '/report-warnings', permissions: [
    PERMISSIONS.REPORT_WARNINGS
  ]},
  { id: 'report-teacher-delays', label: 'تأخر المعلمين', icon: 'alarm', path: '/report-teacher-delays', permissions: [
    PERMISSIONS.REPORT_TEACHER_DELAYS, PERMISSIONS.VIEW_REPORTS
  ]},
  
  { id: 'notifications', label: 'إدارة الإشعارات', icon: 'notifications', path: '/manage-notifications', permissions: [
    PERMISSIONS.SEND_NOTIFICATIONS, 'manage_notifications'
  ]},
  { id: 'settings-divider', label: 'الإعدادات', icon: 'settings', path: '', permissions: [PERMISSIONS.MANAGE_SETTINGS] },
  { id: 'general-settings', label: 'الإعدادات العامة', icon: 'options', path: '/general-settings', permissions: [], adminOnly: true },
  { id: 'roles', label: 'الأدوار والصلاحيات', icon: 'key', path: '/manage-roles', permissions: [PERMISSIONS.MANAGE_ROLES] },
  { id: 'activity-logs', label: 'سجلات النشاط', icon: 'list', path: '/activity-logs', permissions: [], adminOnly: true },
  // الأرشيف الدراسي
  { id: 'archives-divider', label: 'الأرشيف الدراسي', icon: 'archive', path: '', permissions: [PERMISSIONS.VIEW_ARCHIVE] },
  { id: 'archives', label: 'الفصول المؤرشفة', icon: 'archive', path: '/archives', permissions: [PERMISSIONS.VIEW_ARCHIVE] },
  { id: 'archive-search', label: 'البحث في الأرشيف', icon: 'search', path: '/archive-search', permissions: [PERMISSIONS.SEARCH_ARCHIVE] },
  { id: 'trash', label: 'سلة المحذوفات', icon: 'trash', path: '/trash', permissions: [], adminOnly: true },
];

interface SideMenuProps {
  visible: boolean;
  onClose: () => void;
}

export const SideMenu: React.FC<SideMenuProps> = ({ visible, onClose }) => {
  const user = useAuthStore((state) => state.user);
  const userRole = user?.role || 'student';
  const { hasAnyPermission } = useAuth();
  const isAdmin = userRole === 'admin';

  // فلترة العناصر حسب صلاحيات المستخدم الفردية
  const filteredItems = MENU_ITEMS.filter(item => {
    if (item.forAll) return true;
    if (item.adminOnly) return isAdmin;
    // العناصر الخاصة بالمعلم فقط
    if ((item as any).teacherOnly && userRole !== 'teacher') return false;
    if (isAdmin) return true;
    if (item.permissions.length === 0) return false;
    return hasAnyPermission(item.permissions);
  });

  const handleNavigate = (path: string) => {
    if (path) {
      onClose();
      router.push(path);
    }
  };

  const handleGoBack = () => {
    onClose();
    if (Platform.OS === 'web') {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        router.replace('/');
      }
    } else {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/');
      }
    }
  };

  const handleGoHome = () => {
    onClose();
    router.replace('/');
  };

  const handleLogout = () => {
    onClose();
    router.replace('/login');
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.overlayTouch} onPress={onClose} />
        
        <View style={styles.menuContainer}>
          {/* Header */}
          <View style={styles.menuHeader}>
            <View style={styles.userInfo}>
              <View style={styles.avatar}>
                <Ionicons name="person" size={24} color="#fff" />
              </View>
              <View>
                <Text style={styles.userName}>{user?.full_name || 'مستخدم'}</Text>
                <Text style={styles.userRole}>
                  {getRoleLabel(userRole)}
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>

          {/* Quick Actions */}
          <View style={styles.quickActions}>
            <TouchableOpacity style={styles.quickBtn} onPress={handleGoBack}>
              <Ionicons name="arrow-forward" size={20} color="#1565c0" />
              <Text style={styles.quickBtnText}>رجوع</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickBtn} onPress={handleGoHome}>
              <Ionicons name="home" size={20} color="#1565c0" />
              <Text style={styles.quickBtnText}>الرئيسية</Text>
            </TouchableOpacity>
          </View>

          {/* Menu Items */}
          <ScrollView style={styles.menuList}>
            {filteredItems.map((item) => {
              if (item.id.includes('divider')) {
                return (
                  <View key={item.id} style={styles.divider}>
                    <Text style={styles.dividerText}>{item.label}</Text>
                  </View>
                );
              }

              return (
                <TouchableOpacity
                  key={item.id}
                  style={styles.menuItem}
                  onPress={() => handleNavigate(item.path)}
                >
                  <Ionicons name={item.icon as any} size={22} color="#333" />
                  <Text style={styles.menuItemText}>{item.label}</Text>
                  <Ionicons name="chevron-back" size={18} color="#999" />
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Footer */}
          <View style={styles.menuFooter}>
            {/* 📘 رابط الدليل قبل تسجيل الخروج */}
            <TouchableOpacity
              style={styles.helpBtn}
              onPress={() => handleNavigate('/help')}
              testID="side-menu-help-btn"
            >
              <Ionicons name="help-circle" size={20} color="#2962ff" />
              <Text style={styles.helpText}>دليل استخدام المنصة</Text>
              <Ionicons name="chevron-back" size={16} color="#2962ff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
              <Ionicons name="log-out" size={20} color="#f44336" />
              <Text style={styles.logoutText}>تسجيل الخروج</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

// زر فتح القائمة
interface MenuButtonProps {
  style?: any;
}

export const MenuButton: React.FC<MenuButtonProps> = ({ style }) => {
  const [menuVisible, setMenuVisible] = useState(false);

  return (
    <>
      <TouchableOpacity 
        style={[styles.menuButton, style]} 
        onPress={() => setMenuVisible(true)}
      >
        <Ionicons name="menu" size={28} color="#fff" />
      </TouchableOpacity>
      
      <SideMenu 
        visible={menuVisible} 
        onClose={() => setMenuVisible(false)} 
      />
    </>
  );
};

// شريط التنقل السفلي
export const BottomNavBar: React.FC = () => {
  const user = useAuthStore((state) => state.user);
  const [menuVisible, setMenuVisible] = useState(false);

  const handleGoBack = () => {
    if (Platform.OS === 'web') {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        router.replace('/');
      }
    } else {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/');
      }
    }
  };

  return (
    <>
      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navItem} onPress={handleGoBack}>
          <Ionicons name="arrow-forward" size={24} color="#666" />
          <Text style={styles.navItemText}>رجوع</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.navItem} onPress={() => router.push('/')}>
          <Ionicons name="home" size={24} color="#1565c0" />
          <Text style={[styles.navItemText, { color: '#1565c0' }]}>الرئيسية</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.navItem} onPress={() => router.push('/schedule')}>
          <Ionicons name="calendar" size={24} color="#666" />
          <Text style={styles.navItemText}>الجدول</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.navItem} onPress={() => setMenuVisible(true)}>
          <Ionicons name="menu" size={24} color="#666" />
          <Text style={styles.navItemText}>القائمة</Text>
        </TouchableOpacity>
      </View>
      
      <SideMenu 
        visible={menuVisible} 
        onClose={() => setMenuVisible(false)} 
      />
    </>
  );
};

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  overlayTouch: {
    flex: 1,
  },
  menuContainer: {
    width: Math.min(300, width * 0.85),
    backgroundColor: '#fff',
    height: '100%',
  },
  menuHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
    backgroundColor: '#1565c0',
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  userName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  userRole: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
  },
  closeBtn: {
    padding: 8,
    backgroundColor: '#fff',
    borderRadius: 20,
  },
  quickActions: {
    flexDirection: 'row',
    padding: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  quickBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: '#e3f2fd',
    borderRadius: 8,
  },
  quickBtnText: {
    color: '#1565c0',
    fontSize: 14,
    fontWeight: '600',
  },
  menuList: {
    flex: 1,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    gap: 12,
  },
  menuItemText: {
    flex: 1,
    fontSize: 15,
    color: '#333',
  },
  divider: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: '#f5f5f5',
  },
  dividerText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#666',
  },
  menuFooter: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    backgroundColor: '#ffebee',
    borderRadius: 8,
  },
  helpBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 12,
    backgroundColor: '#e3f2fd',
    borderRadius: 8,
    marginBottom: 8,
  },
  helpText: {
    flex: 1,
    color: '#1565c0',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'right',
  },
  logoutText: {
    color: '#f44336',
    fontSize: 15,
    fontWeight: '600',
  },
  menuButton: {
    padding: 8,
  },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingVertical: 8,
    paddingBottom: Platform.OS === 'ios' ? 24 : 8,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  navItemText: {
    fontSize: 11,
    color: '#666',
  },
});

export default SideMenu;
