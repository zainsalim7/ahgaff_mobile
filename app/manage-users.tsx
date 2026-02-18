import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  RefreshControl,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import { usersAPI, permissionsAPI, departmentsAPI, coursesAPI, rolesAPI, facultiesAPI } from '../src/services/api';
import { LoadingScreen } from '../src/components/LoadingScreen';
import { useAuth } from '../src/contexts/AuthContext';

interface User {
  id: string;
  username: string;
  full_name: string;
  role: string;
  role_id?: string;
  email?: string;
  phone?: string;
  is_active: boolean;
  created_at: string;
  university_id?: string;
  faculty_id?: string;
  department_id?: string;
  faculty_name?: string;
  department_name?: string;
}

interface Permission {
  key: string;
  label: string;
  category: string;
}

interface ScopeType {
  key: string;
  label: string;
}

interface Role {
  id: string;
  name: string;
  permissions: string[];
  is_system: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'مدير النظام',
  university_president: 'رئيس الجامعة',
  dean: 'عميد كلية',
  department_head: 'رئيس قسم',
  registration_manager: 'مدير التسجيل',
  registrar: 'موظف تسجيل',
  teacher: 'مدرس',
  employee: 'موظف',
  student: 'طالب',
};

const ROLE_COLORS: Record<string, string> = {
  admin: '#9c27b0',
  university_president: '#1a237e',
  dean: '#0d47a1',
  department_head: '#1565c0',
  registration_manager: '#00838f',
  registrar: '#00695c',
  teacher: '#2e7d32',
  employee: '#ff9800',
  student: '#4caf50',
};

