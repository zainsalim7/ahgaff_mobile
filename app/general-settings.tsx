import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Platform,
  Alert,
  ActivityIndicator,
  Modal,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LoadingScreen } from '../src/components/LoadingScreen';
import api, { settingsAPI, semestersAPI, facultiesAPI } from '../src/services/api';
import { useAuth } from '../src/contexts/AuthContext';
import { Picker } from '@react-native-picker/picker';

// Interfaces
interface University {
  id: string;
  name: string;
  code: string;
  description?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  faculties_count: number;
}

interface Faculty {
  id: string;
  name: string;
  code: string;
  description?: string;
  dean_id?: string;
  dean_name?: string;
  departments_count: number;
}

interface Semester {
  id: string;
  name: string;
  academic_year: string;
  start_date?: string;
  end_date?: string;
  status: string;
  courses_count: number;
  created_at: string;
  closed_at?: string;
  archived_at?: string;
}

interface Settings {
  college_name: string;
  college_name_en: string;
  academic_year: string;
  current_semester: string;
  semester_start_date: string;
  semester_end_date: string;
  levels_count: number;
  sections: string[];
  attendance_late_minutes: number;
  max_absence_percent: number;
  primary_color: string;
  secondary_color: string;
  academic_years: string[];
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  active: { label: 'نشط', color: '#4caf50', bg: '#e8f5e9', icon: 'checkmark-circle' },
  upcoming: { label: 'قادم', color: '#2196f3', bg: '#e3f2fd', icon: 'time' },
  closed: { label: 'منتهي', color: '#ff9800', bg: '#fff3e0', icon: 'close-circle' },
  archived: { label: 'مؤرشف', color: '#9e9e9e', bg: '#fafafa', icon: 'archive' },
};

type TabType = 'university' | 'semesters' | 'settings';

