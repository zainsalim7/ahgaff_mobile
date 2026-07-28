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
  Platform,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Picker } from '@react-native-picker/picker';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import api, { coursesAPI, lecturesAPI, settingsAPI } from '../src/services/api';
import { LoadingScreen } from '../src/components/LoadingScreen';
import AddLectureModal, { LectureFormData } from '../src/components/AddLectureModal';
import RoomPicker from '../src/components/RoomPicker';
import { TimeRangeSummary } from '../src/components/TimeRangeSummary';
import { suggestEndTime } from '../src/utils/timeFormat';
import { useAuthStore } from '../src/store/authStore';
import { CourseTabBar } from '../src/components/CourseTabBar';
import { PERMISSIONS } from '../src/contexts/AuthContext';
import { formatGregorianDate, formatHijriDate, parseDate, WEEKDAYS_AR } from '../src/utils/dateUtils';
import { goBack, goHome } from '../src/utils/navigation';

interface Lecture {
  id: string;
  course_id: string;
  date: string;
  start_time: string;
  end_time: string;
  room: string;
  status: string;
  notes: string;
  // ملاحظات الإلغاء وإعادة الجدولة
  original_date?: string | null;
  last_rescheduled_from?: string | null;
  last_rescheduled_at?: string | null;
  rescheduled_by_name?: string | null;
  cancellation_reason?: string | null;
  cancelled_at?: string | null;
  cancelled_by_name?: string | null;
}

const DAYS = [
  { id: 'saturday', name: 'السبت', num: 6 },
  { id: 'sunday', name: 'الأحد', num: 0 },
  { id: 'monday', name: 'الإثنين', num: 1 },
  { id: 'tuesday', name: 'الثلاثاء', num: 2 },
  { id: 'wednesday', name: 'الأربعاء', num: 3 },
  { id: 'thursday', name: 'الخميس', num: 4 },
  { id: 'friday', name: 'الجمعة', num: 5 },
];

// أوقات المحاضرات: من 01:00 إلى 00:00 بفواصل ربع ساعة
const TIME_SLOTS: string[] = [];
for (let h = 1; h <= 23; h++) {
  const hh = h.toString().padStart(2, '0');
  TIME_SLOTS.push(`${hh}:00`, `${hh}:15`, `${hh}:30`, `${hh}:45`);
}
TIME_SLOTS.push('00:00');

const STATUS_LABELS: { [key: string]: { label: string; color: string } } = {
  scheduled: { label: 'مجدولة', color: '#2196f3' },
  completed: { label: 'منعقدة', color: '#4caf50' },
  cancelled: { label: 'ملغاة', color: '#f44336' },
  absent: { label: 'غائب', color: '#ff9800' },
};

interface DayScheduleConfig {
  day: string;
  enabled: boolean;
  slots: { start_time: string; end_time: string }[];
}

