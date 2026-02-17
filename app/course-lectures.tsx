import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  TextInput,
  ActivityIndicator,
  Modal,
  ScrollView,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { coursesAPI, lecturesAPI, settingsAPI } from '../src/services/api';
import { LoadingScreen } from '../src/components/LoadingScreen';
import AddLectureModal, { LectureFormData } from '../src/components/AddLectureModal';
import { useAuth, PERMISSIONS } from '../src/contexts/AuthContext';

interface Lecture {
  id: string;
  course_id: string;
  date: string;
  start_time: string;
  end_time: string;
  room: string;
  status: string;
  notes: string;
}

const DAYS = [
  { id: 'saturday', name: 'السبت', num: 6 },
  { id: 'sunday', name: 'الأحد', num: 0 },
  { id: 'monday', name: 'الإثنين', num: 1 },
  { id: 'tuesday', name: 'الثلاثاء', num: 2 },
  { id: 'wednesday', name: 'الأربعاء', num: 3 },
  { id: 'thursday', name: 'الخميس', num: 4 },
];

const TIME_SLOTS = [
  '07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00', '10:30',
  '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30',
  '19:00', '19:30', '20:00',
];

const STATUS_LABELS: { [key: string]: { label: string; color: string } } = {
  scheduled: { label: 'مجدولة', color: '#2196f3' },
  completed: { label: 'منعقدة', color: '#4caf50' },
  cancelled: { label: 'ملغاة', color: '#f44336' },
};

interface DayScheduleConfig {
  day: string;
  enabled: boolean;
  slots: { start_time: string; end_time: string }[];
}

