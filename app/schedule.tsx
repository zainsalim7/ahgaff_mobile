import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  Modal,
  FlatList,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { coursesAPI, departmentsAPI, settingsAPI, lecturesAPI } from '../src/services/api';
import { useAuthStore } from '../src/store/authStore';
import { LoadingScreen } from '../src/components/LoadingScreen';
import { Course, Department } from '../src/types';
import api from '../src/services/api';
import AddLectureModal, { LectureFormData } from '../src/components/AddLectureModal';

const DAYS = [
  { id: 'saturday', name: 'السبت', short: 'س', num: 6 },
  { id: 'sunday', name: 'الأحد', short: 'ح', num: 0 },
  { id: 'monday', name: 'الإثنين', short: 'ن', num: 1 },
  { id: 'tuesday', name: 'الثلاثاء', short: 'ث', num: 2 },
  { id: 'wednesday', name: 'الأربعاء', short: 'ر', num: 3 },
  { id: 'thursday', name: 'الخميس', short: 'خ', num: 4 },
];

const TIME_SLOTS = [
  '07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00', '10:30',
  '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30',
  '19:00', '19:30', '20:00',
];

interface DayScheduleConfig {
  day: string;
  enabled: boolean;
  slots: { start_time: string; end_time: string }[];
}

interface SemesterSettings {
  semester_start_date: string | null;
  semester_end_date: string | null;
  current_semester: string;
}

