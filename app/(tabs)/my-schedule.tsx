import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/store/authStore';
import { studentsAPI, lecturesAPI, coursesAPI, settingsAPI } from '../../src/services/api';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { Ionicons } from '@expo/vector-icons';

const SCREEN_WIDTH = Dimensions.get('window').width;

const DAYS_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const DAYS_SHORT = ['أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'];
const MONTHS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
];

interface Lecture {
  id: string;
  course_id: string;
  course_name: string;
  course_code: string;
  teacher_name: string;
  date: string;
  start_time: string;
  end_time: string;
  room: string;
  status: string;
}

interface SemesterDates {
  start: string;
  end: string;
}

export default function MyScheduleScreen() {
  const user = useAuthStore((state) => state.user);
  const [student, setStudent] = useState<any>(null);
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [semesterDates, setSemesterDates] = useState<SemesterDates | null>(null);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const fetchData = useCallback(async () => {
    try {
      // جلب إعدادات الفصل الدراسي
      const settingsRes = await settingsAPI.get();
      if (settingsRes.data?.semester_start_date && settingsRes.data?.semester_end_date) {
        setSemesterDates({
          start: settingsRes.data.semester_start_date,
          end: settingsRes.data.semester_end_date,
        });
        
        // ضبط الشهر الحالي على بداية الفصل إذا كان الشهر الحالي خارج نطاق الفصل
        const semesterStart = new Date(settingsRes.data.semester_start_date);
        const semesterEnd = new Date(settingsRes.data.semester_end_date);
        const now = new Date();
        
        if (now < semesterStart) {
          setCurrentMonth(new Date(semesterStart.getFullYear(), semesterStart.getMonth(), 1));
        } else if (now > semesterEnd) {
          setCurrentMonth(new Date(semesterEnd.getFullYear(), semesterEnd.getMonth(), 1));
        }
      }
      
      const studentRes = await studentsAPI.getMe();
      const foundStudent = studentRes.data;
      
      if (!foundStudent) {
        setLoading(false);
        return;
      }
      setStudent(foundStudent);

      // جلب جميع المقررات حسب قسم ومستوى وشعبة الطالب
      const coursesRes = await coursesAPI.getAll();
      const studentCourses = coursesRes.data.filter((c: any) => 
        c.department_id === foundStudent.department_id &&
        c.level === foundStudent.level &&
        (!c.section || c.section === foundStudent.section)
      );

      // جلب المحاضرات لكل مقرر
      const allLectures: Lecture[] = [];
      for (const course of studentCourses) {
        try {
          const lecturesRes = await lecturesAPI.getByCourse(course.id);
          const courseLectures = lecturesRes.data.map((l: any) => ({
            ...l,
            course_name: course.name,
            course_code: course.code,
            teacher_name: course.teacher_name || 'غير محدد',
          }));
          allLectures.push(...courseLectures);
        } catch (e) {
          // تجاهل الأخطاء
        }
      }

      // ترتيب حسب التاريخ والوقت
      allLectures.sort((a, b) => {
        const dateA = new Date(a.date + 'T' + a.start_time);
        const dateB = new Date(b.date + 'T' + b.start_time);
        return dateA.getTime() - dateB.getTime();
      });

      setLectures(allLectures);
    } catch (error) {
      console.error('Error fetching schedule:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  // تحويل التاريخ لصيغة YYYY-MM-DD
  const formatDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // الحصول على محاضرات يوم معين
  const getDayLectures = (date: Date) => {
    const dateStr = formatDate(date);
    return lectures.filter(l => l.date === dateStr && l.status !== 'cancelled');
  };

  // التنقل بين الأشهر مع التحقق من حدود الفصل الدراسي
  const navigateMonth = (direction: number) => {
    const newDate = new Date(currentMonth);
    newDate.setMonth(newDate.getMonth() + direction);
    
    // التحقق من أن الشهر الجديد ضمن نطاق الفصل الدراسي
    if (semesterDates) {
      const semesterStart = new Date(semesterDates.start);
      const semesterEnd = new Date(semesterDates.end);
      
      const newMonthStart = new Date(newDate.getFullYear(), newDate.getMonth(), 1);
      const newMonthEnd = new Date(newDate.getFullYear(), newDate.getMonth() + 1, 0);
      
      // لا تسمح بالتنقل قبل بداية الفصل
      if (direction < 0 && newMonthEnd < semesterStart) {
        return;
      }
      // لا تسمح بالتنقل بعد نهاية الفصل
      if (direction > 0 && newMonthStart > semesterEnd) {
        return;
      }
    }
    
    setCurrentMonth(newDate);
  };

  // التحقق من إمكانية التنقل للشهر السابق
  const canNavigatePrev = () => {
    if (!semesterDates) return true;
    const semesterStart = new Date(semesterDates.start);
    const prevMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    const prevMonthEnd = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0);
    return prevMonthEnd >= semesterStart;
  };

  // التحقق من إمكانية التنقل للشهر التالي
  const canNavigateNext = () => {
    if (!semesterDates) return true;
    const semesterEnd = new Date(semesterDates.end);
    const nextMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    return nextMonth <= semesterEnd;
  };

  // الحصول على أيام الشهر
  const getMonthDays = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    const days: (Date | null)[] = [];
    
    // إضافة أيام فارغة في البداية (بدء الأسبوع من السبت)
    const startDay = firstDay.getDay();
    const emptyDays = startDay === 6 ? 0 : startDay + 1;
    for (let i = 0; i < emptyDays; i++) {
      days.push(null);
    }
    
    // إضافة أيام الشهر
    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push(new Date(year, month, i));
    }
    
    return days;
  };

  // التحقق من وجود محاضرات في يوم معين
  const hasLectures = (date: Date) => {
    const dateStr = formatDate(date);
    return lectures.some(l => l.date === dateStr && l.status !== 'cancelled');
  };

  // التحقق من أن اليوم هو اليوم الحالي
  const isToday = (date: Date) => {
    return formatDate(date) === formatDate(today);
  };

  // التحقق من أن اليوم مختار
  const isSelected = (date: Date) => {
    return selectedDate && formatDate(date) === formatDate(selectedDate);
  };

  // الذهاب لليوم الحالي
  const goToToday = () => {
    const now = new Date();
    setCurrentMonth(now);
    setSelectedDate(now);
  };

  // محاضرات اليوم المختار - مع إعادة الحساب عند تغيير lectures أو selectedDate
  const todayLectures = React.useMemo(() => {
    return getDayLectures(selectedDate);
  }, [lectures, selectedDate]);

  if (loading) {
    return <LoadingScreen />;
  }

  if (!student) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={64} color="#f44336" />
          <Text style={styles.errorText}>لم يتم العثور على بيانات الطالب</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* بطاقة اليوم المختار */}
        <View style={styles.todayCard}>
          <View style={styles.todayHeader}>
            <View>
              <Text style={styles.todayDay}>{DAYS_AR[selectedDate.getDay()]}</Text>
              <Text style={styles.todayDate}>
                {selectedDate.getDate()} {MONTHS_AR[selectedDate.getMonth()]} {selectedDate.getFullYear()}
              </Text>
            </View>
            {!isToday(selectedDate) && (
              <TouchableOpacity style={styles.todayBtn} onPress={goToToday}>
                <Ionicons name="today" size={18} color="#1565c0" />
                <Text style={styles.todayBtnText}>اليوم</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* محاضرات اليوم */}
          <View style={styles.todayLectures}>
            {todayLectures.length === 0 ? (
              <View style={styles.noLectures}>
                <Ionicons name="calendar-outline" size={40} color="#ccc" />
                <Text style={styles.noLecturesText}>لا توجد محاضرات</Text>
              </View>
            ) : (
              todayLectures.map((lecture, index) => (
                <View key={lecture.id || index} style={styles.lectureCard}>
                  <View style={styles.lectureTime}>
                    <Text style={styles.lectureTimeText}>{lecture.start_time}</Text>
                    <View style={styles.timeLine} />
                    <Text style={styles.lectureTimeText}>{lecture.end_time}</Text>
                  </View>
                  <View style={styles.lectureInfo}>
                    <Text style={styles.lectureName}>{lecture.course_name}</Text>
                    <Text style={styles.lectureCode}>{lecture.course_code}</Text>
                    <View style={styles.lectureDetails}>
                      {lecture.teacher_name && (
                        <View style={styles.lectureDetailRow}>
                          <Ionicons name="person" size={13} color="rgba(255,255,255,0.8)" />
                          <Text style={styles.lectureDetailText}>{lecture.teacher_name}</Text>
                        </View>
                      )}
                      {lecture.room && (
                        <View style={styles.lectureDetailRow}>
                          <Ionicons name="location" size={13} color="rgba(255,255,255,0.8)" />
                          <Text style={styles.lectureDetailText}>قاعة {lecture.room}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
              ))
            )}
          </View>
        </View>

        {/* التقويم الشهري */}
        <View style={styles.monthCard}>
          {/* عرض نطاق الفصل الدراسي */}
          {semesterDates && (
            <View style={styles.semesterInfo}>
              <Ionicons name="calendar-outline" size={14} color="#1565c0" />
              <Text style={styles.semesterInfoText}>
                الفصل الدراسي: {new Date(semesterDates.start).toLocaleDateString('ar-SA')} - {new Date(semesterDates.end).toLocaleDateString('ar-SA')}
              </Text>
            </View>
          )}
          
          <View style={styles.monthHeader}>
            <TouchableOpacity 
              onPress={() => navigateMonth(-1)} 
              style={[styles.navBtn, !canNavigatePrev() && styles.navBtnDisabled]}
              disabled={!canNavigatePrev()}
            >
              <Ionicons name="chevron-forward" size={24} color={canNavigatePrev() ? "#1565c0" : "#ccc"} />
            </TouchableOpacity>
            <Text style={styles.monthTitle}>
              {MONTHS_AR[currentMonth.getMonth()]} {currentMonth.getFullYear()}
            </Text>
            <TouchableOpacity 
              onPress={() => navigateMonth(1)} 
              style={[styles.navBtn, !canNavigateNext() && styles.navBtnDisabled]}
              disabled={!canNavigateNext()}
            >
              <Ionicons name="chevron-back" size={24} color={canNavigateNext() ? "#1565c0" : "#ccc"} />
            </TouchableOpacity>
          </View>

          {/* أسماء الأيام */}
          <View style={styles.daysHeader}>
            {['سبت', 'جمع', 'خمي', 'أرب', 'ثلا', 'إثن', 'أحد'].map((day, i) => (
              <Text key={i} style={styles.dayName}>{day}</Text>
            ))}
          </View>

          {/* شبكة الأيام */}
          <View style={styles.daysGrid}>
            {getMonthDays().map((date, index) => (
              <TouchableOpacity
                key={index}
                style={[
                  styles.dayCell,
                  date && isToday(date) && styles.dayCellToday,
                  date && isSelected(date) && styles.dayCellSelected,
                ]}
                onPress={() => date && setSelectedDate(date)}
                disabled={!date}
              >
                {date && (
                  <>
                    <Text style={[
                      styles.dayNumber,
                      isToday(date) && styles.dayNumberToday,
                      isSelected(date) && styles.dayNumberSelected,
                    ]}>
                      {date.getDate()}
                    </Text>
                    {hasLectures(date) && (
                      <View style={[
                        styles.lectureDot,
                        isSelected(date) && styles.lectureDotSelected,
                      ]} />
                    )}
                  </>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* إحصائيات */}
        <View style={styles.statsCard}>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{lectures.length}</Text>
            <Text style={styles.statLabel}>إجمالي المحاضرات</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>
              {lectures.filter(l => new Date(l.date) >= today).length}
            </Text>
            <Text style={styles.statLabel}>محاضرات قادمة</Text>
          </View>
        </View>
      </ScrollView>
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
  // Today Card
  todayCard: {
    backgroundColor: '#1565c0',
    margin: 16,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  todayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  todayDay: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  todayDate: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 4,
  },
  todayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  todayBtnText: {
    fontSize: 14,
    color: '#1565c0',
    fontWeight: '600',
  },
  todayLectures: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: 12,
    minHeight: 100,
  },
  noLectures: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  noLecturesText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 8,
  },
  lectureCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  lectureTime: {
    alignItems: 'center',
    marginLeft: 12,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: '#4caf50',
  },
  lectureTimeText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '600',
  },
  timeLine: {
    flex: 1,
    width: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginVertical: 4,
  },
  lectureInfo: {
    flex: 1,
  },
  lectureName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  lectureCode: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
  },
  lectureDetails: {
    marginTop: 8,
    gap: 4,
  },
  lectureDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  lectureDetailText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.85)',
  },
  // Semester Info
  semesterInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e3f2fd',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
    gap: 6,
  },
  semesterInfoText: {
    fontSize: 12,
    color: '#1565c0',
    flex: 1,
  },
  // Month Card
  monthCard: {
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
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  monthTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  navBtn: {
    padding: 8,
  },
  navBtnDisabled: {
    opacity: 0.4,
  },
  daysHeader: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  dayName: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
  },
  dayCellToday: {
    backgroundColor: '#e3f2fd',
    borderRadius: 50,
  },
  dayCellSelected: {
    backgroundColor: '#1565c0',
    borderRadius: 50,
  },
  dayNumber: {
    fontSize: 14,
    color: '#333',
  },
  dayNumberToday: {
    color: '#1565c0',
    fontWeight: 'bold',
  },
  dayNumberSelected: {
    color: '#fff',
    fontWeight: 'bold',
  },
  lectureDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4caf50',
    marginTop: 2,
  },
  lectureDotSelected: {
    backgroundColor: '#fff',
  },
  // Stats Card
  statsCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    backgroundColor: '#e0e0e0',
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
});
