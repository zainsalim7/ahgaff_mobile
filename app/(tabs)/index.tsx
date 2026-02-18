import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Modal,
  Share,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/store/authStore';
import { useOfflineStore } from '../../src/store/offlineStore';
import { reportsAPI, attendanceAPI, studentsAPI, departmentsAPI, settingsAPI, coursesAPI, enrollmentAPI, lecturesAPI } from '../../src/services/api';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import QRCode from 'react-native-qrcode-svg';

interface CourseStats {
  course_id: string;
  course_name: string;
  course_code: string;
  total_lectures: number;
  present_count: number;
  absent_count: number;
  late_count: number;
  excused_count: number;
  attendance_rate: number;
  status: 'excellent' | 'warning' | 'danger';
}

interface MonthLectures {
  dates: string[];
  lectures_by_date: { [key: string]: any[] };
  total_lectures: number;
}

interface TodayLecture {
  id: string;
  course_id: string;
  course_name: string;
  course_code: string;
  start_time: string;
  end_time: string;
  room: string;
  status: string;
  attendance_count: number;
  total_enrolled: number;
}

export default function HomeScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const { pendingAttendance, isOnline } = useOfflineStore();
  
  const [summary, setSummary] = useState<any>(null);
  const [studentInfo, setStudentInfo] = useState<any>(null);
  const [coursesStats, setCoursesStats] = useState<CourseStats[]>([]);
  const [departmentName, setDepartmentName] = useState<string>('');
  const [collegeName, setCollegeName] = useState<string>('');
  const [maxAbsencePercent, setMaxAbsencePercent] = useState<number>(25);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  
  // Teacher calendar states
  const [todayLectures, setTodayLectures] = useState<TodayLecture[]>([]);
  const [monthLectures, setMonthLectures] = useState<MonthLectures | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [semesterDates, setSemesterDates] = useState<{ start: string; end: string; name: string } | null>(null);

  // مشاركة رمز QR
  const shareQRCode = async () => {
    if (!studentInfo?.qr_code) return;
    
    try {
      await Share.share({
        message: `رمز الحضور للطالب: ${studentInfo.full_name}\nالرقم الأكاديمي: ${studentInfo.student_id}\nكود QR: ${studentInfo.qr_code}`,
        title: 'رمز الحضور',
      });
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  const fetchData = useCallback(async () => {
    try {
      if (user?.role === 'admin') {
        const response = await reportsAPI.getSummary();
        setSummary(response.data);
      } else if (user?.role === 'student') {
        // جلب بيانات الطالب
        try {
          const studentRes = await studentsAPI.getMe();
          setStudentInfo(studentRes.data);
          
          // جلب اسم القسم
          if (studentRes.data?.department_id) {
            const deptsRes = await departmentsAPI.getAll();
            const dept = deptsRes.data.find((d: any) => d.id === studentRes.data.department_id);
            if (dept) {
              setDepartmentName(dept.name);
            }
          }
          
          // جلب إعدادات النظام
          const settingsRes = await settingsAPI.get();
          const maxAbsence = settingsRes.data?.max_absence_percent || 25;
          setMaxAbsencePercent(maxAbsence);
          
          // جلب اسم الكلية من الإعدادات
          if (settingsRes.data?.college_name) {
            setCollegeName(settingsRes.data.college_name);
          }
          
          // جلب المقررات وإحصائيات كل مقرر على حدة
          if (studentRes.data?.id) {
            const coursesRes = await coursesAPI.getAll();
            console.log('Total courses from API:', coursesRes.data.length);
            const studentCourses = coursesRes.data.filter((c: any) => 
              c.department_id === studentRes.data.department_id &&
              c.level === studentRes.data.level &&
              (!c.section || c.section === studentRes.data.section)
            );
            console.log('Filtered student courses:', studentCourses.length);
            
            const statsPromises = studentCourses.map(async (course: any) => {
              try {
                const statsRes = await attendanceAPI.getStudentStats(studentRes.data.id, course.id);
                const stats = statsRes.data;
                const totalSessions = stats.total_sessions || 0;
                const attendanceRate = totalSessions > 0 ? (stats.attendance_rate || 0) : 100;
                
                // تحديد الحالة بناءً على نسبة الغياب
                let status: 'excellent' | 'warning' | 'danger' = 'excellent';
                if (totalSessions > 0) {
                  if (attendanceRate < (100 - maxAbsence)) {
                    status = 'danger'; // محروم
                  } else if (attendanceRate < (100 - maxAbsence / 2)) {
                    status = 'warning'; // تحذير
                  }
                }
                
                return {
                  course_id: course.id,
                  course_name: course.name,
                  course_code: course.code,
                  total_lectures: totalSessions,
                  present_count: stats.present_count || 0,
                  absent_count: stats.absent_count || 0,
                  late_count: stats.late_count || 0,
                  excused_count: stats.excused_count || 0,
                  attendance_rate: attendanceRate,
                  status,
                } as CourseStats;
              } catch {
                // إذا فشل جلب الإحصائيات، نُظهر المقرر بدون إحصائيات
                return {
                  course_id: course.id,
                  course_name: course.name,
                  course_code: course.code,
                  total_lectures: 0,
                  present_count: 0,
                  absent_count: 0,
                  late_count: 0,
                  excused_count: 0,
                  attendance_rate: 100,
                  status: 'excellent' as const,
                } as CourseStats;
              }
            });
            
            const results = await Promise.all(statsPromises);
            setCoursesStats(results as CourseStats[]);
          }
        } catch (e) {
          console.log('Error fetching student info:', e);
        }
      } else if (user?.role === 'teacher') {
        // جلب بيانات المعلم - محاضرات اليوم والشهر وإعدادات الفصل
        try {
          const [todayRes, monthRes, settingsRes] = await Promise.all([
            lecturesAPI.getToday(),
            lecturesAPI.getMonth(currentMonth.getFullYear(), currentMonth.getMonth() + 1),
            settingsAPI.get()
          ]);
          setTodayLectures(todayRes.data || []);
          setMonthLectures(monthRes.data || { dates: [], lectures_by_date: {}, total_lectures: 0 });
          
          // حفظ تواريخ الفصل الدراسي
          if (settingsRes.data) {
            setSemesterDates({
              start: settingsRes.data.semester_start_date,
              end: settingsRes.data.semester_end_date,
              name: settingsRes.data.current_semester
            });
          }
        } catch (e) {
          console.log('Error fetching teacher data:', e);
        }
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.role, currentMonth]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const syncOfflineData = async () => {
    const unsynced = pendingAttendance.filter(r => !r.synced);
    if (unsynced.length === 0) {
      Alert.alert('تنبيه', 'لا توجد بيانات للمزامنة');
      return;
    }

    try {
      await attendanceAPI.sync(unsynced);
      Alert.alert('نجاح', `تمت مزامنة ${unsynced.length} سجل`);
    } catch (error) {
      Alert.alert('خطأ', 'فشلت المزامنة');
    }
  };

  if (loading) {
    return <LoadingScreen />;
  }

  const unsyncedCount = pendingAttendance.filter(r => !r.synced).length;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Welcome Section */}
        <View style={styles.welcomeCard}>
          <View style={styles.welcomeHeader}>
            <View style={styles.avatarContainer}>
              <Ionicons name={user?.role === 'student' ? 'school' : 'person'} size={32} color="#1565c0" />
            </View>
            <View style={styles.welcomeText}>
              <Text style={styles.greeting}>مرحباً</Text>
              <Text style={styles.userName}>{user?.full_name}</Text>
              {user?.role === 'student' && studentInfo && (
                <Text style={styles.studentIdText}>#{studentInfo.student_id}</Text>
              )}
              {user?.role !== 'student' && (
                <Text style={styles.userRole}>
                  {user?.role === 'admin' ? 'مشرف' : 
                   user?.role === 'teacher' ? 'معلم' : 
                   user?.role === 'dean' ? 'عميد كلية' :
                   user?.role === 'department_head' ? 'رئيس قسم' :
                   user?.role === 'registration_manager' ? 'مدير التسجيل' :
                   user?.role === 'registrar' ? 'موظف تسجيل' :
                   user?.role === 'employee' ? 'موظف' : 'مستخدم'}
                </Text>
              )}
            </View>
          </View>
          {/* اسم الكلية للطالب */}
          {user?.role === 'student' && collegeName && (
            <View style={styles.collegeNameContainer}>
              <Ionicons name="school-outline" size={16} color="#1565c0" />
              <Text style={styles.collegeNameText}>{collegeName}</Text>
            </View>
          )}
        </View>

        {/* Sync Status */}
        {unsyncedCount > 0 && (
          <TouchableOpacity style={styles.syncCard} onPress={syncOfflineData}>
            <Ionicons name="cloud-upload" size={24} color="#ff9800" />
            <View style={styles.syncInfo}>
              <Text style={styles.syncTitle}>بيانات غير مؤمنة</Text>
              <Text style={styles.syncCount}>{unsyncedCount} سجل بانتظار المزامنة</Text>
            </View>
            <Ionicons name="chevron-forward" size={24} color="#999" />
          </TouchableOpacity>
        )}

        {/* Admin Stats */}
        {user?.role === 'admin' && summary && (
          <View style={styles.statsGrid}>
            <View style={[styles.statCard, { backgroundColor: '#e3f2fd' }]}>
              <Ionicons name="people" size={32} color="#1565c0" />
              <Text style={styles.statNumber}>{summary.total_students}</Text>
              <Text style={styles.statLabel}>طالب</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: '#e8f5e9' }]}>
              <Ionicons name="school" size={32} color="#4caf50" />
              <Text style={styles.statNumber}>{summary.total_teachers}</Text>
              <Text style={styles.statLabel}>معلم</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: '#fff3e0' }]}>
              <Ionicons name="book" size={32} color="#ff9800" />
              <Text style={styles.statNumber}>{summary.total_courses}</Text>
              <Text style={styles.statLabel}>مقرر</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: '#fce4ec' }]}>
              <Ionicons name="business" size={32} color="#e91e63" />
              <Text style={styles.statNumber}>{summary.total_departments}</Text>
              <Text style={styles.statLabel}>قسم</Text>
            </View>
          </View>
        )}

        {/* Today's Attendance for Admin */}
        {user?.role === 'admin' && summary?.today_attendance && (
          <View style={styles.todayCard}>
            <Text style={styles.todayTitle}>حضور اليوم</Text>
            <View style={styles.todayStats}>
              <View style={styles.todayStat}>
                <Text style={styles.todayNumber}>{summary.today_attendance.present}</Text>
                <Text style={styles.todayLabel}>حاضر</Text>
              </View>
              <View style={styles.todayStat}>
                <Text style={[styles.todayNumber, { color: '#f44336' }]}>
                  {summary.today_attendance.absent}
                </Text>
                <Text style={styles.todayLabel}>غائب</Text>
              </View>
              <View style={styles.todayStat}>
                <Text style={[styles.todayNumber, { color: '#1565c0' }]}>
                  {summary.today_attendance.rate}%
                </Text>
                <Text style={styles.todayLabel}>نسبة الحضور</Text>
              </View>
            </View>
          </View>
        )}

        {/* Teacher Dashboard */}
        {user?.role === 'teacher' && (
          <>
            {/* Today's Lectures Section */}
            <View style={styles.teacherSection}>
              <View style={styles.teacherSectionHeader}>
                <View style={styles.teacherSectionIcon}>
                  <Ionicons name="today" size={24} color="#fff" />
                </View>
                <View>
                  <Text style={styles.teacherSectionTitle}>محاضرات اليوم</Text>
                  <Text style={styles.teacherSectionDate}>
                    {new Date().toLocaleDateString('ar-SA', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </Text>
                </View>
                <View style={styles.lectureCountBadge}>
                  <Text style={styles.lectureCountText}>{todayLectures.length}</Text>
                </View>
              </View>
              
              {todayLectures.length === 0 ? (
                <View style={styles.noLecturesBox}>
                  <Ionicons name="checkmark-circle" size={32} color="#4caf50" />
                  <Text style={styles.noLecturesText}>لا توجد محاضرات مجدولة لليوم</Text>
                </View>
              ) : (
                todayLectures.map((lecture, index) => (
                  <TouchableOpacity
                    key={lecture.id}
                    style={[styles.todayLectureItem, index > 0 && { marginTop: 8 }]}
                    onPress={() => router.push({
                      pathname: '/take-attendance',
                      params: { lectureId: lecture.id, courseId: lecture.course_id }
                    })}
                  >
                    <View style={styles.lectureTimeBox}>
                      <Text style={styles.lectureTimeText}>{lecture.start_time}</Text>
                      <Text style={styles.lectureTimeDivider}>-</Text>
                      <Text style={styles.lectureTimeText}>{lecture.end_time}</Text>
                    </View>
                    <View style={styles.lectureInfoBox}>
                      <Text style={styles.lectureNameText} numberOfLines={1}>{lecture.course_name}</Text>
                      <Text style={styles.lectureCodeText}>{lecture.course_code}</Text>
                      {lecture.room && (
                        <View style={styles.lectureRoomRow}>
                          <Ionicons name="location" size={12} color="#666" />
                          <Text style={styles.lectureRoomText}>{lecture.room}</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.lectureStatusBox}>
                      <View style={[styles.lectureStatusBadge, { 
                        backgroundColor: lecture.status === 'completed' ? '#e8f5e9' : '#fff3e0' 
                      }]}>
                        <Text style={[styles.lectureStatusText, { 
                          color: lecture.status === 'completed' ? '#4caf50' : '#ff9800' 
                        }]}>
                          {lecture.status === 'completed' ? 'منعقدة' : 'مجدولة'}
                        </Text>
                      </View>
                      <View style={styles.lectureAttendRow}>
                        <Ionicons name="people" size={14} color="#1565c0" />
                        <Text style={styles.lectureAttendText}>{lecture.attendance_count}/{lecture.total_enrolled}</Text>
                      </View>
                    </View>
                    <Ionicons name="chevron-back" size={20} color="#ccc" />
                  </TouchableOpacity>
                ))
              )}
              
              <TouchableOpacity 
                style={styles.viewAllBtn}
                onPress={() => router.push('/schedule')}
              >
                <Text style={styles.viewAllText}>عرض جدول اليوم الكامل</Text>
                <Ionicons name="arrow-back" size={16} color="#1565c0" />
              </TouchableOpacity>
            </View>

            {/* Monthly Calendar Section */}
            <View style={styles.calendarSection}>
              {/* Semester Info */}
              {semesterDates && (
                <View style={styles.semesterInfoBar}>
                  <Ionicons name="school" size={16} color="#1565c0" />
                  <Text style={styles.semesterInfoText}>
                    {semesterDates.name} ({semesterDates.start} - {semesterDates.end})
                  </Text>
                </View>
              )}
              
              <View style={styles.calendarHeader}>
                <TouchableOpacity 
                  style={[styles.calendarNavBtn, 
                    semesterDates && new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1) <= new Date(semesterDates.start) && styles.calendarNavBtnDisabled
                  ]}
                  onPress={() => {
                    const newMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1);
                    // التحقق من عدم الخروج عن نطاق الفصل
                    if (!semesterDates || newMonth >= new Date(semesterDates.start.slice(0, 7) + '-01')) {
                      setCurrentMonth(newMonth);
                    }
                  }}
                  disabled={semesterDates && new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1) <= new Date(semesterDates.start)}
                >
                  <Ionicons name="chevron-forward" size={24} color={
                    semesterDates && new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1) <= new Date(semesterDates.start) ? '#ccc' : '#1565c0'
                  } />
                </TouchableOpacity>
                <Text style={styles.calendarTitle}>
                  {currentMonth.toLocaleDateString('ar-SA', { month: 'long', year: 'numeric' })}
                </Text>
                <TouchableOpacity 
                  style={[styles.calendarNavBtn,
                    semesterDates && new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0) >= new Date(semesterDates.end) && styles.calendarNavBtnDisabled
                  ]}
                  onPress={() => {
                    const newMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1);
                    // التحقق من عدم الخروج عن نطاق الفصل
                    if (!semesterDates || newMonth <= new Date(semesterDates.end.slice(0, 7) + '-28')) {
                      setCurrentMonth(newMonth);
                    }
                  }}
                  disabled={semesterDates && new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0) >= new Date(semesterDates.end)}
                >
                  <Ionicons name="chevron-back" size={24} color={
                    semesterDates && new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0) >= new Date(semesterDates.end) ? '#ccc' : '#1565c0'
                  } />
                </TouchableOpacity>
              </View>
              
              {/* Calendar Days Header */}
              <View style={styles.calendarDaysHeader}>
                {['أحد', 'اثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'].map((day, i) => (
                  <Text key={i} style={styles.calendarDayName}>{day}</Text>
                ))}
              </View>
              
              {/* Calendar Grid */}
              <View style={styles.calendarGrid}>
                {(() => {
                  const year = currentMonth.getFullYear();
                  const month = currentMonth.getMonth();
                  const firstDay = new Date(year, month, 1).getDay();
                  const daysInMonth = new Date(year, month + 1, 0).getDate();
                  const today = new Date();
                  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                  
                  // تحديد نطاق الفصل
                  const semesterStart = semesterDates ? new Date(semesterDates.start) : null;
                  const semesterEnd = semesterDates ? new Date(semesterDates.end) : null;
                  
                  const cells = [];
                  
                  // Empty cells before first day
                  for (let i = 0; i < firstDay; i++) {
                    cells.push(<View key={`empty-${i}`} style={styles.calendarCell} />);
                  }
                  
                  // Days of month
                  for (let day = 1; day <= daysInMonth; day++) {
                    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const currentDate = new Date(dateStr);
                    const hasLecture = monthLectures?.dates?.includes(dateStr);
                    const isToday = dateStr === todayStr;
                    const isSelected = dateStr === selectedDate;
                    
                    // التحقق إذا كان اليوم خارج نطاق الفصل
                    const isOutOfSemester = semesterStart && semesterEnd && 
                      (currentDate < semesterStart || currentDate > semesterEnd);
                    
                    cells.push(
                      <TouchableOpacity
                        key={day}
                        style={[
                          styles.calendarCell,
                          isToday && styles.calendarCellToday,
                          isSelected && styles.calendarCellSelected,
                          isOutOfSemester && styles.calendarCellOutOfSemester,
                        ]}
                        onPress={() => {
                          if (hasLecture && !isOutOfSemester) {
                            setSelectedDate(dateStr);
                          }
                        }}
                        disabled={isOutOfSemester}
                      >
                        <Text style={[
                          styles.calendarCellText,
                          isToday && styles.calendarCellTextToday,
                          isSelected && styles.calendarCellTextSelected,
                          isOutOfSemester && styles.calendarCellTextOutOfSemester,
                        ]}>
                          {day}
                        </Text>
                        {hasLecture && !isOutOfSemester && (
                          <View style={[
                            styles.calendarDot,
                            isToday && styles.calendarDotToday,
                          ]} />
                        )}
                      </TouchableOpacity>
                    );
                  }
                  
                  return cells;
                })()}
              </View>
              
              {/* Selected Date Lectures */}
              {selectedDate && monthLectures?.lectures_by_date?.[selectedDate] && (
                <View style={styles.selectedDateLectures}>
                  <Text style={styles.selectedDateTitle}>
                    محاضرات {new Date(selectedDate).toLocaleDateString('ar-SA', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </Text>
                  {monthLectures.lectures_by_date[selectedDate].map((lec: any) => (
                    <View key={lec.id} style={styles.selectedLectureItem}>
                      <Text style={styles.selectedLectureTime}>{lec.start_time} - {lec.end_time}</Text>
                      <Text style={styles.selectedLectureName}>{lec.course_name}</Text>
                      {lec.room && <Text style={styles.selectedLectureRoom}>{lec.room}</Text>}
                    </View>
                  ))}
                </View>
              )}
              
              {/* Month Stats */}
              <View style={styles.monthStatsRow}>
                <View style={styles.monthStatItem}>
                  <Text style={styles.monthStatNumber}>{monthLectures?.total_lectures || 0}</Text>
                  <Text style={styles.monthStatLabel}>محاضرة هذا الشهر</Text>
                </View>
                <View style={styles.monthStatItem}>
                  <Text style={styles.monthStatNumber}>{monthLectures?.dates?.length || 0}</Text>
                  <Text style={styles.monthStatLabel}>يوم دراسي</Text>
                </View>
              </View>
            </View>

            {/* Quick Actions */}
            <View style={styles.quickActions}>
              <Text style={styles.sectionTitle}>إجراءات سريعة</Text>
              <TouchableOpacity
                style={styles.actionCard}
                onPress={() => router.push('/courses')}
              >
                <View style={[styles.actionIcon, { backgroundColor: '#e3f2fd' }]}>
                  <Ionicons name="book" size={28} color="#1565c0" />
                </View>
                <View style={styles.actionInfo}>
                  <Text style={styles.actionTitle}>مقرراتي</Text>
                  <Text style={styles.actionDesc}>عرض المقررات</Text>
                </View>
                <Ionicons name="chevron-forward" size={24} color="#999" />
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Dashboard for Dean, Department Head, and other administrative roles */}
        {user?.role && ['dean', 'department_head', 'registration_manager', 'registrar', 'employee'].includes(user.role) && (
          <>
            {/* Administrative Stats */}
            <View style={styles.adminRoleSection}>
              <Text style={styles.sectionTitle}>لوحة التحكم</Text>
              
              <View style={styles.adminRoleGrid}>
                <TouchableOpacity
                  style={styles.adminRoleCard}
                  onPress={() => router.push('/add-student')}
                >
                  <View style={[styles.adminRoleIcon, { backgroundColor: '#e3f2fd' }]}>
                    <Ionicons name="people" size={28} color="#1565c0" />
                  </View>
                  <Text style={styles.adminRoleTitle}>الطلاب</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.adminRoleCard}
                  onPress={() => router.push('/add-course')}
                >
                  <View style={[styles.adminRoleIcon, { backgroundColor: '#fff3e0' }]}>
                    <Ionicons name="book" size={28} color="#ff9800" />
                  </View>
                  <Text style={styles.adminRoleTitle}>المقررات</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.adminRoleCard}
                  onPress={() => router.push('/manage-teachers')}
                >
                  <View style={[styles.adminRoleIcon, { backgroundColor: '#e8f5e9' }]}>
                    <Ionicons name="school" size={28} color="#4caf50" />
                  </View>
                  <Text style={styles.adminRoleTitle}>المعلمين</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.adminRoleCard}
                  onPress={() => router.push('/reports')}
                >
                  <View style={[styles.adminRoleIcon, { backgroundColor: '#e0f7fa' }]}>
                    <Ionicons name="document-text" size={28} color="#00bcd4" />
                  </View>
                  <Text style={styles.adminRoleTitle}>التقارير</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Quick Actions */}
            <View style={styles.quickActions}>
              <Text style={styles.sectionTitle}>إجراءات سريعة</Text>
              
              <TouchableOpacity
                style={styles.actionCard}
                onPress={() => router.push('/add-department')}
              >
                <View style={[styles.actionIcon, { backgroundColor: '#fce4ec' }]}>
                  <Ionicons name="business" size={28} color="#e91e63" />
                </View>
                <View style={styles.actionInfo}>
                  <Text style={styles.actionTitle}>الأقسام</Text>
                  <Text style={styles.actionDesc}>إدارة الأقسام</Text>
                </View>
                <Ionicons name="chevron-forward" size={24} color="#999" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionCard}
                onPress={() => router.push('/schedule')}
              >
                <View style={[styles.actionIcon, { backgroundColor: '#f3e5f5' }]}>
                  <Ionicons name="calendar" size={28} color="#9c27b0" />
                </View>
                <View style={styles.actionInfo}>
                  <Text style={styles.actionTitle}>الجدول</Text>
                  <Text style={styles.actionDesc}>جدول المحاضرات</Text>
                </View>
                <Ionicons name="chevron-forward" size={24} color="#999" />
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Quick Actions for Student */}
        {user?.role === 'student' && (
          <>
            {/* Student Details Card - بدون الاسم لأنه موجود في الترحيب */}
            {studentInfo && (
              <View style={styles.studentDetailsCard}>
                <View style={styles.studentDetailsGrid}>
                  <View style={styles.studentDetailItem}>
                    <Ionicons name="business-outline" size={20} color="#1565c0" />
                    <Text style={styles.studentDetailLabel}>القسم</Text>
                    <Text style={styles.studentDetailValue}>{departmentName || 'غير محدد'}</Text>
                  </View>
                  
                  <View style={styles.studentDetailItem}>
                    <Ionicons name="layers-outline" size={20} color="#4caf50" />
                    <Text style={styles.studentDetailLabel}>المستوى</Text>
                    <Text style={styles.studentDetailValue}>المستوى {studentInfo.level}</Text>
                  </View>
                  
                  <View style={styles.studentDetailItem}>
                    <Ionicons name="people-outline" size={20} color="#ff9800" />
                    <Text style={styles.studentDetailLabel}>الشعبة</Text>
                    <Text style={styles.studentDetailValue}>{studentInfo.section || 'غير محدد'}</Text>
                  </View>
                  
                  <TouchableOpacity 
                    style={styles.studentDetailItem}
                    onPress={() => setShowQRModal(true)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="qr-code-outline" size={20} color="#9c27b0" />
                    <Text style={styles.studentDetailLabel}>كود QR</Text>
                    <Text style={[styles.studentDetailValueSmall, { color: '#9c27b0' }]}>اضغط للعرض</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* QR Code Modal */}
            <Modal
              visible={showQRModal}
              transparent
              animationType="fade"
              onRequestClose={() => setShowQRModal(false)}
            >
              <View style={styles.qrModalOverlay}>
                <View style={styles.qrModalContent}>
                  <TouchableOpacity 
                    style={styles.qrModalClose}
                    onPress={() => setShowQRModal(false)}
                  >
                    <Ionicons name="close" size={24} color="#666" />
                  </TouchableOpacity>
                  
                  <Text style={styles.qrModalTitle}>رمز الحضور</Text>
                  <Text style={styles.qrModalSubtitle}>{studentInfo?.full_name}</Text>
                  <Text style={styles.qrModalId}>#{studentInfo?.student_id}</Text>
                  
                  <View style={styles.qrCodeContainer}>
                    {studentInfo?.qr_code && (
                      <QRCode
                        value={studentInfo.qr_code}
                        size={200}
                        backgroundColor="white"
                        color="#333"
                      />
                    )}
                  </View>
                  
                  <Text style={styles.qrCodeText}>{studentInfo?.qr_code}</Text>
                  
                  <TouchableOpacity 
                    style={styles.shareButton}
                    onPress={shareQRCode}
                  >
                    <Ionicons name="share-outline" size={20} color="#fff" />
                    <Text style={styles.shareButtonText}>مشاركة</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Modal>

            {/* ملخص سريع للحضور */}
            {coursesStats.length > 0 && (
              <TouchableOpacity 
                style={styles.attendanceSummaryCard}
                onPress={() => router.push('/my-attendance')}
                activeOpacity={0.7}
              >
                <View style={styles.summaryHeader}>
                  <Ionicons name="stats-chart" size={24} color="#1565c0" />
                  <Text style={styles.summaryTitle}>ملخص الحضور</Text>
                  <Ionicons name="chevron-forward" size={20} color="#999" />
                </View>
                <View style={styles.summaryStats}>
                  <View style={styles.summaryStatItem}>
                    <Text style={styles.summaryStatValue}>{coursesStats.length}</Text>
                    <Text style={styles.summaryStatLabel}>مقرر</Text>
                  </View>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryStatItem}>
                    <Text style={[styles.summaryStatValue, { color: '#4caf50' }]}>
                      {coursesStats.filter(c => c.status === 'excellent').length}
                    </Text>
                    <Text style={styles.summaryStatLabel}>ممتاز</Text>
                  </View>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryStatItem}>
                    <Text style={[styles.summaryStatValue, { color: '#ff9800' }]}>
                      {coursesStats.filter(c => c.status === 'warning').length}
                    </Text>
                    <Text style={styles.summaryStatLabel}>تحذير</Text>
                  </View>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryStatItem}>
                    <Text style={[styles.summaryStatValue, { color: '#f44336' }]}>
                      {coursesStats.filter(c => c.status === 'danger').length}
                    </Text>
                    <Text style={styles.summaryStatLabel}>خطر</Text>
                  </View>
                </View>
                <Text style={styles.summaryHint}>اضغط لعرض التفاصيل</Text>
              </TouchableOpacity>
            )}

            <View style={styles.quickActions}>
              <Text style={styles.sectionTitle}>إجراءات سريعة</Text>
              <TouchableOpacity
                style={styles.actionCard}
                onPress={() => router.push('/my-attendance')}
              >
                <View style={[styles.actionIcon, { backgroundColor: '#e8f5e9' }]}>
                  <Ionicons name="checkmark-circle" size={28} color="#4caf50" />
                </View>
                <View style={styles.actionInfo}>
                  <Text style={styles.actionTitle}>سجل حضوري</Text>
                  <Text style={styles.actionDesc}>عرض سجل الحضور والغياب</Text>
                </View>
                <Ionicons name="chevron-forward" size={24} color="#999" />
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.actionCard, { marginTop: 12 }]}
                onPress={() => router.push('/my-schedule')}
              >
                <View style={[styles.actionIcon, { backgroundColor: '#e3f2fd' }]}>
                  <Ionicons name="calendar" size={28} color="#1565c0" />
                </View>
                <View style={styles.actionInfo}>
                  <Text style={styles.actionTitle}>جدول محاضراتي</Text>
                  <Text style={styles.actionDesc}>عرض المحاضرات الأسبوعية والشهرية</Text>
                </View>
                <Ionicons name="chevron-forward" size={24} color="#999" />
              </TouchableOpacity>
            </View>
          </>
        )}
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
  },
  welcomeCard: {
    backgroundColor: '#fff',
    margin: 16,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  welcomeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#e3f2fd',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 16,
  },
  welcomeText: {
    flex: 1,
  },
  greeting: {
    fontSize: 14,
    color: '#666',
  },
  userName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 4,
  },
  userRole: {
    fontSize: 14,
    color: '#1565c0',
    marginTop: 2,
  },
  studentIdText: {
    fontSize: 14,
    color: '#1565c0',
    fontWeight: '600',
    marginTop: 2,
  },
  collegeNameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    gap: 6,
  },
  collegeNameText: {
    fontSize: 14,
    color: '#1565c0',
    fontWeight: '500',
  },
  syncCard: {
    backgroundColor: '#fff8e1',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ffe082',
  },
  syncInfo: {
    flex: 1,
    marginHorizontal: 12,
  },
  syncTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#f57c00',
  },
  syncCount: {
    fontSize: 12,
    color: '#ff9800',
    marginTop: 2,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  statCard: {
    width: '46%',
    margin: '2%',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 8,
  },
  statLabel: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  todayCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  todayTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 16,
    textAlign: 'center',
  },
  todayStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  todayStat: {
    alignItems: 'center',
  },
  todayNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#4caf50',
  },
  todayLabel: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  quickActions: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  actionCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  actionIcon: {
    width: 50,
    height: 50,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionInfo: {
    flex: 1,
    marginHorizontal: 12,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  actionDesc: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  // Student Info Card Styles
  studentInfoCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  studentDetailsCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  studentInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  studentAvatarLarge: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#e3f2fd',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 16,
  },
  studentMainInfo: {
    flex: 1,
  },
  studentNameLarge: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  studentIdBadge: {
    fontSize: 16,
    color: '#1565c0',
    fontWeight: '600',
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  studentDetailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  studentDetailItem: {
    width: '50%',
    alignItems: 'center',
    paddingVertical: 12,
  },
  studentDetailLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  studentDetailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginTop: 2,
  },
  studentDetailValueSmall: {
    fontSize: 11,
    fontWeight: '600',
    color: '#333',
    marginTop: 2,
  },
  studentContactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    marginTop: 6,
    gap: 8,
  },
  studentContactText: {
    fontSize: 14,
    color: '#666',
  },
  // Attendance Stats Card Styles
  attendanceStatsCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  attendanceStatsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    marginBottom: 16,
  },
  attendanceRateContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  attendanceRateCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 4,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  attendanceRateText: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  attendanceRateLabel: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  attendanceStatsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  attendanceStatItem: {
    alignItems: 'center',
  },
  attendanceStatIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  attendanceStatNumber: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  attendanceStatLabel: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  attendanceTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  attendanceTotalLabel: {
    fontSize: 14,
    color: '#666',
  },
  attendanceTotalValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1565c0',
  },
  // Courses Stats Styles
  coursesStatsSection: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  coursesStatsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  courseStatsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#4caf50',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  courseCardWarning: {
    borderLeftColor: '#ff9800',
    backgroundColor: '#fffbf5',
  },
  courseCardDanger: {
    borderLeftColor: '#f44336',
    backgroundColor: '#fff5f5',
  },
  courseStatsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  courseNameContainer: {
    flex: 1,
    marginLeft: 8,
  },
  courseStatsName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  courseStatsCode: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  courseStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusExcellent: {
    backgroundColor: '#e8f5e9',
  },
  statusWarning: {
    backgroundColor: '#fff3e0',
  },
  statusDanger: {
    backgroundColor: '#ffebee',
  },
  courseStatusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  courseStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  courseStatMini: {
    alignItems: 'center',
    flex: 1,
  },
  courseStatValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  courseStatMiniLabel: {
    fontSize: 10,
    color: '#888',
    marginTop: 2,
  },
  noCoursesCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 12,
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noCoursesText: {
    fontSize: 14,
    color: '#999',
    marginTop: 12,
  },
  // Attendance Summary Card
  attendanceSummaryCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  summaryTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  summaryStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 12,
  },
  summaryStatItem: {
    alignItems: 'center',
  },
  summaryDivider: {
    width: 1,
    backgroundColor: '#e0e0e0',
  },
  summaryStatValue: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
  },
  summaryStatLabel: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  summaryHint: {
    textAlign: 'center',
    fontSize: 12,
    color: '#999',
    marginTop: 10,
  },
  // QR Modal Styles
  qrModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  qrModalContent: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    width: '90%',
    maxWidth: 350,
    alignItems: 'center',
  },
  qrModalClose: {
    position: 'absolute',
    top: 12,
    right: 12,
    padding: 8,
  },
  qrModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  qrModalSubtitle: {
    fontSize: 16,
    color: '#666',
  },
  qrModalId: {
    fontSize: 14,
    color: '#1565c0',
    fontWeight: '600',
    marginBottom: 20,
  },
  qrCodeContainer: {
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#e0e0e0',
    marginBottom: 12,
  },
  qrCodeText: {
    fontSize: 10,
    color: '#999',
    textAlign: 'center',
    marginBottom: 20,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1565c0',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 25,
    gap: 8,
  },
  shareButtonText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
  // Teacher Dashboard Styles
  teacherSection: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  teacherSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  teacherSectionIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#1565c0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  teacherSectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  teacherSectionDate: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  lectureCountBadge: {
    marginLeft: 'auto',
    backgroundColor: '#1565c0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  lectureCountText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  noLecturesBox: {
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
  },
  noLecturesText: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
  },
  todayLectureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  lectureTimeBox: {
    backgroundColor: '#1565c0',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    minWidth: 65,
  },
  lectureTimeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  lectureTimeDivider: {
    color: '#fff',
    fontSize: 10,
    opacity: 0.7,
  },
  lectureInfoBox: {
    flex: 1,
  },
  lectureNameText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  lectureCodeText: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  lectureRoomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  lectureRoomText: {
    fontSize: 11,
    color: '#666',
  },
  lectureStatusBox: {
    alignItems: 'flex-end',
    gap: 6,
  },
  lectureStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  lectureStatusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  lectureAttendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  lectureAttendText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#1565c0',
  },
  viewAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingVertical: 10,
    gap: 6,
  },
  viewAllText: {
    fontSize: 14,
    color: '#1565c0',
    fontWeight: '500',
  },
  // Calendar Styles
  calendarSection: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  calendarNavBtn: {
    padding: 8,
  },
  calendarTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  calendarDaysHeader: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  calendarDayName: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calendarCell: {
    width: '14.28%',
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
  },
  calendarCellToday: {
    backgroundColor: '#e3f2fd',
    borderRadius: 20,
  },
  calendarCellSelected: {
    backgroundColor: '#1565c0',
    borderRadius: 20,
  },
  calendarCellText: {
    fontSize: 14,
    color: '#333',
  },
  calendarCellTextToday: {
    fontWeight: 'bold',
    color: '#1565c0',
  },
  calendarCellTextSelected: {
    color: '#fff',
    fontWeight: 'bold',
  },
  calendarDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ff9800',
    position: 'absolute',
    bottom: 4,
  },
  calendarDotToday: {
    backgroundColor: '#1565c0',
  },
  selectedDateLectures: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  selectedDateTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  selectedLectureItem: {
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
  },
  selectedLectureTime: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1565c0',
  },
  selectedLectureName: {
    fontSize: 13,
    color: '#333',
    marginTop: 2,
  },
  selectedLectureRoom: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  monthStatsRow: {
    flexDirection: 'row',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  monthStatItem: {
    flex: 1,
    alignItems: 'center',
  },
  monthStatNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1565c0',
  },
  monthStatLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  // Semester and Calendar additional styles
  semesterInfoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e3f2fd',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
    gap: 8,
  },
  semesterInfoText: {
    fontSize: 12,
    color: '#1565c0',
    fontWeight: '500',
  },
  calendarNavBtnDisabled: {
    opacity: 0.5,
  },
  calendarCellOutOfSemester: {
    opacity: 0.3,
  },
  calendarCellTextOutOfSemester: {
    color: '#ccc',
  },
  // Admin Role Dashboard Styles
  adminRoleSection: {
    marginBottom: 20,
  },
  adminRoleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  adminRoleCard: {
    width: '48%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  adminRoleIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  adminRoleTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
});