export default function GeneralSettingsScreen() {
  const router = useRouter();
  const { isAdmin, isLoading: authLoading, user } = useAuth();
  
  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>('settings');
  
  // Common states
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // University states
  const [university, setUniversity] = useState<University | null>(null);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [editUniversity, setEditUniversity] = useState(false);
  const [showFacultyForm, setShowFacultyForm] = useState(false);
  const [editingFaculty, setEditingFaculty] = useState<Faculty | null>(null);
  const [universityForm, setUniversityForm] = useState({
    name: '',
    code: '',
    description: '',
    address: '',
    phone: '',
    email: '',
    website: '',
  });
  const [facultyForm, setFacultyForm] = useState({
    name: '',
    code: '',
    description: '',
  });
  
  // Semester states
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [showSemesterModal, setShowSemesterModal] = useState(false);
  const [semesterModalMode, setSemesterModalMode] = useState<'add' | 'edit'>('add');
  const [selectedSemester, setSelectedSemester] = useState<Semester | null>(null);
  const [semesterForm, setSemesterForm] = useState({
    name: '',
    academic_year: '',
    start_date: '',
    end_date: '',
  });
  
  // Settings states
  const [settings, setSettings] = useState<Settings>({
    college_name: '',
    college_name_en: '',
    academic_year: '',
    current_semester: '',
    semester_start_date: '',
    semester_end_date: '',
    levels_count: 5,
    sections: [],
    attendance_late_minutes: 15,
    max_absence_percent: 25,
    primary_color: '#1565c0',
    secondary_color: '#ff9800',
    academic_years: [],
  });
  const [sectionsInput, setSectionsInput] = useState('');
  
  // Faculty settings states
  const [selectedFacultyId, setSelectedFacultyId] = useState<string>('');
  const [facultySettings, setFacultySettings] = useState<{
    levels_count: number;
    sections: string[];
    attendance_late_minutes: number;
    max_absence_percent: number;
    primary_color: string;
    secondary_color: string;
    phone: string;
    whatsapp: string;
    email: string;
  }>({
    levels_count: 5,
    sections: ['أ', 'ب', 'ج'],
    attendance_late_minutes: 15,
    max_absence_percent: 25,
    primary_color: '#1565c0',
    secondary_color: '#ff9800',
    phone: '',
    whatsapp: '',
    email: '',
  });
  const [facultySectionsInput, setFacultySectionsInput] = useState('أ، ب، ج');

  // Helper functions
  const showMessage = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      window.alert(`${title}\n\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  const showConfirm = (title: string, message: string, onConfirm: () => void, confirmText = 'تأكيد', destructive = false) => {
    if (Platform.OS === 'web') {
      if (window.confirm(`${title}\n\n${message}`)) {
        onConfirm();
      }
    } else {
      Alert.alert(title, message, [
        { text: 'إلغاء', style: 'cancel' },
        { text: confirmText, style: destructive ? 'destructive' : 'default', onPress: onConfirm }
      ]);
    }
  };

  // Fetch all data
  const fetchData = useCallback(async () => {
    try {
      const [uniRes, facRes, semestersRes, settingsRes] = await Promise.all([
        api.get('/university'),
        api.get('/faculties'),
        semestersAPI.getAll(),
        settingsAPI.get(),
      ]);
      
      // University data
      if (uniRes.data) {
        setUniversity(uniRes.data);
        setUniversityForm({
          name: uniRes.data.name || '',
          code: uniRes.data.code || '',
          description: uniRes.data.description || '',
          address: uniRes.data.address || '',
          phone: uniRes.data.phone || '',
          email: uniRes.data.email || '',
          website: uniRes.data.website || '',
        });
      }
      setFaculties(facRes.data || []);
      
      // Semesters data
      setSemesters(semestersRes.data);
      
      // Settings data
      setSettings(settingsRes.data);
      setSectionsInput(settingsRes.data.sections?.join('، ') || '');
      
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

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  // ==================== University Functions ====================
  const handleSaveUniversity = async () => {
    if (!universityForm.name || !universityForm.code) {
      showMessage('خطأ', 'الرجاء إدخال اسم ورمز الجامعة');
      return;
    }

    setSaving(true);
    try {
      await api.post('/university', universityForm);
      showMessage('نجاح', 'تم حفظ بيانات الجامعة بنجاح');
      setEditUniversity(false);
      fetchData();
    } catch (error: any) {
      showMessage('خطأ', error.response?.data?.detail || 'حدث خطأ');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveFaculty = async () => {
    if (!facultyForm.name || !facultyForm.code) {
      showMessage('خطأ', 'الرجاء إدخال اسم ورمز الكلية');
      return;
    }

    setSaving(true);
    try {
      if (editingFaculty) {
        await api.put(`/faculties/${editingFaculty.id}`, facultyForm);
        showMessage('نجاح', 'تم تحديث بيانات الكلية بنجاح');
      } else {
        await api.post('/faculties', facultyForm);
        showMessage('نجاح', 'تم إضافة الكلية بنجاح');
      }
      setShowFacultyForm(false);
      setEditingFaculty(null);
      setFacultyForm({ name: '', code: '', description: '' });
      fetchData();
    } catch (error: any) {
      showMessage('خطأ', error.response?.data?.detail || 'حدث خطأ');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteFaculty = (faculty: Faculty) => {
    showConfirm('حذف كلية', `هل أنت متأكد من حذف ${faculty.name}؟`, async () => {
      try {
        await api.delete(`/faculties/${faculty.id}`);
        showMessage('نجاح', 'تم حذف الكلية بنجاح');
        fetchData();
      } catch (error: any) {
        showMessage('خطأ', error.response?.data?.detail || 'فشل في الحذف');
      }
    }, 'حذف', true);
  };

  const handleEditFaculty = (faculty: Faculty) => {
    setEditingFaculty(faculty);
    setFacultyForm({
      name: faculty.name,
      code: faculty.code,
      description: faculty.description || '',
    });
    setShowFacultyForm(true);
  };

  // ==================== Semester Functions ====================
  const openAddSemesterModal = () => {
    setSemesterModalMode('add');
    setSemesterForm({
      name: '',
      academic_year: settings?.academic_year || '',
      start_date: '',
      end_date: '',
    });
    setSelectedSemester(null);
    setShowSemesterModal(true);
  };

  const openEditSemesterModal = (semester: Semester) => {
    setSemesterModalMode('edit');
    setSemesterForm({
      name: semester.name,
      academic_year: semester.academic_year,
      start_date: semester.start_date || '',
      end_date: semester.end_date || '',
    });
    setSelectedSemester(semester);
    setShowSemesterModal(true);
  };

  const handleSaveSemester = async () => {
    if (!semesterForm.name.trim() || !semesterForm.academic_year.trim()) {
      showMessage('خطأ', 'يرجى ملء جميع الحقول المطلوبة');
      return;
    }

    setSaving(true);
    try {
      if (semesterModalMode === 'add') {
        await semestersAPI.create(semesterForm);
        showMessage('نجاح', 'تم إنشاء الفصل الدراسي بنجاح');
      } else if (selectedSemester) {
        await semestersAPI.update(selectedSemester.id, semesterForm);
        showMessage('نجاح', 'تم تحديث الفصل الدراسي بنجاح');
      }
      setShowSemesterModal(false);
      fetchData();
    } catch (error: any) {
      showMessage('خطأ', error.response?.data?.detail || 'حدث خطأ');
    } finally {
      setSaving(false);
    }
  };

  const handleActivateSemester = (semester: Semester) => {
    showConfirm(
      'تفعيل الفصل',
      `هل تريد تفعيل الفصل "${semester.name}" وجعله الفصل الحالي؟`,
      async () => {
        try {
          setSaving(true);
          await semestersAPI.activate(semester.id);
          showMessage('نجاح', `تم تفعيل الفصل "${semester.name}" بنجاح`);
          fetchData();
        } catch (error: any) {
          showMessage('خطأ', error.response?.data?.detail || 'فشل في التفعيل');
        } finally {
          setSaving(false);
        }
      }
    );
  };

  const handleCloseSemester = (semester: Semester) => {
    showConfirm(
      'إغلاق الفصل',
      `هل تريد إغلاق الفصل "${semester.name}"؟`,
      async () => {
        try {
          setSaving(true);
          await semestersAPI.close(semester.id);
          showMessage('نجاح', 'تم إغلاق الفصل بنجاح');
          fetchData();
        } catch (error: any) {
          showMessage('خطأ', error.response?.data?.detail || 'فشل في الإغلاق');
        } finally {
          setSaving(false);
        }
      },
      'إغلاق',
      true
    );
  };

  const handleArchiveSemester = (semester: Semester) => {
    showConfirm(
      'أرشفة الفصل',
      `هل تريد أرشفة الفصل "${semester.name}"؟\n\n⚠️ هذا الإجراء لا يمكن التراجع عنه.`,
      async () => {
        try {
          setSaving(true);
          await semestersAPI.archive(semester.id);
          showMessage('نجاح', 'تم أرشفة الفصل بنجاح');
          fetchData();
        } catch (error: any) {
          showMessage('خطأ', error.response?.data?.detail || 'فشل في الأرشفة');
        } finally {
          setSaving(false);
        }
      },
      'أرشفة',
      true
    );
  };

  const handleDeleteSemester = (semester: Semester) => {
    showConfirm(
      'حذف الفصل',
      `هل تريد حذف الفصل "${semester.name}"؟`,
      async () => {
        try {
          setSaving(true);
          await semestersAPI.delete(semester.id);
          showMessage('نجاح', 'تم حذف الفصل بنجاح');
          fetchData();
        } catch (error: any) {
          showMessage('خطأ', error.response?.data?.detail || 'فشل في الحذف');
        } finally {
          setSaving(false);
        }
      },
      'حذف',
      true
    );
  };

  // ==================== Settings Functions ====================
  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const sectionsArray = sectionsInput
        .split(/[،,\s]+/)
        .map(s => s.trim())
        .filter(s => s.length > 0);

      await settingsAPI.update({
        ...settings,
        sections: sectionsArray,
      });
      showMessage('نجاح', 'تم حفظ الإعدادات بنجاح');
    } catch (error: any) {
      showMessage('خطأ', error.response?.data?.detail || 'فشل في حفظ الإعدادات');
    } finally {
      setSaving(false);
    }
  };

  // Group semesters by year
  const semestersByYear = semesters.reduce((acc, sem) => {
    if (!acc[sem.academic_year]) {
      acc[sem.academic_year] = [];
    }
    acc[sem.academic_year].push(sem);
    return acc;
  }, {} as Record<string, Semester[]>);

  // Show loading while auth is being loaded
  if (authLoading) {
    return <LoadingScreen />;
  }

  if (loading) {
    return <LoadingScreen />;
  }

  // Note: Backend APIs already check permissions, so we just show the page

  // ==================== Render University Tab ====================
  const renderUniversityTab = () => (
    <ScrollView style={styles.tabContent}>
      {/* University Card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.universityIcon}>
            <Ionicons name="school" size={40} color="#1565c0" />
          </View>
          <View style={styles.universityInfo}>
            <Text style={styles.universityName}>
              {university?.name || 'لم يتم تعيين الجامعة'}
            </Text>
            {university?.code && (
              <Text style={styles.universityCode}>{university.code}</Text>
            )}
          </View>
          <TouchableOpacity
            style={styles.editIconBtn}
            onPress={() => setEditUniversity(!editUniversity)}
          >
            <Ionicons name={editUniversity ? "close" : "create"} size={20} color="#1565c0" />
          </TouchableOpacity>
        </View>

        {editUniversity ? (
          <View style={styles.form}>
            <Text style={styles.label}>اسم الجامعة *</Text>
            <TextInput
              style={styles.input}
              value={universityForm.name}
              onChangeText={(text) => setUniversityForm({ ...universityForm, name: text })}
              placeholder="اسم الجامعة"
            />

            <Text style={styles.label}>رمز الجامعة *</Text>
            <TextInput
              style={styles.input}
              value={universityForm.code}
              onChangeText={(text) => setUniversityForm({ ...universityForm, code: text })}
              placeholder="مثال: AHGAFF"
            />

            <Text style={styles.label}>الوصف</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={universityForm.description}
              onChangeText={(text) => setUniversityForm({ ...universityForm, description: text })}
              placeholder="وصف الجامعة"
              multiline
              numberOfLines={3}
            />

            <Text style={styles.label}>العنوان</Text>
            <TextInput
              style={styles.input}
              value={universityForm.address}
              onChangeText={(text) => setUniversityForm({ ...universityForm, address: text })}
              placeholder="عنوان الجامعة"
            />

            <Text style={styles.label}>الهاتف</Text>
            <TextInput
              style={styles.input}
              value={universityForm.phone}
              onChangeText={(text) => setUniversityForm({ ...universityForm, phone: text })}
              placeholder="رقم الهاتف"
              keyboardType="phone-pad"
            />

            <Text style={styles.label}>البريد الإلكتروني</Text>
            <TextInput
              style={styles.input}
              value={universityForm.email}
              onChangeText={(text) => setUniversityForm({ ...universityForm, email: text })}
              placeholder="البريد الإلكتروني"
              keyboardType="email-address"
            />

            <Text style={styles.label}>الموقع الإلكتروني</Text>
            <TextInput
              style={styles.input}
              value={universityForm.website}
              onChangeText={(text) => setUniversityForm({ ...universityForm, website: text })}
              placeholder="www.example.com"
            />

            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.savingBtn]}
              onPress={handleSaveUniversity}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>حفظ بيانات الجامعة</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.universityDetails}>
            {university?.description && (
              <Text style={styles.detailText}>{university.description}</Text>
            )}
            {university?.address && (
              <View style={styles.detailRow}>
                <Ionicons name="location" size={16} color="#666" />
                <Text style={styles.detailText}>{university.address}</Text>
              </View>
            )}
            {university?.phone && (
              <View style={styles.detailRow}>
                <Ionicons name="call" size={16} color="#666" />
                <Text style={styles.detailText}>{university.phone}</Text>
              </View>
            )}
            {university?.email && (
              <View style={styles.detailRow}>
                <Ionicons name="mail" size={16} color="#666" />
                <Text style={styles.detailText}>{university.email}</Text>
              </View>
            )}
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{faculties.length}</Text>
                <Text style={styles.statLabel}>كليات</Text>
              </View>
            </View>
          </View>
        )}
      </View>

      {/* Faculties Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>الكليات</Text>
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => {
              setEditingFaculty(null);
              setFacultyForm({ name: '', code: '', description: '' });
              setShowFacultyForm(true);
            }}
          >
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={styles.addBtnText}>إضافة كلية</Text>
          </TouchableOpacity>
        </View>

        {showFacultyForm && (
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>
              {editingFaculty ? 'تعديل الكلية' : 'إضافة كلية جديدة'}
            </Text>

            <Text style={styles.label}>اسم الكلية *</Text>
            <TextInput
              style={styles.input}
              value={facultyForm.name}
              onChangeText={(text) => setFacultyForm({ ...facultyForm, name: text })}
              placeholder="مثال: كلية الشريعة والقانون"
            />

            <Text style={styles.label}>رمز الكلية *</Text>
            <TextInput
              style={styles.input}
              value={facultyForm.code}
              onChangeText={(text) => setFacultyForm({ ...facultyForm, code: text })}
              placeholder="مثال: LAW"
            />

            <Text style={styles.label}>الوصف</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={facultyForm.description}
              onChangeText={(text) => setFacultyForm({ ...facultyForm, description: text })}
              placeholder="وصف الكلية"
              multiline
              numberOfLines={2}
            />

            <View style={styles.formButtons}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  setShowFacultyForm(false);
                  setEditingFaculty(null);
                }}
              >
                <Text style={styles.cancelBtnText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, saving && styles.savingBtn]}
                onPress={handleSaveFaculty}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveBtnText}>
                    {editingFaculty ? 'تحديث' : 'إضافة'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {faculties.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="business-outline" size={48} color="#ccc" />
            <Text style={styles.emptyText}>لا توجد كليات</Text>
          </View>
        ) : (
          faculties.map((faculty) => (
            <View key={faculty.id} style={styles.facultyCard}>
              <View style={styles.facultyIcon}>
                <Ionicons name="business" size={24} color="#4caf50" />
              </View>
              <View style={styles.facultyInfo}>
                <Text style={styles.facultyName}>{faculty.name}</Text>
                <Text style={styles.facultyCode}>{faculty.code}</Text>
                <Text style={styles.facultyDepts}>{faculty.departments_count} أقسام</Text>
              </View>
              <View style={styles.actionButtons}>
                <TouchableOpacity
                  style={[styles.iconBtn, styles.editIconBtnSmall]}
                  onPress={() => handleEditFaculty(faculty)}
                >
                  <Ionicons name="create" size={18} color="#1565c0" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.iconBtn, styles.deleteIconBtn]}
                  onPress={() => handleDeleteFaculty(faculty)}
                >
                  <Ionicons name="trash" size={18} color="#f44336" />
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </View>
      <View style={{ height: 40 }} />
    </ScrollView>
  );

  // ==================== Render Semesters Tab ====================
  const renderSemestersTab = () => (
    <ScrollView style={styles.tabContent}>
      {/* Current Semester Info */}
      {settings && (
        <View style={styles.currentInfo}>
          <Ionicons name="calendar" size={24} color="#1565c0" />
          <View style={styles.currentInfoText}>
            <Text style={styles.currentLabel}>الفصل الحالي</Text>
            <Text style={styles.currentValue}>
              {settings.current_semester} - {settings.academic_year}
            </Text>
          </View>
          <TouchableOpacity onPress={openAddSemesterModal} style={styles.addSemesterBtn}>
            <Ionicons name="add" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {/* Semesters List */}
      {Object.entries(semestersByYear)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([year, yearSemesters]) => (
        <View key={year} style={styles.yearSection}>
          <View style={styles.yearHeader}>
            <Ionicons name="school" size={20} color="#1565c0" />
            <Text style={styles.yearTitle}>{year}</Text>
          </View>
          
          {yearSemesters.map((semester) => {
            const statusInfo = STATUS_LABELS[semester.status] || STATUS_LABELS.upcoming;
            
            return (
              <View key={semester.id} style={styles.semesterCard}>
                <View style={styles.semesterHeader}>
                  <View style={styles.semesterInfo}>
                    <Text style={styles.semesterName}>{semester.name}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: statusInfo.bg }]}>
                      <Ionicons name={statusInfo.icon as any} size={14} color={statusInfo.color} />
                      <Text style={[styles.statusText, { color: statusInfo.color }]}>
                        {statusInfo.label}
                      </Text>
                    </View>
                  </View>
                  
                  <View style={styles.semesterStats}>
                    <View style={styles.semesterStatItem}>
                      <Ionicons name="book" size={16} color="#666" />
                      <Text style={styles.semesterStatText}>{semester.courses_count} مقرر</Text>
                    </View>
                  </View>
                </View>
                
                {(semester.start_date || semester.end_date) && (
                  <View style={styles.dateRow}>
                    <Ionicons name="calendar-outline" size={14} color="#999" />
                    <Text style={styles.dateText}>
                      {semester.start_date || '---'} إلى {semester.end_date || '---'}
                    </Text>
                  </View>
                )}
                
                <View style={styles.semesterActions}>
                  {semester.status !== 'archived' && semester.status !== 'active' && (
                    <TouchableOpacity
                      style={[styles.semesterActionBtn, styles.activateBtn]}
                      onPress={() => handleActivateSemester(semester)}
                    >
                      <Ionicons name="checkmark-circle" size={18} color="#4caf50" />
                      <Text style={[styles.actionText, { color: '#4caf50' }]}>تفعيل</Text>
                    </TouchableOpacity>
                  )}
                  
                  {semester.status === 'active' && (
                    <TouchableOpacity
                      style={[styles.semesterActionBtn, styles.closeActionBtn]}
                      onPress={() => handleCloseSemester(semester)}
                    >
                      <Ionicons name="close-circle" size={18} color="#ff9800" />
                      <Text style={[styles.actionText, { color: '#ff9800' }]}>إغلاق</Text>
                    </TouchableOpacity>
                  )}
                  
                  {semester.status === 'closed' && (
                    <TouchableOpacity
                      style={[styles.semesterActionBtn, styles.archiveBtn]}
                      onPress={() => handleArchiveSemester(semester)}
                    >
                      <Ionicons name="archive" size={18} color="#9e9e9e" />
                      <Text style={[styles.actionText, { color: '#9e9e9e' }]}>أرشفة</Text>
                    </TouchableOpacity>
                  )}
                  
                  {semester.status !== 'archived' && (
                    <TouchableOpacity
                      style={[styles.semesterActionBtn, styles.editSemesterBtn]}
                      onPress={() => openEditSemesterModal(semester)}
                    >
                      <Ionicons name="pencil" size={18} color="#1565c0" />
                    </TouchableOpacity>
                  )}
                  
                  {semester.courses_count === 0 && semester.status !== 'active' && (
                    <TouchableOpacity
                      style={[styles.semesterActionBtn, styles.deleteSemesterBtn]}
                      onPress={() => handleDeleteSemester(semester)}
                    >
                      <Ionicons name="trash" size={18} color="#f44336" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      ))}

      {semesters.length === 0 && (
        <View style={styles.emptyState}>
          <Ionicons name="calendar-outline" size={64} color="#ccc" />
          <Text style={styles.emptyText}>لا توجد فصول دراسية</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={openAddSemesterModal}>
            <Text style={styles.emptyBtnText}>إنشاء فصل جديد</Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={{ height: 40 }} />
    </ScrollView>
  );

  // ==================== Render Settings Tab ====================
  const renderSettingsTab = () => {
    // دالة لجلب إعدادات الكلية المختارة
    const loadFacultySettings = async (facultyId: string) => {
      if (!facultyId) return;
      try {
        const response = await facultiesAPI.getById(facultyId);
        const data = response.data;
        setFacultySettings({
          levels_count: data.levels_count || 5,
          sections: data.sections || ['أ', 'ب', 'ج'],
          attendance_late_minutes: data.attendance_late_minutes || 15,
          max_absence_percent: data.max_absence_percent || 25,
          primary_color: data.primary_color || '#1565c0',
          secondary_color: data.secondary_color || '#ff9800',
          phone: data.phone || '',
          whatsapp: data.whatsapp || '',
          email: data.email || '',
        });
        setFacultySectionsInput((data.sections || ['أ', 'ب', 'ج']).join('، '));
      } catch (error) {
        console.error('Error loading faculty settings:', error);
      }
    };

    // دالة لحفظ إعدادات الكلية
    const saveFacultySettings = async () => {
      if (!selectedFacultyId) {
        showMessage('خطأ', 'يرجى اختيار كلية أولاً');
        return;
      }
      
      setSaving(true);
      try {
        const sections = facultySectionsInput
          .split(/[،,]/)
          .map(s => s.trim())
          .filter(s => s);
        
        await facultiesAPI.updateSettings(selectedFacultyId, {
          ...facultySettings,
          sections,
        });
        
        showMessage('نجاح', 'تم حفظ إعدادات الكلية بنجاح');
      } catch (error: any) {
        showMessage('خطأ', error.response?.data?.detail || 'فشل في حفظ الإعدادات');
      } finally {
        setSaving(false);
      }
    };

    return (
      <ScrollView style={styles.tabContent}>
        {/* اختيار الكلية */}
        <View style={styles.card}>
          <View style={styles.cardSectionHeader}>
            <Ionicons name="business" size={22} color="#1565c0" />
            <Text style={styles.cardSectionTitle}>اختر الكلية</Text>
          </View>
          
          {faculties.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="school-outline" size={48} color="#ccc" />
              <Text style={styles.emptyText}>لا توجد كليات</Text>
              <Text style={styles.emptySubText}>قم بإنشاء كليات من تبويب "الجامعة" أولاً</Text>
            </View>
          ) : (
            <View style={styles.pickerContainer}>
              <Picker
                selectedValue={selectedFacultyId}
                onValueChange={(value) => {
                  setSelectedFacultyId(value);
                  if (value) loadFacultySettings(value);
                }}
                style={styles.picker}
              >
                <Picker.Item label="-- اختر كلية --" value="" />
                {faculties.map(faculty => (
                  <Picker.Item
                    key={faculty.id}
                    label={faculty.name}
                    value={faculty.id}
                  />
                ))}
              </Picker>
            </View>
          )}
        </View>

        {/* إعدادات الكلية المختارة */}
        {selectedFacultyId && (
          <>
            {/* الإعدادات الأكاديمية */}
            <View style={styles.card}>
              <View style={styles.cardSectionHeader}>
                <Ionicons name="school" size={22} color="#4caf50" />
                <Text style={styles.cardSectionTitle}>الإعدادات الأكاديمية</Text>
              </View>

              <Text style={styles.label}>عدد المستويات الدراسية</Text>
              <View style={styles.optionsRow}>
                {[4, 5, 6, 8].map(num => (
                  <TouchableOpacity
                    key={num}
                    style={[
                      styles.optionBtn,
                      facultySettings.levels_count === num && styles.optionBtnActive
                    ]}
                    onPress={() => setFacultySettings({ ...facultySettings, levels_count: num })}
                  >
                    <Text style={[
                      styles.optionText,
                      facultySettings.levels_count === num && styles.optionTextActive
                    ]}>{num}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>الشُعب المتاحة (مفصولة بفاصلة)</Text>
              <TextInput
                style={styles.input}
                value={facultySectionsInput}
                onChangeText={setFacultySectionsInput}
                placeholder="أ، ب، ج"
              />
            </View>

            {/* إعدادات الحضور */}
            <View style={styles.card}>
              <View style={styles.cardSectionHeader}>
                <Ionicons name="time" size={22} color="#ff9800" />
                <Text style={styles.cardSectionTitle}>إعدادات الحضور</Text>
              </View>

              <Text style={styles.label}>دقائق التأخير المسموحة</Text>
              <View style={styles.optionsRow}>
                {[5, 10, 15, 20, 30].map(min => (
                  <TouchableOpacity
                    key={min}
                    style={[
                      styles.optionBtn,
                      facultySettings.attendance_late_minutes === min && styles.optionBtnActive
                    ]}
                    onPress={() => setFacultySettings({ ...facultySettings, attendance_late_minutes: min })}
                  >
                    <Text style={[
                      styles.optionText,
                      facultySettings.attendance_late_minutes === min && styles.optionTextActive
                    ]}>{min} د</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>نسبة الغياب القصوى المسموحة (%)</Text>
              <View style={styles.optionsRow}>
                {[15, 20, 25, 30, 35].map(percent => (
                  <TouchableOpacity
                    key={percent}
                    style={[
                      styles.optionBtn,
                      facultySettings.max_absence_percent === percent && styles.optionBtnActive
                    ]}
                    onPress={() => setFacultySettings({ ...facultySettings, max_absence_percent: percent })}
                  >
                    <Text style={[
                      styles.optionText,
                      facultySettings.max_absence_percent === percent && styles.optionTextActive
                    ]}>{percent}%</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* معلومات التواصل */}
            <View style={styles.card}>
              <View style={styles.cardSectionHeader}>
                <Ionicons name="call" size={22} color="#2196f3" />
                <Text style={styles.cardSectionTitle}>معلومات التواصل</Text>
              </View>

              <Text style={styles.label}>رقم الهاتف</Text>
              <TextInput
                style={styles.input}
                value={facultySettings.phone}
                onChangeText={(text) => setFacultySettings({ ...facultySettings, phone: text })}
                placeholder="رقم الهاتف"
                keyboardType="phone-pad"
              />

              <Text style={styles.label}>رقم الواتساب</Text>
              <TextInput
                style={styles.input}
                value={facultySettings.whatsapp}
                onChangeText={(text) => setFacultySettings({ ...facultySettings, whatsapp: text })}
                placeholder="رقم الواتساب"
                keyboardType="phone-pad"
              />

              <Text style={styles.label}>البريد الإلكتروني</Text>
              <TextInput
                style={styles.input}
                value={facultySettings.email}
                onChangeText={(text) => setFacultySettings({ ...facultySettings, email: text })}
                placeholder="البريد الإلكتروني"
                keyboardType="email-address"
              />
            </View>

            {/* ألوان الواجهة */}
            <View style={styles.card}>
              <View style={styles.cardSectionHeader}>
                <Ionicons name="color-palette" size={22} color="#9c27b0" />
                <Text style={styles.cardSectionTitle}>ألوان الواجهة</Text>
              </View>

              <Text style={styles.label}>اللون الرئيسي</Text>
              <View style={styles.colorRow}>
                {['#1565c0', '#2196f3', '#00bcd4', '#009688', '#4caf50', '#8bc34a'].map(color => (
                  <TouchableOpacity
                    key={color}
                    style={[
                      styles.colorOption,
                      { backgroundColor: color },
                      facultySettings.primary_color === color && styles.colorOptionActive
                    ]}
                    onPress={() => setFacultySettings({ ...facultySettings, primary_color: color })}
                  >
                    {facultySettings.primary_color === color && (
                      <Ionicons name="checkmark" size={20} color="#fff" />
                    )}
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>اللون الثانوي</Text>
              <View style={styles.colorRow}>
                {['#ff9800', '#ff5722', '#f44336', '#e91e63', '#9c27b0', '#673ab7'].map(color => (
                  <TouchableOpacity
                    key={color}
                    style={[
                      styles.colorOption,
                      { backgroundColor: color },
                      facultySettings.secondary_color === color && styles.colorOptionActive
                    ]}
                    onPress={() => setFacultySettings({ ...facultySettings, secondary_color: color })}
                  >
                    {facultySettings.secondary_color === color && (
                      <Ionicons name="checkmark" size={20} color="#fff" />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* زر الحفظ */}
            <TouchableOpacity
              style={[styles.saveButton, saving && styles.saveButtonDisabled]}
              onPress={saveFacultySettings}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="save" size={20} color="#fff" />
                  <Text style={styles.saveButtonText}>حفظ إعدادات الكلية</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-forward" size={24} color="#1565c0" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>الإعدادات العامة</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'settings' && styles.tabActive]}
          onPress={() => setActiveTab('settings')}
        >
          <Ionicons name="settings" size={20} color={activeTab === 'settings' ? '#1565c0' : '#666'} />
          <Text style={[styles.tabText, activeTab === 'settings' && styles.tabTextActive]}>
            الإعدادات
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.tab, activeTab === 'semesters' && styles.tabActive]}
          onPress={() => setActiveTab('semesters')}
        >
          <Ionicons name="calendar" size={20} color={activeTab === 'semesters' ? '#1565c0' : '#666'} />
          <Text style={[styles.tabText, activeTab === 'semesters' && styles.tabTextActive]}>
            الفصول
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.tab, activeTab === 'university' && styles.tabActive]}
          onPress={() => setActiveTab('university')}
        >
          <Ionicons name="school" size={20} color={activeTab === 'university' ? '#1565c0' : '#666'} />
          <Text style={[styles.tabText, activeTab === 'university' && styles.tabTextActive]}>
            الجامعة
          </Text>
        </TouchableOpacity>
      </View>

      {/* Tab Content */}
      {activeTab === 'university' && renderUniversityTab()}
      {activeTab === 'semesters' && renderSemestersTab()}
      {activeTab === 'settings' && renderSettingsTab()}

      {/* Semester Modal */}
      <Modal
        visible={showSemesterModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowSemesterModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {semesterModalMode === 'add' ? 'إنشاء فصل دراسي جديد' : 'تعديل الفصل الدراسي'}
              </Text>
              <TouchableOpacity onPress={() => setShowSemesterModal(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={styles.inputLabel}>اسم الفصل *</Text>
              <View style={styles.semesterNames}>
                {['الفصل الأول', 'الفصل الثاني', 'الفصل الصيفي'].map(name => (
                  <TouchableOpacity
                    key={name}
                    style={[
                      styles.nameBtn,
                      semesterForm.name === name && styles.nameBtnActive
                    ]}
                    onPress={() => setSemesterForm(prev => ({ ...prev, name }))}
                  >
                    <Text style={[
                      styles.nameBtnText,
                      semesterForm.name === name && styles.nameBtnTextActive
                    ]}>
                      {name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.inputLabel}>السنة الدراسية *</Text>
              <TextInput
                style={styles.modalInput}
                value={semesterForm.academic_year}
                onChangeText={(text) => setSemesterForm(prev => ({ ...prev, academic_year: text }))}
                placeholder="مثال: 2024-2025"
                placeholderTextColor="#999"
              />

              <Text style={styles.inputLabel}>تاريخ البداية</Text>
              <TextInput
                style={styles.modalInput}
                value={semesterForm.start_date}
                onChangeText={(text) => setSemesterForm(prev => ({ ...prev, start_date: text }))}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#999"
              />

              <Text style={styles.inputLabel}>تاريخ النهاية</Text>
              <TextInput
                style={styles.modalInput}
                value={semesterForm.end_date}
                onChangeText={(text) => setSemesterForm(prev => ({ ...prev, end_date: text }))}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#999"
              />
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity 
                style={styles.modalCancelBtn}
                onPress={() => setShowSemesterModal(false)}
              >
                <Text style={styles.modalCancelBtnText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalSaveBtn, saving && styles.savingBtn]}
                onPress={handleSaveSemester}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalSaveBtnText}>
                    {semesterModalMode === 'add' ? 'إنشاء' : 'حفظ'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Loading overlay */}
      {saving && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#1565c0" />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
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
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 6,
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#1565c0',
  },
  tabText: {
    fontSize: 14,
    color: '#666',
  },
  tabTextActive: {
    color: '#1565c0',
    fontWeight: '600',
  },
  tabContent: {
    flex: 1,
    padding: 16,
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
  // Card styles
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    gap: 8,
  },
  cardSectionTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  settingsNote: {
    fontSize: 13,
    color: '#666',
    marginBottom: 16,
    paddingHorizontal: 4,
    fontStyle: 'italic',
  },
  // University styles
  universityIcon: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#e3f2fd',
    justifyContent: 'center',
    alignItems: 'center',
  },
  universityInfo: {
    flex: 1,
    marginLeft: 16,
  },
  universityName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  universityCode: {
    fontSize: 14,
    color: '#1565c0',
    marginTop: 4,
  },
  editIconBtn: {
    padding: 8,
  },
  universityDetails: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  detailText: {
    fontSize: 14,
    color: '#666',
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1565c0',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  // Form styles
  form: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#fafafa',
    textAlign: 'right',
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  // Button styles
  saveBtn: {
    backgroundColor: '#1565c0',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 20,
    flex: 1,
  },
  savingBtn: {
    opacity: 0.7,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  cancelBtnText: {
    color: '#666',
    fontSize: 16,
  },
  formButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  // Section styles
  section: {
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4caf50',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 4,
  },
  addBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  // Form card
  formCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  formTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  // Empty state
  emptyState: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    marginTop: 12,
  },
  emptySubText: {
    fontSize: 13,
    color: '#999',
    marginTop: 8,
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
  // Picker styles
  pickerContainer: {
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    overflow: 'hidden',
  },
  picker: {
    height: 50,
  },
  // Faculty card
  facultyCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  facultyIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#e8f5e9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  facultyInfo: {
    flex: 1,
    marginLeft: 12,
  },
  facultyName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  facultyCode: {
    fontSize: 14,
    color: '#4caf50',
    marginTop: 2,
  },
  facultyDepts: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editIconBtnSmall: {
    backgroundColor: '#e3f2fd',
  },
  deleteIconBtn: {
    backgroundColor: '#ffebee',
  },
  // Semester styles
  currentInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e3f2fd',
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  currentInfoText: {
    flex: 1,
  },
  currentLabel: {
    fontSize: 12,
    color: '#1565c0',
  },
  currentValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1565c0',
  },
  addSemesterBtn: {
    backgroundColor: '#1565c0',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  yearSection: {
    marginBottom: 20,
  },
  yearHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  yearTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1565c0',
  },
  semesterCard: {
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
  semesterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  semesterInfo: {
    flex: 1,
  },
  semesterName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 6,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  semesterStats: {
    alignItems: 'flex-end',
  },
  semesterStatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  semesterStatText: {
    fontSize: 12,
    color: '#666',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  dateText: {
    fontSize: 12,
    color: '#999',
  },
  semesterActions: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 12,
  },
  semesterActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  activateBtn: {
    backgroundColor: '#e8f5e9',
  },
  closeActionBtn: {
    backgroundColor: '#fff3e0',
  },
  archiveBtn: {
    backgroundColor: '#fafafa',
  },
  editSemesterBtn: {
    backgroundColor: '#e3f2fd',
  },
  deleteSemesterBtn: {
    backgroundColor: '#ffebee',
  },
  actionText: {
    fontSize: 12,
    fontWeight: '500',
  },
  // Settings styles
  optionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#f5f5f5',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  optionBtnActive: {
    backgroundColor: '#1565c0',
    borderColor: '#1565c0',
  },
  optionText: {
    fontSize: 14,
    color: '#666',
  },
  optionTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  colorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  colorOption: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  colorOptionActive: {
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  saveButton: {
    flexDirection: 'row',
    backgroundColor: '#4caf50',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    marginBottom: 32,
  },
  saveButtonDisabled: {
    backgroundColor: '#a5d6a7',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  previewSection: {
    padding: 24,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  previewTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  previewSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginBottom: 16,
  },
  previewBadge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  previewBadgeText: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
  },
  bigSaveBtn: {
    flexDirection: 'row',
    backgroundColor: '#4caf50',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  bigSaveBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
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
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  modalInput: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
    textAlign: 'right',
  },
  semesterNames: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  nameBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
  },
  nameBtnActive: {
    backgroundColor: '#1565c0',
  },
  nameBtnText: {
    fontSize: 14,
    color: '#666',
  },
  nameBtnTextActive: {
    color: '#fff',
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
  modalCancelBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
  },
  modalCancelBtnText: {
    fontSize: 14,
    color: '#666',
  },
  modalSaveBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#1565c0',
    minWidth: 100,
    alignItems: 'center',
  },
  modalSaveBtnText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