export default function CourseLecturesScreen() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const router = useRouter();
  
  // صلاحيات
  const { hasPermission, user, isLoading: authLoading } = useAuth();
  // فقط المدير ومن لديه صلاحية manage_lectures يمكنهم إدارة المحاضرات
  // المدرس لا يستطيع إضافة أو توليد محاضرات - فقط عرض وتسجيل حضور
  const canManageLectures = hasPermission(PERMISSIONS.MANAGE_LECTURES) || user?.role === 'admin';
  
  const [course, setCourse] = useState<any>(null);
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  
  // إعدادات الفصل
  const [semesterSettings, setSemesterSettings] = useState<{
    start: string | null;
    end: string | null;
    current: string;
  } | null>(null);
  
  // توليد المحاضرات
  const [generateRoom, setGenerateRoom] = useState('');
  const [generating, setGenerating] = useState(false);
  const [dayConfigs, setDayConfigs] = useState<DayScheduleConfig[]>(
    DAYS.map(d => ({
      day: d.id,
      enabled: false,
      slots: [{ start_time: '08:00', end_time: '09:30' }],
    }))
  );

  const fetchData = useCallback(async () => {
    if (!courseId) return;
    
    try {
      const [courseRes, lecturesRes, settingsRes] = await Promise.all([
        coursesAPI.getById(courseId),
        lecturesAPI.getByCourse(courseId),
        settingsAPI.get(),
      ]);
      
      setCourse(courseRes.data);
      setLectures(lecturesRes.data);
      setSemesterSettings({
        start: settingsRes.data.semester_start_date,
        end: settingsRes.data.semester_end_date,
        current: settingsRes.data.current_semester || 'الفصل الحالي',
      });
    } catch (error) {
      console.error('Error fetching data:', error);
      Alert.alert('خطأ', 'فشل في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // حفظ محاضرة جديدة باستخدام المكون الموحد
  const handleSaveLecture = async (data: LectureFormData) => {
    try {
      await lecturesAPI.create(courseId!, {
        date: data.date,
        start_time: data.start_time,
        end_time: data.end_time,
        room: data.room,
        notes: data.notes || '',
      });
      Alert.alert('نجاح', 'تم إضافة المحاضرة');
      fetchData();
    } catch (error: any) {
      const message = error.response?.data?.detail || 'حدث خطأ';
      Alert.alert('خطأ', message);
      throw error;
    }
  };

  // التحقق من إعدادات الفصل قبل التوليد
  const openGenerateModal = () => {
    if (!semesterSettings?.start || !semesterSettings?.end) {
      Alert.alert(
        'إعدادات الفصل غير مكتملة',
        'يجب إعداد تاريخ بداية ونهاية الفصل الدراسي أولاً.\n\nهل تريد الذهاب لصفحة الإعدادات؟',
        [
          { text: 'إلغاء', style: 'cancel' },
          {
            text: 'الذهاب للإعدادات',
            onPress: () => router.push('/settings'),
          },
        ]
      );
      return;
    }
    
    setGenerateRoom('');
    setDayConfigs(DAYS.map(d => ({
      day: d.id,
      enabled: false,
      slots: [{ start_time: '08:00', end_time: '09:30' }],
    })));
    setShowGenerateModal(true);
  };

  // تفعيل/تعطيل يوم
  const toggleDay = (dayId: string) => {
    setDayConfigs(prev => prev.map(config =>
      config.day === dayId ? { ...config, enabled: !config.enabled } : config
    ));
  };

  // تحديث وقت محاضرة
  const updateSlotTime = (dayId: string, slotIndex: number, field: 'start_time' | 'end_time', value: string) => {
    setDayConfigs(prev => prev.map(config => {
      if (config.day === dayId) {
        const newSlots = [...config.slots];
        newSlots[slotIndex] = { ...newSlots[slotIndex], [field]: value };
        return { ...config, slots: newSlots };
      }
      return config;
    }));
  };

  // إضافة محاضرة لليوم
  const addSlotToDay = (dayId: string) => {
    setDayConfigs(prev => prev.map(config => {
      if (config.day === dayId) {
        const lastSlot = config.slots[config.slots.length - 1];
        const lastEnd = lastSlot.end_time;
        const [hours, mins] = lastEnd.split(':').map(Number);
        const newStart = `${String(Math.min(hours + 1, 20)).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
        const newEnd = `${String(Math.min(hours + 2, 21)).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
        return {
          ...config,
          slots: [...config.slots, { start_time: newStart, end_time: newEnd }],
        };
      }
      return config;
    }));
  };

  // حذف محاضرة من اليوم
  const removeSlotFromDay = (dayId: string, slotIndex: number) => {
    setDayConfigs(prev => prev.map(config => {
      if (config.day === dayId && config.slots.length > 1) {
        return {
          ...config,
          slots: config.slots.filter((_, i) => i !== slotIndex),
        };
      }
      return config;
    }));
  };

  // توليد المحاضرات
  const handleGenerateLectures = async () => {
    if (!generateRoom.trim()) {
      Alert.alert('خطأ', 'الرجاء إدخال رقم القاعة');
      return;
    }

    const enabledDays = dayConfigs.filter(d => d.enabled);
    if (enabledDays.length === 0) {
      Alert.alert('خطأ', 'الرجاء اختيار يوم واحد على الأقل');
      return;
    }

    const scheduleConfig = enabledDays.map(d => ({
      day: d.day,
      slots: d.slots,
    }));

    setGenerating(true);
    try {
      const response = await lecturesAPI.generateBulk({
        course_id: courseId!,
        room: generateRoom.trim(),
        schedule: scheduleConfig,
        start_date: semesterSettings?.start,
        end_date: semesterSettings?.end,
      });

      const count = response.data.lectures_created || 0;
      Alert.alert(
        'نجاح! 🎉',
        `تم توليد ${count} محاضرة للفصل الدراسي`,
        [{ text: 'حسناً', onPress: () => setShowGenerateModal(false) }]
      );
      fetchData();
    } catch (error: any) {
      const message = error.response?.data?.detail || 'فشل في توليد المحاضرات';
      Alert.alert('خطأ', message);
    } finally {
      setGenerating(false);
    }
  };

  const handleDeleteLecture = async (lectureId: string) => {
    Alert.alert(
      'تأكيد',
      'هل تريد حذف هذه المحاضرة؟',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'حذف',
          style: 'destructive',
          onPress: async () => {
            try {
              await lecturesAPI.delete(lectureId);
              Alert.alert('نجاح', 'تم حذف المحاضرة');
              fetchData();
            } catch (error: any) {
              Alert.alert('خطأ', 'فشل في حذف المحاضرة');
            }
          }
        }
      ]
    );
  };

  const handleCancelLecture = async (lectureId: string) => {
    try {
      await lecturesAPI.update(lectureId, { status: 'cancelled' });
      Alert.alert('نجاح', 'تم إلغاء المحاضرة');
      fetchData();
    } catch (error: any) {
      Alert.alert('خطأ', 'فشل في إلغاء المحاضرة');
    }
  };

  const renderLecture = ({ item }: { item: Lecture }) => {
    const statusInfo = STATUS_LABELS[item.status] || STATUS_LABELS.scheduled;
    
    return (
      <TouchableOpacity
        style={styles.lectureCard}
        onPress={() => router.push({ pathname: '/take-attendance', params: { lectureId: item.id } })}
      >
        <View style={styles.lectureHeader}>
          <Text style={styles.lectureDate}>{item.date}</Text>
          <View style={[styles.statusBadge, { backgroundColor: statusInfo.color }]}>
            <Text style={styles.statusText}>{statusInfo.label}</Text>
          </View>
        </View>
        
        <View style={styles.lectureDetails}>
          <View style={styles.detailRow}>
            <Ionicons name="time-outline" size={16} color="#666" />
            <Text style={styles.detailText}>{item.start_time} - {item.end_time}</Text>
          </View>
          {item.room && (
            <View style={styles.detailRow}>
              <Ionicons name="location-outline" size={16} color="#666" />
              <Text style={styles.detailText}>{item.room}</Text>
            </View>
          )}
        </View>
        
        <View style={styles.lectureActions}>
          {item.status === 'scheduled' && (
            <>
              <TouchableOpacity
                style={styles.attendanceBtn}
                onPress={() => router.push({ pathname: '/take-attendance', params: { lectureId: item.id } })}
              >
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
                <Text style={styles.attendanceBtnText}>تسجيل الحضور</Text>
              </TouchableOpacity>
              {canManageLectures && (
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => handleCancelLecture(item.id)}
                >
                  <Ionicons name="close-circle" size={20} color="#f44336" />
                </TouchableOpacity>
              )}
            </>
          )}
          {item.status === 'completed' && (
            <TouchableOpacity
              style={[styles.attendanceBtn, { backgroundColor: '#4caf50' }]}
              onPress={() => router.push({ pathname: '/take-attendance', params: { lectureId: item.id } })}
            >
              <Ionicons name="eye" size={20} color="#fff" />
              <Text style={styles.attendanceBtnText}>عرض الحضور</Text>
            </TouchableOpacity>
          )}
          {canManageLectures && (
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => handleDeleteLecture(item.id)}
            >
              <Ionicons name="trash" size={20} color="#f44336" />
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'محاضرات المقرر',
          headerBackTitle: 'رجوع',
        }}
      />
      <SafeAreaView style={styles.container} edges={['bottom']}>
        {/* Course Info */}
        <View style={styles.courseInfo}>
          <Text style={styles.courseName}>{course?.name}</Text>
          <Text style={styles.courseCode}>{course?.code}</Text>
          <Text style={styles.lectureCount}>
            عدد المحاضرات: {lectures.length}
          </Text>
        </View>

        {/* Semester Info */}
        {semesterSettings?.start && semesterSettings?.end ? (
          <View style={styles.semesterInfo}>
            <Ionicons name="calendar" size={18} color="#4caf50" />
            <Text style={styles.semesterInfoText}>
              {semesterSettings.current}: {semesterSettings.start} إلى {semesterSettings.end}
            </Text>
          </View>
        ) : (
          <TouchableOpacity 
            style={styles.semesterWarning}
            onPress={() => router.push('/settings')}
          >
            <Ionicons name="warning" size={20} color="#ff9800" />
            <Text style={styles.semesterWarningText}>
              اضغط لإعداد تواريخ الفصل الدراسي
            </Text>
          </TouchableOpacity>
        )}

        {/* Action Buttons - Only for authorized users */}
        {canManageLectures && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => setShowAddModal(true)}
            >
              <Ionicons name="add" size={20} color="#fff" />
              <Text style={styles.actionBtnText}>إضافة محاضرة</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.actionBtn, styles.generateBtnStyle]}
              onPress={openGenerateModal}
            >
              <Ionicons name="flash" size={20} color="#fff" />
              <Text style={styles.actionBtnText}>توليد الفصل</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Lectures List */}
        {lectures.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="calendar-outline" size={64} color="#ccc" />
            <Text style={styles.emptyText}>لا توجد محاضرات</Text>
            <Text style={styles.emptySubtext}>
              اضغط على "توليد الفصل" لإنشاء محاضرات الفصل الدراسي
            </Text>
          </View>
        ) : (
          <FlatList
            data={lectures}
            keyExtractor={(item) => item.id}
            renderItem={renderLecture}
            contentContainerStyle={styles.listContent}
          />
        )}

        {/* Add Lecture Modal - Using the new unified component */}
        <AddLectureModal
          visible={showAddModal}
          onClose={() => setShowAddModal(false)}
          onSave={handleSaveLecture}
          selectedCourseId={courseId}
          showCourseSelector={false}
          title="إضافة محاضرة"
        />

        {/* Generate Semester Lectures Modal */}
        <Modal
          visible={showGenerateModal}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowGenerateModal(false)}
        >
          <SafeAreaView style={styles.generateModalContainer}>
            <View style={styles.generateModalHeader}>
              <TouchableOpacity onPress={() => setShowGenerateModal(false)}>
                <Ionicons name="close" size={28} color="#333" />
              </TouchableOpacity>
              <Text style={styles.generateModalTitle}>توليد محاضرات الفصل</Text>
              <View style={{ width: 28 }} />
            </View>

            <ScrollView style={styles.generateModalContent}>
              {/* Semester Info */}
              <View style={styles.generateSection}>
                <View style={styles.generateSectionHeader}>
                  <Ionicons name="calendar" size={20} color="#4caf50" />
                  <Text style={styles.generateSectionTitle}>فترة الفصل الدراسي</Text>
                </View>
                <View style={styles.semesterDatesBox}>
                  <View style={styles.semesterDateItem}>
                    <Text style={styles.semesterDateLabel}>البداية</Text>
                    <Text style={styles.semesterDateValue}>{semesterSettings?.start}</Text>
                  </View>
                  <Ionicons name="arrow-forward" size={20} color="#999" />
                  <View style={styles.semesterDateItem}>
                    <Text style={styles.semesterDateLabel}>النهاية</Text>
                    <Text style={styles.semesterDateValue}>{semesterSettings?.end}</Text>
                  </View>
                </View>
              </View>

              {/* Course Info */}
              <View style={styles.generateSection}>
                <View style={styles.generateSectionHeader}>
                  <Ionicons name="book" size={20} color="#ff9800" />
                  <Text style={styles.generateSectionTitle}>المقرر</Text>
                </View>
                <View style={styles.courseInfoBox}>
                  <Text style={styles.courseInfoName}>{course?.name}</Text>
                  <Text style={styles.courseInfoCode}>{course?.code}</Text>
                </View>
              </View>

              {/* Room */}
              <View style={styles.generateSection}>
                <View style={styles.generateSectionHeader}>
                  <Ionicons name="location" size={20} color="#9c27b0" />
                  <Text style={styles.generateSectionTitle}>القاعة</Text>
                </View>
                <TextInput
                  style={styles.roomInput}
                  value={generateRoom}
                  onChangeText={setGenerateRoom}
                  placeholder="أدخل رقم القاعة"
                  placeholderTextColor="#999"
                />
              </View>

              {/* Select Days */}
              <View style={styles.generateSection}>
                <View style={styles.generateSectionHeader}>
                  <Ionicons name="today" size={20} color="#1565c0" />
                  <Text style={styles.generateSectionTitle}>أيام المحاضرات وأوقاتها</Text>
                </View>
                <Text style={styles.generateHint}>
                  اختر الأيام وحدد أوقات المحاضرات لكل يوم
                </Text>

                {DAYS.map(day => {
                  const config = dayConfigs.find(d => d.day === day.id)!;
                  return (
                    <View key={day.id} style={styles.dayConfigCard}>
                      <View style={styles.dayConfigHeader}>
                        <View style={styles.dayConfigLeft}>
                          <Switch
                            value={config.enabled}
                            onValueChange={() => toggleDay(day.id)}
                            trackColor={{ false: '#e0e0e0', true: '#bbdefb' }}
                            thumbColor={config.enabled ? '#1565c0' : '#f4f3f4'}
                          />
                          <Text style={[
                            styles.dayConfigName,
                            config.enabled && styles.dayConfigNameActive
                          ]}>{day.name}</Text>
                        </View>
                        {config.enabled && (
                          <TouchableOpacity
                            style={styles.addSlotBtn}
                            onPress={() => addSlotToDay(day.id)}
                          >
                            <Ionicons name="add-circle" size={24} color="#4caf50" />
                          </TouchableOpacity>
                        )}
                      </View>

                      {config.enabled && (
                        <View style={styles.slotsContainer}>
                          {config.slots.map((slot, index) => (
                            <View key={index} style={styles.slotRow}>
                              <Text style={styles.slotLabel}>محاضرة {index + 1}</Text>
                              <View style={styles.slotTimes}>
                                <View style={styles.slotTimeBox}>
                                  <Text style={styles.slotTimeLabel}>من</Text>
                                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                    {TIME_SLOTS.slice(0, 20).map(time => (
                                      <TouchableOpacity
                                        key={time}
                                        style={[
                                          styles.slotTimeBtn,
                                          slot.start_time === time && styles.slotTimeBtnActive
                                        ]}
                                        onPress={() => updateSlotTime(day.id, index, 'start_time', time)}
                                      >
                                        <Text style={[
                                          styles.slotTimeBtnText,
                                          slot.start_time === time && styles.slotTimeBtnTextActive
                                        ]}>{time}</Text>
                                      </TouchableOpacity>
                                    ))}
                                  </ScrollView>
                                </View>
                                <View style={styles.slotTimeBox}>
                                  <Text style={styles.slotTimeLabel}>إلى</Text>
                                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                    {TIME_SLOTS.slice(0, 20).map(time => (
                                      <TouchableOpacity
                                        key={time}
                                        style={[
                                          styles.slotTimeBtn,
                                          slot.end_time === time && styles.slotTimeBtnActive
                                        ]}
                                        onPress={() => updateSlotTime(day.id, index, 'end_time', time)}
                                      >
                                        <Text style={[
                                          styles.slotTimeBtnText,
                                          slot.end_time === time && styles.slotTimeBtnTextActive
                                        ]}>{time}</Text>
                                      </TouchableOpacity>
                                    ))}
                                  </ScrollView>
                                </View>
                              </View>
                              {config.slots.length > 1 && (
                                <TouchableOpacity
                                  style={styles.removeSlotBtn}
                                  onPress={() => removeSlotFromDay(day.id, index)}
                                >
                                  <Ionicons name="trash" size={18} color="#f44336" />
                                </TouchableOpacity>
                              )}
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            </ScrollView>

            {/* Generate Button */}
            <View style={styles.generateModalFooter}>
              <TouchableOpacity
                style={[styles.generateButton, generating && styles.generateButtonDisabled]}
                onPress={handleGenerateLectures}
                disabled={generating}
              >
                {generating ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="flash" size={22} color="#fff" />
                    <Text style={styles.generateButtonText}>توليد المحاضرات</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </Modal>
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
    padding: 20,
    alignItems: 'center',
  },
  courseName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  courseCode: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginBottom: 8,
  },
  lectureCount: {
    fontSize: 16,
    color: '#fff',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  semesterInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8f5e9',
    margin: 16,
    marginBottom: 0,
    padding: 12,
    borderRadius: 8,
    gap: 8,
  },
  semesterInfoText: {
    fontSize: 13,
    color: '#2e7d32',
    flex: 1,
  },
  semesterWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff3e0',
    margin: 16,
    marginBottom: 0,
    padding: 12,
    borderRadius: 8,
    gap: 8,
  },
  semesterWarningText: {
    fontSize: 13,
    color: '#e65100',
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4caf50',
    padding: 14,
    borderRadius: 10,
    gap: 8,
  },
  generateBtnStyle: {
    backgroundColor: '#9c27b0',
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
    paddingTop: 0,
  },
  lectureCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  lectureHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  lectureDate: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  lectureDetails: {
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  detailText: {
    fontSize: 14,
    color: '#666',
  },
  lectureActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 12,
  },
  attendanceBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1565c0',
    padding: 10,
    borderRadius: 8,
    gap: 6,
  },
  attendanceBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  cancelBtn: {
    padding: 8,
  },
  deleteBtn: {
    padding: 8,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 18,
    color: '#999',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#bbb',
    marginTop: 8,
    textAlign: 'center',
  },
  // Generate Modal Styles
  generateModalContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  generateModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  generateModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  generateModalContent: {
    flex: 1,
  },
  generateSection: {
    backgroundColor: '#fff',
    margin: 16,
    marginBottom: 0,
    padding: 16,
    borderRadius: 12,
  },
  generateSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  generateSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  generateHint: {
    fontSize: 13,
    color: '#666',
    marginBottom: 12,
  },
  semesterDatesBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  semesterDateItem: {
    alignItems: 'center',
  },
  semesterDateLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  semesterDateValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  courseInfoBox: {
    backgroundColor: '#f5f5f5',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  courseInfoName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  courseInfoCode: {
    fontSize: 14,
    color: '#666',
  },
  roomInput: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 14,
    fontSize: 15,
    textAlign: 'right',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  dayConfigCard: {
    backgroundColor: '#f9f9f9',
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
  },
  dayConfigHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    backgroundColor: '#fff',
  },
  dayConfigLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dayConfigName: {
    fontSize: 15,
    color: '#666',
  },
  dayConfigNameActive: {
    color: '#1565c0',
    fontWeight: '600',
  },
  addSlotBtn: {
    padding: 4,
  },
  slotsContainer: {
    padding: 12,
    paddingTop: 0,
  },
  slotRow: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  slotLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1565c0',
    marginBottom: 8,
  },
  slotTimes: {
    gap: 8,
  },
  slotTimeBox: {
    marginBottom: 8,
  },
  slotTimeLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 6,
  },
  slotTimeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#f5f5f5',
    borderRadius: 6,
    marginRight: 6,
  },
  slotTimeBtnActive: {
    backgroundColor: '#1565c0',
  },
  slotTimeBtnText: {
    fontSize: 13,
    color: '#666',
  },
  slotTimeBtnTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  removeSlotBtn: {
    alignSelf: 'flex-end',
    padding: 8,
    backgroundColor: '#ffebee',
    borderRadius: 8,
    marginTop: 8,
  },
  generateModalFooter: {
    padding: 16,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  generateButton: {
    flexDirection: 'row',
    backgroundColor: '#4caf50',
    paddingVertical: 16,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  generateButtonDisabled: {
    backgroundColor: '#bdbdbd',
  },
  generateButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
});