export default function ManageUsersScreen() {
  const router = useRouter();
  const { hasPermission, isLoading: authLoading, user, isAdmin } = useAuth();
  
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [scopeTypes, setScopeTypes] = useState<ScopeType[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [faculties, setFaculties] = useState<any[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRole, setSelectedRole] = useState<string>('all');
  
  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [saving, setSaving] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  
  // Form states
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    full_name: '',
    role_id: '',  // معرف الدور الجديد
    email: '',
    phone: '',
    scope_type: '',  // نوع النطاق (department أو course)
    scope_id: '',    // معرف القسم أو المقرر
    faculty_id: '',  // معرف الكلية
    department_id: '', // معرف القسم
  });
  
  // Permission form
  const [userPermissions, setUserPermissions] = useState<any[]>([]);
  const [newPermScope, setNewPermScope] = useState({
    scope_type: 'global',
    scope_id: '',
    permissions: [] as string[],
  });

  const fetchData = useCallback(async () => {
    try {
      const [usersRes, permsRes, deptsRes, coursesRes, rolesRes, facultiesRes] = await Promise.all([
        usersAPI.getAll(),
        permissionsAPI.getAvailable(),
        departmentsAPI.getAll(),
        coursesAPI.getAll(),
        rolesAPI.getAll(),
        facultiesAPI.getAll(),
      ]);
      
      setUsers(usersRes.data);
      setFilteredUsers(usersRes.data);
      setPermissions(permsRes.data.permissions || []);
      setScopeTypes(permsRes.data.scope_types || []);
      setRoles(rolesRes.data || []);
      console.log('Roles loaded:', rolesRes.data?.length, 'roles');
      console.log('Roles data:', JSON.stringify(rolesRes.data?.slice(0, 3)));
      setDepartments(deptsRes.data);
      setCourses(coursesRes.data);
      setFaculties(facultiesRes.data || []);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    // استبعاد الطلاب والمعلمين بالكامل - لأن لهم أقسام خاصة بهم
    let filtered = users.filter(u => {
      // استبعاد أدوار الطلاب والمعلمين
      if (u.role === 'student' || u.role === 'teacher') return false;
      return true;
    });
    
    if (searchQuery) {
      filtered = filtered.filter(u => 
        u.full_name.includes(searchQuery) || 
        u.username.includes(searchQuery)
      );
    }
    
    if (selectedRole !== 'all') {
      filtered = filtered.filter(u => u.role === selectedRole || (u as any).role_id === selectedRole);
    }
    
    setFilteredUsers(filtered);
  }, [searchQuery, selectedRole, users]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const handleAddUser = async () => {
    if (!formData.username || !formData.password || !formData.full_name) {
      if (Platform.OS === 'web') {
        window.alert('يرجى ملء جميع الحقول المطلوبة');
      } else {
        Alert.alert('خطأ', 'يرجى ملء جميع الحقول المطلوبة');
      }
      return;
    }

    if (!formData.role_id) {
      if (Platform.OS === 'web') {
        window.alert('يرجى اختيار دور للمستخدم');
      } else {
        Alert.alert('خطأ', 'يرجى اختيار دور للمستخدم');
      }
      return;
    }

    // التحقق من اختيار الكلية (إجباري لغير المدير)
    const selectedRole = roles.find(r => r.id === formData.role_id);
    const systemKey = (selectedRole as any)?.system_key || '';
    const roleName = selectedRole?.name?.toLowerCase() || '';
    const isAdmin = systemKey === 'admin' || roleName.includes('مدير النظام');
    
    if (!isAdmin && !formData.faculty_id) {
      if (Platform.OS === 'web') {
        window.alert('يرجى اختيار الكلية للمستخدم');
      } else {
        Alert.alert('خطأ', 'يرجى اختيار الكلية للمستخدم');
      }
      return;
    }
    
    setSaving(true);
    try {
      await usersAPI.create({
        username: formData.username,
        password: formData.password,
        full_name: formData.full_name,
        role_id: formData.role_id,
        email: formData.email || undefined,
        phone: formData.phone || undefined,
        faculty_id: formData.faculty_id || undefined,
        department_id: formData.department_id || undefined,
      });
      
      if (Platform.OS === 'web') {
        window.alert('✅ تم إضافة المستخدم بنجاح');
      } else {
        Alert.alert('نجاح', 'تم إضافة المستخدم بنجاح');
      }
      setShowAddModal(false);
      setFormData({
        username: '',
        password: '',
        full_name: '',
        role_id: '',
        email: '',
        phone: '',
        scope_type: '',
        scope_id: '',
        faculty_id: '',
        department_id: '',
      });
      fetchData();
    } catch (error: any) {
      const msg = error.response?.data?.detail || 'فشل في إضافة المستخدم';
      if (Platform.OS === 'web') {
        window.alert(msg);
      } else {
        Alert.alert('خطأ', msg);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleEditUser = async () => {
    if (!selectedUser) return;
    
    setSaving(true);
    try {
      await usersAPI.update(selectedUser.id, {
        full_name: formData.full_name,
        role_id: formData.role_id || undefined,
        email: formData.email || undefined,
        phone: formData.phone || undefined,
        faculty_id: formData.faculty_id || undefined,
        department_id: formData.department_id || undefined,
      });
      
      if (Platform.OS === 'web') {
        window.alert('✅ تم تحديث المستخدم بنجاح');
      } else {
        Alert.alert('نجاح', 'تم تحديث المستخدم بنجاح');
      }
      setShowEditModal(false);
      fetchData();
    } catch (error: any) {
      const msg = error.response?.data?.detail || 'فشل في تحديث المستخدم';
      if (Platform.OS === 'web') {
        window.alert(msg);
      } else {
        Alert.alert('خطأ', msg);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteUser = (user: User) => {
    const confirmDelete = () => {
      usersAPI.delete(user.id)
        .then(() => {
          Alert.alert('نجاح', 'تم حذف المستخدم بنجاح');
          fetchData();
        })
        .catch((error: any) => {
          Alert.alert('خطأ', error.response?.data?.detail || 'فشل في حذف المستخدم');
        });
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`هل تريد حذف المستخدم "${user.full_name}"؟`)) {
        confirmDelete();
      }
    } else {
      Alert.alert(
        'تأكيد الحذف',
        `هل تريد حذف المستخدم "${user.full_name}"؟`,
        [
          { text: 'إلغاء', style: 'cancel' },
          { text: 'حذف', style: 'destructive', onPress: confirmDelete },
        ]
      );
    }
  };

  // إعادة تعيين كلمة المرور
  const openResetPasswordModal = (user: User) => {
    setSelectedUser(user);
    setNewPassword('');
    setShowResetPasswordModal(true);
  };

  const handleResetPassword = async () => {
    if (!selectedUser || !newPassword) {
      Alert.alert('خطأ', 'الرجاء إدخال كلمة المرور الجديدة');
      return;
    }
    
    if (newPassword.length < 4) {
      Alert.alert('خطأ', 'كلمة المرور يجب أن تكون 4 أحرف على الأقل');
      return;
    }

    try {
      setSaving(true);
      await usersAPI.resetPassword(selectedUser.id, newPassword);
      Alert.alert('نجاح', 'تم إعادة تعيين كلمة المرور بنجاح');
      setShowResetPasswordModal(false);
      setNewPassword('');
    } catch (error: any) {
      Alert.alert('خطأ', error.response?.data?.detail || 'فشل في إعادة تعيين كلمة المرور');
    } finally {
      setSaving(false);
    }
  };

  // تفعيل/إيقاف المستخدم
  const handleToggleActive = async (user: User) => {
    const action = user.is_active ? 'إيقاف' : 'تفعيل';
    
    const confirmToggle = async () => {
      try {
        await usersAPI.toggleActive(user.id);
        Alert.alert('نجاح', `تم ${action} المستخدم بنجاح`);
        fetchData();
      } catch (error: any) {
        Alert.alert('خطأ', error.response?.data?.detail || `فشل في ${action} المستخدم`);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`هل تريد ${action} المستخدم "${user.full_name}"؟`)) {
        confirmToggle();
      }
    } else {
      Alert.alert(
        `تأكيد ${action}`,
        `هل تريد ${action} المستخدم "${user.full_name}"؟`,
        [
          { text: 'إلغاء', style: 'cancel' },
          { text: action, onPress: confirmToggle },
        ]
      );
    }
  };

  const openEditModal = (user: User) => {
    setSelectedUser(user);
    setFormData({
      username: user.username,
      password: '',
      full_name: user.full_name,
      role_id: (user as any).role_id || '',
      email: user.email || '',
      phone: user.phone || '',
      scope_type: (user as any).scope_type || '',
      scope_id: (user as any).scope_id || '',
    });
    setShowEditModal(true);
  };

  const openPermissionsModal = async (user: User) => {
    setSelectedUser(user);
    try {
      const res = await usersAPI.getPermissions(user.id);
      setUserPermissions(res.data.scopes || []);
      setShowPermissionsModal(true);
    } catch (error) {
      console.error('Error fetching permissions:', error);
    }
  };

  const handleAddPermission = async () => {
    if (!selectedUser || newPermScope.permissions.length === 0) return;
    
    try {
      await usersAPI.addPermission(selectedUser.id, newPermScope);
      const res = await usersAPI.getPermissions(selectedUser.id);
      setUserPermissions(res.data.scopes || []);
      setNewPermScope({ scope_type: 'global', scope_id: '', permissions: [] });
      Alert.alert('نجاح', 'تم إضافة الصلاحية بنجاح');
    } catch (error: any) {
      Alert.alert('خطأ', error.response?.data?.detail || 'فشل في إضافة الصلاحية');
    }
  };

  const handleDeletePermission = async (permissionId: string) => {
    if (!selectedUser || !permissionId) return;
    
    try {
      await usersAPI.deletePermission(selectedUser.id, permissionId);
      const res = await usersAPI.getPermissions(selectedUser.id);
      setUserPermissions(res.data.scopes || []);
      Alert.alert('نجاح', 'تم حذف الصلاحية بنجاح');
    } catch (error: any) {
      Alert.alert('خطأ', error.response?.data?.detail || 'فشل في حذف الصلاحية');
    }
  };

  const togglePermission = (permKey: string) => {
    setNewPermScope(prev => ({
      ...prev,
      permissions: prev.permissions.includes(permKey)
        ? prev.permissions.filter(p => p !== permKey)
        : [...prev.permissions, permKey]
    }));
  };

  if (loading || authLoading || !user) {
    return <LoadingScreen />;
  }

  // السماح للمدير فقط - الشرط البسيط والموثوق
  const userRole = user.role;
  const canAccess = userRole === 'admin' || hasPermission('manage_users');
  
  if (!canAccess) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="lock-closed" size={64} color="#f44336" />
          <Text style={styles.errorText}>غير مصرح لك بالوصول لهذه الصفحة</Text>
          <Text style={styles.errorSubText}>يجب تسجيل الدخول كمدير النظام</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-forward" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>إدارة المستخدمين</Text>
        <TouchableOpacity onPress={() => setShowAddModal(true)} style={styles.addBtn}>
          <Ionicons name="add" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Search & Filter */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={20} color="#999" />
          <TextInput
            style={styles.searchInput}
            placeholder="بحث..."
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color="#999" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Role Filter - Dropdown */}
      <View style={styles.filterContainer}>
        <View style={styles.dropdownRow}>
          <View style={styles.dropdownContainer}>
            <Text style={styles.dropdownLabel}>فلترة حسب الدور</Text>
            <View style={styles.pickerWrapper}>
              <Picker
                selectedValue={selectedRole}
                onValueChange={(value) => setSelectedRole(value)}
                style={styles.picker}
              >
                <Picker.Item 
                  label={`الكل (${users.filter(u => u.role !== 'student' && u.role !== 'teacher').length})`} 
                  value="all" 
                />
                {roles.filter(r => !['student', 'teacher'].includes((r as any).system_key || '')).map(role => {
                  const roleKey = (role as any).system_key || role.id;
                  const count = users.filter(u => (u.role === roleKey || (u as any).role_id === role.id) && u.role !== 'student' && u.role !== 'teacher').length;
                  return (
                    <Picker.Item 
                      key={role.id} 
                      label={`${role.name} (${count})`} 
                      value={roleKey} 
                    />
                  );
                })}
              </Picker>
            </View>
          </View>
        </View>
      </View>

      {/* Users Count */}
      <View style={styles.countContainer}>
        <Text style={styles.countText}>
          عدد المستخدمين: {filteredUsers.length} من {users.filter(u => u.role !== 'student' && u.role !== 'teacher').length}
        </Text>
      </View>

      {/* Users List */}
      <ScrollView
        style={styles.listContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {filteredUsers.map(user => (
          <View key={user.id} style={styles.userCard}>
            <View style={styles.userInfo}>
              <View style={[styles.avatar, { backgroundColor: ROLE_COLORS[user.role] || '#999' }]}>
                <Text style={styles.avatarText}>{user.full_name.charAt(0)}</Text>
              </View>
              <View style={styles.userDetails}>
                <Text style={styles.userName}>{user.full_name}</Text>
                <Text style={styles.userUsername}>@{user.username}</Text>
                <View style={[styles.roleBadge, { backgroundColor: `${ROLE_COLORS[user.role]}20` }]}>
                  <Text style={[styles.roleText, { color: ROLE_COLORS[user.role] }]}>
                    {ROLE_LABELS[user.role]}
                  </Text>
                </View>
                {/* عرض الكلية والقسم إذا موجودة */}
                {(user.faculty_name || user.department_name) && (
                  <View style={styles.scopeInfo}>
                    {user.faculty_name && (
                      <Text style={styles.scopeText}>
                        <Ionicons name="business" size={12} color="#666" /> {user.faculty_name}
                      </Text>
                    )}
                    {user.department_name && (
                      <Text style={styles.scopeText}>
                        <Ionicons name="library" size={12} color="#666" /> {user.department_name}
                      </Text>
                    )}
                  </View>
                )}
              </View>
            </View>
            <View style={styles.userActions}>
              {/* زر تفعيل/إيقاف */}
              {user.role !== 'admin' && (
                <TouchableOpacity
                  style={[styles.actionBtn, user.is_active ? styles.deactivateBtn : styles.activateBtn]}
                  onPress={() => handleToggleActive(user)}
                >
                  <Ionicons name={user.is_active ? "pause" : "play"} size={18} color={user.is_active ? "#ff9800" : "#4caf50"} />
                </TouchableOpacity>
              )}
              {/* زر إعادة تعيين كلمة المرور */}
              <TouchableOpacity
                style={[styles.actionBtn, styles.resetBtn]}
                onPress={() => openResetPasswordModal(user)}
              >
                <Ionicons name="key" size={18} color="#9c27b0" />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.editBtn]}
                onPress={() => openEditModal(user)}
              >
                <Ionicons name="create" size={18} color="#1565c0" />
              </TouchableOpacity>
              {user.role !== 'admin' && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.deleteBtn]}
                  onPress={() => handleDeleteUser(user)}
                >
                  <Ionicons name="trash" size={18} color="#f44336" />
                </TouchableOpacity>
              )}
            </View>
            {/* مؤشر حالة التفعيل */}
            {!user.is_active && (
              <View style={styles.inactiveBadge}>
                <Text style={styles.inactiveBadgeText}>غير مفعل</Text>
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      {/* Add User Modal */}
      <Modal visible={showAddModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>إضافة مستخدم جديد</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.modalBody}>
              <Text style={styles.inputLabel}>اسم المستخدم *</Text>
              <TextInput
                style={styles.input}
                value={formData.username}
                onChangeText={(text) => setFormData(prev => ({ ...prev, username: text }))}
                placeholder="اسم المستخدم"
              />
              
              <Text style={styles.inputLabel}>كلمة المرور *</Text>
              <TextInput
                style={styles.input}
                value={formData.password}
                onChangeText={(text) => setFormData(prev => ({ ...prev, password: text }))}
                placeholder="كلمة المرور"
                secureTextEntry
              />
              
              <Text style={styles.inputLabel}>الاسم الكامل *</Text>
              <TextInput
                style={styles.input}
                value={formData.full_name}
                onChangeText={(text) => setFormData(prev => ({ ...prev, full_name: text }))}
                placeholder="الاسم الكامل"
              />
              
              <Text style={styles.inputLabel}>الدور</Text>
              <View style={styles.roleSelector}>
                {roles.filter(r => !['student', 'teacher'].includes((r as any).system_key || '')).map(role => (
                  <TouchableOpacity
                    key={role.id}
                    style={[
                      styles.roleSelectorItem,
                      formData.role_id === role.id && styles.roleSelectorItemActive
                    ]}
                    onPress={() => setFormData(prev => ({ 
                      ...prev, 
                      role_id: role.id,
                      faculty_id: '',
                      department_id: ''
                    }))}
                  >
                    <Text style={[
                      styles.roleSelectorText,
                      formData.role_id === role.id && styles.roleSelectorTextActive
                    ]}>
                      {role.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              
              {/* حقل الكلية - إجباري لجميع المستخدمين */}
              {formData.role_id && (() => {
                const selectedRole = roles.find(r => r.id === formData.role_id);
                const roleName = selectedRole?.name?.toLowerCase() || '';
                const systemKey = (selectedRole as any)?.system_key || '';
                
                // المدير لا يحتاج لكلية
                const isAdmin = systemKey === 'admin' || roleName.includes('مدير النظام');
                
                // بعض الأدوار تحتاج قسم بالإضافة للكلية
                const needsDepartment = roleName.includes('رئيس قسم') || roleName.includes('department_head') ||
                                       roleName.includes('مدرس') || roleName.includes('مشرف');
                
                return (
                  <>
                    {/* الكلية - إجباري لجميع المستخدمين ما عدا المدير */}
                    {!isAdmin && (
                      <>
                        <Text style={styles.inputLabel}>الكلية *</Text>
                        <View style={styles.scopeSelector}>
                          {faculties.map(faculty => (
                            <TouchableOpacity
                              key={faculty.id}
                              style={[
                                styles.scopeItem,
                                formData.faculty_id === faculty.id && styles.scopeItemActive
                              ]}
                              onPress={() => setFormData(prev => ({ 
                                ...prev, 
                                faculty_id: faculty.id,
                                department_id: '' // إعادة تعيين القسم عند تغيير الكلية
                              }))}
                            >
                              <Text style={[
                                styles.scopeItemText,
                                formData.faculty_id === faculty.id && styles.scopeItemTextActive
                              ]}>
                                {faculty.name}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        {!formData.faculty_id && (
                          <Text style={styles.requiredHint}>⚠️ يجب اختيار الكلية</Text>
                        )}
                      </>
                    )}
                    
                    {/* القسم - للأدوار التي تحتاجه */}
                    {needsDepartment && formData.faculty_id && (
                      <>
                        <Text style={styles.inputLabel}>القسم *</Text>
                        <View style={styles.scopeSelector}>
                          {departments
                            .filter(dept => dept.faculty_id === formData.faculty_id)
                            .map(dept => (
                            <TouchableOpacity
                              key={dept.id}
                              style={[
                                styles.scopeItem,
                                formData.department_id === dept.id && styles.scopeItemActive
                              ]}
                              onPress={() => setFormData(prev => ({ ...prev, department_id: dept.id }))}
                            >
                              <Text style={[
                                styles.scopeItemText,
                                formData.department_id === dept.id && styles.scopeItemTextActive
                              ]}>
                                {dept.name}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </>
                    )}
                  </>
                );
              })()}
              
              <Text style={styles.inputLabel}>البريد الإلكتروني</Text>
              <TextInput
                style={styles.input}
                value={formData.email}
                onChangeText={(text) => setFormData(prev => ({ ...prev, email: text }))}
                placeholder="البريد الإلكتروني"
                keyboardType="email-address"
              />
              
              <Text style={styles.inputLabel}>رقم الهاتف</Text>
              <TextInput
                style={styles.input}
                value={formData.phone}
                onChangeText={(text) => setFormData(prev => ({ ...prev, phone: text }))}
                placeholder="رقم الهاتف"
                keyboardType="phone-pad"
              />
            </ScrollView>
            
            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAddModal(false)}>
                <Text style={styles.cancelBtnText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.submitBtn, saving && styles.savingBtn]} 
                onPress={handleAddUser}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.submitBtnText}>إضافة</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit User Modal */}
      <Modal visible={showEditModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>تعديل المستخدم</Text>
              <TouchableOpacity onPress={() => setShowEditModal(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.modalBody}>
              <Text style={styles.inputLabel}>الاسم الكامل</Text>
              <TextInput
                style={styles.input}
                value={formData.full_name}
                onChangeText={(text) => setFormData(prev => ({ ...prev, full_name: text }))}
                placeholder="الاسم الكامل"
              />
              
              <Text style={styles.inputLabel}>الدور</Text>
              <View style={styles.roleSelector}>
                {roles.map(role => (
                  <TouchableOpacity
                    key={role.id}
                    style={[
                      styles.roleSelectorItem,
                      formData.role_id === role.id && styles.roleSelectorItemActive
                    ]}
                    onPress={() => setFormData(prev => ({ ...prev, role_id: role.id }))}
                  >
                    <Text style={[
                      styles.roleSelectorText,
                      formData.role_id === role.id && styles.roleSelectorTextActive
                    ]}>
                      {role.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              
              <Text style={styles.inputLabel}>البريد الإلكتروني</Text>
              <TextInput
                style={styles.input}
                value={formData.email}
                onChangeText={(text) => setFormData(prev => ({ ...prev, email: text }))}
                placeholder="البريد الإلكتروني"
              />
              
              <Text style={styles.inputLabel}>رقم الهاتف</Text>
              <TextInput
                style={styles.input}
                value={formData.phone}
                onChangeText={(text) => setFormData(prev => ({ ...prev, phone: text }))}
                placeholder="رقم الهاتف"
              />
            </ScrollView>
            
            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowEditModal(false)}>
                <Text style={styles.cancelBtnText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.submitBtn, saving && styles.savingBtn]} 
                onPress={handleEditUser}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.submitBtnText}>حفظ</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Permissions Modal */}
      <Modal visible={showPermissionsModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '90%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>صلاحيات {selectedUser?.full_name}</Text>
              <TouchableOpacity onPress={() => setShowPermissionsModal(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.modalBody}>
              {/* Current Permissions */}
              <Text style={styles.sectionTitle}>الصلاحيات الحالية</Text>
              {userPermissions.length === 0 ? (
                <Text style={styles.emptyText}>لا توجد صلاحيات مخصصة (يستخدم الافتراضي)</Text>
              ) : (
                userPermissions.map((scope, index) => (
                  <View key={index} style={styles.permissionCard}>
                    <View style={styles.permissionHeader}>
                      <View style={styles.scopeBadge}>
                        <Text style={styles.scopeText}>
                          {scope.scope_type === 'global' ? 'عامة' : 
                           scope.scope_type === 'department' ? `قسم: ${scope.scope_name}` :
                           `مقرر: ${scope.scope_name}`}
                        </Text>
                      </View>
                      {scope.id && (
                        <TouchableOpacity onPress={() => handleDeletePermission(scope.id)}>
                          <Ionicons name="trash-outline" size={20} color="#f44336" />
                        </TouchableOpacity>
                      )}
                    </View>
                    <View style={styles.permissionsList}>
                      {scope.permissions.map((perm: string) => {
                        const permInfo = permissions.find(p => p.key === perm);
                        return (
                          <View key={perm} style={styles.permTag}>
                            <Text style={styles.permTagText}>{permInfo?.label || perm}</Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                ))
              )}
              
              {/* Add New Permission */}
              <Text style={[styles.sectionTitle, { marginTop: 20 }]}>إضافة صلاحية جديدة</Text>
              
              <Text style={styles.inputLabel}>نوع النطاق</Text>
              <View style={styles.roleSelector}>
                {scopeTypes.map(scope => (
                  <TouchableOpacity
                    key={scope.key}
                    style={[
                      styles.roleSelectorItem,
                      newPermScope.scope_type === scope.key && styles.roleSelectorItemActive
                    ]}
                    onPress={() => setNewPermScope(prev => ({ ...prev, scope_type: scope.key, scope_id: '' }))}
                  >
                    <Text style={[
                      styles.roleSelectorText,
                      newPermScope.scope_type === scope.key && styles.roleSelectorTextActive
                    ]}>
                      {scope.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              
              {newPermScope.scope_type === 'department' && (
                <>
                  <Text style={styles.inputLabel}>اختر القسم</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {departments.map(dept => (
                      <TouchableOpacity
                        key={dept.id}
                        style={[
                          styles.scopeChip,
                          newPermScope.scope_id === dept.id && styles.scopeChipActive
                        ]}
                        onPress={() => setNewPermScope(prev => ({ ...prev, scope_id: dept.id }))}
                      >
                        <Text style={[
                          styles.scopeChipText,
                          newPermScope.scope_id === dept.id && styles.scopeChipTextActive
                        ]}>
                          {dept.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              )}
              
              {newPermScope.scope_type === 'course' && (
                <>
                  <Text style={styles.inputLabel}>اختر المقرر</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {courses.map(course => (
                      <TouchableOpacity
                        key={course.id}
                        style={[
                          styles.scopeChip,
                          newPermScope.scope_id === course.id && styles.scopeChipActive
                        ]}
                        onPress={() => setNewPermScope(prev => ({ ...prev, scope_id: course.id }))}
                      >
                        <Text style={[
                          styles.scopeChipText,
                          newPermScope.scope_id === course.id && styles.scopeChipTextActive
                        ]}>
                          {course.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              )}
              
              <Text style={styles.inputLabel}>الصلاحيات</Text>
              <View style={styles.permissionsGrid}>
                {permissions.map(perm => (
                  <TouchableOpacity
                    key={perm.key}
                    style={[
                      styles.permCheckbox,
                      newPermScope.permissions.includes(perm.key) && styles.permCheckboxActive
                    ]}
                    onPress={() => togglePermission(perm.key)}
                  >
                    <Ionicons 
                      name={newPermScope.permissions.includes(perm.key) ? 'checkbox' : 'square-outline'} 
                      size={20} 
                      color={newPermScope.permissions.includes(perm.key) ? '#1565c0' : '#999'} 
                    />
                    <Text style={styles.permCheckboxText}>{perm.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              
              <TouchableOpacity 
                style={[styles.submitBtn, { marginTop: 16 }]} 
                onPress={handleAddPermission}
              >
                <Text style={styles.submitBtnText}>إضافة الصلاحية</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Reset Password Modal */}
      <Modal visible={showResetPasswordModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: 300 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>إعادة تعيين كلمة المرور</Text>
              <TouchableOpacity onPress={() => setShowResetPasswordModal(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            
            <View style={styles.modalBody}>
              <Text style={styles.resetUserName}>{selectedUser?.full_name}</Text>
              <Text style={styles.inputLabel}>كلمة المرور الجديدة *</Text>
              <TextInput
                style={styles.input}
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="أدخل كلمة المرور الجديدة"
                secureTextEntry
              />
              
              <TouchableOpacity
                style={[styles.submitBtn, saving && styles.submitBtnDisabled]}
                onPress={handleResetPassword}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitBtnText}>إعادة تعيين</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    color: '#666',
    marginTop: 16,
    textAlign: 'center',
  },
  errorSubText: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
    textAlign: 'center',
  },
  loginBtn: {
    marginTop: 20,
    backgroundColor: '#1565c0',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
  },
  loginBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backBtn: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  addBtn: {
    backgroundColor: '#1565c0',
    padding: 8,
    borderRadius: 8,
  },
  searchContainer: {
    padding: 16,
    backgroundColor: '#fff',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
    textAlign: 'right',
  },
  filterScroll: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: '#1565c0',
  },
  filterChipText: {
    fontSize: 14,
    color: '#666',
  },
  filterChipTextActive: {
    color: '#fff',
  },
  listContainer: {
    flex: 1,
    padding: 16,
  },
  userCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  avatarText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  userDetails: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  userUsername: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 6,
  },
  roleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  scopeInfo: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
    gap: 8,
  },
  scopeText: {
    fontSize: 11,
    color: '#666',
  },
  userActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  permBtn: {
    backgroundColor: '#f3e5f5',
  },
  editBtn: {
    backgroundColor: '#e3f2fd',
  },
  deleteBtn: {
    backgroundColor: '#ffebee',
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    width: '100%',
    maxWidth: 500,
    maxHeight: '80%',
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
  modalBody: {
    padding: 16,
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    gap: 12,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
    marginTop: 12,
  },
  input: {
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    textAlign: 'right',
  },
  roleSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  roleSelectorItem: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  roleSelectorItemActive: {
    backgroundColor: '#1565c0',
  },
  roleSelectorText: {
    fontSize: 14,
    color: '#666',
  },
  roleSelectorTextActive: {
    color: '#fff',
  },
  scopeSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  scopeItem: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  scopeItemActive: {
    backgroundColor: '#e3f2fd',
    borderColor: '#1565c0',
  },
  scopeItemText: {
    fontSize: 13,
    color: '#666',
  },
  requiredHint: {
    fontSize: 12,
    color: '#f44336',
    marginTop: 4,
    marginBottom: 8,
  },
  scopeItemTextActive: {
    color: '#1565c0',
    fontWeight: '600',
  },
  cancelBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  cancelBtnText: {
    fontSize: 14,
    color: '#666',
  },
  submitBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#1565c0',
    minWidth: 100,
    alignItems: 'center',
  },
  savingBtn: {
    opacity: 0.7,
  },
  submitBtnText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
  // Permission Modal Styles
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    padding: 20,
  },
  permissionCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  permissionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  scopeBadge: {
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  scopeText: {
    fontSize: 12,
    color: '#1565c0',
    fontWeight: '600',
  },
  permissionsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  permTag: {
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  permTagText: {
    fontSize: 11,
    color: '#4caf50',
  },
  scopeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#f0f0f0',
    marginRight: 8,
    marginBottom: 8,
  },
  scopeChipActive: {
    backgroundColor: '#1565c0',
  },
  scopeChipText: {
    fontSize: 13,
    color: '#666',
  },
  scopeChipTextActive: {
    color: '#fff',
  },
  permissionsGrid: {
    gap: 8,
  },
  permCheckbox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    gap: 10,
  },
  permCheckboxActive: {
    backgroundColor: '#e3f2fd',
  },
  permCheckboxText: {
    fontSize: 14,
    color: '#333',
  },
  scopeSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  scopeItem: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#f0f0f0',
    marginRight: 8,
    marginBottom: 8,
  },
  scopeItemActive: {
    backgroundColor: '#1565c0',
  },
  scopeItemText: {
    fontSize: 13,
    color: '#666',
  },
  scopeItemTextActive: {
    color: '#fff',
  },
  // Dropdown Filter Styles
  filterContainer: {
    padding: 10,
    backgroundColor: '#f8f9fa',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 10,
  },
  dropdownRow: {
    flexDirection: 'row',
    gap: 8,
  },
  dropdownContainer: {
    flex: 1,
  },
  dropdownLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  pickerWrapper: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    overflow: 'hidden',
  },
  picker: {
    height: 45,
    fontSize: 13,
  },
  countContainer: {
    backgroundColor: '#e3f2fd',
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
  },
  countText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1565c0',
    textAlign: 'center',
  },
  // New styles for user actions
  resetBtn: {
    backgroundColor: '#f3e5f5',
  },
  activateBtn: {
    backgroundColor: '#e8f5e9',
  },
  deactivateBtn: {
    backgroundColor: '#fff3e0',
  },
  inactiveBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: '#f44336',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  inactiveBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  resetUserName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
    marginBottom: 16,
  },
});