export default function ScheduleScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [lectures, setLectures] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState('saturday');
  
  // إضافة محاضرة جديدة
  const [showAddModal, setShowAddModal] = useState(false);
  
  // توليد المحاضرات
  const [generateModalVisible, setGenerateModalVisible] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [semesterSettings, setSemesterSettings] = useState<SemesterSettings | null>(null);
  const [selectedCourseForGenerate, setSelectedCourseForGenerate] = useState<string>('');
  const [generateRoom, setGenerateRoom] = useState<string>('');
  
  // تكوين الأيام للتوليد
  const [dayConfigs, setDayConfigs] = useState<DayScheduleConfig[]>(
    DAYS.map(d => ({
      day: d.id,
      enabled: false,
      slots: [{ start_time: '08:00', end_time: '09:00' }],
    }))
  );

  // محاضرات اليوم الحالي
  const [todayLectures, setTodayLectures] = useState<any[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const [coursesRes, deptsRes, settingsRes] = await Promise.all([
        coursesAPI.getAll(),
        departmentsAPI.getAll(),
        settingsAPI.get(),
      ]);
      setCourses(coursesRes.data);
      setDepartments(deptsRes.data);
      setSemesterSettings({
        semester_start_date: settingsRes.data.semester_start_date,
        semester_end_date: settingsRes.data.semester_end_date,
        current_semester: settingsRes.data.current_semester,
      });
      
      // جلب محاضرات اليوم الحالي (للمعلم تظهر مقرراته فقط)
      try {
        const todayRes = await lecturesAPI.getToday();
        setTodayLectures(todayRes.data || []);
      } catch (e) {
        console.log('Error fetching today lectures:', e);
      }
      
      // جلب المحاضرات لجميع المقررات (للعرض في الجدول الأسبوعي)
      const allLectures: any[] = [];
      for (const course of coursesRes.data) {
        try {
          const lectRes = await lecturesAPI.getByCourse(course.id);
          allLectures.push(...lectRes.data.map((l: any) => ({ ...l, course })));
        } catch (e) {}
      }
      setLectures(allLectures);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getCourseName = (courseId: string) => {
    const course = courses.find(c => c.id === courseId);
    return course?.name || 'غير محدد';
  };

  // الحصول على محاضرات اليوم المحدد
  const getDayLectures = () => {
    const day = DAYS.find(d => d.id === selectedDay);
    if (!day) return [];
    
    return lectures
      .filter(lecture => {
        const date = new Date(lecture.date);
        return date.getDay() === day.num;
      })
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  };

  // عدد المحاضرات لكل يوم
  const getDayLectureCount = (dayId: string) => {
    const day = DAYS.find(d => d.id === dayId);
    if (!day) return 0;
    
    return lectures.filter(lecture => {
      const date = new Date(lecture.date);
      return date.getDay() === day.num;
    }).length;
  };

  // حفظ المحاضرة الجديدة
  const handleSaveLecture = async (data: LectureFormData) => {
    if (!data.course_id) {
      Alert.alert('خطأ', 'الرجاء اختيار المقرر');
      throw new Error('Missing course_id');
    }
    
    try {
      await lecturesAPI.create(data.course_id, {
        date: data.date,
        start_time: data.start_time,
        end_time: data.end_time,
        room: data.room,
        notes: data.notes || '',
      });
      Alert.alert('نجاح', 'تم إضافة المحاضرة بنجاح');
      fetchData();
    } catch (error: any) {
      const message = error.response?.data?.detail || 'فشل في إضافة المحاضرة';
      Alert.alert('خطأ', message);
      throw error;
    }
  };

  const handleDeleteLecture = (lectureId: string) => {
    Alert.alert(
      'حذف المحاضرة',
      'هل أنت متأكد من حذف هذه المحاضرة؟',
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
            } catch (error) {
              Alert.alert('خطأ', 'فشل في حذف المحاضرة');
            }
          },
        },
      ]
    );
  };

  // التحقق من إعدادات الفصل
  const checkSemesterSettings = () => {
    if (!semesterSettings?.semester_start_date || !semesterSettings?.semester_end_date) {
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
      return false;
    }
    return true;
  };

  // فتح نافذة توليد المحاضرات
  const openGenerateModal = () => {
    if (!checkSemesterSettings()) return;
    
    setSelectedCourseForGenerate(courses[0]?.id || '');
    setGenerateRoom('');
    setDayConfigs(DAYS.map(d => ({
      day: d.id,
      enabled: false,
      slots: [{ start_time: '08:00', end_time: '09:00' }],
    })));
    setGenerateModalVisible(true);
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
        const newStart = `${String(hours + 1).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
        const newEnd = `${String(hours + 2).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
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
    if (!selectedCourseForGenerate) {
      Alert.alert('خطأ', 'الرجاء اختيار المقرر');
      return;
    }

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
      const response = await api.post('/lectures/generate-semester', {
        course_id: selectedCourseForGenerate,
        room: generateRoom.trim(),
        schedule: scheduleConfig,
        start_date: semesterSettings?.semester_start_date,
        end_date: semesterSettings?.semester_end_date,
      });

      const count = response.data.lectures_created || 0;
      Alert.alert(
        'نجاح! 🎉',
        `تم توليد ${count} محاضرة للفصل الدراسي`,
        [{ text: 'حسناً', onPress: () => setGenerateModalVisible(false) }]
      );
      fetchData();
    } catch (error: any) {
      const message = error.response?.data?.detail || 'فشل في توليد المحاضرات';
      Alert.alert('خطأ', message);
    } finally {
      setGenerating(false);
    }
  };

  const renderLectureItem = ({ item }: { item: any }) => {
    const course = item.course;
    
    return (
      <TouchableOpacity
        style={styles.lectureCard}
        onPress={() => router.push({
          pathname: '/take-attendance',
          params: { lectureId: item.id, courseId: item.course_id, courseName: course?.name }
        })}
      >
        <View style={styles.timeColumn}>
          <Text style={styles.timeText}>{item.start_time}</Text>
          <View style={styles.timeLine} />
          <Text style={styles.timeText}>{item.end_time}</Text>
        </View>
        <View style={styles.lectureInfo}>
          <Text style={styles.courseName}>{course?.name || getCourseName(item.course_id)}</Text>
          <View style={styles.detailRow}>
            <Ionicons name="calendar" size={14} color="#666" />
            <Text style={styles.detailText}>{item.date}</Text>
          </View>
          <View style={styles.detailRow}>
            <Ionicons name="location" size={14} color="#666" />
            <Text style={styles.detailText}>القاعة: {item.room || 'غير محدد'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Ionicons name="people" size={14} color="#666" />
            <Text style={styles.detailText}>
              م{course?.level || '-'} - شعبة {course?.section || '-'}
            </Text>
          </View>
        </View>
        <View style={styles.actionColumn}>
          {user?.role === 'admin' && (
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => handleDeleteLecture(item.id)}
            >
              <Ionicons name="trash" size={18} color="#f44336" />
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // عرض إعدادات الفصل
  const renderSemesterInfo = () => {
    if (!semesterSettings?.semester_start_date || !semesterSettings?.semester_end_date) {
      return (
        <TouchableOpacity 
          style={styles.semesterWarning}
          onPress={() => router.push('/settings')}
        >
          <Ionicons name="warning" size={24} color="#ff9800" />
          <View style={{ flex: 1, marginHorizontal: 12 }}>
            <Text style={styles.semesterWarningTitle}>إعدادات الفصل غير مكتملة</Text>
            <Text style={styles.semesterWarningText}>
              اضغط هنا لإعداد تواريخ الفصل الدراسي
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color="#ff9800" />
        </TouchableOpacity>
      );
    }

    return (
      <View style={styles.semesterInfo}>
        <Ionicons name="calendar" size={20} color="#4caf50" />
        <Text style={styles.semesterInfoText}>
          {semesterSettings.current_semester}: {semesterSettings.semester_start_date} إلى {semesterSettings.semester_end_date}
        </Text>
      </View>
    );
  };

  if (loading) {
    return <LoadingScreen />;
  }

  const dayLectures = getDayLectures();
  const todayDate = new Date().toLocaleDateString('ar-SA', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  // للمعلم: عرض محاضرات اليوم فقط
  if (user?.role === 'teacher') {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>محاضرات اليوم</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Today's Date */}
        <View style={styles.todayDateSection}>
          <View style={styles.todayIconContainer}>
            <Ionicons name="today" size={24} color="#fff" />
          </View>
          <View>
            <Text style={styles.todayDateTitle}>اليوم</Text>
            <Text style={styles.todayDateText}>{todayDate}</Text>
          </View>
        </View>

        {/* Today's Lectures */}
        <FlatList
          data={todayLectures}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.todayLectureCard}
              onPress={() => router.push({
                pathname: '/take-attendance',
                params: { lectureId: item.id, courseId: item.course_id }
              })}
            >
              <View style={styles.todayLectureTime}>
                <Text style={styles.todayLectureTimeText}>{item.start_time}</Text>
                <View style={styles.todayLectureTimeDivider} />
                <Text style={styles.todayLectureTimeText}>{item.end_time}</Text>
              </View>
              
              <View style={styles.todayLectureInfo}>
                <Text style={styles.todayLectureCourseName}>{item.course_name}</Text>
                <Text style={styles.todayLectureCourseCode}>{item.course_code}</Text>
                {item.room && (
                  <View style={styles.todayLectureRoom}>
                    <Ionicons name="location" size={12} color="#666" />
                    <Text style={styles.todayLectureRoomText}>{item.room}</Text>
                  </View>
                )}
              </View>
              
              <View style={styles.todayLectureActions}>
                <View style={[styles.todayLectureStatus, { 
                  backgroundColor: item.status === 'completed' ? '#e8f5e9' : '#fff3e0' 
                }]}>
                  <Text style={[styles.todayLectureStatusText, { 
                    color: item.status === 'completed' ? '#4caf50' : '#ff9800' 
                  }]}>
                    {item.status === 'completed' ? 'منعقدة' : 'مجدولة'}
                  </Text>
                </View>
                <View style={styles.todayLectureAttendance}>
                  <Ionicons name="people" size={14} color="#1565c0" />
                  <Text style={styles.todayLectureAttendanceText}>
                    {item.attendance_count}/{item.total_enrolled}
                  </Text>
                </View>
              </View>
              
              <TouchableOpacity
                style={styles.todayLectureAttendBtn}
                onPress={() => router.push({
                  pathname: '/take-attendance',
                  params: { lectureId: item.id, courseId: item.course_id }
                })}
              >
                <Ionicons name="checkmark-circle" size={32} color="#4caf50" />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.todayLecturesList}
          ListEmptyComponent={
            <View style={styles.emptyTodayContainer}>
              <Ionicons name="calendar-outline" size={80} color="#ccc" />
              <Text style={styles.emptyTodayTitle}>لا توجد محاضرات اليوم</Text>
              <Text style={styles.emptyTodayText}>
                ليس لديك محاضرات مجدولة لهذا اليوم
              </Text>
            </View>
          }
        />
      </SafeAreaView>
    );
  }

  // للمدير: عرض الجدول الأسبوعي الكامل
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>جدول المحاضرات</Text>
        {user?.role === 'admin' && (
          <TouchableOpacity onPress={openGenerateModal} style={styles.generateBtn}>
            <Ionicons name="calendar" size={22} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      {/* Semester Info */}
      {renderSemesterInfo()}

      {/* Days Tabs */}
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false}
        style={styles.daysContainer}
        contentContainerStyle={styles.daysContent}
      >
        {DAYS.map(day => {
          const dayCount = getDayLectureCount(day.id);
          return (
            <TouchableOpacity
              key={day.id}
              style={[styles.dayTab, selectedDay === day.id && styles.dayTabActive]}
              onPress={() => setSelectedDay(day.id)}
            >
              <Text style={[styles.dayText, selectedDay === day.id && styles.dayTextActive]}>
                {day.name}
              </Text>
              {dayCount > 0 && (
                <View style={[styles.dayBadge, selectedDay === day.id && styles.dayBadgeActive]}>
                  <Text style={[styles.dayBadgeText, selectedDay === day.id && styles.dayBadgeTextActive]}>
                    {dayCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Schedule List */}
      <FlatList
        data={dayLectures}
        renderItem={renderLectureItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.scheduleList}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="calendar-outline" size={64} color="#ccc" />
            <Text style={styles.emptyText}>لا توجد محاضرات في هذا اليوم</Text>
          </View>
        }
      />

      {/* Add Button */}
      {user?.role === 'admin' && (
        <TouchableOpacity style={styles.fab} onPress={() => setShowAddModal(true)}>
          <Ionicons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      )}

      {/* Add Lecture Modal - Using the new unified component */}
      <AddLectureModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSave={handleSaveLecture}
        courses={courses.map(c => ({ id: c.id, name: c.name }))}
        showCourseSelector={true}
        title="إضافة محاضرة جديدة"
      />

      {/* Generate Lectures Modal */}
      <Modal
        visible={generateModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setGenerateModalVisible(false)}
      >
        <SafeAreaView style={styles.generateModalContainer}>
          <View style={styles.generateModalHeader}>
            <TouchableOpacity onPress={() => setGenerateModalVisible(false)}>
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
                  <Text style={styles.semesterDateValue}>{semesterSettings?.semester_start_date}</Text>
                </View>
                <Ionicons name="arrow-forward" size={20} color="#999" />
                <View style={styles.semesterDateItem}>
                  <Text style={styles.semesterDateLabel}>النهاية</Text>
                  <Text style={styles.semesterDateValue}>{semesterSettings?.semester_end_date}</Text>
                </View>
              </View>
            </View>

            {/* Select Course */}
            <View style={styles.generateSection}>
              <View style={styles.generateSectionHeader}>
                <Ionicons name="book" size={20} color="#ff9800" />
                <Text style={styles.generateSectionTitle}>المقرر</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {courses.map(course => (
                  <TouchableOpacity
                    key={course.id}
                    style={[
                      styles.courseChip,
                      selectedCourseForGenerate === course.id && styles.courseChipActive
                    ]}
                    onPress={() => setSelectedCourseForGenerate(course.id)}
                  >
                    <Text style={[
                      styles.courseChipText,
                      selectedCourseForGenerate === course.id && styles.courseChipTextActive
                    ]}>{course.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
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
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#9c27b0',
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
  generateBtn: {
    width: 40,
    height: 40,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  semesterWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff3e0',
    margin: 16,
    marginBottom: 0,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ffcc80',
  },
  semesterWarningTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#e65100',
  },
  semesterWarningText: {
    fontSize: 12,
    color: '#ff9800',
    marginTop: 2,
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
  },
  daysContainer: {
    marginTop: 16,
    maxHeight: 50,
  },
  daysContent: {
    paddingHorizontal: 16,
  },
  dayTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 8,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  dayTabActive: {
    backgroundColor: '#9c27b0',
    borderColor: '#9c27b0',
  },
  dayText: {
    fontSize: 14,
    color: '#666',
  },
  dayTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  dayBadge: {
    backgroundColor: '#e0e0e0',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 6,
  },
  dayBadgeActive: {
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  dayBadgeText: {
    fontSize: 11,
    color: '#666',
    fontWeight: '600',
  },
  dayBadgeTextActive: {
    color: '#fff',
  },
  scheduleList: {
    padding: 16,
  },
  lectureCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  timeColumn: {
    alignItems: 'center',
    marginRight: 16,
  },
  timeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9c27b0',
  },
  timeLine: {
    width: 2,
    height: 20,
    backgroundColor: '#e0e0e0',
    marginVertical: 4,
  },
  lectureInfo: {
    flex: 1,
  },
  courseName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  detailText: {
    fontSize: 13,
    color: '#666',
  },
  actionColumn: {
    justifyContent: 'center',
    gap: 8,
  },
  deleteBtn: {
    padding: 8,
    backgroundColor: '#ffebee',
    borderRadius: 8,
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
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#9c27b0',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
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
  courseChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#f5f5f5',
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  courseChipActive: {
    backgroundColor: '#ff9800',
    borderColor: '#ff9800',
  },
  courseChipText: {
    fontSize: 14,
    color: '#666',
  },
  courseChipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  roomInput: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    textAlign: 'right',
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
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#f5f5f5',
    borderRadius: 6,
    marginRight: 6,
  },
  slotTimeBtnActive: {
    backgroundColor: '#1565c0',
  },
  slotTimeBtnText: {
    fontSize: 12,
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
  // Teacher's Today Lectures Styles
  todayDateSection: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    margin: 16,
    padding: 16,
    borderRadius: 12,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  todayIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#1565c0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  todayDateTitle: {
    fontSize: 12,
    color: '#666',
  },
  todayDateText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginTop: 2,
  },
  todayLecturesList: {
    padding: 16,
    paddingTop: 0,
  },
  todayLectureCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  todayLectureTime: {
    backgroundColor: '#1565c0',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  todayLectureTimeText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  todayLectureTimeDivider: {
    width: 20,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.5)',
    marginVertical: 4,
  },
  todayLectureInfo: {
    flex: 1,
  },
  todayLectureCourseName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  todayLectureCourseCode: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  todayLectureRoom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  todayLectureRoomText: {
    fontSize: 12,
    color: '#666',
  },
  todayLectureActions: {
    alignItems: 'flex-end',
    gap: 8,
  },
  todayLectureStatus: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  todayLectureStatusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  todayLectureAttendance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  todayLectureAttendanceText: {
    fontSize: 13,
    color: '#1565c0',
    fontWeight: '500',
  },
  todayLectureAttendBtn: {
    padding: 4,
  },
  emptyTodayContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  emptyTodayTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#666',
    marginTop: 16,
  },
  emptyTodayText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
  },
});
