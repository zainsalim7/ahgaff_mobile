import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usersAPI } from '../src/services/api';
import { User } from '../src/types';
import { LoadingScreen } from '../src/components/LoadingScreen';

const USER_ROLES = [
  { key: 'teacher', label: 'معلم', color: '#4caf50' },
  { key: 'employee', label: 'موظف', color: '#ff9800' },
];

export default function AddTeacherScreen() {
  const [teachers, setTeachers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<User | null>(null);
  const [filterRole, setFilterRole] = useState<string>('');

  const [formData, setFormData] = useState({
    username: '',
    full_name: '',
    password: '',
    email: '',
    phone: '',
    role: 'teacher',
  });

  const fetchTeachers = useCallback(async () => {
    try {
      // جلب المعلمين والموظفين
      const [teachersRes, employeesRes] = await Promise.all([
        usersAPI.getAll('teacher'),
        usersAPI.getAll('employee'),
      ]);
      setTeachers([...teachersRes.data, ...employeesRes.data]);
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTeachers();
  }, [fetchTeachers]);

  const handleSubmit = async () => {
    if (!editingTeacher && (!formData.username || !formData.full_name || !formData.password)) {
      Alert.alert('خطأ', 'الرجاء ملء جميع الحقول المطلوبة');
      return;
    }
    if (editingTeacher && !formData.full_name) {
      Alert.alert('خطأ', 'الرجاء إدخال الاسم الكامل');
      return;
    }

    setSaving(true);
    try {
      if (editingTeacher) {
        await usersAPI.update(editingTeacher.id, {
          full_name: formData.full_name,
          email: formData.email || undefined,
          phone: formData.phone || undefined,
          password: formData.password || undefined,
        });
        Alert.alert('نجاح', 'تم تحديث البيانات بنجاح');
      } else {
        await usersAPI.create({
          username: formData.username,
          full_name: formData.full_name,
          password: formData.password,
          email: formData.email || undefined,
          phone: formData.phone || undefined,
          role: formData.role,
        });
        const roleLabel = USER_ROLES.find(r => r.key === formData.role)?.label || formData.role;
        Alert.alert('نجاح', `تم إضافة ${roleLabel} بنجاح`);
      }
      resetForm();
      setShowForm(false);
      setEditingTeacher(null);
      fetchTeachers();
    } catch (error: any) {
      const message = error.response?.data?.detail || 'حدث خطأ';
      Alert.alert('خطأ', message);
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setFormData({
      username: '',
      full_name: '',
      password: '',
      email: '',
      phone: '',
      role: 'teacher',
    });
  };

  const handleEdit = (teacher: User) => {
    setEditingTeacher(teacher);
    setFormData({
      username: teacher.username,
      full_name: teacher.full_name,
      password: '',
      email: teacher.email || '',
      phone: teacher.phone || '',
      role: teacher.role,
    });
    setShowForm(true);
  };

  const handleDelete = (userId: string, userName: string, role: string) => {
    const roleLabel = USER_ROLES.find(r => r.key === role)?.label || role;
    Alert.alert(
      `حذف ${roleLabel}`,
      `هل أنت متأكد من حذف ${userName}؟`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'حذف',
          style: 'destructive',
          onPress: async () => {
            try {
              await usersAPI.delete(userId);
              fetchTeachers();
            } catch (error) {
              Alert.alert('خطأ', 'فشل في الحذف');
            }
          },
        },
      ]
    );
  };

  const getRoleInfo = (role: string) => {
    return USER_ROLES.find(r => r.key === role) || { label: role, color: '#999' };
  };

  const filteredUsers = filterRole 
    ? teachers.filter(t => t.role === filterRole)
    : teachers;

  const renderTeacher = ({ item }: { item: User }) => {
    const roleInfo = getRoleInfo(item.role);
    return (
      <View style={styles.itemCard}>
        <View style={[styles.roleIndicator, { backgroundColor: roleInfo.color }]} />
        <View style={styles.itemInfo}>
          <Text style={styles.itemName}>{item.full_name}</Text>
          <Text style={styles.itemDetail}>@{item.username}</Text>
          <Text style={[styles.roleTag, { color: roleInfo.color }]}>{roleInfo.label}</Text>
        </View>
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={styles.editBtn}
            onPress={() => handleEdit(item)}
          >
            <Ionicons name="create" size={20} color="#ff9800" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={() => handleDelete(item.id, item.full_name, item.role)}
          >
            <Ionicons name="trash" size={20} color="#f44336" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {showForm ? (
          <ScrollView style={styles.formContainer}>
            <Text style={styles.formTitle}>
              {editingTeacher ? 'تعديل البيانات' : 'إضافة مستخدم جديد'}
            </Text>

            {/* اختيار الدور - فقط عند الإضافة */}
            {!editingTeacher && (
              <>
                <Text style={styles.label}>نوع المستخدم *</Text>
                <View style={styles.rolesRow}>
                  {USER_ROLES.map(role => (
                    <TouchableOpacity
                      key={role.key}
                      style={[
                        styles.roleBtn,
                        formData.role === role.key && { backgroundColor: role.color, borderColor: role.color }
                      ]}
                      onPress={() => setFormData({ ...formData, role: role.key })}
                    >
                      <Ionicons 
                        name={formData.role === role.key ? "checkmark-circle" : "ellipse-outline"} 
                        size={18} 
                        color={formData.role === role.key ? '#fff' : role.color} 
                      />
                      <Text style={[
                        styles.roleBtnText,
                        formData.role === role.key && { color: '#fff' }
                      ]}>{role.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
            
            <Text style={styles.label}>اسم المستخدم *</Text>
            <TextInput
              style={[styles.input, editingTeacher && styles.inputDisabled]}
              value={formData.username}
              onChangeText={(text) => setFormData({ ...formData, username: text })}
              placeholder="أدخل اسم المستخدم"
              autoCapitalize="none"
              editable={!editingTeacher}
            />

            <Text style={styles.label}>الاسم الكامل *</Text>
            <TextInput
              style={styles.input}
              value={formData.full_name}
              onChangeText={(text) => setFormData({ ...formData, full_name: text })}
              placeholder="أدخل الاسم الكامل"
            />

            <Text style={styles.label}>كلمة المرور {editingTeacher ? '' : '*'}</Text>
            <TextInput
              style={styles.input}
              value={formData.password}
              onChangeText={(text) => setFormData({ ...formData, password: text })}
              placeholder={editingTeacher ? 'اتركها فارغة للإبقاء على القديمة' : 'أدخل كلمة المرور'}
              secureTextEntry
            />

            <Text style={styles.label}>رقم الهاتف</Text>
            <TextInput
              style={styles.input}
              value={formData.phone}
              onChangeText={(text) => setFormData({ ...formData, phone: text })}
              placeholder="رقم الهاتف"
              keyboardType="phone-pad"
            />

            <Text style={styles.label}>البريد الإلكتروني</Text>
            <TextInput
              style={styles.input}
              value={formData.email}
              onChangeText={(text) => setFormData({ ...formData, email: text })}
              placeholder="البريد الإلكتروني"
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <View style={styles.formButtons}>
              <TouchableOpacity
                style={[styles.btn, styles.cancelBtn]}
                onPress={() => {
                  setShowForm(false);
                  setEditingTeacher(null);
                  resetForm();
                }}
              >
                <Text style={styles.cancelBtnText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.saveBtn]}
                onPress={handleSubmit}
                disabled={saving}
              >
                <Text style={styles.saveBtnText}>
                  {saving ? 'جاري الحفظ...' : editingTeacher ? 'تحديث' : 'حفظ'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        ) : (
          <>
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => setShowForm(true)}
            >
              <Ionicons name="add-circle" size={24} color="#fff" />
              <Text style={styles.addButtonText}>إضافة مستخدم جديد</Text>
            </TouchableOpacity>

            {/* فلتر الأدوار */}
            <View style={styles.filterRow}>
              <TouchableOpacity
                style={[styles.filterBtn, !filterRole && styles.filterBtnActive]}
                onPress={() => setFilterRole('')}
              >
                <Text style={[styles.filterText, !filterRole && styles.filterTextActive]}>الكل</Text>
              </TouchableOpacity>
              {USER_ROLES.map(role => (
                <TouchableOpacity
                  key={role.key}
                  style={[
                    styles.filterBtn, 
                    filterRole === role.key && { backgroundColor: role.color, borderColor: role.color }
                  ]}
                  onPress={() => setFilterRole(role.key)}
                >
                  <Text style={[
                    styles.filterText, 
                    filterRole === role.key && styles.filterTextActive
                  ]}>{role.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <FlatList
              data={filteredUsers}
              renderItem={renderTeacher}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Ionicons name="people-outline" size={64} color="#ccc" />
                  <Text style={styles.emptyText}>لا يوجد مستخدمين</Text>
                </View>
              }
            />
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  addButton: {
    flexDirection: 'row',
    backgroundColor: '#4caf50',
    margin: 16,
    marginBottom: 8,
    padding: 16,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  filterBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderRadius: 20,
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
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  itemCard: {
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
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  itemDetail: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  roleTag: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  deleteBtn: {
    padding: 8,
    backgroundColor: '#ffebee',
    borderRadius: 8,
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editBtn: {
    padding: 8,
    backgroundColor: '#fff3e0',
    borderRadius: 8,
  },
  inputDisabled: {
    backgroundColor: '#f5f5f5',
    color: '#999',
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
  formContainer: {
    padding: 16,
  },
  formTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 20,
    textAlign: 'center',
  },
  rolesRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  roleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#f9f9f9',
    gap: 6,
  },
  roleBtnText: {
    fontSize: 14,
    color: '#666',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
    marginTop: 12,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    textAlign: 'right',
  },
  formButtons: {
    flexDirection: 'row',
    marginTop: 24,
    marginBottom: 40,
  },
  btn: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelBtn: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginRight: 8,
  },
  cancelBtnText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '600',
  },
  saveBtn: {
    backgroundColor: '#4caf50',
    marginLeft: 8,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
