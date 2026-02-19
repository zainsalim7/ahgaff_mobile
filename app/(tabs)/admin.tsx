import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usersAPI, studentsAPI, departmentsAPI, coursesAPI } from '../../src/services/api';
import { LoadingScreen } from '../../src/components/LoadingScreen';

// دالة للتحقق من الصلاحيات
const checkPermission = (userRole: string, userPermissions: string[], requiredPermission: string): boolean => {
  if (userRole === 'admin') return true;
  return userPermissions?.includes(requiredPermission) || false;
};

export default function AdminScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userRole, setUserRole] = useState<string>('');
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [counts, setCounts] = useState({
    teachers: 0,
    students: 0,
    departments: 0,
    courses: 0,
  });

  const loadUserData = useCallback(async () => {
    try {
      const storedUser = await AsyncStorage.getItem('user');
      if (storedUser) {
        const user = JSON.parse(storedUser);
        setUserRole(user.role || '');
        setUserPermissions(user.permissions || []);
        console.log('Admin: Loaded user role:', user.role, 'permissions:', user.permissions?.length);
      } else {
        console.log('Admin: No stored user found');
      }
    } catch (error) {
      console.error('Error loading user data:', error);
    }
  }, []);

  const fetchCounts = useCallback(async () => {
    try {
      const [teachers, students, departments, courses] = await Promise.all([
        usersAPI.getAll('teacher'),
        studentsAPI.getAll(),
        departmentsAPI.getAll(),
        coursesAPI.getAll(),
      ]);

      setCounts({
        teachers: teachers.data?.length || 0,
        students: students.data?.length || 0,
        departments: departments.data?.length || 0,
        courses: courses.data?.length || 0,
      });
    } catch (error) {
      console.error('Error fetching counts:', error);
      // Set default values on error
      setCounts({
        teachers: 0,
        students: 0,
        departments: 0,
        courses: 0,
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadUserData();
    fetchCounts();
  }, [loadUserData, fetchCounts]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchCounts();
  };

  if (loading) {
    return <LoadingScreen />;
  }

  // تعريف عناصر القائمة مع الصلاحيات المطلوبة
  const allMenuItems = [
    {
      title: 'إدارة الكليات',
      icon: 'school',
      color: '#673ab7',
      bg: '#ede7f6',
      count: counts.faculties || 0,
      route: '/general-settings',
      permission: 'manage_faculties',
      description: 'إدارة الكليات وإعداداتها',
    },
    {
      title: 'إدارة الأقسام',
      icon: 'business',
      color: '#e91e63',
      bg: '#fce4ec',
      count: counts.departments,
      route: '/add-department',
      permission: 'manage_departments',
    },
    {
      title: 'الإعدادات العامة',
      icon: 'settings',
      color: '#1565c0',
      bg: '#e3f2fd',
      count: 0,
      route: '/general-settings',
      permission: null,
      adminOnly: true,
      description: 'الجامعة، الفصول، الإعدادات',
    },
    {
      title: 'إدارة المعلمين',
      icon: 'person',
      color: '#4caf50',
      bg: '#e8f5e9',
      count: counts.teachers,
      route: '/manage-teachers',
      permission: 'manage_users',
    },
    {
      title: 'إدارة الطلاب',
      icon: 'people',
      color: '#1565c0',
      bg: '#e3f2fd',
      count: counts.students,
      route: '/add-student',
      permission: 'manage_students',
    },
    {
      title: 'إدارة المقررات',
      icon: 'book',
      color: '#ff9800',
      bg: '#fff3e0',
      count: counts.courses,
      route: '/add-course',
      permission: 'manage_courses',
    },
    {
      title: 'جدول المحاضرات',
      icon: 'calendar',
      color: '#9c27b0',
      bg: '#f3e5f5',
      count: 0,
      route: '/schedule',
      permission: 'manage_lectures',
    },
    {
      title: 'التقارير والتصدير',
      icon: 'document-text',
      color: '#00bcd4',
      bg: '#e0f7fa',
      count: 0,
      route: '/reports',
      permission: 'view_reports',
    },
    {
      title: 'إدارة المستخدمين والصلاحيات',
      icon: 'people-circle',
      color: '#673ab7',
      bg: '#ede7f6',
      count: 0,
      route: '/manage-users',
      permission: 'manage_users',
      adminOnly: true,
    },
    {
      title: 'إدارة الأدوار',
      icon: 'shield-checkmark',
      color: '#ff5722',
      bg: '#fbe9e7',
      count: 0,
      route: '/manage-roles',
      permission: 'manage_roles',
      adminOnly: true,
    },
    {
      title: 'سجلات النشاط',
      icon: 'list',
      color: '#3f51b5',
      bg: '#e8eaf6',
      count: 0,
      route: '/activity-logs',
      permission: null,
      adminOnly: true,
    },
    {
      title: 'إدارة الأوفلاين',
      icon: 'cloud-offline',
      color: '#009688',
      bg: '#e0f2f1',
      count: 0,
      route: '/offline-sync',
      permission: null,
      teacherOnly: true,
    },
  ];

  // تصفية العناصر حسب صلاحيات المستخدم
  const menuItems = allMenuItems.filter(item => {
    // المدير يرى كل شيء
    if (userRole === 'admin') return true;
    
    // للمعلم فقط
    if (item.teacherOnly) {
      return userRole === 'teacher' || userPermissions?.includes('record_attendance');
    }
    
    // العناصر التي تتطلب صلاحيات محددة
    if (item.permission) {
      return checkPermission(userRole, userPermissions, item.permission);
    }
    
    // العناصر الخاصة بالمدير فقط (adminOnly)
    if (item.adminOnly) {
      // الإعدادات العامة - فقط للمدير أو من لديه صلاحيات شاملة
      if (item.route === '/general-settings') {
        // يجب أن يكون لديه صلاحيات متعددة ليصل للإعدادات العامة
        const hasMultiplePermissions = userPermissions?.filter(p => 
          ['manage_users', 'manage_faculties', 'manage_departments', 'manage_courses', 'manage_roles'].includes(p)
        ).length >= 3;
        return hasMultiplePermissions;
      }
      // سجلات النشاط - للمدير فقط
      if (item.route === '/activity-logs') {
        return false; // فقط للمدير
      }
      // إدارة الأدوار - يتطلب صلاحية manage_roles
      if (item.route === '/manage-roles') {
        return userPermissions?.includes('manage_roles');
      }
      // باقي العناصر adminOnly - للمدير فقط
      return false;
    }
    
    return false;
  });

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <Text style={styles.sectionTitle}>إدارة النظام</Text>
        
        {menuItems.map((item, index) => (
          <TouchableOpacity
            key={index}
            style={styles.menuCard}
            onPress={() => router.push(item.route as any)}
          >
            <View style={[styles.iconContainer, { backgroundColor: item.bg }]}>
              <Ionicons name={item.icon as any} size={28} color={item.color} />
            </View>
            <View style={styles.menuInfo}>
              <Text style={styles.menuTitle}>{item.title}</Text>
              <Text style={styles.menuCount}>{item.count} مسجل</Text>
            </View>
            <Ionicons name="chevron-forward" size={24} color="#999" />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 16,
  },
  menuCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuInfo: {
    flex: 1,
    marginHorizontal: 16,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  menuCount: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
});