export default function CourseLecturesScreen() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const router = useRouter();
  
  // استخدام Zustand store للمصادقة
  const user = useAuthStore((state) => state.user);
  const authLoading = useAuthStore((state) => state.isLoading);
  
  // فحص الصلاحيات
  const hasPermission = (permission: string) => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return user.permissions?.includes(permission) || false;
  };
  
  // الطالب لا يمكنه الوصول لهذه الصفحة
  const isStudent = user?.role === 'student';
  
  // فقط المدير ومن لديه صلاحية manage_lectures يمكنهم إدارة المحاضرات
  const isTeacher = user?.role === 'teacher';
  const canManageLectures = !isTeacher && !isStudent && (hasPermission(PERMISSIONS.MANAGE_LECTURES) || user?.role === 'admin');
  const canReschedule = hasPermission(PERMISSIONS.RESCHEDULE_LECTURE) || user?.role === 'admin';
  
  // إعادة توجيه الطالب
  useEffect(() => {
    if (!authLoading && isStudent) {
      router.replace('/');
    }
  }, [isStudent, authLoading]);
  
  const [course, setCourse] = useState<any>(null);
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  
  // تقسيم الصفحات
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalLectures, setTotalLectures] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [serverStats, setServerStats] = useState<any>(null);
  const PER_PAGE = 50;
  
  // إشعارات مرئية
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);
  
  const showNotification = (type: 'success' | 'error' | 'warning', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), type === 'warning' ? 15000 : 5000);
  };
  
  // تحديد المحاضرات للحذف
  const [selectedLectures, setSelectedLectures] = useState<Set<string>>(new Set());
  
  // إعادة جدولة
  const [rescheduleModal, setRescheduleModal] = useState<{lectureId: string; courseName: string; oldDate: string} | null>(null);
  const [rescheduleData, setRescheduleData] = useState({ date: '', start_time: '08:00', end_time: '09:00', room: '' });
  const [rescheduling, setRescheduling] = useState(false);
  // 🏛️ تغيير القاعة فقط
  const [roomChangeModal, setRoomChangeModal] = useState<{lectureId: string; currentRoom: string; date: string; time: string; startTime: string; endTime: string} | null>(null);
  const [newRoom, setNewRoom] = useState('');
  const [changingRoom, setChangingRoom] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [deleting, setDeleting] = useState(false);
  
  // === فلترة وتنظيم المحاضرات ===
  const [viewMode, setViewMode] = useState<'month' | 'list' | 'week'>('month');
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  // التصميم الجديد
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [perPage, setPerPage] = useState(10);
  const [pageNum, setPageNum] = useState(1);
  const [searchLecture, setSearchLecture] = useState('');
  const [selectedDay, setSelectedDay] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  
  // أسماء الأشهر بالعربية
  const MONTHS_AR = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
  ];
  
  // تجميع المحاضرات حسب الشهر
  const groupLecturesByMonth = useCallback(() => {
    const groups: { [key: string]: Lecture[] } = {};
    
    lectures.forEach(lecture => {
      const date = parseDate(lecture.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthName = `${MONTHS_AR[date.getMonth()]} ${date.getFullYear()}`;
      
      if (!groups[monthKey]) {
        groups[monthKey] = [];
      }
      groups[monthKey].push(lecture);
    });
    
    // ترتيب حسب التاريخ داخل كل شهر
    Object.keys(groups).forEach(key => {
      groups[key].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    });
    
    return groups;
  }, [lectures]);
  
  // الحصول على قائمة الأشهر المتاحة
  const getAvailableMonths = useCallback(() => {
    const months = new Set<string>();
    lectures.forEach(lecture => {
      const date = parseDate(lecture.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      months.add(monthKey);
    });
    return Array.from(months).sort();
  }, [lectures]);
  
  // فلترة المحاضرات
  const getFilteredLectures = useCallback(() => {
    let filtered = [...lectures];
    
    // فلترة حسب الشهر (محلياً فقط - الحالة تُفلتر من السيرفر)
    if (selectedMonth) {
      filtered = filtered.filter(l => {
        const date = parseDate(l.date);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        return monthKey === selectedMonth;
      });
    }
    
    return filtered.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [lectures, selectedMonth]);
  
  // إحصائيات ثابتة من السيرفر (لا تتغير عند الفلترة)
  const getStats = useCallback(() => {
    if (serverStats) {
      return {
        total: serverStats.total,
        scheduled: serverStats.scheduled,
        completed: serverStats.completed,
        cancelled: serverStats.cancelled,
        absent: serverStats.absent,
      };
    }
    return { total: 0, scheduled: 0, completed: 0, cancelled: 0, absent: 0 };
  }, [serverStats]);
  
  // تبديل توسيع/طي الشهر
  const toggleMonth = (monthKey: string) => {
    const newExpanded = new Set(expandedMonths);
    if (newExpanded.has(monthKey)) {
      newExpanded.delete(monthKey);
    } else {
      newExpanded.add(monthKey);
    }
    setExpandedMonths(newExpanded);
  };
  
  // إعدادات الفصل
  const [semesterSettings, setSemesterSettings] = useState<{
    start: string | null;
    end: string | null;
    current: string;
  } | null>(null);
  
  // نموذج إدخال التواريخ
  const [showDateModal, setShowDateModal] = useState(false);
  const [tempStartDate, setTempStartDate] = useState('');
  const [tempEndDate, setTempEndDate] = useState('');
  const [savingDates, setSavingDates] = useState(false);
  
  // توليد المحاضرات
  const [generateRoom, setGenerateRoom] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [dayConfigs, setDayConfigs] = useState<DayScheduleConfig[]>(
    DAYS.map(d => ({
      day: d.id,
      enabled: false,
      slots: [{ start_time: '08:00', end_time: '09:30' }],
    }))
  );

  // 🟢🔴 مواعيد التوليد لفحص إشغال القاعات (كل تكرارات الأيام المفعلة ضمن الفترة)
  const generateOccurrences = React.useMemo(() => {
    if (!tempStartDate || !tempEndDate || tempStartDate >= tempEndDate) return undefined;
    const enabled = dayConfigs.filter(d => d.enabled);
    if (enabled.length === 0) return undefined;
    const dayNumById: Record<string, number> = {};
    DAYS.forEach(d => { dayNumById[d.id] = d.num; });
    const occ: { date: string; start_time: string; end_time: string }[] = [];
    const start = new Date(tempStartDate + 'T00:00:00');
    const end = new Date(tempEndDate + 'T00:00:00');
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return undefined;
    for (let d = new Date(start); d <= end && occ.length < 200; d.setDate(d.getDate() + 1)) {
      const cfg = enabled.find(c => dayNumById[c.day] === d.getDay());
      if (!cfg) continue;
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      for (const s of cfg.slots) {
        if (s.start_time && s.end_time) occ.push({ date: dateStr, start_time: s.start_time, end_time: s.end_time });
      }
    }
    return occ.length > 0 ? occ : undefined;
  }, [tempStartDate, tempEndDate, dayConfigs]);

  const fetchData = useCallback(async (page: number = 1, append: boolean = false) => {
    if (!courseId) return;
    
    try {
      if (page === 1) setLoading(true);
      else setLoadingMore(true);
      
      const [courseRes, lecturesRes, settingsRes] = await Promise.all([
        ...(page === 1 ? [coursesAPI.getById(courseId)] : [Promise.resolve({ data: course })]),
        lecturesAPI.getByCourse(courseId, page, PER_PAGE, selectedStatus || undefined),
        ...(page === 1 ? [settingsAPI.get()] : [Promise.resolve({ data: {} })]),
      ]);
      
      if (page === 1) setCourse(courseRes.data);
      
      const lectureData = lecturesRes.data.lectures || lecturesRes.data;
      if (append) {
        setLectures(prev => [...prev, ...lectureData]);
      } else {
        setLectures(lectureData);
      }
      
      setTotalPages(lecturesRes.data.total_pages || 1);
      setTotalLectures(lecturesRes.data.total || lectureData.length);
      setCurrentPage(page);
      
      // حفظ الإحصائيات الثابتة من السيرفر
      if (lecturesRes.data.stats) {
        setServerStats(lecturesRes.data.stats);
      }
      
      // محاولة جلب تواريخ الفصل من الإعدادات
      let semStart = settingsRes.data.semester_start_date;
      let semEnd = settingsRes.data.semester_end_date;
      let semName = settingsRes.data.current_semester || 'الفصل الحالي';
      
      // إذا لم تكن التواريخ متوفرة، جلب من الفصل النشط مباشرة
      if (!semStart || !semEnd) {
        try {
          const currentSemRes = await api.get('/semesters/current');
          if (currentSemRes.data) {
            semStart = semStart || currentSemRes.data.start_date;
            semEnd = semEnd || currentSemRes.data.end_date;
            semName = semName || currentSemRes.data.name;
          }
        } catch (e) {
          console.log('Error fetching current semester:', e);
        }
      }
      
      setSemesterSettings({
        start: semStart,
        end: semEnd,
        current: semName,
      });
    } catch (error) {
      console.error('Error fetching data:', error);
      if (page === 1) Alert.alert('خطأ', 'فشل في تحميل البيانات');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [courseId, selectedStatus, course]);

  useEffect(() => {
    fetchData(1);
  }, [courseId, selectedStatus]);

  // حفظ محاضرة جديدة باستخدام المكون الموحد
  const handleSaveLecture = async (data: LectureFormData, force: boolean = false) => {
    try {
      await lecturesAPI.create(courseId!, {
        date: data.date,
        start_time: data.start_time,
        end_time: data.end_time,
        room: data.room,
        notes: data.notes || '',
        force,
      });
      Alert.alert('نجاح', 'تم إضافة المحاضرة');
      showNotification('success', 'تم إضافة المحاضرة بنجاح');
      fetchData(1);
    } catch (error: any) {
      const status = error.response?.status;
      const message = error.response?.data?.detail || 'حدث خطأ';
      
      // تحذير: تعارض شعب من نفس المقرر - السماح بالمتابعة
      if (status === 409 && !force) {
        if (Platform.OS === 'web') {
          const confirmed = window.confirm(message + '\n\nهل تريد المتابعة وإنشاء المحاضرة؟');
          if (confirmed) {
            await handleSaveLecture(data, true);
            return;
          }
        } else {
          Alert.alert('تنبيه', message, [
            { text: 'إلغاء', style: 'cancel' },
            { text: 'متابعة', onPress: () => handleSaveLecture(data, true) }
          ]);
        }
        return;
      }
      
      showNotification('error', message);
      throw error;
    }
  };

  // فتح نموذج التوليد مباشرة بدون أي شروط
  const openGenerateModal = () => {
    // التواريخ فارغة - المستخدم يحدد بنفسه
    setTempStartDate('');
    setTempEndDate('');
    
    setGenerateRoom('');
    setGenerateError('');
    setDayConfigs(DAYS.map(d => ({
      day: d.id,
      enabled: false,
      slots: [{ start_time: '08:00', end_time: '09:30' }],
    })));
    setShowGenerateModal(true);
  };

  // ====== دوال تحديد وحذف المحاضرات ======
  
  // تفعيل/إلغاء وضع التحديد
  const toggleSelectionMode = () => {
    setSelectionMode(!selectionMode);
    setSelectedLectures(new Set());
  };

  // تحديد/إلغاء تحديد محاضرة واحدة
  const toggleLectureSelection = (lectureId: string) => {
    const newSelected = new Set(selectedLectures);
    if (newSelected.has(lectureId)) {
      newSelected.delete(lectureId);
    } else {
      newSelected.add(lectureId);
    }
    setSelectedLectures(newSelected);
  };

  // تحديد الكل / إلغاء تحديد الكل
  const toggleSelectAll = () => {
    const filtered = getFilteredLectures();
    if (selectedLectures.size === filtered.length) {
      setSelectedLectures(new Set());
    } else {
      setSelectedLectures(new Set(filtered.map(l => l.id)));
    }
  };

  // حذف المحاضرات المحددة
  const deleteSelectedLectures = async () => {
    if (selectedLectures.size === 0) {
      if (Platform.OS === 'web') {
        window.alert('الرجاء تحديد محاضرات للحذف');
      } else {
        Alert.alert('تنبيه', 'الرجاء تحديد محاضرات للحذف');
      }
      return;
    }

    const confirmMessage = selectedLectures.size === lectures.length 
      ? `هل أنت متأكد من حذف جميع المحاضرات (${lectures.length} محاضرة)؟`
      : `هل أنت متأكد من حذف ${selectedLectures.size} محاضرة؟`;

    const doDelete = async () => {
      setDeleting(true);
      try {
        const deletePromises = Array.from(selectedLectures).map(id => 
          lecturesAPI.delete(id)
        );
        await Promise.all(deletePromises);
        if (Platform.OS === 'web') {
          window.alert(`تم حذف ${selectedLectures.size} محاضرة`);
        } else {
          Alert.alert('نجاح', `تم حذف ${selectedLectures.size} محاضرة`);
        }
        setSelectedLectures(new Set());
        setSelectionMode(false);
        fetchData(1);
      } catch (error) {
        console.error('Error deleting lectures:', error);
        if (Platform.OS === 'web') {
          window.alert('حدث خطأ أثناء حذف المحاضرات');
        } else {
          Alert.alert('خطأ', 'حدث خطأ أثناء حذف المحاضرات');
        }
      } finally {
        setDeleting(false);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(confirmMessage)) {
        await doDelete();
      }
    } else {
      Alert.alert('تأكيد الحذف', confirmMessage, [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'حذف', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  // حذف جميع المحاضرات
  const deleteAllLectures = () => {
    if (lectures.length === 0) {
      if (Platform.OS === 'web') {
        window.alert('لا توجد محاضرات للحذف');
      } else {
        Alert.alert('تنبيه', 'لا توجد محاضرات للحذف');
      }
      return;
    }

    const confirmMessage = `هل أنت متأكد من حذف جميع المحاضرات (${lectures.length} محاضرة)؟\n\nهذا الإجراء لا يمكن التراجع عنه!`;

    const doDeleteAll = async () => {
      setDeleting(true);
      try {
        const deletePromises = lectures.map(l => lecturesAPI.delete(l.id));
        await Promise.all(deletePromises);
        if (Platform.OS === 'web') {
          window.alert(`تم حذف جميع المحاضرات (${lectures.length})`);
        } else {
          Alert.alert('نجاح', `تم حذف جميع المحاضرات (${lectures.length})`);
        }
        setSelectionMode(false);
        fetchData(1);
      } catch (error) {
        console.error('Error deleting all lectures:', error);
        if (Platform.OS === 'web') {
          window.alert('حدث خطأ أثناء حذف المحاضرات');
        } else {
          Alert.alert('خطأ', 'حدث خطأ أثناء حذف المحاضرات');
        }
      } finally {
        setDeleting(false);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(confirmMessage)) {
        doDeleteAll();
      }
    } else {
      Alert.alert('حذف جميع المحاضرات', confirmMessage, [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'حذف الكل', style: 'destructive', onPress: doDeleteAll },
      ]);
    }
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
        const prevSlot = newSlots[slotIndex];
        newSlots[slotIndex] = { ...prevSlot, [field]: value };
        // اقتراح النهاية تلقائياً عند تغيير البداية (يحافظ على المدة السابقة)
        if (field === 'start_time' && value) {
          newSlots[slotIndex].end_time = suggestEndTime(value, prevSlot.start_time, prevSlot.end_time);
        }
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
    setGenerateError('');
    
    if (!tempStartDate || !tempEndDate) {
      setGenerateError('الرجاء اختيار تاريخ البداية والنهاية');
      return;
    }
    if (tempStartDate >= tempEndDate) {
      setGenerateError('تاريخ النهاية يجب أن يكون بعد تاريخ البداية');
      return;
    }
    if (!generateRoom.trim()) {
      setGenerateError('الرجاء إدخال رقم القاعة');
      return;
    }

    const enabledDays = dayConfigs.filter(d => d.enabled);
    if (enabledDays.length === 0) {
      setGenerateError('الرجاء اختيار يوم واحد على الأقل');
      return;
    }

    if (!confirm(`هل أنت متأكد من توليد المحاضرات من ${tempStartDate} إلى ${tempEndDate}؟`)) return;

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
        start_date: tempStartDate,
        end_date: tempEndDate,
      });

      const count = response.data.lectures_created || 0;
      const skipped = response.data.conflicts_skipped || 0;
      const wsCreated = response.data.weekly_cells_created || 0;
      const wsExisting = response.data.weekly_cells_existing || 0;
      const wsNotes: string[] = response.data.weekly_notes || [];
      let msg = `تم توليد ${count} محاضرة بنجاح`;
      if (skipped > 0) msg += `\n(تم تخطي ${skipped} محاضرة بسبب تعارض مع أستاذ آخر)`;
      if (wsCreated > 0) msg += `\n🗓️ أُدرج ${wsCreated} موعد في الجدول الأسبوعي (العرض الشامل)`;
      if (wsExisting > 0) msg += `\n🗓️ ${wsExisting} موعد مدرج مسبقاً في الجدول الأسبوعي`;
      if (wsNotes.length > 0) msg += `\n⚠️ الجدول الأسبوعي:\n• ${wsNotes.join('\n• ')}`;
      if (skipped > 0 || wsNotes.length > 0) {
        showNotification('warning', msg);
      } else {
        showNotification('success', msg);
      }
      setShowGenerateModal(false);
      fetchData(1);
    } catch (error: any) {
      const message = error.response?.data?.detail || 'فشل في توليد المحاضرات';
      showNotification('error', message);
    } finally {
      setGenerating(false);
    }
  };

  const handleDeleteLecture = async (lectureId: string) => {
    if (!confirm('هل تريد حذف هذه المحاضرة؟')) return;
    try {
      await lecturesAPI.delete(lectureId);
      showNotification('success', 'تم حذف المحاضرة');
      fetchData(1);
    } catch (error: any) {
      showNotification('error', 'فشل في حذف المحاضرة');
    }
  };

  const handleCancelLecture = async (lectureId: string) => {
    let reason = '';
    if (Platform.OS === 'web') {
      const r = window.prompt('أدخل سبب إلغاء المحاضرة (سيظهر في التقارير):', '');
      if (r === null) return; // المستخدم ضغط إلغاء
      reason = r.trim();
    } else {
      // على الموبايل نستخدم نافذة تأكيد بسيطة
      const ok = await new Promise<boolean>((resolve) => {
        Alert.alert(
          'إلغاء المحاضرة',
          'هل أنت متأكد من إلغاء هذه المحاضرة؟ يمكنك إضافة السبب من تعديل المحاضرة لاحقاً.',
          [
            { text: 'تراجع', style: 'cancel', onPress: () => resolve(false) },
            { text: 'تأكيد الإلغاء', style: 'destructive', onPress: () => resolve(true) },
          ],
        );
      });
      if (!ok) return;
    }
    try {
      const payload: any = { status: 'cancelled' };
      if (reason) payload.cancellation_reason = reason;
      await lecturesAPI.update(lectureId, payload);
      showNotification('success', 'تم إلغاء المحاضرة');
      fetchData(1);
    } catch (error: any) {
      showNotification('error', 'فشل في إلغاء المحاضرة');
    }
  };

  // 🏛️ تغيير قاعة المحاضرة فقط (مع فحص التعارض والإشعارات)
  const handleChangeRoom = async (force: boolean = false) => {
    if (!roomChangeModal || !newRoom) return;
    setChangingRoom(true);
    try {
      const res = await api.put(`/lectures/${roomChangeModal.lectureId}/room`, { room: newRoom, force });
      showNotification('success', res.data.message || 'تم تغيير القاعة بنجاح');
      setRoomChangeModal(null);
      fetchData(1);
    } catch (error: any) {
      const status = error.response?.status;
      const message = error.response?.data?.detail || 'حدث خطأ في تغيير القاعة';
      // تحذير قابل للتجاوز (دمج شعبتين لنفس المعلم)
      if (status === 409 && !force) {
        if (Platform.OS === 'web') {
          if (window.confirm(message + '\n\nهل تريد المتابعة؟')) {
            await handleChangeRoom(true);
          }
        } else {
          Alert.alert('تنبيه', message, [
            { text: 'إلغاء', style: 'cancel' },
            { text: 'متابعة', onPress: () => handleChangeRoom(true) },
          ]);
        }
      } else {
        showNotification('error', message);
      }
    } finally {
      setChangingRoom(false);
    }
  };

  const handleReschedule = async () => {
    if (!rescheduleModal) return;
    if (!rescheduleData.date) {
      if (Platform.OS === 'web') window.alert('يرجى اختيار التاريخ الجديد');
      else Alert.alert('تنبيه', 'يرجى اختيار التاريخ الجديد');
      return;
    }
    if (rescheduleData.start_time && rescheduleData.end_time && rescheduleData.end_time <= rescheduleData.start_time) {
      if (Platform.OS === 'web') window.alert('وقت النهاية يجب أن يكون بعد وقت البداية');
      else Alert.alert('خطأ', 'وقت النهاية يجب أن يكون بعد وقت البداية');
      return;
    }
    setRescheduling(true);
    try {
      const res = await api.put(`/lectures/${rescheduleModal.lectureId}/reschedule`, rescheduleData);
      showNotification('success', res.data.message || 'تم إعادة الجدولة بنجاح');
      setRescheduleModal(null);
      fetchData(1);
    } catch (error: any) {
      const msg = error.response?.data?.detail || error.message || 'فشل في إعادة الجدولة';
      showNotification('error', msg);
    } finally {
      setRescheduling(false);
    }
  };


  const renderLecture = ({ item, index }: { item: Lecture; index: number }) => {
    const statusInfo = STATUS_LABELS[item.status] || STATUS_LABELS.scheduled;
    const isSelected = selectedLectures.has(item.id);
    const lectureDate = parseDate(item.date);
    const dayName = WEEKDAYS_AR[lectureDate.getDay()];
    const dateStr = formatGregorianDate(lectureDate, { includeYear: true });
    const studentsTotal = (item as any).students_count ?? course?.students_count ?? 0;
    const stCounts = (item as any).attendance_stats || {};
    const presentCount = stCounts.present ?? 0;
    const absentCount = stCounts.absent ?? studentsTotal;

    const CardWrapper: any = selectionMode ? TouchableOpacity : View;
    return (
      <CardWrapper
        dataSet={{ responsive: "lecture-card" }}
        style={[styles.lectureCardNew, isSelected && styles.lectureCardNewSelected]}
        {...(selectionMode ? { onPress: () => toggleLectureSelection(item.id), activeOpacity: 0.7 } : {})}
      >
        {/* الرقم التسلسلي / مربع التحديد */}
        {selectionMode ? (
          <TouchableOpacity
            style={styles.lectureNumWrap}
            onPress={() => toggleLectureSelection(item.id)}
            testID={`lecture-checkbox-${item.id}`}
          >
            <Ionicons name={isSelected ? 'checkbox' : 'square-outline'} size={22} color={isSelected ? '#2962ff' : '#8a94a8'} />
          </TouchableOpacity>
        ) : (
          <View style={styles.lectureNumWrap}>
            <View style={styles.lectureNumBadge}>
              <Text style={styles.lectureNumText}>{index + 1}</Text>
            </View>
          </View>
        )}

        {/* العمود الأول: اليوم + التاريخ */}
        <View style={styles.lectureDayCol}>
          <Text style={styles.lectureDayName}>{dayName}</Text>
          <Text style={styles.lectureDateText}>{dateStr}</Text>
        </View>

        {/* الوسط: الوقت + المكان */}
        <View style={styles.lectureMidCol}>
          <View style={styles.lectureMetaRowNew}>
            <View style={styles.lectureMetaItem}>
              <Ionicons name="time-outline" size={13} color="#5b6678" />
              <Text style={styles.lectureMetaText}>{item.start_time} - {item.end_time}</Text>
            </View>
            {item.room ? (
              <View style={styles.lectureMetaItem}>
                <Ionicons name="location-outline" size={13} color="#5b6678" />
                <Text style={styles.lectureMetaText}>{item.room}</Text>
              </View>
            ) : null}
          </View>
          {item.last_rescheduled_from && (
            <View style={styles.noteBoxInfoNew}>
              <Ionicons name="swap-horizontal" size={12} color="#1565c0" />
              <Text style={styles.noteTextNew} numberOfLines={1}>
                أُعيدت الجدولة من {formatGregorianDate(parseDate(item.last_rescheduled_from), { includeYear: false })}
                {item.rescheduled_by_name ? ` · ${item.rescheduled_by_name}` : ''}
              </Text>
            </View>
          )}
        </View>

        {/* العمليات */}
        <View style={styles.lectureActionsNew}>
          <TouchableOpacity style={styles.actBtnDetails} onPress={() => router.push({ pathname: '/take-attendance', params: { lectureId: item.id } })}>
            <Ionicons name="information-circle-outline" size={14} color="#2962ff" />
            <Text style={styles.actBtnDetailsText}>التفاصيل</Text>
          </TouchableOpacity>
          {canReschedule && (item.status === 'scheduled' || item.status === 'absent') && (
            <TouchableOpacity
              style={styles.actBtnReschedule}
              onPress={() => {
                setRescheduleData({ date: '', start_time: item.start_time || '08:00', end_time: item.end_time || '09:00', room: item.room || '' });
                setRescheduleModal({ lectureId: item.id, courseName: course?.name || '', oldDate: item.date });
              }}
              testID={`reschedule-${item.id}`}
            >
              <Ionicons name="calendar-outline" size={14} color="#ff9800" />
              <Text style={styles.actBtnRescheduleText}>إعادة الجدولة</Text>
            </TouchableOpacity>
          )}
          {item.status === 'scheduled' && (
            <TouchableOpacity style={styles.actBtnAttend} onPress={() => router.push({ pathname: '/take-attendance', params: { lectureId: item.id } })}>
              <Ionicons name="checkmark-circle-outline" size={14} color="#22a35a" />
              <Text style={styles.actBtnAttendText}>تسجيل الحضور</Text>
            </TouchableOpacity>
          )}
          {item.status === 'completed' && (
            <TouchableOpacity style={styles.actBtnAttend} onPress={() => router.push({ pathname: '/take-attendance', params: { lectureId: item.id } })}>
              <Ionicons name="eye-outline" size={14} color="#22a35a" />
              <Text style={styles.actBtnAttendText}>عرض الحضور</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.dotsBtn}
            onPress={() => setOpenMenuId(openMenuId === item.id ? null : item.id)}
            accessibilityLabel="العمليات"
          >
            <Ionicons name="ellipsis-vertical" size={16} color="#5b6678" />
          </TouchableOpacity>
        </View>

        {/* شارة الحالة */}
        <View dataSet={{ responsive: "lecture-status-abs" }} style={[styles.statusBadgeAbs, { backgroundColor: statusInfo.color }]}>
          <Text style={styles.statusBadgeAbsText}>{statusInfo.label}</Text>
        </View>
      </CardWrapper>
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
        {/* شريط الإشعارات */}
        {notification && (
          <TouchableOpacity
            onPress={() => setNotification(null)}
            style={{
              backgroundColor: notification.type === 'success' ? '#4caf50' : notification.type === 'warning' ? '#ef6c00' : '#f44336',
              padding: 14,
              marginHorizontal: 20,
              marginTop: 12,
              borderRadius: 10,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            data-testid="notification-banner"
          >
            <Ionicons name={notification.type === 'success' ? 'checkmark-circle' : 'alert-circle'} size={20} color="#fff" />
            <Text style={{ color: '#fff', marginLeft: 8, fontWeight: '600', fontSize: 15 }}>{notification.message}</Text>
          </TouchableOpacity>
        )}

        <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.pageScroll, { flexGrow: 1 }]} showsVerticalScrollIndicator={true}>

          {/* رأس الصفحة الموحّد (breadcrumb + بطاقة المقرر + تبويبات + تعديل/حذف) */}
          {courseId && (
            <CourseTabBar
              courseId={courseId as string}
              course={course}
              activeTab="lectures"
              onCourseUpdated={() => fetchData(1, false)}
              canManage={canManageLectures}
            />
          )}

          {/* أزرار إجراءات المحاضرات */}
          {canManageLectures && (
            <View style={styles.lecturesActionsRow}>
              <TouchableOpacity style={[styles.headerBtn, styles.btnAddGreen]} onPress={() => setShowAddModal(true)}>
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={styles.btnPrimaryText}>إضافة محاضرة</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.headerBtn, styles.btnGeneratePurple]} onPress={openGenerateModal}>
                <Ionicons name="flash" size={16} color="#fff" />
                <Text style={styles.btnPrimaryText}>توليد تلقائي</Text>
              </TouchableOpacity>
              {lectures.length > 0 && (
                <TouchableOpacity style={[styles.headerBtn, styles.btnGhost]} onPress={toggleSelectionMode}>
                  <Ionicons name={selectionMode ? 'close' : 'checkbox-outline'} size={16} color="#1a2540" />
                  <Text style={styles.btnGhostText}>{selectionMode ? 'إلغاء التحديد' : 'تحديد متعدد'}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* 4 بطاقات إحصائيات */}
          <View dataSet={{ responsive: "stats-grid" }} style={styles.statsGrid}>
            {(() => {
              const stats = getStats();
              const totalLectures = lectures.length;
              return (
                <>
                  <View style={styles.statCard}>
                    <View style={[styles.statIconWrap, { backgroundColor: '#e7f0fe' }]}>
                      <Ionicons name="library" size={20} color="#2962ff" />
                    </View>
                    <View style={styles.statTextCol}>
                      <Text style={styles.statValueNew}>{totalLectures}</Text>
                      <Text style={styles.statLabelNew}>إجمالي المحاضرات</Text>
                    </View>
                  </View>
                  <View style={styles.statCard}>
                    <View style={[styles.statIconWrap, { backgroundColor: '#e7f6ee' }]}>
                      <Ionicons name="calendar" size={20} color="#22a35a" />
                    </View>
                    <View style={styles.statTextCol}>
                      <Text style={styles.statValueNew}>{stats.scheduled}</Text>
                      <Text style={styles.statLabelNew}>مجدولة</Text>
                    </View>
                  </View>
                  <View style={styles.statCard}>
                    <View style={[styles.statIconWrap, { backgroundColor: '#e7f6ee' }]}>
                      <Ionicons name="checkmark-circle" size={20} color="#22a35a" />
                    </View>
                    <View style={styles.statTextCol}>
                      <Text style={styles.statValueNew}>{stats.completed}</Text>
                      <Text style={styles.statLabelNew}>منفذة</Text>
                    </View>
                  </View>
                  <View style={styles.statCard}>
                    <View style={[styles.statIconWrap, { backgroundColor: '#fff3e0' }]}>
                      <Ionicons name="warning" size={20} color="#ff9800" />
                    </View>
                    <View style={styles.statTextCol}>
                      <Text style={styles.statValueNew}>{stats.absent}</Text>
                      <Text style={styles.statLabelNew}>غائب</Text>
                    </View>
                  </View>
                </>
              );
            })()}
          </View>

          {/* بطاقة الفلاتر */}
          <View style={styles.filterCard}>
            <View dataSet={{ responsive: "filter-row" }} style={styles.filterRowLec}>
              <View style={styles.filterFieldFlex2}>
                <View style={styles.dropdown}>
                  <Picker selectedValue={selectedStatus || ''} onValueChange={(v) => setSelectedStatus(v || null)} style={styles.dropdownInner}>
                    <Picker.Item label="كل الحالات" value="" />
                    <Picker.Item label="مجدولة" value="scheduled" />
                    <Picker.Item label="منفذة" value="completed" />
                    <Picker.Item label="ملغاة" value="cancelled" />
                    <Picker.Item label="غائب" value="absent" />
                  </Picker>
                </View>
              </View>
              <View style={styles.filterFieldFlex2}>
                <View style={styles.dropdown}>
                  <Picker selectedValue={selectedDay} onValueChange={(v) => setSelectedDay(v)} style={styles.dropdownInner}>
                    <Picker.Item label="كل الأيام" value="" />
                    {WEEKDAYS_AR.map((d, i) => <Picker.Item key={i} label={d} value={String(i)} />)}
                  </Picker>
                </View>
              </View>
              <View style={styles.dateRangeBox}>
                <Ionicons name="calendar-outline" size={14} color="#8a95a8" />
                {Platform.OS === 'web' ? (
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e: any) => setDateFrom(e.target.value)}
                    style={{
                      flex: 1, border: 'none', backgroundColor: 'transparent', fontSize: 13,
                      color: dateFrom ? '#1a2540' : '#a8b1c2', padding: '4px 6px', textAlign: 'right',
                      outline: 'none', fontFamily: 'inherit',
                    } as any}
                    data-testid="date-from-input"
                  />
                ) : (
                  <TextInput
                    style={styles.dateInput}
                    placeholder="من"
                    value={dateFrom}
                    onChangeText={setDateFrom}
                    placeholderTextColor="#a8b1c2"
                  />
                )}
                <Text style={styles.dateSep}>–</Text>
                {Platform.OS === 'web' ? (
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e: any) => setDateTo(e.target.value)}
                    style={{
                      flex: 1, border: 'none', backgroundColor: 'transparent', fontSize: 13,
                      color: dateTo ? '#1a2540' : '#a8b1c2', padding: '4px 6px', textAlign: 'right',
                      outline: 'none', fontFamily: 'inherit',
                    } as any}
                    data-testid="date-to-input"
                  />
                ) : (
                  <TextInput
                    style={styles.dateInput}
                    placeholder="إلى"
                    value={dateTo}
                    onChangeText={setDateTo}
                    placeholderTextColor="#a8b1c2"
                  />
                )}
              </View>
              <TouchableOpacity
                style={styles.filterApplyBtn}
                onPress={() => { setSelectedStatus(null); setSelectedDay(''); setDateFrom(''); setDateTo(''); setPageNum(1); }}
              >
                <Ionicons name="funnel-outline" size={14} color="#1a2540" />
                <Text style={styles.btnGhostText}>تصفية</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* شريط التحديد (يظهر فقط عند تفعيله) */}
          {selectionMode && canManageLectures && (
            <View style={styles.selBarLec}>
              <TouchableOpacity style={styles.selBarItem} onPress={toggleSelectAll}>
                <Ionicons name={selectedLectures.size === getFilteredLectures().length ? 'checkbox' : 'square-outline'} size={18} color="#2962ff" />
                <Text style={styles.selBarText}>{selectedLectures.size === getFilteredLectures().length ? 'إلغاء الكل' : 'تحديد الكل'}</Text>
              </TouchableOpacity>
              <Text style={styles.selBarCount}>{selectedLectures.size} / {getFilteredLectures().length}</Text>
              <View style={{ flex: 1 }} />
              <TouchableOpacity style={[styles.selActionBtn, { backgroundColor: '#f44336' }]} onPress={deleteSelectedLectures} disabled={selectedLectures.size === 0 || deleting}>
                {deleting ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="trash" size={14} color="#fff" />}
                <Text style={styles.selActionText}>حذف</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.selActionBtn, { backgroundColor: '#c62828' }]} onPress={deleteAllLectures} disabled={deleting}>
                <Ionicons name="trash-bin" size={14} color="#fff" />
                <Text style={styles.selActionText}>حذف الكل</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* قائمة المحاضرات */}
          {(() => {
            let filtered = getFilteredLectures();
            // فلاتر إضافية
            if (selectedDay !== '') {
              filtered = filtered.filter(l => String(parseDate(l.date).getDay()) === selectedDay);
            }
            if (dateFrom) filtered = filtered.filter(l => l.date >= dateFrom);
            if (dateTo) filtered = filtered.filter(l => l.date <= dateTo);

            const total = filtered.length;
            const totPages = Math.max(1, Math.ceil(total / perPage));
            const paged = filtered.slice((pageNum - 1) * perPage, pageNum * perPage);

            if (total === 0) {
              return (
                <View style={styles.tableCard}>
                  <View style={styles.tableEmpty}>
                    <Ionicons name="calendar-outline" size={48} color="#cfd6e1" />
                    <Text style={styles.tableEmptyText}>
                      {lectures.length === 0 ? 'لا توجد محاضرات' : 'لا توجد محاضرات تطابق الفلتر'}
                    </Text>
                    {lectures.length === 0 && canManageLectures && (
                      <TouchableOpacity style={[styles.headerBtn, styles.btnGeneratePurple, { marginTop: 8 }]} onPress={openGenerateModal}>
                        <Ionicons name="flash" size={14} color="#fff" />
                        <Text style={styles.btnPrimaryText}>توليد للفصل النشط</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            }

            return (
              <View>
                <View style={{ gap: 12 }}>
                  {paged.map((item, idx) => (
                    <View key={item.id}>{renderLecture({ item, index: (pageNum - 1) * perPage + idx })}</View>
                  ))}
                </View>

                {/* تذييل: pagination */}
                <View style={[styles.tableFooter, { backgroundColor: '#fff', borderRadius: 14, marginTop: 14, borderWidth: 1, borderColor: '#eef1f6' }]}>
                  <View style={styles.perPageWrap}>
                    <Text style={styles.perPageLbl}>عرض {((pageNum - 1) * perPage) + 1} إلى {Math.min(pageNum * perPage, total)} من {total} محاضرات</Text>
                  </View>
                  <View style={styles.pagerWrap}>
                    <Text style={styles.perPageLbl}>لكل صفحة</Text>
                    <View style={[styles.perPageBox, { width: 64 }]}>
                      <Picker selectedValue={String(perPage)} onValueChange={(v) => { setPerPage(parseInt(v) || 10); setPageNum(1); }} style={styles.perPagePicker}>
                        {[10, 25, 50, 100].map(n => <Picker.Item key={n} label={String(n)} value={String(n)} />)}
                      </Picker>
                    </View>
                    {totPages > 1 && (
                      <>
                        <TouchableOpacity style={[styles.pagerNavBtn, pageNum <= 1 && styles.pagerNavBtnDisabled]} onPress={() => setPageNum(p => Math.max(1, p - 1))} disabled={pageNum <= 1}>
                          <Text style={[styles.pagerNavText, pageNum <= 1 && { color: '#c0c8d4' }]}>السابق</Text>
                        </TouchableOpacity>
                        {Array.from({ length: totPages }, (_, i) => i + 1).slice(0, 5).map(p => (
                          <TouchableOpacity key={p} style={[styles.pagerBtn, pageNum === p && styles.pagerBtnActive]} onPress={() => setPageNum(p)}>
                            <Text style={[styles.pagerBtnText, pageNum === p && styles.pagerBtnTextActive]}>{p}</Text>
                          </TouchableOpacity>
                        ))}
                        <TouchableOpacity style={[styles.pagerNavBtn, pageNum >= totPages && styles.pagerNavBtnDisabled]} onPress={() => setPageNum(p => Math.min(totPages, p + 1))} disabled={pageNum >= totPages}>
                          <Text style={[styles.pagerNavText, pageNum >= totPages && { color: '#c0c8d4' }]}>التالي</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                </View>
              </View>
            );
          })()}

        </ScrollView>

        {/* قائمة العمليات (3 نقاط) */}
        {openMenuId && (() => {
          const lec = lectures.find(l => l.id === openMenuId);
          if (!lec) return null;
          return (
            <Modal visible transparent animationType="fade" onRequestClose={() => setOpenMenuId(null)}>
              <View style={styles.modalOverlayNew}>
                <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setOpenMenuId(null)} />
                <View style={styles.menuModalCard}>
                  <View style={styles.menuModalHeader}>
                    <Text style={styles.menuModalTitle} numberOfLines={1}>{WEEKDAYS_AR[parseDate(lec.date).getDay()]} · {formatGregorianDate(parseDate(lec.date), { includeYear: true })}</Text>
                    <TouchableOpacity onPress={() => setOpenMenuId(null)}>
                      <Ionicons name="close" size={20} color="#5b6678" />
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity style={styles.menuItem} onPress={() => { setOpenMenuId(null); router.push({ pathname: '/take-attendance', params: { lectureId: lec.id } }); }}>
                    <Ionicons name="information-circle-outline" size={18} color="#2962ff" />
                    <Text style={styles.menuText}>عرض التفاصيل</Text>
                  </TouchableOpacity>
                  {canReschedule && (lec.status === 'scheduled' || lec.status === 'absent') && (
                    <TouchableOpacity style={styles.menuItem} onPress={() => {
                      setOpenMenuId(null);
                      setRescheduleData({ date: '', start_time: lec.start_time || '08:00', end_time: lec.end_time || '09:00', room: lec.room || '' });
                      setRescheduleModal({ lectureId: lec.id, courseName: course?.name || '', oldDate: lec.date });
                    }}>
                      <Ionicons name="calendar-outline" size={18} color="#ff9800" />
                      <Text style={styles.menuText}>إعادة الجدولة</Text>
                    </TouchableOpacity>
                  )}
                  {canManageLectures && lec.status === 'scheduled' && (
                    <TouchableOpacity style={styles.menuItem} testID="change-room-menu-item" onPress={() => {
                      setOpenMenuId(null);
                      setNewRoom('');
                      setRoomChangeModal({ lectureId: lec.id, currentRoom: lec.room || '', date: lec.date, time: `${lec.start_time || ''} - ${lec.end_time || ''}`, startTime: lec.start_time || '', endTime: lec.end_time || '' });
                    }}>
                      <Ionicons name="location-outline" size={18} color="#9c27b0" />
                      <Text style={styles.menuText}>تغيير القاعة</Text>
                    </TouchableOpacity>
                  )}
                  {canManageLectures && lec.status === 'scheduled' && (
                    <TouchableOpacity style={styles.menuItem} onPress={() => { setOpenMenuId(null); handleCancelLecture(lec.id); }}>
                      <Ionicons name="close-circle-outline" size={18} color="#f57c00" />
                      <Text style={styles.menuText}>إلغاء المحاضرة</Text>
                    </TouchableOpacity>
                  )}
                  {canManageLectures && (
                    <TouchableOpacity style={[styles.menuItem, styles.menuItemDanger]} onPress={() => { setOpenMenuId(null); handleDeleteLecture(lec.id); }}>
                      <Ionicons name="trash-outline" size={18} color="#f44336" />
                      <Text style={[styles.menuText, { color: '#f44336' }]}>حذف</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </Modal>
          );
        })()}

        {/* Add Lecture Modal - Using the new unified component */}
        {/* Add Lecture Modal - Using the new unified component */}
        <AddLectureModal
          visible={showAddModal}
          onClose={() => setShowAddModal(false)}
          onSave={handleSaveLecture}
          selectedCourseId={courseId}
          showCourseSelector={false}
          facultyId={course?.faculty_id}
          accessibilityLabel="إضافة محاضرة"
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
              {/* فترة توليد المحاضرات - Date Pickers */}
              <View style={styles.generateSection}>
                <View style={styles.generateSectionHeader}>
                  <Ionicons name="calendar" size={20} color="#4caf50" />
                  <Text style={styles.generateSectionTitle}>فترة توليد المحاضرات</Text>
                </View>
                <View style={styles.semesterDatesBox}>
                  <View style={[styles.semesterDateItem, { flex: 1 }]}>
                    <Text style={styles.semesterDateLabel}>من تاريخ</Text>
                    {Platform.OS === 'web' ? (
                      <input
                        type="date"
                        value={tempStartDate}
                        onChange={(e: any) => setTempStartDate(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '8px',
                          borderRadius: '8px',
                          border: '1px solid #e0e0e0',
                          fontSize: '14px',
                          backgroundColor: '#f9f9f9',
                          color: '#333',
                          boxSizing: 'border-box',
                        }}
                      />
                    ) : (
                      <TextInput
                        style={styles.dateModalInput}
                        value={tempStartDate}
                        onChangeText={setTempStartDate}
                        placeholder="YYYY-MM-DD"
                      />
                    )}
                  </View>
                  <Ionicons name="arrow-forward" size={20} color="#999" style={{ marginHorizontal: 8, marginTop: 24 }} />
                  <View style={[styles.semesterDateItem, { flex: 1 }]}>
                    <Text style={styles.semesterDateLabel}>إلى تاريخ</Text>
                    {Platform.OS === 'web' ? (
                      <input
                        type="date"
                        value={tempEndDate}
                        onChange={(e: any) => setTempEndDate(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '8px',
                          borderRadius: '8px',
                          border: '1px solid #e0e0e0',
                          fontSize: '14px',
                          backgroundColor: '#f9f9f9',
                          color: '#333',
                          boxSizing: 'border-box',
                        }}
                      />
                    ) : (
                      <TextInput
                        style={styles.dateModalInput}
                        value={tempEndDate}
                        onChangeText={setTempEndDate}
                        placeholder="YYYY-MM-DD"
                      />
                    )}
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

              {/* Room - قائمة منسدلة من القاعات المسجلة */}
              <View style={styles.generateSection}>
                <View style={styles.generateSectionHeader}>
                  <Ionicons name="location" size={20} color="#9c27b0" />
                  <Text style={styles.generateSectionTitle}>القاعة</Text>
                </View>
                <RoomPicker
                  value={generateRoom}
                  onChange={setGenerateRoom}
                  testID="generate-room-picker"
                  facultyId={course?.faculty_id}
                  occurrences={generateOccurrences}
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
                                  {Platform.OS === 'web' ? (
                                    <input
                                      type="time"
                                      value={slot.start_time}
                                      onChange={(e: any) => updateSlotTime(day.id, index, 'start_time', e.target.value)}
                                      data-testid={`start-time-select-${day.id}-${index}`}
                                      style={{
                                        width: '100%',
                                        padding: '10px 12px',
                                        borderRadius: '8px',
                                        border: '1px solid #ddd',
                                        fontSize: '16px',
                                        backgroundColor: '#f9f9f9',
                                        color: '#333',
                                        textAlign: 'center',
                                        boxSizing: 'border-box' as any,
                                      }}
                                    />
                                  ) : (
                                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                      {TIME_SLOTS.map(time => (
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
                                  )}
                                </View>
                                <View style={styles.slotTimeBox}>
                                  <Text style={styles.slotTimeLabel}>إلى</Text>
                                  {Platform.OS === 'web' ? (
                                    <input
                                      type="time"
                                      value={slot.end_time}
                                      onChange={(e: any) => updateSlotTime(day.id, index, 'end_time', e.target.value)}
                                      data-testid={`end-time-select-${day.id}-${index}`}
                                      style={{
                                        width: '100%',
                                        padding: '10px 12px',
                                        borderRadius: '8px',
                                        border: '1px solid #ddd',
                                        fontSize: '16px',
                                        backgroundColor: '#f9f9f9',
                                        color: '#333',
                                        textAlign: 'center',
                                        boxSizing: 'border-box' as any,
                                      }}
                                    />
                                  ) : (
                                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                      {TIME_SLOTS.map(time => (
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
                                  )}
                                </View>
                              </View>
                              <TimeRangeSummary start={slot.start_time} end={slot.end_time} compact />
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
              {generateError ? (
                <View style={{ backgroundColor: '#ffebee', padding: 12, borderRadius: 8, marginBottom: 10, width: '100%' }}>
                  <Text style={{ color: '#c62828', textAlign: 'center', fontSize: 14, fontWeight: '600' }}>{generateError}</Text>
                </View>
              ) : null}
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
      
      {/* Modal إعادة الجدولة */}
      {rescheduleModal && (
        <Modal visible={true} transparent animationType="fade">
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '90%', maxWidth: 400 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 16, color: '#1a237e' }}>
                إعادة جدولة محاضرة
              </Text>
              <Text style={{ textAlign: 'center', color: '#666', marginBottom: 16 }}>
                {rescheduleModal.courseName} - {rescheduleModal.oldDate}
              </Text>
              
              {/* التاريخ الجديد */}
              <Text style={{ fontWeight: '600', marginBottom: 8, color: '#333' }}>التاريخ الجديد:</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={rescheduleData.date}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={(e: any) => setRescheduleData(prev => ({ ...prev, date: e.target.value }))}
                  data-testid="reschedule-date-input"
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid #ddd',
                    fontSize: '16px',
                    textAlign: 'center',
                    marginBottom: '4px',
                    boxSizing: 'border-box',
                    backgroundColor: '#f9f9f9',
                  }}
                />
              ) : (
                <TextInput
                  style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, marginBottom: 4, textAlign: 'center', fontSize: 16 }}
                  placeholder="YYYY-MM-DD"
                  value={rescheduleData.date}
                  onChangeText={(text) => setRescheduleData(prev => ({ ...prev, date: text }))}
                  data-testid="reschedule-date-input"
                />
              )}
              {/* عرض اسم اليوم */}
              {rescheduleData.date && (() => {
                const [y, m, d] = rescheduleData.date.split('-').map(Number);
                if (y && m && d) {
                  const dayName = WEEKDAYS_AR[new Date(y, m - 1, d).getDay()];
                  return <Text style={{ fontSize: 14, color: '#1565c0', fontWeight: '600', marginBottom: 16, textAlign: 'center' }}>{dayName}</Text>;
                }
                return <View style={{ marginBottom: 16 }} />;
              })()}
              
              {/* وقت البداية */}
              <Text style={{ fontWeight: '600', marginBottom: 8, color: '#333' }}>وقت البداية:</Text>
              <input
                type="time"
                value={rescheduleData.start_time}
                onChange={(e: any) => setRescheduleData(prev => ({ ...prev, start_time: e.target.value, end_time: e.target.value ? suggestEndTime(e.target.value, prev.start_time, prev.end_time) : prev.end_time }))}
                data-testid="reschedule-start-time"
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid #ddd',
                  fontSize: '16px',
                  textAlign: 'center',
                  marginBottom: '16px',
                  boxSizing: 'border-box',
                  backgroundColor: '#f9f9f9',
                }}
              />
              
              {/* وقت النهاية */}
              <Text style={{ fontWeight: '600', marginBottom: 8, color: '#333' }}>وقت النهاية:</Text>
              <input
                type="time"
                value={rescheduleData.end_time}
                onChange={(e: any) => setRescheduleData(prev => ({ ...prev, end_time: e.target.value }))}
                data-testid="reschedule-end-time"
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid #ddd',
                  fontSize: '16px',
                  textAlign: 'center',
                  marginBottom: '8px',
                  boxSizing: 'border-box',
                  backgroundColor: '#f9f9f9',
                }}
              />
              <View style={{ marginBottom: 8 }}>
                <TimeRangeSummary start={rescheduleData.start_time} end={rescheduleData.end_time} />
              </View>

              {/* 🏛️ تغيير القاعة مع كشف التوفر في الموعد الجديد */}
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#3a4560', marginBottom: 6, textAlign: 'right' as any }}>
                القاعة (يمكن تغييرها — 🟢 متاحة / 🔴 مشغولة في الموعد الجديد)
              </Text>
              <View style={{ marginBottom: 16 }}>
                <RoomPicker
                  value={rescheduleData.room}
                  onChange={(room) => setRescheduleData(prev => ({ ...prev, room }))}
                  testID="reschedule-room-picker"
                  facultyId={course?.faculty_id}
                  excludeLectureId={rescheduleModal?.lectureId}
                  occurrences={
                    rescheduleData.date && rescheduleData.start_time && rescheduleData.end_time
                      ? [{ date: rescheduleData.date, start_time: rescheduleData.start_time, end_time: rescheduleData.end_time }]
                      : undefined
                  }
                />
              </View>
              
              {/* الأزرار */}
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <TouchableOpacity
                  style={{ flex: 1, backgroundColor: '#e0e0e0', padding: 14, borderRadius: 10, alignItems: 'center' }}
                  onPress={() => setRescheduleModal(null)}
                >
                  <Text style={{ fontWeight: '600', color: '#333' }}>إلغاء</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, backgroundColor: '#ff9800', padding: 14, borderRadius: 10, alignItems: 'center', opacity: rescheduling ? 0.6 : 1 }}
                  onPress={handleReschedule}
                  disabled={rescheduling}
                  data-testid="confirm-reschedule-btn"
                >
                  <Text style={{ fontWeight: '600', color: '#fff' }}>
                    {rescheduling ? 'جاري...' : 'إعادة الجدولة'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* 🏛️ نافذة تغيير القاعة فقط */}
      {roomChangeModal && (
        <Modal visible={true} transparent animationType="fade">
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '90%', maxWidth: 400 }} testID="change-room-modal">
              <Text style={{ fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 8, color: '#4a148c' }}>
                تغيير قاعة المحاضرة
              </Text>
              <Text style={{ textAlign: 'center', color: '#666', marginBottom: 16 }}>
                {roomChangeModal.date} · {roomChangeModal.time}
              </Text>
              <View style={{ backgroundColor: '#f3e5f5', borderRadius: 8, padding: 10, marginBottom: 16 }}>
                <Text style={{ textAlign: 'center', color: '#6a1b9a', fontWeight: '600' }}>
                  القاعة الحالية: {roomChangeModal.currentRoom || 'غير محددة'}
                </Text>
              </View>
              <Text style={{ fontWeight: '600', marginBottom: 8, color: '#333', textAlign: 'right' }}>القاعة الجديدة:</Text>
              <RoomPicker
                value={newRoom}
                onChange={setNewRoom}
                testID="change-room-picker"
                facultyId={course?.faculty_id}
                occurrences={
                  roomChangeModal.date && roomChangeModal.startTime && roomChangeModal.endTime
                    ? [{ date: roomChangeModal.date, start_time: roomChangeModal.startTime, end_time: roomChangeModal.endTime }]
                    : undefined
                }
                excludeLectureId={roomChangeModal.lectureId}
              />
              <Text style={{ fontSize: 12, color: '#888', textAlign: 'center', marginTop: 10, marginBottom: 16 }}>
                سيتم فحص توفر القاعة وإشعار المعلم والطلاب تلقائياً
              </Text>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <TouchableOpacity
                  style={{ flex: 1, backgroundColor: '#e0e0e0', padding: 14, borderRadius: 10, alignItems: 'center' }}
                  onPress={() => setRoomChangeModal(null)}
                >
                  <Text style={{ fontWeight: '600', color: '#333' }}>إلغاء</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, backgroundColor: '#9c27b0', padding: 14, borderRadius: 10, alignItems: 'center', opacity: (changingRoom || !newRoom || newRoom === roomChangeModal.currentRoom) ? 0.5 : 1 }}
                  onPress={() => handleChangeRoom()}
                  disabled={changingRoom || !newRoom || newRoom === roomChangeModal.currentRoom}
                  testID="confirm-change-room-btn"
                >
                  <Text style={{ fontWeight: '600', color: '#fff' }}>
                    {changingRoom ? 'جاري...' : 'حفظ القاعة'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  lecturesActionsRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  container: {
    flex: 1,
    backgroundColor: '#f4f6fb',
  },

  // ====== التصميم الجديد ======
  pageScroll: { padding: 20, paddingBottom: 60, maxWidth: 1440, width: '100%', alignSelf: 'center' },

  courseHeaderCard: { backgroundColor: '#fff', borderRadius: 14, padding: 18, marginBottom: 16, borderWidth: 1, borderColor: '#eef1f6', flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
  courseHeaderRight: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 14, flex: 1, minWidth: 280 },
  courseBookIcon: { width: 48, height: 48, borderRadius: 10, backgroundColor: '#eef4ff', alignItems: 'center', justifyContent: 'center' },
  courseHeaderName: { fontSize: 22, fontWeight: '700', color: '#1a2540', textAlign: 'right' },
  courseHeaderCode: { fontSize: 12, color: '#8a95a8', marginTop: 2, textAlign: 'right' },
  courseHeaderChips: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  courseChipNew: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3e7ee' },
  courseChipText: { fontSize: 11, color: '#1a2540', fontWeight: '500' },
  courseHeaderActions: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, flexWrap: 'wrap' },

  headerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 8 },
  btnAddGreen: { backgroundColor: '#22c55e' },
  btnGeneratePurple: { backgroundColor: '#9333ea' },
  btnPrimaryText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  btnGhost: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3e7ee' },
  btnGhostText: { color: '#1a2540', fontSize: 13, fontWeight: '600' },

  statsGrid: { flexDirection: 'row', gap: 14, marginBottom: 16, flexWrap: 'wrap' },
  statCard: { flex: 1, minWidth: 180, backgroundColor: '#fff', borderRadius: 14, padding: 16, flexDirection: 'row-reverse', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#eef1f6' },
  statIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  statTextCol: { flex: 1, alignItems: 'flex-end' },
  statValueNew: { fontSize: 22, color: '#1a2540', fontWeight: '700' },
  statLabelNew: { fontSize: 12, color: '#8a95a8', marginTop: 2 },

  filterCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#eef1f6' },
  filterRowLec: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  filterFieldFlex1: { flex: 1, minWidth: 140 },
  filterFieldFlex2: { flex: 2, minWidth: 220 },
  searchBox: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: '#e3e7ee', height: 40 },
  searchBoxInput: { flex: 1, fontSize: 13, color: '#1a2540', textAlign: 'right', outlineStyle: 'none' as any },
  dropdown: { backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#e3e7ee', height: 40, overflow: 'hidden', justifyContent: 'center' },
  dropdownInner: { height: 40, fontSize: 13, color: '#1a2540', textAlign: 'right', backgroundColor: 'transparent', borderWidth: 0 },
  dateRangeBox: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: '#e3e7ee', height: 40, minWidth: 200 },
  dateInput: { flex: 1, fontSize: 12, color: '#1a2540', textAlign: 'center', outlineStyle: 'none' as any, minWidth: 70 },
  dateSep: { color: '#8a95a8' },
  filterApplyBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3e7ee', height: 40, paddingHorizontal: 14, borderRadius: 8 },

  selBarLec: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, backgroundColor: '#eef4ff', borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: '#cfdcff', flexWrap: 'wrap' },
  selBarItem: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  selBarText: { fontSize: 13, color: '#2962ff', fontWeight: '600' },
  selBarCount: { fontSize: 12, color: '#1a2540', fontWeight: '600' },
  selActionBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 7 },
  selActionText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  // بطاقة محاضرة
  lectureCardNew: { backgroundColor: '#fff', borderRadius: 12, padding: 16, flexDirection: 'row-reverse', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: '#eef1f6', position: 'relative' },
  lectureCardNewSelected: { backgroundColor: '#eef4ff', borderColor: '#cfdcff' },
  lectureNumWrap: { width: 44 },
  lectureNumBadge: { width: 36, height: 36, borderRadius: 8, backgroundColor: '#eef4ff', alignItems: 'center', justifyContent: 'center' },
  lectureNumText: { fontSize: 14, fontWeight: '700', color: '#2962ff' },
  lectureDayCol: { minWidth: 110, alignItems: 'flex-end' },
  lectureDayName: { fontSize: 14, fontWeight: '700', color: '#1a2540' },
  lectureDateText: { fontSize: 11, color: '#8a95a8', marginTop: 2 },
  lectureMidCol: { flex: 1, gap: 8 },
  lectureMetaRowNew: { flexDirection: 'row-reverse', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  lectureMetaItem: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4 },
  lectureMetaText: { fontSize: 12, color: '#1a2540' },
  lectureCountsRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  countItem: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4 },
  countDot: { width: 6, height: 6, borderRadius: 3 },
  countText: { fontSize: 12, fontWeight: '700', color: '#1a2540' },
  countLbl: { fontSize: 11, color: '#8a95a8' },
  noteBoxInfoNew: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, backgroundColor: '#eef4ff', padding: 6, borderRadius: 6, borderRightWidth: 2, borderRightColor: '#2962ff', marginTop: 4 },
  noteTextNew: { fontSize: 11, color: '#1a2540', flex: 1 },

  lectureActionsNew: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  actBtnDetails: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 7, backgroundColor: '#eef4ff' },
  actBtnDetailsText: { fontSize: 12, fontWeight: '600', color: '#2962ff' },
  actBtnReschedule: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 7, backgroundColor: '#fff3e0' },
  actBtnRescheduleText: { fontSize: 12, fontWeight: '600', color: '#ff9800' },
  actBtnAttend: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 7, backgroundColor: '#e7f6ee' },
  actBtnAttendText: { fontSize: 12, fontWeight: '600', color: '#22a35a' },
  dotsBtn: { width: 32, height: 32, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e3e7ee', backgroundColor: '#fff' },

  statusBadgeAbs: { position: 'absolute', top: 12, left: 16, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusBadgeAbsText: { fontSize: 10, color: '#fff', fontWeight: '700' },

  tableCard: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#eef1f6' },
  tableEmpty: { paddingVertical: 60, alignItems: 'center', gap: 12 },
  tableEmptyText: { fontSize: 14, color: '#8a95a8' },
  tableFooter: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', padding: 14, flexWrap: 'wrap', gap: 12 },
  perPageWrap: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  perPageLbl: { fontSize: 12, color: '#5b6678' },
  perPageBox: { width: 70, height: 34, borderWidth: 1, borderColor: '#e3e7ee', borderRadius: 6, justifyContent: 'center', overflow: 'hidden' },
  perPagePicker: { height: 34, fontSize: 12, borderWidth: 0, backgroundColor: 'transparent' },
  pagerWrap: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  pagerBtn: { minWidth: 32, height: 32, borderRadius: 6, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e3e7ee', backgroundColor: '#fff' },
  pagerBtnActive: { backgroundColor: '#2962ff', borderColor: '#2962ff' },
  pagerBtnText: { fontSize: 12, color: '#1a2540', fontWeight: '600' },
  pagerBtnTextActive: { color: '#fff' },
  pagerNavBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, paddingHorizontal: 12, height: 32, borderRadius: 6, borderWidth: 1, borderColor: '#e3e7ee', backgroundColor: '#fff' },
  pagerNavBtnDisabled: { backgroundColor: '#fafbfd' },
  pagerNavText: { fontSize: 12, color: '#1a2540', fontWeight: '600' },

  modalOverlayNew: { flex: 1, backgroundColor: 'rgba(20,30,55,0.45)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  menuModalCard: { backgroundColor: '#fff', borderRadius: 14, width: '100%', maxWidth: 380, paddingVertical: 8, borderWidth: 1, borderColor: '#eef1f6', boxShadow: '0 12px 32px rgba(20,30,55,0.18)' as any },
  menuModalHeader: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f3f5f9', marginBottom: 4 },
  menuModalTitle: { fontSize: 14, fontWeight: '700', color: '#1a2540', flex: 1, textAlign: 'right' },
  menuItem: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 14 },
  menuItemDanger: { borderTopWidth: 1, borderTopColor: '#f3f5f9', marginTop: 2 },
  menuText: { fontSize: 13, color: '#1a2540', fontWeight: '500', textAlign: 'right' },

  // ====== الستايلات القديمة (يحتفظ بها للنوافذ المنبثقة) ======
  courseInfo: {
    backgroundColor: '#1565c0',
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 8,
    alignItems: 'center',
  },
  courseTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 4,
  },
  courseName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  courseCode: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.85)',
  },
  courseDetailsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 4,
    marginTop: 4,
  },
  courseDetailChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 12,
  },
  courseDetailText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '500',
  },
  lectureCount: {
    fontSize: 13,
    color: '#fff',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 16,
  },
  semesterInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8f5e9',
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 6,
  },
  semesterInfoText: {
    fontSize: 11,
    color: '#2e7d32',
    flex: 1,
  },
  semesterWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff3e0',
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 6,
  },
  semesterWarningText: {
    fontSize: 11,
    color: '#e65100',
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4caf50',
    height: 32,
    paddingHorizontal: 8,
    borderRadius: 6,
    gap: 4,
  },
  generateBtnStyle: {
    backgroundColor: '#9c27b0',
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  listContent: {
    padding: 16,
    paddingTop: 0,
  },
  lectureCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  lectureHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  lectureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  lectureDateBlock: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    flexShrink: 1,
  },
  lectureMetaInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
    flexWrap: 'wrap',
  },
  detailRowInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  lectureDay: {
    fontSize: 12,
    color: '#1565c0',
    fontWeight: '600',
  },
  lectureDate: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  lectureHijri: {
    fontSize: 11,
    color: '#888',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  statusText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  lectureDetails: {
    marginBottom: 6,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  detailText: {
    fontSize: 12,
    color: '#666',
  },
  noteBoxInfo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: '#e3f2fd',
    borderLeftWidth: 3,
    borderLeftColor: '#1565c0',
    padding: 8,
    borderRadius: 6,
    marginBottom: 8,
  },
  noteBoxDanger: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: '#ffebee',
    borderLeftWidth: 3,
    borderLeftColor: '#c62828',
    padding: 8,
    borderRadius: 6,
    marginBottom: 8,
  },
  noteText: {
    flex: 1,
    fontSize: 12,
    color: '#333',
    lineHeight: 18,
    textAlign: 'right',
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
  // Styles for selection mode
  selectionBtn: {
    backgroundColor: '#607d8b',
  },
  selectionActiveBtn: {
    backgroundColor: '#f44336',
  },
  selectionBar: {
    backgroundColor: '#e3f2fd',
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
  },
  selectionInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  selectAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectAllText: {
    fontSize: 14,
    color: '#1565c0',
    fontWeight: '600',
  },
  selectedCount: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  selectionActions: {
    flexDirection: 'row',
    gap: 10,
  },
  deleteSelectedBtn: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#f44336',
    paddingVertical: 10,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  deleteSelectedText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  deleteAllBtn: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#d32f2f',
    paddingVertical: 10,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  deleteAllText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  disabledBtn: {
    backgroundColor: '#bdbdbd',
  },
  // === Stats Bar ===
  semesterBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginHorizontal: 16,
    marginTop: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: '#e3f2fd',
    borderRadius: 6,
    borderLeftWidth: 2,
    borderLeftColor: '#1565c0',
  },
  semesterBannerText: {
    flex: 1,
    color: '#1565c0',
    fontSize: 11,
    fontWeight: '600' as const,
    textAlign: 'right' as const,
  },
  statsBar: {
    flexDirection: 'row' as const,
    display: 'flex' as any,
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 10,
    overflow: 'hidden',
  },
  statItem: {
    width: '25%' as any,
    alignItems: 'center' as const,
    paddingVertical: 6,
    borderRightWidth: 1,
    borderRightColor: '#f0f0f0',
  },
  statItemActive: {
    backgroundColor: '#e3f2fd',
  },
  statItemScheduled: {
    backgroundColor: '#e3f2fd',
  },
  statItemCompleted: {
    backgroundColor: '#e8f5e9',
  },
  statItemCancelled: {
    backgroundColor: '#ffebee',
  },
  statNumber: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#333',
  },
  statLabel: {
    fontSize: 10,
    color: '#666',
    marginTop: 1,
  },
  // === Month Filter ===
  monthsFilter: {
    marginTop: 6,
    minHeight: 32,
    maxHeight: 32,
    zIndex: 5,
    marginBottom: 2,
  },
  monthsFilterContent: {
    paddingHorizontal: 16,
    gap: 6,
  },
  monthChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  monthChipActive: {
    backgroundColor: '#1565c0',
    borderColor: '#1565c0',
  },
  monthChipText: {
    fontSize: 11,
    color: '#666',
  },
  monthChipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  lectureCardSelected: {
    backgroundColor: '#e3f2fd',
    borderColor: '#1565c0',
    borderWidth: 2,
  },
  checkbox: {
    marginLeft: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lectureContentWithCheckbox: {
    flex: 1,
    marginRight: 8,
  },
  lectureContentFull: {
    flex: 1,
  },
  dateModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dateModalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    width: '90%',
    maxWidth: 400,
  },
  dateModalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    marginBottom: 4,
  },
  dateModalSubtitle: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },
  dateModalLabel: {
    fontSize: 13,
    color: '#555',
    marginBottom: 4,
  },
  dateModalInput: {
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    color: '#333',
    textAlign: 'left',
  },
  dateModalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
    gap: 12,
  },
  dateModalCancelBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
  },
  dateModalCancelText: {
    color: '#666',
    fontWeight: '600',
  },
  dateModalSaveBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#1565c0',
    alignItems: 'center',
  },
  dateModalSaveText: {
    color: '#fff',
    fontWeight: '600',
  },
});
