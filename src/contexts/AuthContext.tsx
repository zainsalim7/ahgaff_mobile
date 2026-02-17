import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authAPI } from '../services/api';

interface User {
  id: string;
  username: string;
  full_name: string;
  role: string;
  permissions: string[];
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAdmin: boolean;
  login: (token: string, user: User) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
  hasAllPermissions: (permissions: string[]) => boolean;
  refreshUser: () => Promise<void>;
  checkIsAdmin: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// قائمة الصلاحيات المتاحة
export const PERMISSIONS = {
  // صلاحيات الإدارة
  MANAGE_USERS: 'manage_users',
  MANAGE_DEPARTMENTS: 'manage_departments',
  MANAGE_COURSES: 'manage_courses',
  MANAGE_STUDENTS: 'manage_students',
  MANAGE_FACULTIES: 'manage_faculties',
  MANAGE_TEACHERS: 'manage_teachers',
  MANAGE_ENROLLMENTS: 'manage_enrollments',
  // صلاحيات الحضور
  RECORD_ATTENDANCE: 'record_attendance',
  TAKE_ATTENDANCE: 'take_attendance',
  VIEW_ATTENDANCE: 'view_attendance',
  EDIT_ATTENDANCE: 'edit_attendance',
  // صلاحيات التقارير
  VIEW_REPORTS: 'view_reports',
  VIEW_STATISTICS: 'view_statistics',
  EXPORT_REPORTS: 'export_reports',
  IMPORT_DATA: 'import_data',
  // صلاحيات المحاضرات
  MANAGE_LECTURES: 'manage_lectures',
  VIEW_LECTURES: 'view_lectures',
  VIEW_COURSES: 'view_courses',
} as const;

// متغير عام للتخزين المؤقت
let cachedUser: User | null = null;
let cachedToken: string | null = null;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // تحميل البيانات المخزنة عند بدء التطبيق
  useEffect(() => {
    loadStoredAuth();
  }, []);

  const loadStoredAuth = async () => {
    try {
      const storedToken = await AsyncStorage.getItem('token');
      const storedUser = await AsyncStorage.getItem('user');
      
      if (storedToken && storedUser) {
        const parsedUser = JSON.parse(storedUser);
        setToken(storedToken);
        setUser(parsedUser);
        // تحديث التخزين المؤقت
        cachedToken = storedToken;
        cachedUser = parsedUser;
      }
    } catch (error) {
      console.error('Error loading auth:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (newToken: string, newUser: User) => {
    try {
      await AsyncStorage.setItem('token', newToken);
      await AsyncStorage.setItem('user', JSON.stringify(newUser));
      setToken(newToken);
      setUser(newUser);
      // تحديث التخزين المؤقت
      cachedToken = newToken;
      cachedUser = newUser;
    } catch (error) {
      console.error('Error saving auth:', error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await AsyncStorage.removeItem('token');
      await AsyncStorage.removeItem('user');
      setToken(null);
      setUser(null);
      // مسح التخزين المؤقت
      cachedToken = null;
      cachedUser = null;
    } catch (error) {
      console.error('Error clearing auth:', error);
    }
  };

  const refreshUser = useCallback(async () => {
    if (!token && !cachedToken) return;
    try {
      const response = await authAPI.me();
      const updatedUser = response.data;
      setUser(updatedUser);
      cachedUser = updatedUser;
      await AsyncStorage.setItem('user', JSON.stringify(updatedUser));
    } catch (error) {
      console.error('Error refreshing user:', error);
    }
  }, [token]);

  // دالة للتحقق من كون المستخدم admin - تقرأ مباشرة من AsyncStorage إذا لزم
  const checkIsAdmin = useCallback(async (): Promise<boolean> => {
    // أولاً تحقق من المتغير المؤقت
    if (cachedUser) {
      return cachedUser.role === 'admin';
    }
    
    // ثم تحقق من state
    if (user) {
      return user.role === 'admin';
    }
    
    // أخيراً اقرأ من AsyncStorage مباشرة
    try {
      const storedUser = await AsyncStorage.getItem('user');
      if (storedUser) {
        const parsedUser = JSON.parse(storedUser);
        cachedUser = parsedUser;
        return parsedUser.role === 'admin';
      }
    } catch (error) {
      console.error('Error checking admin:', error);
    }
    
    return false;
  }, [user]);

  // التحقق من صلاحية واحدة
  const hasPermission = useCallback((permission: string): boolean => {
    // استخدم التخزين المؤقت أولاً
    const currentUser = cachedUser || user;
    
    // إذا لم يتم تحميل المستخدم بعد وما زال التحميل جاري
    if (!currentUser && isLoading) {
      return true; // نفترض أن لديه الصلاحية أثناء التحميل
    }
    
    if (!currentUser) {
      return false;
    }
    
    // المدير لديه جميع الصلاحيات تلقائياً
    if (currentUser.role === 'admin') return true;
    
    // تحقق من الصلاحيات المخزنة
    return currentUser.permissions?.includes(permission) || false;
  }, [user, isLoading]);

  // التحقق من وجود أي صلاحية من القائمة
  const hasAnyPermission = useCallback((permissions: string[]): boolean => {
    const currentUser = cachedUser || user;
    
    if (!currentUser && isLoading) return true;
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    
    return permissions.some(p => currentUser.permissions?.includes(p));
  }, [user, isLoading]);

  // التحقق من وجود جميع الصلاحيات في القائمة
  const hasAllPermissions = useCallback((permissions: string[]): boolean => {
    const currentUser = cachedUser || user;
    
    if (!currentUser && isLoading) return true;
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    
    return permissions.every(p => currentUser.permissions?.includes(p));
  }, [user, isLoading]);

  // استخدم التخزين المؤقت للتحقق من admin
  const isAdmin = (cachedUser || user)?.role === 'admin';

  return (
    <AuthContext.Provider
      value={{
        user: cachedUser || user,
        token: cachedToken || token,
        isLoading,
        isAdmin,
        login,
        logout,
        hasPermission,
        hasAnyPermission,
        hasAllPermissions,
        refreshUser,
        checkIsAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// مكون لإخفاء المحتوى إذا لم يكن للمستخدم الصلاحية
interface PermissionGateProps {
  permission?: string;
  permissions?: string[];
  requireAll?: boolean;
  children: ReactNode;
  fallback?: ReactNode;
}

export function PermissionGate({ 
  permission, 
  permissions, 
  requireAll = false, 
  children, 
  fallback = null 
}: PermissionGateProps) {
  const { hasPermission, hasAnyPermission, hasAllPermissions } = useAuth();

  let hasAccess = false;

  if (permission) {
    hasAccess = hasPermission(permission);
  } else if (permissions) {
    hasAccess = requireAll ? hasAllPermissions(permissions) : hasAnyPermission(permissions);
  }

  return hasAccess ? <>{children}</> : <>{fallback}</>;
}
