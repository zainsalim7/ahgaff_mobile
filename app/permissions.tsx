import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  FlatList,
  ActivityIndicator,
  Modal,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { usersAPI, permissionsAPI } from '../src/services/api';
import { LoadingScreen } from '../src/components/LoadingScreen';

interface Permission {
  key: string;
  label: string;
  category: string;
}

interface Role {
  key: string;
  label: string;
}

interface User {
  id: string;
  username: string;
  full_name: string;
  role: string;
  email?: string;
  permissions: string[];
}

const ROLE_COLORS: { [key: string]: string } = {
  admin: '#f44336',
  teacher: '#4caf50',
  employee: '#ff9800',
  student: '#2196f3',
};

const ROLE_LABELS: { [key: string]: string } = {
  admin: 'مدير النظام',
  teacher: 'معلم',
  employee: 'موظف',
  student: 'طالب',
};

export default function PermissionsScreen() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [defaultPermissions, setDefaultPermissions] = useState<{ [key: string]: string[] }>({});
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [filterRole, setFilterRole] = useState<string>('');

  const fetchData = useCallback(async () => {
    try {
      const [usersRes, permsRes] = await Promise.all([
        usersAPI.getAll(),
        permissionsAPI.getAll(),
      ]);
      setUsers(usersRes.data);
      setAllPermissions(permsRes.data.permissions);
      setRoles(permsRes.data.roles);
      setDefaultPermissions(permsRes.data.default_permissions);
    } catch (error) {
      console.error('Error fetching data:', error);
      Alert.alert('خطأ', 'فشل في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openUserModal = (user: User) => {
    setSelectedUser(user);
    setUserPermissions([...user.permissions]);
    setSelectedRole(user.role);
    setShowModal(true);
  };

  const togglePermission = (permKey: string) => {
    setUserPermissions(prev => {
      if (prev.includes(permKey)) {
        return prev.filter(p => p !== permKey);
      } else {
        return [...prev, permKey];
      }
    });
  };

  const handleRoleChange = (newRole: string) => {
    setSelectedRole(newRole);
    // تحديث الصلاحيات للافتراضية للدور الجديد
    setUserPermissions(defaultPermissions[newRole] || []);
  };

  const handleSave = async () => {
    if (!selectedUser) return;

    setSaving(true);
    try {
      // إذا تغير الدور، استخدم API تحديث الدور
      if (selectedRole !== selectedUser.role) {
        await usersAPI.updateRole(selectedUser.id, selectedRole, userPermissions);
      } else {
        // فقط تحديث الصلاحيات
        await usersAPI.updatePermissions(selectedUser.id, userPermissions);
      }
      
      Alert.alert('نجاح', 'تم حفظ التغييرات');
      setShowModal(false);
      fetchData();
    } catch (error: any) {
      const message = error.response?.data?.detail || 'فشل في حفظ التغييرات';
      Alert.alert('خطأ', message);
    } finally {
      setSaving(false);
    }
  };

  const handleResetPermissions = async () => {
    if (!selectedUser) return;

    Alert.alert(
      'إعادة تعيين الصلاحيات',
      'سيتم إعادة تعيين صلاحيات هذا المستخدم إلى الافتراضية حسب دوره. متابعة؟',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'إعادة تعيين',
          onPress: async () => {
            setSaving(true);
            try {
              await usersAPI.resetPermissions(selectedUser.id);
              Alert.alert('نجاح', 'تم إعادة تعيين الصلاحيات');
              setShowModal(false);
              fetchData();
            } catch (error) {
              Alert.alert('خطأ', 'فشل في إعادة تعيين الصلاحيات');
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  // تجميع الصلاحيات حسب الفئة
  const groupedPermissions = allPermissions.reduce((acc, perm) => {
    if (!acc[perm.category]) {
      acc[perm.category] = [];
    }
    acc[perm.category].push(perm);
    return acc;
  }, {} as { [key: string]: Permission[] });

  const filteredUsers = filterRole 
    ? users.filter(u => u.role === filterRole)
    : users;

  const renderUser = ({ item }: { item: User }) => (
    <TouchableOpacity
      style={styles.userCard}
      onPress={() => openUserModal(item)}
    >
      <View style={[styles.roleIndicator, { backgroundColor: ROLE_COLORS[item.role] || '#999' }]} />
      <View style={styles.userInfo}>
        <Text style={styles.userName}>{item.full_name}</Text>
        <Text style={styles.userUsername}>@{item.username}</Text>
        <View style={styles.roleTag}>
          <Text style={[styles.roleText, { color: ROLE_COLORS[item.role] || '#999' }]}>
            {ROLE_LABELS[item.role] || item.role}
          </Text>
        </View>
      </View>
      <View style={styles.permCount}>
        <Ionicons name="key" size={18} color="#ff9800" />
        <Text style={styles.permCountText}>{item.permissions?.length || 0}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color="#ccc" />
    </TouchableOpacity>
  );

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>إدارة الصلاحيات</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Info Banner */}
      <View style={styles.infoBanner}>
        <Ionicons name="information-circle" size={20} color="#1565c0" />
        <Text style={styles.infoBannerText}>
          اضغط على المستخدم لتعديل دوره وصلاحياته
        </Text>
      </View>

      {/* Role Filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterBtn, !filterRole && styles.filterBtnActive]}
          onPress={() => setFilterRole('')}
        >
          <Text style={[styles.filterText, !filterRole && styles.filterTextActive]}>الكل</Text>
        </TouchableOpacity>
        {roles.map(role => (
          <TouchableOpacity
            key={role.key}
            style={[
              styles.filterBtn, 
              filterRole === role.key && styles.filterBtnActive,
              { borderColor: ROLE_COLORS[role.key] }
            ]}
            onPress={() => setFilterRole(role.key)}
          >
            <Text style={[
              styles.filterText, 
              filterRole === role.key && styles.filterTextActive,
              filterRole === role.key && { color: '#fff' }
            ]}>{role.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Users List */}
      <FlatList
        data={filteredUsers}
        renderItem={renderUser}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="people-outline" size={64} color="#ccc" />
            <Text style={styles.emptyText}>لا يوجد مستخدمون</Text>
          </View>
        }
      />

      {/* Permissions Modal */}
      <Modal
        visible={showModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowModal(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          {/* Modal Header */}
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowModal(false)}>
              <Ionicons name="close" size={28} color="#333" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>تعديل الصلاحيات</Text>
            <TouchableOpacity onPress={handleSave} disabled={saving}>
              {saving ? (
                <ActivityIndicator size="small" color="#ff9800" />
              ) : (
                <Text style={styles.saveText}>حفظ</Text>
              )}
            </TouchableOpacity>
          </View>

          {selectedUser && (
            <ScrollView style={styles.modalContent}>
              {/* User Info */}
              <View style={styles.userInfoSection}>
                <View style={[styles.avatarLarge, { backgroundColor: ROLE_COLORS[selectedUser.role] }]}>
                  <Ionicons name="person" size={32} color="#fff" />
                </View>
                <Text style={styles.modalUserName}>{selectedUser.full_name}</Text>
                <Text style={styles.modalUserUsername}>@{selectedUser.username}</Text>
              </View>

              {/* Role Selection */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>الدور</Text>
                <View style={styles.rolesGrid}>
                  {roles.map(role => (
                    <TouchableOpacity
                      key={role.key}
                      style={[
                        styles.roleOption,
                        selectedRole === role.key && styles.roleOptionActive,
                        selectedRole === role.key && { borderColor: ROLE_COLORS[role.key], backgroundColor: ROLE_COLORS[role.key] + '15' }
                      ]}
                      onPress={() => handleRoleChange(role.key)}
                    >
                      <Ionicons 
                        name={selectedRole === role.key ? "checkmark-circle" : "ellipse-outline"} 
                        size={20} 
                        color={selectedRole === role.key ? ROLE_COLORS[role.key] : '#999'} 
                      />
                      <Text style={[
                        styles.roleOptionText,
                        selectedRole === role.key && { color: ROLE_COLORS[role.key], fontWeight: '600' }
                      ]}>{role.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Permissions */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>الصلاحيات</Text>
                  <TouchableOpacity onPress={handleResetPermissions}>
                    <Text style={styles.resetText}>إعادة تعيين</Text>
                  </TouchableOpacity>
                </View>

                {Object.entries(groupedPermissions).map(([category, perms]) => (
                  <View key={category} style={styles.permCategory}>
                    <Text style={styles.categoryTitle}>{category}</Text>
                    {perms.map(perm => (
                      <TouchableOpacity
                        key={perm.key}
                        style={styles.permItem}
                        onPress={() => togglePermission(perm.key)}
                      >
                        <View style={styles.permInfo}>
                          <Text style={styles.permLabel}>{perm.label}</Text>
                          <Text style={styles.permKey}>{perm.key}</Text>
                        </View>
                        <Switch
                          value={userPermissions.includes(perm.key)}
                          onValueChange={() => togglePermission(perm.key)}
                          trackColor={{ false: '#e0e0e0', true: '#ffcc80' }}
                          thumbColor={userPermissions.includes(perm.key) ? '#ff9800' : '#f4f3f4'}
                        />
                      </TouchableOpacity>
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#1565c0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e3f2fd',
    margin: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 8,
    gap: 8,
  },
  infoBannerText: {
    flex: 1,
    fontSize: 13,
    color: '#1565c0',
  },
  filterRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    maxHeight: 60,
  },
  filterBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  filterBtnActive: {
    backgroundColor: '#1565c0',
    borderColor: '#1565c0',
  },
  filterText: {
    fontSize: 13,
    color: '#333',
  },
  filterTextActive: {
    color: '#fff',
  },
  listContent: {
    padding: 16,
    paddingTop: 8,
  },
  userCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  roleIndicator: {
    width: 4,
    height: 48,
    borderRadius: 2,
    marginRight: 12,
  },
  userInfo: {
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
  roleTag: {
    marginTop: 6,
  },
  roleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  permCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginRight: 8,
    backgroundColor: '#fff8e1',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  permCountText: {
    fontSize: 13,
    color: '#ff9800',
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    marginTop: 16,
  },
  // Modal Styles
  modalContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  saveText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ff9800',
  },
  modalContent: {
    flex: 1,
  },
  userInfoSection: {
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  avatarLarge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalUserName: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
  },
  modalUserUsername: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  section: {
    backgroundColor: '#fff',
    marginTop: 16,
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  resetText: {
    fontSize: 14,
    color: '#f44336',
  },
  rolesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  roleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    backgroundColor: '#f9f9f9',
    gap: 8,
    minWidth: '45%',
  },
  roleOptionActive: {
    borderWidth: 2,
  },
  roleOptionText: {
    fontSize: 14,
    color: '#666',
  },
  permCategory: {
    marginBottom: 16,
  },
  categoryTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1565c0',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e3f2fd',
  },
  permItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  permInfo: {
    flex: 1,
  },
  permLabel: {
    fontSize: 14,
    color: '#333',
  },
  permKey: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
});
