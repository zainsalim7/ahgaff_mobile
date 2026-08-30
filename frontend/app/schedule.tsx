import { goBack } from '../src/utils/navigation';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
  Platform, ScrollView, KeyboardAvoidingView, TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { settingsAPI, lecturesAPI } from '../src/services/api';
import { useAuthStore } from '../src/store/authStore';
import { LoadingScreen } from '../src/components/LoadingScreen';
import api from '../src/services/api';

const DAYS_AR: Record<number, string> = {
  0: 'الأحد', 1: 'الإثنين', 2: 'الثلاثاء', 3: 'الأربعاء',
  4: 'الخميس', 5: 'الجمعة', 6: 'السبت',
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  scheduled: { label: 'مجدولة', color: '#1565c0', bg: '#e3f2fd', icon: 'time-outline' },
  completed: { label: 'منعقدة', color: '#2e7d32', bg: '#e8f5e9', icon: 'checkmark-circle' },
  absent: { label: 'غائب', color: '#e65100', bg: '#fff3e0', icon: 'alert-circle' },
  cancelled: { label: 'ملغاة', color: '#c62828', bg: '#ffebee', icon: 'close-circle' },
};

const ACCENT_COLORS = ['#1565c0', '#00897b', '#6a1b9a', '#ef6c00', '#c62828', '#2e7d32', '#ad1457'];

