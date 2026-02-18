import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  Platform,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../src/contexts/AuthContext';
import { rolesAPI, permissionsAPI } from '../src/services/api';

interface Permission {
  key: string;
  label: string;
  category: string;
}

interface Role {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  is_system: boolean;
  users_count: number;
  created_at: string;
}

const LoadingScreen = () => (
  <View style={styles.loadingContainer}>
    <ActivityIndicator size="large" color="#1565c0" />
    <Text style={styles.loadingText}>جاري التحميل...</Text>
  </View>
);

export default function ManageRolesScreen() {
  const router = useRouter();
  const { isAdmin, isLoading: authLoading, user } = useAuth();
  
  const [roles, setRoles] = useState<Role[]>([]);
  const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  
  // Form states
  const [roleName, setRoleName] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [rolesRes, permsRes] = await Promise.all([
        rolesAPI.getAll(),
        permissionsAPI.getAvailable(),
      ]);
      
      setRoles(rolesRes.data);
      setAllPermissions(permsRes.data.permissions || []);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading) {
      fetchData();
    }
  }, [authLoading, fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  const openAddModal = () => {
    setModalMode('add');
    setRoleName('');
    setRoleDescription('');
    setSelectedPermissions([]);
    setSelectedRole(null);
    setShowModal(true);
  };

  const openEditModal = (role: Role) => {
    setModalMode('edit');
    setRoleName(role.name);
    setRoleDescription(role.description);
    setSelectedPermissions(role.permissions);
    setSelectedRole(role);
    setShowModal(true);
  };

  const togglePermission = (permKey: string) => {
    setSelectedPermissions(prev => 
      prev.includes(permKey) 
        ? prev.filter(p => p !== permKey)
        : [...prev, permKey]
    );
  };

  const selectAllPermissions = () => {
    if (selectedPermissions.length === allPermissions.length) {
      setSelectedPermissions([]);
    } else {
      setSelectedPermissions(allPermissions.map(p => p.key));
    }
  };

  const handleSave = async () => {
    if (!roleName.trim()) {
      if (Platform.OS === 'web') {
        window.alert('يرجى إدخال اسم الدور');
      } else {
        Alert.alert('خطأ', 'يرجى إدخال اسم الدور');
      }
      return;
    }

    if (selectedPermissions.length === 0) {
      if (Platform.OS === 'web') {
        window.alert('يرجى اختيار صلاحية واحدة على الأقل');
      } else {
        Alert.alert('خطأ', 'يرجى اختيار صلاحية واحدة على الأقل');
      }
      return;
    }

    setSaving(true);
    try {
      if (modalMode === 'add') {
        await rolesAPI.create({
          name: roleName.trim(),
          description: roleDescription.trim(),
          permissions: selectedPermissions,
        });
      } else if (selectedRole) {
        await rolesAPI.update(selectedRole.id, {
          name: roleName.trim(),
          description: roleDescription.trim(),
          permissions: selectedPermissions,
        });
      }
      
      setShowModal(false);
      fetchData();
      
      if (Platform.OS === 'web') {
        window.alert(modalMode === 'add' ? 'تم إنشاء الدور بنجاح' : 'تم تحديث الدور بنجاح');
      } else {
        Alert.alert('نجاح', modalMode === 'add' ? 'تم إنشاء الدور بنجاح' : 'تم تحديث الدور بنجاح');
      }
    } catch (error: any) {
      const msg = error.response?.data?.detail || 'حدث خطأ';
      if (Platform.OS === 'web') {
        window.alert(msg);
      } else {
        Alert.alert('خطأ', msg);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (role: Role) => {
    if (role.is_system) {
      if (Platform.OS === 'web') {
        window.alert('لا يمكن حذف دور نظامي');
      } else {
        Alert.alert('خطأ', 'لا يمكن حذف دور نظامي');
      }
      return;
    }

    if (role.users_count > 0) {
      if (Platform.OS === 'web') {
        window.alert(`لا يمكن حذف الدور، يوجد ${role.users_count} مستخدم مرتبط به`);
      } else {
        Alert.alert('خطأ', `لا يمكن حذف الدور، يوجد ${role.users_count} مستخدم مرتبط به`);
      }
      return;
    }

    const confirmDelete = async () => {
      try {
        await rolesAPI.delete(role.id);
        fetchData();
        if (Platform.OS === 'web') {
          window.alert('تم حذف الدور بنجاح');
        } else {
          Alert.alert('نجاح', 'تم حذف الدور بنجاح');
        }
      } catch (error: any) {
        const msg = error.response?.data?.detail || 'حدث خطأ';
        if (Platform.OS === 'web') {
          window.alert(msg);
        } else {
          Alert.alert('خطأ', msg);
        }
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`هل أنت متأكد من حذف الدور "${role.name}"؟`)) {
        confirmDelete();
      }
    } else {
      Alert.alert(
        'تأكيد الحذف',
        `هل أنت متأكد من حذف الدور "${role.name}"؟`,
        [
          { text: 'إلغاء', style: 'cancel' },
          { text: 'حذف', style: 'destructive', onPress: confirmDelete },
        ]
      );
    }
  };

  // Group permissions by category
  const groupedPermissions = allPermissions.reduce((acc, perm) => {
    if (!acc[perm.category]) {
      acc[perm.category] = [];
    }
    acc[perm.category].push(perm);
    return acc;
  }, {} as Record<string, Permission[]>);

  if (loading || authLoading) {
    return <LoadingScreen />;
  }
  
  // انتظر حتى يتم تحميل بيانات المستخدم
  if (!user || !user.role) {
    return <LoadingScreen />;
  }

  // السماح للمدير فقط
  const userRole = user.role;
  const canAccess = userRole === 'admin';
  
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
          <Ionicons name="arrow-forward" size={24} color="#1565c0" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>إدارة الأدوار</Text>
        <TouchableOpacity onPress={openAddModal} style={styles.addBtn}>
          <Ionicons name="add" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Info Card */}
      <View style={styles.infoCard}>
        <Ionicons name="information-circle" size={24} color="#1565c0" />
        <Text style={styles.infoText}>
          أنشئ أدواراً مخصصة وحدد الصلاحيات لكل دور، ثم أسند الأدوار للمستخدمين
        </Text>
      </View>

      {/* Roles List */}
      <ScrollView 
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {roles.map((role) => (
          <View key={role.id} style={styles.roleCard}>
            <View style={styles.roleHeader}>
              <View style={styles.roleInfo}>
                <View style={styles.roleTitleRow}>
                  <Ionicons 
                    name={role.is_system ? "shield-checkmark" : "shield"} 
                    size={24} 
                    color={role.is_system ? "#4caf50" : "#1565c0"} 
                  />
                  <Text style={styles.roleName}>{role.name}</Text>
                  {role.is_system && (
                    <View style={styles.systemBadge}>
                      <Text style={styles.systemBadgeText}>نظامي</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.roleDescription}>{role.description}</Text>
                <View style={styles.roleStats}>
                  <View style={styles.statItem}>
                    <Ionicons name="people" size={16} color="#666" />
                    <Text style={styles.statText}>{role.users_count} مستخدم</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Ionicons name="key" size={16} color="#666" />
                    <Text style={styles.statText}>{role.permissions.length} صلاحية</Text>
                  </View>
                </View>
              </View>
              
              {/* أزرار التعديل - متاحة لجميع الأدوار، الحذف فقط للأدوار غير النظامية */}
              <View style={styles.roleActions}>
                <TouchableOpacity 
                  style={styles.actionBtn}
                  onPress={() => openEditModal(role)}
                >
                  <Ionicons name="pencil" size={20} color="#1565c0" />
                </TouchableOpacity>
                {!role.is_system && (
                  <TouchableOpacity 
                    style={[styles.actionBtn, styles.deleteBtn]}
                    onPress={() => handleDelete(role)}
                  >
                    <Ionicons name="trash" size={20} color="#f44336" />
                  </TouchableOpacity>
                )}
              </View>
            </View>
            
            {/* Permissions Preview */}
            <View style={styles.permissionsPreview}>
              <Text style={styles.permissionsLabel}>الصلاحيات:</Text>
              <View style={styles.permissionsTags}>
                {role.permissions.slice(0, 5).map((perm) => {
                  const permInfo = allPermissions.find(p => p.key === perm);
                  return (
                    <View key={perm} style={styles.permTag}>
                      <Text style={styles.permTagText}>
                        {permInfo?.label || perm}
                      </Text>
                    </View>
                  );
                })}
                {role.permissions.length > 5 && (
                  <View style={[styles.permTag, styles.moreTag]}>
                    <Text style={styles.permTagText}>+{role.permissions.length - 5}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        ))}

        {roles.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="folder-open-outline" size={64} color="#ccc" />
            <Text style={styles.emptyText}>لا توجد أدوار</Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={openAddModal}>
              <Text style={styles.emptyBtnText}>إنشاء دور جديد</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Add/Edit Role Modal */}
      <Modal
        visible={showModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {modalMode === 'add' ? 'إنشاء دور جديد' : 'تعديل الدور'}
              </Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={styles.inputLabel}>اسم الدور *</Text>
              <TextInput
                style={styles.input}
                value={roleName}
                onChangeText={setRoleName}
                placeholder="مثال: مشرف قسم"
                placeholderTextColor="#999"
              />

              <Text style={styles.inputLabel}>الوصف</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={roleDescription}
                onChangeText={setRoleDescription}
                placeholder="وصف مختصر للدور"
                placeholderTextColor="#999"
                multiline
                numberOfLines={3}
              />

              <View style={styles.permissionsHeader}>
                <Text style={styles.inputLabel}>الصلاحيات *</Text>
                <TouchableOpacity onPress={selectAllPermissions}>
                  <Text style={styles.selectAllText}>
                    {selectedPermissions.length === allPermissions.length ? 'إلغاء الكل' : 'تحديد الكل'}
                  </Text>
                </TouchableOpacity>
              </View>

              {Object.entries(groupedPermissions).map(([category, perms]) => (
                <View key={category} style={styles.permCategory}>
                  <Text style={styles.categoryTitle}>{category}</Text>
                  <View style={styles.permsList}>
                    {perms.map((perm) => (
                      <TouchableOpacity
                        key={perm.key}
                        style={[
                          styles.permItem,
                          selectedPermissions.includes(perm.key) && styles.permItemSelected
                        ]}
                        onPress={() => togglePermission(perm.key)}
                      >
                        <Ionicons
                          name={selectedPermissions.includes(perm.key) ? "checkbox" : "square-outline"}
                          size={20}
                          color={selectedPermissions.includes(perm.key) ? "#1565c0" : "#666"}
                        />
                        <Text style={[
                          styles.permItemText,
                          selectedPermissions.includes(perm.key) && styles.permItemTextSelected
                        ]}>
                          {perm.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ))}
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity 
                style={styles.cancelBtn}
                onPress={() => setShowModal(false)}
              >
                <Text style={styles.cancelBtnText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.saveBtn, saving && styles.savingBtn]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.saveBtnText}>
                    {modalMode === 'add' ? 'إنشاء' : 'حفظ'}
                  </Text>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    marginTop: 16,
    fontSize: 18,
    color: '#666',
  },
  errorSubText: {
    marginTop: 8,
    fontSize: 14,
    color: '#999',
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
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  addBtn: {
    backgroundColor: '#1565c0',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e3f2fd',
    margin: 16,
    padding: 12,
    borderRadius: 8,
    gap: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: '#1565c0',
  },
  scrollView: {
    flex: 1,
    padding: 16,
    paddingTop: 0,
  },
  roleCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  roleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  roleInfo: {
    flex: 1,
  },
  roleTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  roleName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  systemBadge: {
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  systemBadgeText: {
    fontSize: 10,
    color: '#4caf50',
    fontWeight: '600',
  },
  roleDescription: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  roleStats: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 8,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    fontSize: 12,
    color: '#666',
  },
  roleActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e3f2fd',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteBtn: {
    backgroundColor: '#ffebee',
  },
  permissionsPreview: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  permissionsLabel: {
    fontSize: 12,
    color: '#999',
    marginBottom: 8,
  },
  permissionsTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  permTag: {
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  moreTag: {
    backgroundColor: '#e3f2fd',
  },
  permTagText: {
    fontSize: 12,
    color: '#666',
  },
  emptyState: {
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    marginTop: 16,
  },
  emptyBtn: {
    marginTop: 16,
    backgroundColor: '#1565c0',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  emptyBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    width: '90%',
    maxWidth: 500,
    maxHeight: '85%',
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
    maxHeight: 400,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
    textAlign: 'right',
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  permissionsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  selectAllText: {
    fontSize: 14,
    color: '#1565c0',
  },
  permCategory: {
    marginBottom: 16,
  },
  categoryTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1565c0',
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 8,
  },
  permsList: {
    gap: 4,
  },
  permItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    gap: 10,
  },
  permItemSelected: {
    backgroundColor: '#e3f2fd',
  },
  permItemText: {
    fontSize: 14,
    color: '#666',
  },
  permItemTextSelected: {
    color: '#1565c0',
    fontWeight: '600',
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  cancelBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
  },
  cancelBtnText: {
    fontSize: 14,
    color: '#666',
  },
  saveBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#1565c0',
    minWidth: 100,
    alignItems: 'center',
  },
  savingBtn: {
    opacity: 0.7,
  },
  saveBtnText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
});
