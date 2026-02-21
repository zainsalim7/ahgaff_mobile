import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Pressable,
  Alert,
  TextInput,
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { coursesAPI, studentsAPI, enrollmentAPI, lecturesAPI, attendanceAPI, API_URL } from '../src/services/api';
import { LoadingScreen } from '../src/components/LoadingScreen';
import { useAuth, PERMISSIONS } from '../src/contexts/AuthContext';
import { useAuthStore } from '../src/store/authStore';

interface EnrolledStudent {
  enrollment_id: string;
  student_id: string;
  student_number: string;
  full_name: string;
  level: number;
  section: string;
  enrolled_at: string;
}

interface Student {
  id: string;
  student_id: string;
  full_name: string;
  level: number;
  section: string;
}

interface Lecture {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
}

interface AttendanceRecord {
  student_id: string;
  status: string;
}

interface StudentStats {
  student_id: string;
  present: number;
  absent: number;
  late: number;
  excused: number;
  total: number;
  rate: number;
}

export default function CourseStudentsScreen() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const router = useRouter();
  const { hasPermission, user: authUser, isLoading: authLoading } = useAuth();
  const user = useAuthStore((state) => state.user);
  
  // الطالب لا يمكنه الوصول لهذه الصفحة
  const isStudent = user?.role === 'student' || authUser?.role === 'student';
  
  // التحقق من صلاحية إدارة الطلاب
  const canManageStudents = !isStudent && (hasPermission(PERMISSIONS.MANAGE_STUDENTS) || user?.role === 'admin');
  
  // إعادة توجيه الطالب
  useEffect(() => {
    if (!authLoading && isStudent) {
      router.replace('/');
    }
  }, [isStudent, authLoading]);
  
  const [course, setCourse] = useState<any>(null);
  const [enrolledStudents, setEnrolledStudents] = useState<EnrolledStudent[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  
  // حالة عرض الحضور
  const [viewMode, setViewMode] = useState<'summary' | 'lecture'>('summary');
  const [selectedLecture, setSelectedLecture] = useState<Lecture | null>(null);
  const [lectureAttendance, setLectureAttendance] = useState<AttendanceRecord[]>([]);
  const [studentStats, setStudentStats] = useState<{ [key: string]: StudentStats }>({});
  const [canEditAttendance, setCanEditAttendance] = useState(false);

  const fetchData = useCallback(async () => {
    if (!courseId) return;
    
    try {
      const [courseRes, enrolledRes, studentsRes, lecturesRes] = await Promise.all([
        coursesAPI.getById(courseId),
        enrollmentAPI.getEnrolled(courseId),
        studentsAPI.getAll(),
        lecturesAPI.getByCourse(courseId),
      ]);
      
      setCourse(courseRes.data);
      setEnrolledStudents(enrolledRes.data);
      setAllStudents(studentsRes.data);
      setLectures(lecturesRes.data || []);
      
      // حساب إحصائيات الحضور لكل طالب
      await calculateStudentStats(enrolledRes.data, lecturesRes.data || []);
    } catch (error) {
      console.error('Error fetching data:', error);
      Alert.alert('خطأ', 'فشل في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  // حساب إحصائيات الحضور لكل طالب
  const calculateStudentStats = async (students: EnrolledStudent[], lecturesList: Lecture[]) => {
    const stats: { [key: string]: StudentStats } = {};
    
    // تهيئة الإحصائيات لكل طالب
    students.forEach(s => {
      stats[s.student_id] = {
        student_id: s.student_id,
        present: 0,
        absent: 0,
        late: 0,
        excused: 0,
        total: 0,
        rate: 0,
      };
    });
    
    // جلب سجلات الحضور لكل محاضرة
    for (const lecture of lecturesList) {
      if (lecture.status === 'completed') {
        try {
          const attendanceRes = await attendanceAPI.getByLecture(lecture.id);
          const records = attendanceRes.data || [];
          
          records.forEach((record: any) => {
            if (stats[record.student_id]) {
              stats[record.student_id].total++;
              switch (record.status) {
                case 'present':
                  stats[record.student_id].present++;
                  break;
                case 'absent':
                  stats[record.student_id].absent++;
                  break;
                case 'late':
                  stats[record.student_id].late++;
                  break;
                case 'excused':
                  stats[record.student_id].excused++;
                  break;
              }
            }
          });
        } catch (e) {
          console.log('Error fetching attendance for lecture:', lecture.id);
        }
      }
    }
    
    // حساب نسبة الحضور
    Object.keys(stats).forEach(studentId => {
      const s = stats[studentId];
      if (s.total > 0) {
        s.rate = Math.round(((s.present + s.late) / s.total) * 100);
      }
    });
    
    setStudentStats(stats);
  };

  // جلب حضور محاضرة معينة
  const fetchLectureAttendance = async (lecture: Lecture) => {
    try {
      const attendanceRes = await attendanceAPI.getByLecture(lecture.id);
      setLectureAttendance(attendanceRes.data || []);
      
      // التحقق من إمكانية التعديل
      const now = new Date();
      const lectureEnd = new Date(`${lecture.date}T${lecture.end_time}`);
      const lectureDuration = (lectureEnd.getTime() - new Date(`${lecture.date}T${lecture.start_time}`).getTime()) / 60000;
      const allowedEndTime = new Date(lectureEnd.getTime() + lectureDuration * 60000);
      
      // يمكن التعديل فقط إذا لم تنتهي المدة المسموحة ولم يكتمل التحضير
      const canEdit = now <= allowedEndTime && lecture.status !== 'completed';
      setCanEditAttendance(canEdit);
    } catch (error) {
      console.error('Error fetching lecture attendance:', error);
    }
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (selectedLecture) {
      fetchLectureAttendance(selectedLecture);
    }
  }, [selectedLecture]);

  const handleEnrollStudents = async () => {
    if (selectedStudents.length === 0) {
      Alert.alert('تنبيه', 'اختر طالب واحد على الأقل');
      return;
    }

    setSaving(true);
    try {
      await enrollmentAPI.enroll(courseId!, selectedStudents);
      Alert.alert('نجاح', `تم تسجيل ${selectedStudents.length} طالب`);
      setShowAddModal(false);
      setSelectedStudents([]);
      fetchData();
    } catch (error) {
      Alert.alert('خطأ', 'فشل في تسجيل الطلاب');
    } finally {
      setSaving(false);
    }
  };

  const handleUnenroll = async (studentId: string, studentName: string) => {
    const confirmMessage = Platform.OS === 'web' 
      ? `هل تريد إلغاء تسجيل ${studentName}؟`
      : '';
    
    if (Platform.OS === 'web') {
      if (!window.confirm(confirmMessage)) return;
      
      try {
        await enrollmentAPI.unenroll(courseId!, studentId);
        Alert.alert('نجاح', 'تم إلغاء التسجيل');
        fetchData();
      } catch (error) {
        Alert.alert('خطأ', 'فشل في إلغاء التسجيل');
      }
    } else {
      Alert.alert(
        'تأكيد',
        `هل تريد إلغاء تسجيل ${studentName}؟`,
        [
          { text: 'إلغاء', style: 'cancel' },
          {
            text: 'نعم',
            style: 'destructive',
            onPress: async () => {
              try {
                await enrollmentAPI.unenroll(courseId!, studentId);
                Alert.alert('نجاح', 'تم إلغاء التسجيل');
                fetchData();
              } catch (error) {
                Alert.alert('خطأ', 'فشل في إلغاء التسجيل');
              }
            },
          },
        ]
      );
    }
  };

  const handleImportExcel = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const file = result.assets[0];
      console.log('Selected file:', file.name);
      setImporting(true);

      const token = await AsyncStorage.getItem('token');
      const url = `${API_URL}/api/students/import/${courseId}`;
      console.log('Upload URL:', url);
      
      const formData = new FormData();
      
      if (Platform.OS === 'web') {
        // Web: fetch blob and append
        console.log('Web platform - fetching blob');
        const response = await fetch(file.uri);
        const blob = await response.blob();
        console.log('Blob size:', blob.size);
        formData.append('file', blob, file.name);
        
        const uploadResponse = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
          body: formData,
        });

        const data = await uploadResponse.json();
        console.log('Response:', data);

        if (uploadResponse.ok) {
          Alert.alert('نجاح ✅', `تم استيراد ${data.imported} طالب جديد\nتم تسجيل ${data.enrolled} طالب في المقرر`);
          fetchData();
        } else {
          Alert.alert('خطأ', data.detail || 'فشل في استيراد الملف');
        }
      } else {
        // Mobile
        formData.append('file', {
          uri: file.uri,
          type: file.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          name: file.name,
        } as any);

        const uploadResponse = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
          body: formData,
        });

        const data = await uploadResponse.json();
        console.log('Response:', data);

        if (uploadResponse.ok) {
          Alert.alert('نجاح ✅', `تم استيراد ${data.imported} طالب جديد\nتم تسجيل ${data.enrolled} طالب في المقرر`);
          fetchData();
        } else {
          Alert.alert('خطأ', data.detail || 'فشل في استيراد الملف');
        }
      }
    } catch (error) {
      console.error('Import error:', error);
      Alert.alert('خطأ', 'فشل في استيراد الملف');
    } finally {
      setImporting(false);
    }
  };

  const toggleStudentSelection = (studentId: string) => {
    setSelectedStudents(prev => 
      prev.includes(studentId) 
        ? prev.filter(id => id !== studentId)
        : [...prev, studentId]
    );
  };

  const getAttendanceStatus = (studentId: string): string => {
    const record = lectureAttendance.find(r => r.student_id === studentId);
    return record?.status || 'absent';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'present': return '#4caf50';
      case 'absent': return '#f44336';
      case 'late': return '#ff9800';
      case 'excused': return '#2196f3';
      default: return '#999';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'present': return 'حاضر';
      case 'absent': return 'غائب';
      case 'late': return 'متأخر';
      case 'excused': return 'معذور';
      default: return '-';
    }
  };

  const getRateColor = (rate: number) => {
    if (rate >= 75) return '#4caf50';
    if (rate >= 50) return '#ff9800';
    return '#f44336';
  };

  // فلترة الطلاب غير المسجلين
  const enrolledIds = enrolledStudents.map(s => s.student_id);
  const filteredStudents = allStudents.filter(s => {
    if (enrolledIds.includes(s.id)) return false;
    if (!searchText) return true;
    return s.full_name.includes(searchText) || s.student_id.includes(searchText);
  });

  if (loading) {
    return <LoadingScreen />;
  }

  const renderStudentWithSummary = ({ item }: { item: EnrolledStudent }) => {
    const stats = studentStats[item.student_id];
    
    return (
      <View style={styles.studentCard}>
        <View style={styles.studentMainInfo}>
          <Text style={styles.studentName}>{item.full_name}</Text>
          <Text style={styles.studentDetail}>{item.student_number} | م{item.level}</Text>
        </View>
        
        {stats && stats.total > 0 ? (
          <View style={styles.statsContainer}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: '#4caf50' }]}>{stats.present}</Text>
              <Text style={styles.statLabel}>حاضر</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: '#f44336' }]}>{stats.absent}</Text>
              <Text style={styles.statLabel}>غائب</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: '#ff9800' }]}>{stats.late}</Text>
              <Text style={styles.statLabel}>متأخر</Text>
            </View>
            <View style={[styles.rateBox, { backgroundColor: getRateColor(stats.rate) + '20' }]}>
              <Text style={[styles.rateText, { color: getRateColor(stats.rate) }]}>{stats.rate}%</Text>
            </View>
          </View>
        ) : (
          <Text style={styles.noStatsText}>لا يوجد حضور مسجل</Text>
        )}
        
        {canManageStudents && (
          <TouchableOpacity
            style={styles.removeBtn}
            onPress={() => handleUnenroll(item.student_id, item.full_name)}
          >
            <Ionicons name="close-circle" size={24} color="#f44336" />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderStudentWithLectureAttendance = ({ item }: { item: EnrolledStudent }) => {
    const status = getAttendanceStatus(item.student_id);
    
    return (
      <View style={styles.studentCard}>
        <View style={styles.studentMainInfo}>
          <Text style={styles.studentName}>{item.full_name}</Text>
          <Text style={styles.studentDetail}>{item.student_number}</Text>
        </View>
        
        <View style={[styles.attendanceStatusBadge, { backgroundColor: getStatusColor(status) + '20' }]}>
          <View style={[styles.statusDot, { backgroundColor: getStatusColor(status) }]} />
          <Text style={[styles.attendanceStatusText, { color: getStatusColor(status) }]}>
            {getStatusLabel(status)}
          </Text>
        </View>
      </View>
    );
  };

  const renderAvailableStudent = ({ item }: { item: Student }) => {
    const isSelected = selectedStudents.includes(item.id);
    return (
      <TouchableOpacity
        style={[styles.selectableCard, isSelected && styles.selectedCard]}
        onPress={() => toggleStudentSelection(item.id)}
      >
        <View style={styles.checkbox}>
          {isSelected && <Ionicons name="checkmark" size={18} color="#fff" />}
        </View>
        <View style={styles.studentInfo}>
          <Text style={styles.studentName}>{item.full_name}</Text>
          <Text style={styles.studentDetail}>{item.student_id} | م{item.level}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'طلاب المقرر',
          headerBackTitle: 'رجوع',
        }}
      />
      <SafeAreaView style={styles.container} edges={['bottom']}>
        {/* Course Info */}
        <View style={styles.courseInfo}>
          <Text style={styles.courseTitle}>{course?.name}</Text>
          <Text style={styles.courseCode}>{course?.code}</Text>
          <Text style={styles.studentCount}>
            {enrolledStudents.length} طالب مسجل
          </Text>
        </View>

        {/* View Mode Toggle */}
        <View style={styles.viewModeContainer}>
          <TouchableOpacity
            style={[styles.viewModeBtn, viewMode === 'summary' && styles.viewModeBtnActive]}
            onPress={() => {
              setViewMode('summary');
              setSelectedLecture(null);
            }}
          >
            <Ionicons name="stats-chart" size={18} color={viewMode === 'summary' ? '#fff' : '#1565c0'} />
            <Text style={[styles.viewModeBtnText, viewMode === 'summary' && styles.viewModeBtnTextActive]}>
              ملخص الحضور
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.viewModeBtn, viewMode === 'lecture' && styles.viewModeBtnActive]}
            onPress={() => setViewMode('lecture')}
          >
            <Ionicons name="calendar" size={18} color={viewMode === 'lecture' ? '#fff' : '#1565c0'} />
            <Text style={[styles.viewModeBtnText, viewMode === 'lecture' && styles.viewModeBtnTextActive]}>
              حسب المحاضرة
            </Text>
          </TouchableOpacity>
        </View>

        {/* Lecture Selector (when in lecture mode) */}
        {viewMode === 'lecture' && (
          <View style={styles.lectureSelector}>
            <Text style={styles.lectureSelectorLabel}>اختر المحاضرة:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.lectureScrollView}>
              {lectures.length === 0 ? (
                <Text style={styles.noLecturesText}>لا توجد محاضرات</Text>
              ) : (
                lectures.map(lecture => (
                  <TouchableOpacity
                    key={lecture.id}
                    style={[
                      styles.lectureChip,
                      selectedLecture?.id === lecture.id && styles.lectureChipActive
                    ]}
                    onPress={() => setSelectedLecture(lecture)}
                  >
                    <Text style={[
                      styles.lectureChipText,
                      selectedLecture?.id === lecture.id && styles.lectureChipTextActive
                    ]}>
                      {lecture.date}
                    </Text>
                    <Text style={[
                      styles.lectureChipTime,
                      selectedLecture?.id === lecture.id && styles.lectureChipTimeActive
                    ]}>
                      {lecture.start_time}
                    </Text>
                    {lecture.status === 'completed' && (
                      <View style={styles.completedBadge}>
                        <Ionicons name="checkmark-circle" size={12} color="#4caf50" />
                      </View>
                    )}
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
            
            {selectedLecture && !canEditAttendance && (
              <View style={styles.readOnlyBanner}>
                <Ionicons name="lock-closed" size={16} color="#666" />
                <Text style={styles.readOnlyText}>عرض فقط - انتهى وقت التعديل</Text>
              </View>
            )}
          </View>
        )}

        {/* Action Buttons - فقط إذا كان لديه صلاحية */}
        {canManageStudents && viewMode === 'summary' && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => setShowAddModal(true)}
            >
              <Ionicons name="person-add" size={20} color="#fff" />
              <Text style={styles.actionBtnText}>إضافة طلاب</Text>
            </TouchableOpacity>
            
            <Pressable
              style={({ pressed }) => [
                styles.actionBtn, 
                styles.importBtn, 
                importing && styles.importingBtn,
                pressed && { opacity: 0.7 }
              ]}
              onPress={() => {
                console.log('Import button pressed!');
                if (!importing) {
                  handleImportExcel();
                }
              }}
              disabled={importing}
            >
              {importing ? (
                <View style={styles.importingContainer}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.actionBtnText}>جاري الرفع...</Text>
                </View>
              ) : (
                <>
                  <Ionicons name="cloud-upload" size={20} color="#fff" />
                  <Text style={styles.actionBtnText}>استيراد Excel</Text>
                </>
              )}
            </Pressable>
          </View>
        )}

        {/* Students List */}
        {enrolledStudents.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={64} color="#ccc" />
            <Text style={styles.emptyText}>لا يوجد طلاب مسجلين</Text>
            {canManageStudents && (
              <Text style={styles.emptySubtext}>
                اضغط على "إضافة طلاب" أو "استيراد Excel"
              </Text>
            )}
          </View>
        ) : viewMode === 'lecture' && !selectedLecture ? (
          <View style={styles.emptyState}>
            <Ionicons name="calendar-outline" size={64} color="#ccc" />
            <Text style={styles.emptyText}>اختر محاضرة لعرض الحضور</Text>
          </View>
        ) : (
          <FlatList
            data={enrolledStudents}
            keyExtractor={(item) => item.enrollment_id}
            renderItem={viewMode === 'summary' ? renderStudentWithSummary : renderStudentWithLectureAttendance}
            contentContainerStyle={styles.listContent}
          />
        )}

        {/* Add Students Modal */}
        {canManageStudents && (
          <Modal
            visible={showAddModal}
            animationType="slide"
            presentationStyle="pageSheet"
          >
            <SafeAreaView style={styles.modalContainer}>
              <View style={styles.modalHeader}>
                <TouchableOpacity onPress={() => {
                  setShowAddModal(false);
                  setSelectedStudents([]);
                  setSearchText('');
                }}>
                  <Text style={styles.cancelText}>إلغاء</Text>
                </TouchableOpacity>
                <Text style={styles.modalTitle}>إضافة طلاب</Text>
                <TouchableOpacity onPress={handleEnrollStudents} disabled={saving}>
                  <Text style={[styles.saveText, saving && styles.disabledText]}>
                    {saving ? 'جاري...' : `إضافة (${selectedStudents.length})`}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.searchContainer}>
                <Ionicons name="search" size={20} color="#999" />
                <TextInput
                  style={styles.searchInput}
                  placeholder="بحث بالاسم أو الرقم..."
                  value={searchText}
                  onChangeText={setSearchText}
                />
              </View>

              {filteredStudents.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>لا توجد نتائج</Text>
                </View>
              ) : (
                <FlatList
                  data={filteredStudents}
                  keyExtractor={(item) => item.id}
                  renderItem={renderAvailableStudent}
                  contentContainerStyle={styles.listContent}
                />
              )}
            </SafeAreaView>
          </Modal>
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  courseInfo: {
    backgroundColor: '#1565c0',
    padding: 16,
  },
  courseTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  courseCode: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 4,
  },
  studentCount: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    marginTop: 8,
  },
  viewModeContainer: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
  },
  viewModeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#e3f2fd',
    gap: 6,
  },
  viewModeBtnActive: {
    backgroundColor: '#1565c0',
  },
  viewModeBtnText: {
    fontSize: 13,
    color: '#1565c0',
    fontWeight: '500',
  },
  viewModeBtnTextActive: {
    color: '#fff',
  },
  lectureSelector: {
    padding: 12,
    paddingTop: 0,
  },
  lectureSelectorLabel: {
    fontSize: 13,
    color: '#666',
    marginBottom: 8,
  },
  lectureScrollView: {
    flexDirection: 'row',
  },
  lectureChip: {
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    alignItems: 'center',
  },
  lectureChipActive: {
    backgroundColor: '#1565c0',
    borderColor: '#1565c0',
  },
  lectureChipText: {
    fontSize: 13,
    color: '#333',
    fontWeight: '500',
  },
  lectureChipTextActive: {
    color: '#fff',
  },
  lectureChipTime: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  lectureChipTimeActive: {
    color: 'rgba(255,255,255,0.8)',
  },
  completedBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#fff',
    borderRadius: 10,
  },
  noLecturesText: {
    color: '#999',
    fontSize: 14,
  },
  readOnlyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff3e0',
    padding: 10,
    borderRadius: 8,
    marginTop: 10,
    gap: 8,
  },
  readOnlyText: {
    fontSize: 13,
    color: '#666',
  },
  actions: {
    flexDirection: 'row',
    padding: 12,
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1565c0',
    padding: 12,
    borderRadius: 8,
    gap: 6,
  },
  importBtn: {
    backgroundColor: '#4caf50',
  },
  importingBtn: {
    opacity: 0.7,
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  importingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  listContent: {
    padding: 12,
  },
  studentCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  studentMainInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  studentDetail: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  statsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  statLabel: {
    fontSize: 10,
    color: '#999',
  },
  rateBox: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  rateText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  noStatsText: {
    fontSize: 12,
    color: '#999',
  },
  attendanceStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  attendanceStatusText: {
    fontSize: 13,
    fontWeight: '500',
  },
  removeBtn: {
    padding: 4,
    marginLeft: 8,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#bbb',
    marginTop: 8,
    textAlign: 'center',
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
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  cancelText: {
    fontSize: 16,
    color: '#f44336',
  },
  saveText: {
    fontSize: 16,
    color: '#1565c0',
    fontWeight: '600',
  },
  disabledText: {
    color: '#ccc',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    margin: 12,
    padding: 10,
    borderRadius: 8,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    textAlign: 'right',
  },
  selectableCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 10,
    marginBottom: 8,
  },
  selectedCard: {
    backgroundColor: '#e3f2fd',
    borderColor: '#1565c0',
    borderWidth: 1,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#1565c0',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1565c0',
    marginLeft: 12,
  },
  studentInfo: {
    flex: 1,
  },
});