function formatDateArabic(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const dayName = DAYS_AR[d.getDay()] || '';
  const day = d.getDate();
  const months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${dayName}، ${day} ${month} ${year}`;
}

function getToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ScheduleScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const [lectures, setLectures] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(getToday);
  const [semesterSettings, setSemesterSettings] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [purgeModal, setPurgeModal] = useState(false);
  const [purgeScope, setPurgeScope] = useState<'faculty' | 'department' | 'course'>('department');
  const [purgeFaculty, setPurgeFaculty] = useState('');
  const [purgeDept, setPurgeDept] = useState('');
  const [purgeCourse, setPurgeCourse] = useState('');
  const [purgeFutureOnly, setPurgeFutureOnly] = useState(false);
  const [purgeLists, setPurgeLists] = useState<{ faculties: any[]; departments: any[]; courses: any[] }>({ faculties: [], departments: [], courses: [] });
  const [purgePreview, setPurgePreview] = useState<any>(null);
  const [purging, setPurging] = useState(false);

  const canPurge = user?.role === 'admin' || user?.permissions?.includes('manage_lectures');

  const openPurgeModal = async () => {
    setPurgePreview(null); setPurgeModal(true);
    try {
      const [f, d, c] = await Promise.all([api.get('/faculties'), api.get('/departments'), api.get('/courses')]);
      setPurgeLists({ faculties: f.data || [], departments: d.data || [], courses: c.data || [] });
    } catch { setPurgeLists({ faculties: [], departments: [], courses: [] }); }
  };

  const purgeBody = () => ({
    scope: purgeScope,
    faculty_id: purgeFaculty || null,
    department_id: purgeDept || null,
    course_id: purgeCourse || null,
    future_only: purgeFutureOnly,
  });

  const runPurgePreview = async () => {
    setPurging(true);
    try {
      const res = await api.post('/lectures/purge/preview', purgeBody());
      setPurgePreview(res.data);
    } catch (e: any) {
      window.alert(typeof e?.response?.data?.detail === 'string' ? e.response.data.detail : 'خطأ في المعاينة');
    } finally { setPurging(false); }
  };

  const runPurge = async () => {
    if (!purgePreview) return;
    if (!window.confirm(`⚠️ تأكيد نهائي: ${purgePreview.message}\n\nهذا الإجراء لا يمكن التراجع عنه. المقررات والإسنادات والجدول الأسبوعي لن تُمس. متابعة؟`)) return;
    setPurging(true);
    try {
      const res = await api.post('/lectures/purge', purgeBody());
      window.alert(res.data.message);
      setPurgeModal(false);
      fetchLectures(selectedDate);
    } catch (e: any) {
      window.alert(typeof e?.response?.data?.detail === 'string' ? e.response.data.detail : 'فشل المسح');
    } finally { setPurging(false); }
  };

  const fetchLectures = useCallback(async (date: string) => {
    try {
      setLoading(true);
      const res = await api.get(`/lectures/all-schedule?date=${date}`);
      setLectures(res.data?.lectures || []);
    } catch (error) {
      console.error('Error fetching lectures:', error);
      setLectures([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const settingsRes = await settingsAPI.get();
        let semStart = settingsRes.data.semester_start_date;
        let semEnd = settingsRes.data.semester_end_date;
        let semName = settingsRes.data.current_semester;
        if (!semStart || !semEnd) {
          try {
            const currentSemRes = await api.get('/semesters/current');
            if (currentSemRes.data) {
              semStart = semStart || currentSemRes.data.start_date;
              semEnd = semEnd || currentSemRes.data.end_date;
              semName = semName || currentSemRes.data.name;
            }
          } catch {}
        }
        setSemesterSettings({ semester_start_date: semStart, semester_end_date: semEnd, current_semester: semName });
      } catch {}
    })();
  }, []);

  useEffect(() => {
    fetchLectures(selectedDate);
  }, [selectedDate, fetchLectures]);

  const isToday = selectedDate === getToday();
  const isTeacher = user?.role === 'teacher';

  const handleDeleteLecture = async (lectureId: string) => {
    if (Platform.OS === 'web') {
      if (!window.confirm('هل أنت متأكد من حذف هذه المحاضرة؟')) return;
      try { await lecturesAPI.delete(lectureId); fetchLectures(selectedDate); } catch { window.alert('فشل في حذف المحاضرة'); }
    } else {
      Alert.alert('حذف المحاضرة', 'هل أنت متأكد؟', [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'حذف', style: 'destructive', onPress: async () => {
          try { await lecturesAPI.delete(lectureId); fetchLectures(selectedDate); } catch { Alert.alert('خطأ', 'فشل في الحذف'); }
        }},
      ]);
    }
  };

  const handleCancelLecture = async (lectureId: string) => {
    if (Platform.OS === 'web') {
      if (!window.confirm('هل أنت متأكد من إلغاء هذه المحاضرة؟')) return;
      try { await lecturesAPI.updateStatus(lectureId, 'cancelled'); fetchLectures(selectedDate); } catch { window.alert('فشل في الإلغاء'); }
    } else {
      Alert.alert('إلغاء المحاضرة', 'هل أنت متأكد؟', [
        { text: 'تراجع', style: 'cancel' },
        { text: 'إلغاء المحاضرة', style: 'destructive', onPress: async () => {
          try { await lecturesAPI.updateStatus(lectureId, 'cancelled'); fetchLectures(selectedDate); } catch { Alert.alert('خطأ', 'فشل'); }
        }},
      ]);
    }
  };

  const getCourseColor = (courseId: string) => {
    let hash = 0;
    for (let i = 0; i < courseId.length; i++) hash = courseId.charCodeAt(i) + ((hash << 5) - hash);
    return ACCENT_COLORS[Math.abs(hash) % ACCENT_COLORS.length];
  };

  const statsCounts = useMemo(() => {
    const counts = { total: lectures.length, completed: 0, scheduled: 0, cancelled: 0, absent: 0 };
    lectures.forEach((l) => {
      if (l.status === 'completed') counts.completed++;
      else if (l.status === 'scheduled') counts.scheduled++;
      else if (l.status === 'cancelled') counts.cancelled++;
      else if (l.status === 'absent') counts.absent++;
    });
    return counts;
  }, [lectures]);

  const filteredLectures = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return lectures;
    return lectures.filter((l) =>
      [l.course_name, l.course_code, l.teacher_name, l.faculty_name, l.department_name, l.room]
        .some((v) => (v || '').toLowerCase().includes(q))
    );
  }, [lectures, searchQuery]);

  // 🗂️ تجميع المحاضرات حسب الفترة الزمنية (قروبات مرتبة زمنياً)
  const timeGroups = useMemo(() => {
    const map: Record<string, { start: string; end: string; items: any[] }> = {};
    filteredLectures.forEach((l) => {
      const key = `${l.start_time || '؟'}|${l.end_time || '؟'}`;
      if (!map[key]) map[key] = { start: l.start_time || '', end: l.end_time || '', items: [] };
      map[key].items.push(l);
    });
    return Object.values(map).sort((a, b) => (a.start || 'zz').localeCompare(b.start || 'zz'));
  }, [filteredLectures]);

  const renderSmallCard = (item: any) => {
    const st = STATUS_CONFIG[item.status] || STATUS_CONFIG.scheduled;
    const courseColor = getCourseColor(item.course_id);
    const canManage = user?.role === 'admin' || user?.permissions?.includes('manage_lectures') || user?.permissions?.includes('edit_lectures');
    return (
      <View key={item.id} style={[s.gCard, { borderTopColor: courseColor }]} testID={`lecture-card-${item.id}`}>
        <View style={s.gCardHead}>
          <Text style={s.gCardName} numberOfLines={1}>{item.course_name}</Text>
          {canManage && (
            <View style={s.gCardIcons}>
              <TouchableOpacity
                style={[s.gIconBtn, { backgroundColor: '#e3f2fd' }]}
                onPress={() => router.push({ pathname: '/take-attendance', params: { lectureId: item.id, courseId: item.course_id, courseName: item.course_name } })}
                testID={`view-attendance-${item.id}`}
              >
                <Ionicons name="eye-outline" size={13} color="#1565c0" />
              </TouchableOpacity>
              {item.status !== 'cancelled' && (
                <TouchableOpacity
                  style={[s.gIconBtn, { backgroundColor: '#fff3e0' }]}
                  onPress={() => handleCancelLecture(item.id)}
                  testID={`cancel-lecture-${item.id}`}
                >
                  <Ionicons name="close-circle-outline" size={13} color="#e65100" />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[s.gIconBtn, { backgroundColor: '#ffebee' }]}
                onPress={() => handleDeleteLecture(item.id)}
                testID={`delete-lecture-${item.id}`}
              >
                <Ionicons name="trash-outline" size={13} color="#c62828" />
              </TouchableOpacity>
            </View>
          )}
        </View>
        {item.course_code ? <Text style={s.gCardCode}>{item.course_code}</Text> : null}
        {item.teacher_name ? (
          <View style={s.gCardRow}>
            <Ionicons name="person-outline" size={12} color="#5b6678" />
            <Text style={s.gCardRowText} numberOfLines={1}>{item.teacher_name}</Text>
          </View>
        ) : null}
        <View style={s.gChips}>
          {item.room ? (
            <View style={[s.gChip, { backgroundColor: '#fff3e0' }]}>
              <Text style={[s.gChipText, { color: '#e65100' }]}>🚪 {item.room}</Text>
            </View>
          ) : null}
          {item.department_name ? (
            <View style={[s.gChip, { backgroundColor: '#ede7f6' }]}>
              <Text style={[s.gChipText, { color: '#5e35b1' }]} numberOfLines={1}>{item.department_name}</Text>
            </View>
          ) : null}
          {item.section ? (
            <View style={[s.gChip, { backgroundColor: '#e0f2f1' }]}>
              <Text style={[s.gChipText, { color: '#00695c' }]}>شعبة {item.section}</Text>
            </View>
          ) : null}
        </View>
        <View style={s.gCardFoot}>
          <View style={[s.cardStatusBadge, { backgroundColor: st.bg }]}>
            <Ionicons name={st.icon} size={10} color={st.color} />
            <Text style={[s.cardStatusText, { color: st.color }]}>{st.label}</Text>
          </View>
          {typeof item.attendance_count !== 'undefined' && (
            <Text style={s.gAttText}>
              {item.status === 'completed' ? `حضور ${item.attendance_count || 0}/${item.total_enrolled || 0}` : `مسجل ${item.total_enrolled || 0}`}
            </Text>
          )}
        </View>
        {isTeacher && (
          <TouchableOpacity
            style={s.gTakeBtn}
            onPress={() => router.push({ pathname: '/take-attendance', params: { lectureId: item.id, courseId: item.course_id } })}
            testID={`teacher-lecture-${item.id}`}
          >
            <Ionicons name="clipboard-outline" size={13} color="#fff" />
            <Text style={s.takeAttendanceBtnText}>تسجيل الحضور</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={[s.pageScroll, { flexGrow: 1 }]} showsVerticalScrollIndicator={true}>

          {/* Page header */}
          <View style={s.pageHeader}>
            <View style={s.pageHeaderRight}>
              <Text style={s.pageTitle}>{isTeacher ? 'جدول المحاضرات' : 'الجدول اليومي'}</Text>
              <View style={s.breadcrumb}>
                <TouchableOpacity onPress={() => router.replace('/')}>
                  <Text style={s.breadcrumbLink}>الرئيسية</Text>
                </TouchableOpacity>
                <Ionicons name="chevron-back" size={12} color="#8a95a8" />
                <Text style={s.breadcrumbCurrent}>الجدول</Text>
              </View>
            </View>
            <View style={s.pageHeaderActions}>
              {!isToday && (
                <TouchableOpacity style={[s.headerBtn, s.btnGhost]} onPress={() => setSelectedDate(getToday())} data-testid="go-today-btn">
                  <Ionicons name="today-outline" size={15} color="#1565c0" />
                  <Text style={s.btnGhostText}>اليوم</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[s.headerBtn, s.btnGhost]} onPress={() => fetchLectures(selectedDate)}>
                <Ionicons name="refresh" size={15} color="#1a2540" />
                <Text style={s.btnGhostText}>تحديث</Text>
              </TouchableOpacity>
              {canPurge && Platform.OS === 'web' && (
                <TouchableOpacity
                  style={[s.headerBtn, { backgroundColor: '#ffebee', borderWidth: 1, borderColor: '#ef9a9a' }]}
                  onPress={openPurgeModal}
                  data-testid="purge-lectures-btn"
                >
                  <Ionicons name="trash-outline" size={15} color="#c62828" />
                  <Text style={{ color: '#c62828', fontSize: 13, fontWeight: '700' }}>مسح المحاضرات</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Stats grid */}
          <View style={s.statsGrid}>
            <View style={s.statCard}>
              <View style={[s.statIconWrap, { backgroundColor: '#1a237e' }]}><Ionicons name="calendar" size={22} color="#fff" /></View>
              <View style={s.statTextCol}>
                <Text style={s.statLabel}>إجمالي المحاضرات</Text>
                <Text style={s.statValue}>{statsCounts.total}</Text>
                <Text style={s.statSubLabel}>محاضرة</Text>
              </View>
            </View>
            <View style={s.statCard}>
              <View style={[s.statIconWrap, { backgroundColor: '#2e7d32' }]}><Ionicons name="checkmark-circle" size={22} color="#fff" /></View>
              <View style={s.statTextCol}>
                <Text style={s.statLabel}>منعقدة</Text>
                <Text style={s.statValue}>{statsCounts.completed}</Text>
                <Text style={s.statSubLabel}>محاضرة مكتملة</Text>
              </View>
            </View>
            <View style={s.statCard}>
              <View style={[s.statIconWrap, { backgroundColor: '#1565c0' }]}><Ionicons name="time" size={22} color="#fff" /></View>
              <View style={s.statTextCol}>
                <Text style={s.statLabel}>مجدولة</Text>
                <Text style={s.statValue}>{statsCounts.scheduled}</Text>
                <Text style={s.statSubLabel}>قيد الانتظار</Text>
              </View>
            </View>
            <View style={s.statCard}>
              <View style={[s.statIconWrap, { backgroundColor: '#c62828' }]}><Ionicons name="close-circle" size={22} color="#fff" /></View>
              <View style={s.statTextCol}>
                <Text style={s.statLabel}>ملغاة/غياب</Text>
                <Text style={s.statValue}>{statsCounts.cancelled + statsCounts.absent}</Text>
                <Text style={s.statSubLabel}>محاضرة</Text>
              </View>
            </View>
          </View>

          {/* Date picker card */}
          <View style={s.dateCard}>
            <View style={s.dateCardHeader}>
              <Text style={s.dateCardTitle}>اختر اليوم</Text>
              {semesterSettings?.current_semester && (
                <View style={s.semesterChip}>
                  <Ionicons name="school" size={12} color="#1565c0" />
                  <Text style={s.semesterChipText}>{semesterSettings.current_semester}</Text>
                </View>
              )}
            </View>
            <View style={s.dateNav} data-testid="date-navigation">
              <TouchableOpacity onPress={() => setSelectedDate(shiftDate(selectedDate, 1))} style={s.dateNavArrow} data-testid="next-day-btn">
                <Ionicons name="chevron-forward" size={20} color="#1a237e" />
              </TouchableOpacity>
              <View style={s.dateNavCenter}>
                <Text style={s.dateNavDay}>{DAYS_AR[new Date(selectedDate + 'T00:00:00').getDay()]}</Text>
                <Text style={s.dateNavDate}>{formatDateArabic(selectedDate)}</Text>
                {Platform.OS === 'web' && (
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e: any) => setSelectedDate(e.target.value)}
                    style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }}
                    data-testid="date-picker-input"
                  />
                )}
              </View>
              <TouchableOpacity onPress={() => setSelectedDate(shiftDate(selectedDate, -1))} style={s.dateNavArrow} data-testid="prev-day-btn">
                <Ionicons name="chevron-back" size={20} color="#1a237e" />
              </TouchableOpacity>
            </View>
            {semesterSettings?.semester_start_date && semesterSettings?.semester_end_date && (
              <View style={s.semesterStrip}>
                <Ionicons name="information-circle" size={13} color="#1565c0" />
                <Text style={s.semesterStripText}>
                  الفصل النشط: {semesterSettings.semester_start_date} ← {semesterSettings.semester_end_date}
                </Text>
              </View>
            )}
          </View>

          {/* Lectures list */}
          <View style={s.listCard}>
            <View style={s.listCardHeader}>
              <Text style={s.listCardTitle}>محاضرات {DAYS_AR[new Date(selectedDate + 'T00:00:00').getDay()]}</Text>
              <Text style={s.listCardCount} data-testid="lecture-count">
                {loading ? '...' : <>عرض <Text style={s.listCardCountAccent}>{filteredLectures.length}</Text> من {lectures.length} محاضرة</>}
              </Text>
            </View>

            {/* Search bar */}
            <View style={s.searchWrap}>
              <View style={s.searchBox}>
                <Ionicons name="search" size={16} color="#8a95a8" />
                <TextInput
                  style={s.searchInput}
                  placeholder="بحث بالمقرر أو المدرّس أو الكلية أو القاعة..."
                  placeholderTextColor="#a8b1c2"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  data-testid="schedule-search-input"
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchQuery('')} data-testid="schedule-search-clear">
                    <Ionicons name="close-circle" size={16} color="#8a95a8" />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {loading ? (
              <View style={s.center}><LoadingScreen /></View>
            ) : filteredLectures.length === 0 ? (
              <View style={s.emptyState}>
                <Ionicons name="calendar-outline" size={56} color="#cfd6e1" />
                <Text style={s.emptyTitle}>{searchQuery ? 'لا توجد نتائج مطابقة' : 'لا توجد محاضرات'}</Text>
                <Text style={s.emptySubtitle}>
                  {searchQuery ? `لا توجد محاضرات تطابق "${searchQuery}"` : `لا توجد محاضرات مجدولة في ${formatDateArabic(selectedDate)}`}
                </Text>
              </View>
            ) : (
              <View style={{ padding: 14 }} testID="time-groups-container">
                {timeGroups.map((g, gi) => (
                  <View key={`${g.start}-${g.end}-${gi}`} style={{ marginBottom: 18 }} testID={`time-group-${g.start || 'na'}`}>
                    <View style={s.gGroupHead}>
                      <View style={s.gTimePill}>
                        <Ionicons name="time" size={13} color="#fff" />
                        <Text style={s.gTimePillText}>
                          {g.start && g.end ? `${g.start} – ${g.end}` : 'بدون وقت محدد'}
                        </Text>
                      </View>
                      <View style={s.gCountPill}>
                        <Text style={s.gCountPillText}>{g.items.length} {g.items.length === 1 ? 'محاضرة' : 'محاضرات'}</Text>
                      </View>
                      <View style={s.gGroupLine} />
                    </View>
                    <View style={s.gGrid}>
                      {g.items.map(renderSmallCard)}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      {purgeModal && Platform.OS === 'web' && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100,
          backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', direction: 'rtl',
        }} onClick={() => !purging && setPurgeModal(false)}>
          <div onClick={(ev: any) => ev.stopPropagation()} style={{
            backgroundColor: '#fff', borderRadius: 12, padding: 20, width: 520, maxWidth: '94%', maxHeight: '85vh', overflowY: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          }} data-testid="purge-modal">
            <div style={{ fontSize: 15, fontWeight: 800, color: '#c62828', marginBottom: 4, textAlign: 'right' }}>🗑️ مسح المحاضرات المولدة</div>
            <div style={{ fontSize: 11.5, color: '#5b6678', marginBottom: 12, textAlign: 'right', lineHeight: 1.7 }}>
              يحذف <b>المحاضرات وسجلات حضورها فقط</b> — لا يمس المقررات ولا الإسنادات ولا الجدول الأسبوعي.
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, color: '#333', marginBottom: 6, textAlign: 'right' }}>النطاق:</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {[['faculty', 'كلية كاملة'], ['department', 'قسم'], ['course', 'مقرر واحد']].map(([v, l]) => (
                <button key={v} onClick={() => { setPurgeScope(v as any); setPurgePreview(null); }} style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
                  border: purgeScope === v ? '2px solid #c62828' : '1px solid #ddd',
                  backgroundColor: purgeScope === v ? '#ffebee' : '#fff', color: purgeScope === v ? '#c62828' : '#555',
                }} data-testid={`purge-scope-${v}`}>{l}</button>
              ))}
            </div>

            <select value={purgeFaculty} onChange={(ev: any) => { setPurgeFaculty(ev.target.value); setPurgeDept(''); setPurgeCourse(''); setPurgePreview(null); }} style={{
              width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, direction: 'rtl', backgroundColor: '#f7f9fc', marginBottom: 8,
            }} data-testid="purge-faculty-select">
              <option value="">-- اختر الكلية --</option>
              {purgeLists.faculties.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            {purgeScope !== 'faculty' && (
              <select value={purgeDept} onChange={(ev: any) => { setPurgeDept(ev.target.value); setPurgeCourse(''); setPurgePreview(null); }} style={{
                width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, direction: 'rtl', backgroundColor: '#f7f9fc', marginBottom: 8,
              }} data-testid="purge-dept-select">
                <option value="">-- اختر القسم --</option>
                {purgeLists.departments.filter((d: any) => !purgeFaculty || d.faculty_id === purgeFaculty).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
            {purgeScope === 'course' && (
              <select value={purgeCourse} onChange={(ev: any) => { setPurgeCourse(ev.target.value); setPurgePreview(null); }} style={{
                width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, direction: 'rtl', backgroundColor: '#f7f9fc', marginBottom: 8,
              }} data-testid="purge-course-select">
                <option value="">-- اختر المقرر --</option>
                {purgeLists.courses.filter((c: any) => !purgeDept || c.department_id === purgeDept).map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name}{c.level ? ` (م${c.level}${c.section ? '/' + c.section : ''})` : ''}</option>
                ))}
              </select>
            )}

            <div style={{ display: 'flex', gap: 8, marginBottom: 12, marginTop: 4 }}>
              {[[false, 'كل المحاضرات'], [true, 'المستقبلية فقط']].map(([v, l]: any) => (
                <button key={String(v)} onClick={() => { setPurgeFutureOnly(v); setPurgePreview(null); }} style={{
                  flex: 1, padding: '7px 0', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                  border: purgeFutureOnly === v ? '2px solid #e65100' : '1px solid #ddd',
                  backgroundColor: purgeFutureOnly === v ? '#fff3e0' : '#fff', color: purgeFutureOnly === v ? '#e65100' : '#555',
                }} data-testid={`purge-time-${v ? 'future' : 'all'}`}>{l}</button>
              ))}
            </div>

            <button onClick={runPurgePreview} disabled={purging || (purgeScope === 'faculty' ? !purgeFaculty : purgeScope === 'department' ? !purgeDept : !purgeCourse)} style={{
              width: '100%', padding: '10px 0', borderRadius: 8, border: 'none', cursor: 'pointer', marginBottom: 8,
              backgroundColor: '#e65100', color: '#fff', fontSize: 13, fontWeight: 700, opacity: purging ? 0.6 : 1,
            }} data-testid="purge-preview-btn">{purging ? 'جاري الفحص...' : '🔍 معاينة ما سيُحذف'}</button>

            {purgePreview && (
              <div data-testid="purge-preview-report">
                <div style={{
                  padding: '10px 12px', borderRadius: 8, marginBottom: 8, fontSize: 12.5, fontWeight: 700, textAlign: 'right', lineHeight: 1.8,
                  backgroundColor: purgePreview.total > 0 ? '#ffebee' : '#f5f5f5', color: purgePreview.total > 0 ? '#b71c1c' : '#666',
                }}>{purgePreview.message}</div>
                {purgePreview.total > 0 && (
                  <button onClick={runPurge} disabled={purging} style={{
                    width: '100%', padding: '11px 0', borderRadius: 8, border: 'none', cursor: 'pointer', marginBottom: 8,
                    backgroundColor: '#c62828', color: '#fff', fontSize: 13.5, fontWeight: 800,
                  }} data-testid="purge-confirm-btn">{purging ? 'جاري المسح...' : `🗑️ تأكيد مسح ${purgePreview.total} محاضرة نهائياً`}</button>
                )}
              </div>
            )}

            <button onClick={() => setPurgeModal(false)} disabled={purging} style={{
              width: '100%', padding: '9px 0', borderRadius: 8, border: '1px solid #ddd', cursor: 'pointer',
              backgroundColor: '#fff', color: '#555', fontSize: 13, fontWeight: 600,
            }} data-testid="purge-close-btn">إغلاق</button>
          </div>
        </div>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  gGroupHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginBottom: 10 },
  gTimePill: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, backgroundColor: '#1565c0', borderRadius: 20, paddingVertical: 5, paddingHorizontal: 14 },
  gTimePillText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  gCountPill: { backgroundColor: '#e3f2fd', borderRadius: 12, paddingVertical: 3, paddingHorizontal: 10 },
  gCountPillText: { color: '#1565c0', fontSize: 11, fontWeight: '700' },
  gGroupLine: { flex: 1, height: 1, backgroundColor: '#dde4ee' },
  gGrid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10 },
  gCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderTopWidth: 3,
    padding: 10,
    minWidth: 225,
    maxWidth: 320,
    flexGrow: 1,
    flexBasis: 225,
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  gCardHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  gCardName: { flex: 1, fontSize: 13.5, fontWeight: '800', color: '#222b3d', textAlign: 'right' },
  gCardIcons: { flexDirection: 'row-reverse', gap: 4 },
  gIconBtn: { width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  gCardCode: { fontSize: 10.5, color: '#9aa4b5', textAlign: 'right', marginTop: 1 },
  gCardRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, marginTop: 5 },
  gCardRowText: { fontSize: 11.5, color: '#5b6678', flex: 1, textAlign: 'right' },
  gChips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  gChip: { borderRadius: 8, paddingVertical: 2, paddingHorizontal: 8, maxWidth: '100%' },
  gChipText: { fontSize: 10, fontWeight: '700' },
  gCardFoot: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 7,
    borderTopWidth: 1,
    borderTopColor: '#edf0f5',
    borderStyle: 'dashed',
  },
  gAttText: { fontSize: 10.5, color: '#8a95a8', fontWeight: '700' },
  gTakeBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#1565c0',
    borderRadius: 8,
    paddingVertical: 7,
    marginTop: 8,
  },
  container: { flex: 1, backgroundColor: '#f4f6fb' },
  pageScroll: { padding: 20, paddingBottom: 60, maxWidth: 1440, width: '100%', alignSelf: 'center' },
  center: { padding: 40, alignItems: 'center' },

  // page header
  pageHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 12 },
  pageHeaderRight: { alignItems: 'flex-end' },
  pageTitle: { fontSize: 26, fontWeight: '700', color: '#1a2540', textAlign: 'right', marginBottom: 6 },
  breadcrumb: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  breadcrumbLink: { fontSize: 13, color: '#2962ff', fontWeight: '500' },
  breadcrumbCurrent: { fontSize: 13, color: '#8a95a8', fontWeight: '500' },
  pageHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  headerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 8 },
  btnGhost: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3e7ee' },
  btnGhostText: { color: '#1a2540', fontSize: 13, fontWeight: '600' },

  // Stats grid
  statsGrid: { flexDirection: 'row', gap: 14, marginBottom: 18, flexWrap: 'wrap' },
  statCard: { flex: 1, minWidth: 200, backgroundColor: '#fff', borderRadius: 14, padding: 18, flexDirection: 'row-reverse', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: '#eef1f6' },
  statIconWrap: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  statTextCol: { flex: 1, alignItems: 'flex-end' },
  statLabel: { fontSize: 13, color: '#8a95a8', fontWeight: '500', marginBottom: 4 },
  statValue: { fontSize: 22, color: '#1a2540', fontWeight: '700', marginBottom: 2 },
  statSubLabel: { fontSize: 11, color: '#a8b1c2' },

  // Date card
  dateCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 18, borderWidth: 1, borderColor: '#eef1f6' },
  dateCardHeader: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 },
  dateCardTitle: { fontSize: 14, fontWeight: '700', color: '#1a2540' },
  semesterChip: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: '#e3f2fd' },
  semesterChipText: { fontSize: 11, color: '#1565c0', fontWeight: '700' },
  dateNav: { flexDirection: 'row-reverse', alignItems: 'center', backgroundColor: '#f7f9fc', paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: '#eef1f6' },
  dateNavArrow: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#e3e7ee' },
  dateNavCenter: { flex: 1, alignItems: 'center', position: 'relative' },
  dateNavDay: { fontSize: 17, fontWeight: '800', color: '#1a237e', marginBottom: 2 },
  dateNavDate: { fontSize: 12, color: '#5b6678', fontWeight: '500' },
  semesterStrip: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, backgroundColor: '#e3f2fd', padding: 8, borderRadius: 8, marginTop: 10 },
  semesterStripText: { fontSize: 11, color: '#1565c0', fontWeight: '600' },

  // List card
  listCard: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#eef1f6' },
  listCardHeader: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#eef1f6' },
  listCardTitle: { fontSize: 15, fontWeight: '700', color: '#1a2540' },
  listCardCount: { fontSize: 12, color: '#5b6678' },
  listCardCountAccent: { color: '#1565c0', fontWeight: '700' },

  // Search bar
  searchWrap: { paddingHorizontal: 14, paddingTop: 12 },
  searchBox: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, backgroundColor: '#f7f9fc', borderWidth: 1, borderColor: '#e3e7ee', borderRadius: 10, paddingHorizontal: 12, paddingVertical: Platform.OS === 'web' ? 10 : 6 },
  searchInput: { flex: 1, fontSize: 13, color: '#1a2540', textAlign: 'right', ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },

  // Faculty/Department row
  facultyRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, marginBottom: 8, backgroundColor: '#f3e5f5', alignSelf: 'flex-end', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  facultyRowText: { fontSize: 11, color: '#6a1b9a', fontWeight: '600' },

  // Lecture row (timeline)
  lectureRow: { flexDirection: 'row-reverse', marginBottom: 8 },
  timeline: { width: 28, alignItems: 'center', paddingTop: 18 },
  timelineDot: { width: 12, height: 12, borderRadius: 6, zIndex: 1, borderWidth: 2, borderColor: '#fff' },
  timelineLine: { width: 2, flex: 1, backgroundColor: '#eef1f6', marginTop: 4 },

  card: { flex: 1, backgroundColor: '#fff', borderRadius: 12, flexDirection: 'row-reverse', overflow: 'hidden', borderWidth: 1, borderColor: '#eef1f6' },
  cardBorder: { width: 4 },
  cardContent: { flex: 1, padding: 14 },
  cardTopRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardTimeBox: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4 },
  cardTime: { fontSize: 13, fontWeight: '700' },
  cardStatusBadge: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  cardStatusText: { fontSize: 11, fontWeight: '700' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#1a2540', marginBottom: 8, textAlign: 'right' },
  cardDetailsRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 14, marginBottom: 4 },
  cardDetail: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4 },
  cardDetailText: { fontSize: 12, color: '#5b6678' },
  cardActions: { flexDirection: 'row-reverse', gap: 8, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f3f5f9', flexWrap: 'wrap' },
  cardActionBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  cardActionText: { fontSize: 12, fontWeight: '700' },
  takeAttendanceBtn: { backgroundColor: '#1a237e', padding: 10, borderRadius: 8, justifyContent: 'center', borderTopWidth: 0, marginTop: 10 },
  takeAttendanceBtnText: { color: '#fff', fontSize: 13, fontWeight: '700', flex: 1, textAlign: 'center' },

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 50, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#5b6678', marginTop: 12 },
  emptySubtitle: { fontSize: 13, color: '#8a95a8', marginTop: 4, textAlign: 'center' },
});
