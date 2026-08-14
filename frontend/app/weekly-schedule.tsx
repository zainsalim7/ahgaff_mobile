import { goBack } from '../src/utils/navigation';
import { router } from 'expo-router';
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Platform, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import { scheduleAPI, departmentsAPI, teachersAPI, coursesAPI } from '../src/services/api';
import api from '../src/services/api';
import { MasterScheduleView } from '../src/components/MasterScheduleView';

const DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];
const COLORS = ['#1565c0', '#2e7d32', '#e65100', '#6a1b9a', '#c62828', '#00838f', '#4e342e', '#37474f'];

function TeacherSearchBox({ teachers, selectedId, onSelect, placeholder }: { teachers: any[], selectedId: string, onSelect: (id: string) => void, placeholder?: string }) {
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const selectedName = teachers.find((t: any) => t.id === selectedId)?.full_name || '';
  const filtered = query.length > 0
    ? teachers.filter((t: any) => t.full_name?.includes(query) || t.teacher_id?.includes(query))
    : teachers;

  if (Platform.OS !== 'web') {
    return (
      <View style={{ backgroundColor: '#f5f5f5', borderRadius: 8, borderWidth: 1, borderColor: '#ddd', overflow: 'hidden' }}>
        <Picker selectedValue={selectedId} onValueChange={onSelect} style={{ height: 40 }}>
          <Picker.Item label={placeholder || '-- المعلم --'} value="" />
          {teachers.map((t: any) => <Picker.Item key={t.id} label={t.full_name} value={t.id} />)}
        </Picker>
      </View>
    );
  }

  return (
    <div style={{ direction: 'rtl' }}>
      <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #ddd', borderRadius: 8, backgroundColor: '#f5f5f5' }}>
        <input
          type="text"
          value={open ? query : selectedName}
          onChange={(e: any) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder || 'ابحث عن المعلم...'}
          style={{ flex: 1, padding: '10px 12px', border: 'none', background: 'transparent', fontSize: 14, outline: 'none', textAlign: 'right' }}
        />
        {selectedId && <button onClick={() => { onSelect(''); setQuery(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 8px', color: '#e53935', fontSize: 16 }}>x</button>}
      </div>
      {open && (
        <div style={{ backgroundColor: '#fff', border: '1px solid #ddd', borderRadius: 8, maxHeight: 220, overflowY: 'auto', marginTop: 4, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', backgroundColor: '#f5f8fc', borderBottom: '1px solid #e3e9f2', position: 'sticky', top: 0 }}>
            <span style={{ fontSize: 11, color: '#5b6678' }}>{filtered.length} نتيجة</span>
            <button onClick={() => { setOpen(false); setQuery(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e53935', fontSize: 12, fontWeight: 700 }}>✕ إغلاق</button>
          </div>
          {filtered.map((t: any) => (
            <div key={t.id} onClick={() => { onSelect(t.id); setQuery(''); setOpen(false); }}
              style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', backgroundColor: t.id === selectedId ? '#e3f2fd' : '#fff', textAlign: 'right' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>{t.full_name}</div>
            </div>
          ))}
          {filtered.length === 0 && <div style={{ padding: 16, color: '#999', textAlign: 'center' }}>لا توجد نتائج</div>}
        </div>
      )}
    </div>
  );
}

export default function WeeklySchedulePage() {
  const [activeTab, setActiveTab] = useState<'schedule' | 'rooms' | 'settings' | 'prefs'>('schedule');
  const [faculties, setFaculties] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [selectedFaculty, setSelectedFaculty] = useState('');
  const [selectedDept, setSelectedDept] = useState('');
  const [selectedLevel, setSelectedLevel] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  const [viewMode, setViewMode] = useState<'section' | 'department' | 'course' | 'teacher' | 'master'>('section');
  const [scheduleTeacher, setScheduleTeacher] = useState('');
  const [scheduleCourse, setScheduleCourse] = useState('');
  const [allTeachers, setAllTeachers] = useState<any[]>([]);
  const [allCourses, setAllCourses] = useState<any[]>([]);
  const [schedule, setSchedule] = useState<any[]>([]);
  const [conflicts, setConflicts] = useState<any>({ total_conflicts: 0, total_conflicting_slots: 0, conflicting_slot_ids: [], all_conflicts: [] });
  const [showConflictsModal, setShowConflictsModal] = useState(false);
  const [timeSlots, setTimeSlots] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Rooms state
  const [newRoom, setNewRoom] = useState({ name: '', capacity: '30', building: '', floor: '' });
  const [importingRooms, setImportingRooms] = useState(false);
  const [roomSchedule, setRoomSchedule] = useState<any>(null);          // 📅 نافذة جدول القاعة
  const [roomScheduleEntries, setRoomScheduleEntries] = useState<any[] | null>(null);

  const openRoomSchedule = (room: any) => {
    setRoomScheduleEntries(null);
    setRoomSchedule(room);
    api.get('/weekly-schedule', { params: { faculty_id: selectedFaculty, room_id: room.id } })
      .then(res => setRoomScheduleEntries(res.data || []))
      .catch(() => setRoomScheduleEntries([]));
  };
  // Settings state
  const [editSlots, setEditSlots] = useState<any[]>([]);
  const [editWorkingDays, setEditWorkingDays] = useState<string[]>([]);
  const [savingSlots, setSavingSlots] = useState(false);
  // Prefs state
  const [teachers, setTeachers] = useState<any[]>([]);
  const [selectedTeacher, setSelectedTeacher] = useState('');
  const [prefs, setPrefs] = useState<any>({ unavailable_days: [], unavailable_slots: [], unavailable_periods: [], max_daily_lectures: 3, allow_consecutive_lectures: true });
  const [savingPrefs, setSavingPrefs] = useState(false);
  // 📋 ملخص تفضيلات معلمي القسم (لقائمة تبويب التفضيلات)
  const [prefsSummary, setPrefsSummary] = useState<any[]>([]);
  const [prefsSummaryLoading, setPrefsSummaryLoading] = useState(false);
  const [prefsTeacherSearch, setPrefsTeacherSearch] = useState('');
  const [prefsListOpen, setPrefsListOpen] = useState(false);
  // Add slot modal
  const [showAddSlot, setShowAddSlot] = useState(false);
  const [addSlotData, setAddSlotData] = useState({ day: '', slot_number: '', course_id: '', teacher_id: '', room_id: '' });
  const [mergeLevels, setMergeLevels] = useState<number[]>([]);
  const [mergeSections, setMergeSections] = useState('');
  const [mergeDept, setMergeDept] = useState(''); // 🆕 قسم آخر من نفس الكلية للمحاضرة المشتركة
  const [mergeDeptLevels, setMergeDeptLevels] = useState<number[]>([]);
  const [addSlotFreeRooms, setAddSlotFreeRooms] = useState<any[] | null>(null);
  const [courses, setCourses] = useState<any[]>([]);

  // Load initial data
  useEffect(() => {
    (async () => {
      try {
        const [facRes, settRes] = await Promise.all([
          api.get('/faculties'),
          scheduleAPI.getSettings(),
        ]);
        setFaculties(facRes.data);
        setTimeSlots(settRes.data.time_slots || []);
        setEditSlots(settRes.data.time_slots || []);
        setEditWorkingDays(settRes.data.working_days || []);
      } catch (e) { console.error(e); }
    })();
  }, []);

  // Load departments, rooms, and settings when faculty changes
  useEffect(() => {
    if (!selectedFaculty) { setDepartments([]); setRooms([]); return; }
    (async () => {
      try {
        const [deptRes, roomRes, settRes] = await Promise.all([
          departmentsAPI.getAll(),
          scheduleAPI.getRooms(selectedFaculty),
          scheduleAPI.getSettings(selectedFaculty),
        ]);
        setDepartments(deptRes.data.filter((d: any) => d.faculty_id === selectedFaculty));
        setRooms(roomRes.data);
        setTimeSlots(settRes.data.time_slots || []);
        setEditSlots(settRes.data.time_slots || []);
        setEditWorkingDays(settRes.data.working_days || []);
      } catch (e) { console.error(e); }
    })();
  }, [selectedFaculty]);

  // Load schedule
  const loadSchedule = useCallback(async () => {
    if (!selectedFaculty) return;
    if (viewMode === 'master') return; // العرض الشامل يجلب بياناته بنفسه
    setLoading(true);
    try {
      const params: any = { faculty_id: selectedFaculty };
      if (viewMode === 'section') {
        if (selectedDept) params.department_id = selectedDept;
        if (selectedLevel) params.level = parseInt(selectedLevel);
        if (selectedSection) params.section = selectedSection;
      } else if (viewMode === 'department') {
        if (selectedDept) params.department_id = selectedDept;
      } else if (viewMode === 'course') {
        if (scheduleCourse) params.course_id = scheduleCourse;
        else { setSchedule([]); setLoading(false); return; }
      } else if (viewMode === 'teacher') {
        if (scheduleTeacher) params.teacher_id = scheduleTeacher;
        else { setSchedule([]); setLoading(false); return; }
        if (selectedDept) params.department_id = selectedDept; // قيد اختياري لجدول المعلم داخل قسم
      }
      const res = await scheduleAPI.getSchedule(params);
      setSchedule(res.data);

      // جلب التعارضات بنفس الفلاتر
      try {
        const conflictParams: any = { faculty_id: selectedFaculty };
        if (selectedDept) conflictParams.department_id = selectedDept;
        if (selectedLevel) conflictParams.level = parseInt(selectedLevel);
        if (selectedSection) conflictParams.section = selectedSection;
        if (viewMode === 'teacher' && scheduleTeacher) conflictParams.teacher_id = scheduleTeacher;
        const cr = await api.get('/weekly-schedule/conflicts', { params: conflictParams });
        setConflicts(cr.data || { total_conflicts: 0, total_conflicting_slots: 0, conflicting_slot_ids: [], all_conflicts: [] });
      } catch (err) {
        console.warn('Conflicts fetch failed:', err);
        setConflicts({ total_conflicts: 0, total_conflicting_slots: 0, conflicting_slot_ids: [], all_conflicts: [] });
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [selectedFaculty, selectedDept, selectedLevel, selectedSection, viewMode, scheduleCourse, scheduleTeacher]);

  useEffect(() => { if (selectedFaculty) loadSchedule(); }, [loadSchedule]);

  // Load teachers for prefs/add (by department)
  useEffect(() => {
    if (selectedDept) {
      (async () => {
        try {
          const [tRes, cRes] = await Promise.all([
            teachersAPI.getAll({ department_id: selectedDept }),
            coursesAPI.getAll({ department_id: selectedDept }),
          ]);
          setTeachers(tRes.data);
          setCourses(cRes.data);
        } catch {}
      })();
    }
  }, [selectedDept]);

  // 🏫 جلب القاعات الفارغة عند اختيار اليوم/الفترة في نافذة الإضافة اليدوية
  useEffect(() => {
    if (!showAddSlot || !selectedFaculty || !addSlotData.day || !addSlotData.slot_number) {
      setAddSlotFreeRooms(null);
      return;
    }
    setAddSlotFreeRooms(null);
    setAddSlotData(p => ({ ...p, room_id: '' }));
    api.get('/weekly-schedule/free-rooms', {
      params: { faculty_id: selectedFaculty, day: addSlotData.day, slot_number: parseInt(addSlotData.slot_number) },
    })
      .then(res => setAddSlotFreeRooms(res.data || []))
      .catch(() => setAddSlotFreeRooms([]));
  }, [showAddSlot, selectedFaculty, addSlotData.day, addSlotData.slot_number]);

  // 📋 تحميل ملخص التفضيلات المحفوظة لكل معلمي القسم (تبويب التفضيلات)
  const loadPrefsSummary = useCallback(async () => {
    if (!selectedDept) { setPrefsSummary([]); return; }
    setPrefsSummaryLoading(true);
    try {
      const res = await scheduleAPI.getTeacherPrefsSummary(selectedDept);
      setPrefsSummary(res.data || []);
    } catch { setPrefsSummary([]); }
    finally { setPrefsSummaryLoading(false); }
  }, [selectedDept]);

  useEffect(() => {
    if (activeTab === 'prefs') loadPrefsSummary();
  }, [activeTab, loadPrefsSummary]);

  // Load all teachers + courses in the faculty (for schedule view modes: teacher/course)
  useEffect(() => {
    if (!selectedFaculty) { setAllTeachers([]); setAllCourses([]); return; }
    (async () => {
      try {
        const deptIds = departments.map((d: any) => d.id);
        if (!deptIds.length) return;
        // get all teachers and courses for all departments of this faculty (in parallel)
        const [tRes, cRes] = await Promise.all([
          teachersAPI.getAll({}),
          coursesAPI.getAll({}),
        ]);
        const teachersInFaculty = (tRes.data || []).filter((t: any) => deptIds.includes(t.department_id));
        const coursesInFaculty = (cRes.data || []).filter((c: any) => deptIds.includes(c.department_id));
        setAllTeachers(teachersInFaculty);
        setAllCourses(coursesInFaculty);
      } catch {}
    })();
  }, [selectedFaculty, departments]);

  // Load teacher prefs
  useEffect(() => {
    if (selectedTeacher && activeTab === 'prefs') {
      (async () => {
        try {
          const res = await scheduleAPI.getTeacherPrefs(selectedTeacher);
          const d = res.data || {};
          // 🔧 تطبيع فوري: دمج الحقول القديمة في الشبكة مرة واحدة ثم تصفيرها
          // حتى تكون unavailable_periods هي مصدر الحقيقة الوحيد (قابلة للتعديل والحفظ)
          const periodsSet = new Set<string>();
          (d.unavailable_periods || []).forEach((p: any) => periodsSet.add(`${p.day}|${Number(p.slot_number)}`));
          (d.unavailable_days || []).forEach((day: string) => {
            timeSlots.forEach(ts => periodsSet.add(`${day}|${ts.slot_number}`));
          });
          (d.unavailable_slots || []).forEach((sn: number) => {
            DAYS.forEach(day => periodsSet.add(`${day}|${Number(sn)}`));
          });
          const normalized = Array.from(periodsSet).map(k => {
            const [day, sn] = k.split('|');
            return { day, slot_number: Number(sn) };
          });
          setPrefs({ ...d, unavailable_periods: normalized, unavailable_days: [], unavailable_slots: [] });
        } catch {}
      })();
    }
  }, [selectedTeacher, activeTab, timeSlots]);

  const handleGenerate = async () => {
    if (!selectedFaculty) return;
    const deptName = departments.find(d => d.id === selectedDept)?.name;
    const facName = faculties.find(f => f.id === selectedFaculty)?.name || '';
    const scopeMsg = selectedDept
      ? `📍 النطاق: قسم "${deptName}" فقط\n(لن يتأثر جدول بقية الأقسام، ومع مراعاة تعارضات المعلمين والقاعات مع كل الأقسام والكليات)`
      : `📍 النطاق: كامل كلية "${facName}" (${departments.length} قسم)`;
    const msg = `هل تريد توليد الجدول تلقائياً؟\n\n${scopeMsg}\n\nسيتم توزيع المقررات مع مراعاة التعارضات والتفضيلات`;
    if (Platform.OS === 'web' && !window.confirm(msg)) return;
    setGenerating(true);
    try {
      const res = await scheduleAPI.autoGenerate(selectedFaculty, selectedDept || undefined);
      const d = res.data;
      let resultMsg = (selectedDept ? `[قسم ${deptName}] ` : '') + d.message;
      if (d.errors?.length) resultMsg += '\n\nملاحظات:\n' + d.errors.join('\n');
      if (Platform.OS === 'web') window.alert(resultMsg);
      else Alert.alert('نتيجة', resultMsg);
      loadSchedule();
    } catch (e: any) {
      const err = e?.response?.data?.detail || 'حدث خطأ';
      if (Platform.OS === 'web') window.alert(err);
    } finally { setGenerating(false); }
  };

  // ============= 🗓️ توليد المحاضرات من الجدول الأسبوعي =============
  const [showGenLecturesModal, setShowGenLecturesModal] = useState(false);
  const [genLecStart, setGenLecStart] = useState('');
  const [genLecEnd, setGenLecEnd] = useState('');
  const [genLecHolidays, setGenLecHolidays] = useState<string[]>([]);
  const [genLecHolidayInput, setGenLecHolidayInput] = useState('');
  const [genLecPreview, setGenLecPreview] = useState<any>(null);
  const [genLecLoading, setGenLecLoading] = useState(false);
  const [resyncLoading, setResyncLoading] = useState(false);

  const runResyncTimes = async () => {
    setResyncLoading(true);
    try {
      const preview = await api.post('/weekly-schedule/resync-lecture-times', {
        faculty_id: selectedFaculty,
        department_id: selectedDept || null,
        dry_run: true,
      });
      const cnt = preview.data?.to_update || 0;
      if (cnt === 0) {
        window.alert('✅ كل أوقات المحاضرات المولدة مطابقة للفترات الحالية — لا شيء يحتاج تصحيحاً');
        return;
      }
      const patterns = (preview.data?.patterns || []).map((p: any) => `• ${p.change} (${p.count} محاضرة)`).join('\n');
      const ok = Platform.OS === 'web'
        ? window.confirm(`سيتم تصحيح أوقات ${cnt} محاضرة وفق أوقات الفترات الحالية:\n\n${patterns}\n\nهل تريد المتابعة؟`)
        : true;
      if (!ok) return;
      const res = await api.post('/weekly-schedule/resync-lecture-times', {
        faculty_id: selectedFaculty,
        department_id: selectedDept || null,
        dry_run: false,
      });
      window.alert(`✅ ${res.data?.message || 'تمت المزامنة'}`);
    } catch (e: any) {
      window.alert(`❌ ${e?.response?.data?.detail || 'فشلت المزامنة'}`);
    } finally { setResyncLoading(false); }
  };

  const openGenLecturesModal = async () => {
    setGenLecPreview(null);
    setGenLecHolidays([]);
    setGenLecHolidayInput('');
    // افتراضياً: فترة الفصل النشط إن وُجدت
    try {
      const res = await api.get('/settings');
      if (res.data?.semester_start_date && res.data?.semester_end_date) {
        setGenLecStart(res.data.semester_start_date);
        setGenLecEnd(res.data.semester_end_date);
      }
    } catch {}
    setShowGenLecturesModal(true);
  };

  const runGenLectures = async (dryRun: boolean) => {
    if (!genLecStart || !genLecEnd) {
      if (Platform.OS === 'web') window.alert('حدد فترة التوليد (من - إلى)');
      return;
    }
    setGenLecLoading(true);
    try {
      const res = await scheduleAPI.generateLecturesFromSchedule({
        faculty_id: selectedFaculty,
        department_id: selectedDept || null,
        start_date: genLecStart,
        end_date: genLecEnd,
        holidays: genLecHolidays,
        dry_run: dryRun,
      });
      if (dryRun) {
        setGenLecPreview(res.data);
      } else {
        if (Platform.OS === 'web') window.alert(res.data.message);
        setShowGenLecturesModal(false);
        setGenLecPreview(null);
      }
    } catch (e: any) {
      if (Platform.OS === 'web') window.alert(e?.response?.data?.detail || 'حدث خطأ');
    } finally { setGenLecLoading(false); }
  };

  const handleDeleteSlot = async (id: string) => {
    if (Platform.OS === 'web' && !window.confirm('حذف هذه المحاضرة من الجدول؟')) return;
    try {
      await scheduleAPI.deleteSlot(id);
      loadSchedule();
    } catch {}
  };

  const handleClearSchedule = async () => {
    const deptName = departments.find(d => d.id === selectedDept)?.name;
    const facName = faculties.find(f => f.id === selectedFaculty)?.name || '';
    const scopeMsg = selectedDept
      ? `مسح جدول قسم "${deptName}" فقط؟`
      : selectedFaculty
        ? `⚠️ مسح جدول كامل كلية "${facName}" (كل الأقسام)؟`
        : '⚠️ مسح الجدول بالكامل لكل الكليات؟';
    if (Platform.OS === 'web' && !window.confirm(scopeMsg + '\nلا يمكن التراجع')) return;
    try {
      const params: any = {};
      if (selectedFaculty) params.faculty_id = selectedFaculty;
      if (selectedDept) params.department_id = selectedDept;
      await scheduleAPI.clearSchedule(params);
      loadSchedule();
    } catch {}
  };

  // ============= Drafts (نسخ احتياطية للمقارنة) =============
  const [drafts, setDrafts] = useState<any[]>([]);
  const [showDraftsModal, setShowDraftsModal] = useState(false);
  const [showSaveDraftModal, setShowSaveDraftModal] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);
  const [comparingDraft, setComparingDraft] = useState<any>(null);

  const fetchDrafts = async () => {
    try {
      const res = await api.get('/weekly-schedule/drafts');
      setDrafts(Array.isArray(res.data) ? res.data : []);
    } catch (e) { console.error(e); }
  };

  const handleSaveDraft = async () => {
    if (!draftName.trim()) {
      if (Platform.OS === 'web') window.alert('أدخل اسم النسخة');
      return;
    }
    setSavingDraft(true);
    try {
      const body: any = { name: draftName.trim(), notes: draftNotes };
      if (selectedFaculty) body.faculty_id = selectedFaculty;
      if (selectedDept) body.department_id = selectedDept;
      const res = await api.post('/weekly-schedule/drafts', body);
      if (Platform.OS === 'web') window.alert(res.data.message);
      setShowSaveDraftModal(false);
      setDraftName('');
      setDraftNotes('');
      fetchDrafts();
    } catch (e: any) {
      const err = e?.response?.data?.detail || 'فشل الحفظ';
      if (Platform.OS === 'web') window.alert(err);
    } finally { setSavingDraft(false); }
  };

  const handleRestoreDraft = async (id: string, name: string) => {
    if (Platform.OS === 'web' && !window.confirm(
      `استعادة النسخة "${name}"؟\n\nسيتم حفظ الجدول الحالي تلقائياً كنسخة احتياطية قبل الاستبدال، حتى لا تفقد البيانات الحالية.\n\nالمتابعة؟`
    )) return;
    try {
      const res = await api.post(`/weekly-schedule/drafts/${id}/restore`, null, { params: { backup_current: true } });
      const d = res.data || {};
      const backupMsg = d.backup_created
        ? `\nتم حفظ الجدول السابق كنسخة احتياطية (${d.backup_slots_count} محاضرة) باسم تلقائي.`
        : '\nلم يكن هناك جدول حالي ليُحفظ.';
      if (Platform.OS === 'web') window.alert(`${d.message || 'تمت الاستعادة'}${backupMsg}`);
      setShowDraftsModal(false);
      loadSchedule();
    } catch (e: any) {
      const err = e?.response?.data?.detail || 'فشل الاسترجاع';
      if (Platform.OS === 'web') window.alert(err);
    }
  };

  const handleDeleteDraft = async (id: string, name: string) => {
    if (Platform.OS === 'web' && !window.confirm(`حذف النسخة "${name}"؟`)) return;
    try {
      await api.delete(`/weekly-schedule/drafts/${id}`);
      fetchDrafts();
    } catch {}
  };

  const handleCompareDraft = async (id: string) => {
    try {
      const res = await api.get(`/weekly-schedule/drafts/${id}/compare`);
      setComparingDraft(res.data);
    } catch (e: any) {
      const err = e?.response?.data?.detail || 'فشل المقارنة';
      if (Platform.OS === 'web') window.alert(err);
    }
  };

  // ============= Visual Export =============
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<'pdf' | 'excel'>('pdf');
  const [exportScope, setExportScope] = useState<'all' | 'teacher' | 'all_teachers' | 'room' | 'section' | 'department'>('all');
  const [exportTeacherId, setExportTeacherId] = useState('');
  const [exportTeacherSearch, setExportTeacherSearch] = useState('');
  const [exportRoomId, setExportRoomId] = useState('');

  const handleExport = async () => {
    const params: any = {};
    if (selectedFaculty) params.faculty_id = selectedFaculty;
    if (selectedDept) params.department_id = selectedDept;

    if (exportScope === 'teacher' && exportTeacherId) {
      params.teacher_id = exportTeacherId;
    } else if (exportScope === 'all_teachers') {
      params.per_teacher = true;
    } else if (exportScope === 'room' && exportRoomId) {
      params.room_id = exportRoomId;
    } else if (exportScope === 'section') {
      if (selectedLevel) params.level = selectedLevel;
      if (selectedSection) params.section = selectedSection;
    }

    try {
      // نستخدم قناة axios الموحدة (API_URL الصحيح لكل بيئة + التوكن تلقائياً)
      const res = await api.get(`/weekly-schedule/export-visual/${exportFormat}`, {
        params,
        responseType: 'blob',
      });
      const objUrl = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = objUrl;
      link.download = `weekly_schedule.${exportFormat === 'pdf' ? 'pdf' : 'xlsx'}`;
      link.click();
      URL.revokeObjectURL(objUrl);
      setShowExportModal(false);
    } catch (e: any) {
      let msg = 'فشل التصدير';
      try {
        const blobData = e?.response?.data;
        if (blobData && typeof blobData.text === 'function') {
          const j = JSON.parse(await blobData.text());
          if (j.detail) msg = j.detail;
        }
      } catch {}
      if (e?.response?.status) msg += ` (رمز ${e.response.status})`;
      else if (e?.message) msg += ` — ${e.message}`;
      if (Platform.OS === 'web') window.alert(msg);
    }
  };

  const handleAddRoom = async () => {
    if (!newRoom.name || !selectedFaculty) {
      if (Platform.OS === 'web') window.alert('اختر الكلية وأدخل اسم القاعة');
      return;
    }
    try {
      await scheduleAPI.createRoom({ ...newRoom, capacity: parseInt(newRoom.capacity) || 30, faculty_id: selectedFaculty });
      const res = await scheduleAPI.getRooms(selectedFaculty);
      setRooms(res.data);
      setNewRoom({ name: '', capacity: '30', building: '', floor: '' });
    } catch (e: any) {
      if (Platform.OS === 'web') window.alert(e?.response?.data?.detail || 'خطأ');
    }
  };

  const handleDeleteRoom = async (id: string) => {
    if (Platform.OS === 'web' && !window.confirm('حذف القاعة؟')) return;
    try {
      await scheduleAPI.deleteRoom(id);
      setRooms(prev => prev.filter(r => r.id !== id));
    } catch {}
  };

  const handleImportRooms = async (file: File) => {
    if (!selectedFaculty) return;
    setImportingRooms(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await scheduleAPI.importRooms(selectedFaculty, formData);
      const d = res.data;
      let msg = d.message;
      if (d.errors?.length) msg += '\n\n' + d.errors.join('\n');
      if (Platform.OS === 'web') window.alert(msg);
      const roomsRes = await scheduleAPI.getRooms(selectedFaculty);
      setRooms(roomsRes.data);
    } catch (e: any) {
      if (Platform.OS === 'web') window.alert(e?.response?.data?.detail || 'خطأ في الاستيراد');
    } finally {
      setImportingRooms(false);
    }
  };

  const handleSaveSlots = async () => {
    if (editWorkingDays.length === 0) {
      if (Platform.OS === 'web') window.alert('اختر يوم عمل واحداً على الأقل');
      return;
    }
    setSavingSlots(true);
    try {
      await scheduleAPI.saveTimeSlots(editSlots, selectedFaculty || undefined);
      await scheduleAPI.saveWorkingDays(editWorkingDays, selectedFaculty || undefined);
      setTimeSlots(editSlots);
      if (Platform.OS === 'web') window.alert('تم حفظ الفترات الزمنية وأيام العمل');
    } catch (e: any) {
      if (Platform.OS === 'web') window.alert(e?.response?.data?.detail || 'حدث خطأ في الحفظ');
    }
    finally { setSavingSlots(false); }
  };

  const handleSavePrefs = async () => {
    if (!selectedTeacher) return;
    setSavingPrefs(true);
    try {
      await scheduleAPI.saveTeacherPrefs(selectedTeacher, prefs);
      if (Platform.OS === 'web') window.alert('تم حفظ التفضيلات');
      loadPrefsSummary(); // تحديث شارات القائمة
    } catch {}
    finally { setSavingPrefs(false); }
  };

  const handleClearPrefs = async () => {
    if (!selectedTeacher) return;
    if (Platform.OS === 'web' && !window.confirm('سيتم مسح كل التفضيلات لهذا المعلم (الفترات المحظورة) وإعادة الإعدادات الافتراضية (3 محاضرات يومياً + السماح بالمتتالية)\n\nهل أنت متأكد؟')) return;
    setSavingPrefs(true);
    try {
      const cleared = { unavailable_days: [], unavailable_slots: [], unavailable_periods: [], max_daily_lectures: 3, allow_consecutive_lectures: true };
      await scheduleAPI.saveTeacherPrefs(selectedTeacher, cleared);
      setPrefs(cleared);
      if (Platform.OS === 'web') window.alert('تم مسح كل التفضيلات — صفحة نظيفة');
      loadPrefsSummary();
    } catch {}
    finally { setSavingPrefs(false); }
  };

  const handleAddScheduleSlot = async () => {
    if (!addSlotData.day || !addSlotData.slot_number || !addSlotData.course_id || !addSlotData.room_id) {
      if (Platform.OS === 'web') window.alert('أكمل جميع الحقول');
      return;
    }
    const course = courses.find((c: any) => c.id === addSlotData.course_id);
    // 🆕 محاضرة مشتركة: مستويات إضافية + شعب من نفس المستوى
    const merge_with: any[] = mergeLevels
      .filter(l => l !== (course?.level || 1))
      .map(l => ({ level: l, section: '' }));
    mergeSections.split(/[+,،\s]+/).map(s => s.trim()).filter(Boolean).forEach(sec => {
      if (sec !== (course?.section || '')) merge_with.push({ level: course?.level || 1, section: sec });
    });
    // 🆕 قسم آخر من نفس الكلية
    if (mergeDept && mergeDept !== selectedDept) {
      mergeDeptLevels.forEach(l => merge_with.push({ department_id: mergeDept, level: l, section: '' }));
    }
    try {
      await scheduleAPI.createSlot({
        faculty_id: selectedFaculty,
        department_id: selectedDept,
        level: course?.level || 1,
        section: course?.section || '',
        day: addSlotData.day,
        slot_number: parseInt(addSlotData.slot_number),
        course_id: addSlotData.course_id,
        teacher_id: addSlotData.teacher_id || course?.teacher_id || '',
        room_id: addSlotData.room_id,
        ...(merge_with.length ? { merge_with } : {}),
      });
      setShowAddSlot(false);
      setAddSlotData({ day: '', slot_number: '', course_id: '', teacher_id: '', room_id: '' });
      setMergeLevels([]);
      setMergeSections('');
      setMergeDept('');
      setMergeDeptLevels([]);
      loadSchedule();
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      if (detail?.conflicts) {
        if (Platform.OS === 'web') window.alert('تعارضات:\n' + detail.conflicts.join('\n'));
      } else {
        if (Platform.OS === 'web') window.alert(typeof detail === 'string' ? detail : 'حدث خطأ');
      }
    }
  };

  // Build grid: day -> slot_number -> items[]
  const grid: Record<string, Record<number, any[]>> = {};
  for (const day of DAYS) {
    grid[day] = {};
    for (const ts of timeSlots) { grid[day][ts.slot_number] = []; }
  }
  const seenMerge = new Set<string>();
  for (const s of schedule) {
    if (grid[s.day] && grid[s.day][s.slot_number]) {
      // 🔗 وضع المعلم: دمج أعضاء المجموعة المشتركة في صندوق واحد بدل التكرار
      if (viewMode === 'teacher' && s.merge_group_id) {
        const k = `${s.merge_group_id}:${s.day}:${s.slot_number}`;
        if (seenMerge.has(k)) continue;
        seenMerge.add(k);
      }
      grid[s.day][s.slot_number].push(s);
    }
  }

  const TABS = [
    { key: 'schedule', label: 'الجدول', icon: 'calendar' },
    { key: 'rooms', label: 'القاعات', icon: 'business' },
    { key: 'settings', label: 'الفترات', icon: 'time' },
    { key: 'prefs', label: 'تفضيلات المعلمين', icon: 'person' },
  ];

  return (
    <SafeAreaView style={st.container} edges={['bottom']}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => goBack()}><Ionicons name="arrow-forward" size={18} color="#3f4b5c" /></TouchableOpacity>
        <Text style={st.headerTitle}>الجدول الأسبوعي</Text>
        <View style={{ width: 18 }} />
      </View>

      {/* Tabs - underline style, compact */}
      <View style={st.tabsBar}>
        {TABS.map(t => (
          <TouchableOpacity key={t.key} style={[st.tab, activeTab === t.key && st.tabActive]} onPress={() => setActiveTab(t.key as any)}>
            <Ionicons name={t.icon as any} size={13} color={activeTab === t.key ? '#1565c0' : '#5b6678'} />
            <Text style={[st.tabText, activeTab === t.key && st.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={{ flex: 1, padding: 10 }}>

        {/* ====== TAB: SCHEDULE ====== */}
        {activeTab === 'schedule' && (
          <>
            {/* View mode selector - compact chips */}
            <View style={st.cardCompact}>
              <Text style={st.label}>نمط العرض</Text>
              <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
                {[
                  { key: 'section', label: 'بالشعبة', icon: 'layers-outline' },
                  { key: 'department', label: 'بالقسم', icon: 'school-outline' },
                  { key: 'course', label: 'بالمقرر', icon: 'book-outline' },
                  { key: 'teacher', label: 'بالأستاذ', icon: 'person-outline' },
                  { key: 'master', label: 'العرض الشامل', icon: 'grid-outline' },
                ].map(m => {
                  const active = viewMode === m.key;
                  return (
                    <TouchableOpacity
                      key={m.key}
                      onPress={() => setViewMode(m.key as any)}
                      style={[st.vmChip, active && st.vmChipActive]}
                      testID={`view-mode-${m.key}`}
                    >
                      <Ionicons name={m.icon as any} size={12} color={active ? '#fff' : '#5b6678'} />
                      <Text style={[st.vmChipText, active && st.vmChipTextActive]}>{m.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Filters - compact */}
            <View style={st.cardCompact}>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                <View style={{ flex: 1, minWidth: 140 }}>
                  <Text style={st.label}>الكلية</Text>
                  <View style={st.pickerWrap}>
                    <Picker selectedValue={selectedFaculty} onValueChange={v => { setSelectedFaculty(v); setSelectedDept(''); setScheduleTeacher(''); setScheduleCourse(''); }} style={{ height: 34, fontSize: 13 }}>
                      <Picker.Item label="-- الكلية --" value="" />
                      {faculties.map(f => <Picker.Item key={f.id} label={f.name} value={f.id} />)}
                    </Picker>
                  </View>
                </View>

                {/* Section mode: dept + level + section */}
                {viewMode === 'section' && (
                  <>
                    <View style={{ flex: 1, minWidth: 140 }}>
                      <Text style={st.label}>القسم (اختياري)</Text>
                      <View style={st.pickerWrap}>
                        <Picker selectedValue={selectedDept} onValueChange={setSelectedDept} style={{ height: 34, fontSize: 13 }}>
                          <Picker.Item label="-- الكل --" value="" />
                          {departments.map(d => <Picker.Item key={d.id} label={d.name} value={d.id} />)}
                        </Picker>
                      </View>
                    </View>
                    <View style={{ flex: 0.5, minWidth: 76 }}>
                      <Text style={st.label}>المستوى</Text>
                      <View style={st.pickerWrap}>
                        <Picker selectedValue={selectedLevel} onValueChange={setSelectedLevel} style={{ height: 34, fontSize: 13 }}>
                          <Picker.Item label="الكل" value="" />
                          {[1,2,3,4,5,6].map(l => <Picker.Item key={l} label={`م${l}`} value={String(l)} />)}
                        </Picker>
                      </View>
                    </View>
                  </>
                )}

                {/* Master mode: optional department filter */}
                {viewMode === 'master' && (
                  <View style={{ flex: 1, minWidth: 140 }}>
                    <Text style={st.label}>القسم (اختياري)</Text>
                    <View style={st.pickerWrap}>
                      <Picker selectedValue={selectedDept} onValueChange={setSelectedDept} style={{ height: 34, fontSize: 13 }}>
                        <Picker.Item label="-- كامل الكلية --" value="" />
                        {departments.map(d => <Picker.Item key={d.id} label={d.name} value={d.id} />)}
                      </Picker>
                    </View>
                  </View>
                )}

                {/* Department mode: pick one department */}
                {viewMode === 'department' && (
                  <View style={{ flex: 2, minWidth: 180 }}>
                    <Text style={st.label}>القسم *</Text>
                    <View style={st.pickerWrap}>
                      <Picker selectedValue={selectedDept} onValueChange={setSelectedDept} style={{ height: 34, fontSize: 13 }}>
                        <Picker.Item label="-- اختر القسم --" value="" />
                        {departments.map(d => <Picker.Item key={d.id} label={d.name} value={d.id} />)}
                      </Picker>
                    </View>
                  </View>
                )}

                {/* Course mode: pick one course */}
                {viewMode === 'course' && (
                  <>
                    <View style={{ flex: 1, minWidth: 140 }}>
                      <Text style={st.label}>القسم (لتصفية المقررات)</Text>
                      <View style={st.pickerWrap}>
                        <Picker selectedValue={selectedDept} onValueChange={setSelectedDept} style={{ height: 34, fontSize: 13 }}>
                          <Picker.Item label="-- كل الأقسام --" value="" />
                          {departments.map(d => <Picker.Item key={d.id} label={d.name} value={d.id} />)}
                        </Picker>
                      </View>
                    </View>
                    <View style={{ flex: 2, minWidth: 180 }}>
                      <Text style={st.label}>المقرر *</Text>
                      <View style={st.pickerWrap}>
                        <Picker selectedValue={scheduleCourse} onValueChange={setScheduleCourse} style={{ height: 34, fontSize: 13 }}>
                          <Picker.Item label="-- اختر المقرر --" value="" />
                          {allCourses.filter((c: any) => !selectedDept || c.department_id === selectedDept).map((c: any) => (
                            <Picker.Item key={c.id} label={`${c.name}${c.section ? ` (${c.section})` : ''} - م${c.level || 1}`} value={c.id} />
                          ))}
                        </Picker>
                      </View>
                    </View>
                  </>
                )}

                {/* Teacher mode: pick one teacher (optionally dept) */}
                {viewMode === 'teacher' && (
                  <>
                    <View style={{ flex: 1, minWidth: 150 }}>
                      <Text style={st.label}>القسم (اختياري)</Text>
                      <View style={st.pickerWrap}>
                        <Picker selectedValue={selectedDept} onValueChange={setSelectedDept} style={{ height: 40 }}>
                          <Picker.Item label="-- كل الأقسام --" value="" />
                          {departments.map(d => <Picker.Item key={d.id} label={d.name} value={d.id} />)}
                        </Picker>
                      </View>
                    </View>
                    <View style={{ flex: 2, minWidth: 220 }}>
                      <Text style={st.label}>الأستاذ *</Text>
                      <TeacherSearchBox
                        teachers={allTeachers.filter((t: any) => !selectedDept || t.department_id === selectedDept)}
                        selectedId={scheduleTeacher}
                        onSelect={setScheduleTeacher}
                        placeholder="ابحث عن الأستاذ..."
                      />
                    </View>
                  </>
                )}
              </View>

              {/* Actions */}
              {selectedFaculty && (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  {viewMode === 'section' && (
                    <View style={{
                      flexDirection: 'row-reverse', alignItems: 'center', gap: 4,
                      backgroundColor: selectedDept ? '#e8f5e9' : '#fff8e1',
                      borderWidth: 1, borderColor: selectedDept ? '#a5d6a7' : '#ffe082',
                      borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
                    }} testID="generation-scope-badge">
                      <Ionicons name="locate" size={13} color={selectedDept ? '#2e7d32' : '#e65100'} />
                      <Text style={{ fontSize: 11, fontWeight: '700', color: selectedDept ? '#2e7d32' : '#e65100' }}>
                        {selectedDept
                          ? `نطاق التوليد/المسح: قسم ${departments.find(d => d.id === selectedDept)?.name || ''} فقط`
                          : `نطاق التوليد/المسح: كامل الكلية (${departments.length} قسم)`}
                      </Text>
                    </View>
                  )}
                  {viewMode === 'section' && (
                    <TouchableOpacity style={[st.btn, { backgroundColor: '#2e7d32' }]} onPress={handleGenerate} disabled={generating} testID="auto-generate-btn">
                      {generating ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="flash" size={16} color="#fff" />}
                      <Text style={st.btnText}>{generating ? 'جاري...' : 'توليد تلقائي'}</Text>
                    </TouchableOpacity>
                  )}
                  {viewMode === 'section' && selectedDept && (
                    <TouchableOpacity style={[st.btn, { backgroundColor: '#1565c0' }]} onPress={() => setShowAddSlot(true)}>
                      <Ionicons name="add" size={16} color="#fff" />
                      <Text style={st.btnText}>إضافة يدوية</Text>
                    </TouchableOpacity>
                  )}
                  {viewMode === 'section' && (
                    <TouchableOpacity style={[st.btn, { backgroundColor: '#e53935' }]} onPress={handleClearSchedule}>
                      <Ionicons name="trash" size={16} color="#fff" />
                      <Text style={st.btnText}>مسح</Text>
                    </TouchableOpacity>
                  )}
                  {/* 💾 حفظ نسخة احتياطية */}
                  {viewMode === 'section' && schedule.length > 0 && (
                    <TouchableOpacity
                      style={[st.btn, { backgroundColor: '#00838f' }]}
                      onPress={openGenLecturesModal}
                      testID="generate-lectures-btn"
                    >
                      <Ionicons name="calendar" size={16} color="#fff" />
                      <Text style={st.btnText}>توليد المحاضرات</Text>
                    </TouchableOpacity>
                  )}
                  {Platform.OS === 'web' && !!selectedFaculty && (
                    <TouchableOpacity
                      style={[st.btn, { backgroundColor: '#ef6c00' }]}
                      onPress={runResyncTimes}
                      disabled={resyncLoading}
                      testID="resync-lecture-times-btn"
                    >
                      <Ionicons name="time" size={16} color="#fff" />
                      <Text style={st.btnText}>{resyncLoading ? 'جاري الفحص...' : 'مزامنة الأوقات'}</Text>
                    </TouchableOpacity>
                  )}
                  {viewMode === 'section' && schedule.length > 0 && (
                    <TouchableOpacity
                      style={[st.btn, { backgroundColor: '#6a1b9a' }]}
                      onPress={() => {
                        const now = new Date();
                        setDraftName(`نسخة ${now.toLocaleDateString('ar')}-${now.getHours()}:${now.getMinutes()}`);
                        setShowSaveDraftModal(true);
                      }}
                      data-testid="save-draft-btn"
                    >
                      <Ionicons name="bookmark" size={16} color="#fff" />
                      <Text style={st.btnText}>حفظ نسخة</Text>
                    </TouchableOpacity>
                  )}
                  {/* 📂 النسخ المحفوظة */}
                  {viewMode === 'section' && (
                    <TouchableOpacity
                      style={[st.btn, { backgroundColor: '#ef6c00' }]}
                      onPress={async () => {
                        await fetchDrafts();
                        setShowDraftsModal(true);
                      }}
                      data-testid="open-drafts-btn"
                    >
                      <Ionicons name="folder-open" size={16} color="#fff" />
                      <Text style={st.btnText}>النسخ المحفوظة</Text>
                    </TouchableOpacity>
                  )}
                  {/* 📄 تصدير */}
                  {schedule.length > 0 && (
                    <TouchableOpacity
                      style={[st.btn, { backgroundColor: '#00838f' }]}
                      onPress={() => setShowExportModal(true)}
                      data-testid="export-btn"
                    >
                      <Ionicons name="download" size={16} color="#fff" />
                      <Text style={st.btnText}>تصدير</Text>
                    </TouchableOpacity>
                  )}
                  {/* 📊 تقرير الفراغ */}
                  <TouchableOpacity
                    style={[st.btn, { backgroundColor: '#5c6bc0' }]}
                    onPress={() => router.push('/availability-report')}
                    data-testid="availability-report-btn"
                  >
                    <Ionicons name="analytics" size={16} color="#fff" />
                    <Text style={st.btnText}>تقرير الفراغ</Text>
                  </TouchableOpacity>

                  {schedule.length > 0 && (
                    <View style={{ marginLeft: 'auto', paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#e3f2fd', borderRadius: 6 }}>
                      <Text style={{ fontSize: 12, color: '#1565c0', fontWeight: '600' }}>إجمالي المحاضرات: {viewMode === 'teacher' ? new Set(schedule.map((s: any) => s.merge_group_id ? `${s.merge_group_id}:${s.day}:${s.slot_number}` : s.id)).size : schedule.length}</Text>
                    </View>
                  )}
                </View>
              )}

              {/* لافتة تحذير التعارضات */}
              {conflicts.total_conflicts > 0 && (
                <TouchableOpacity
                  onPress={() => setShowConflictsModal(true)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 10,
                    backgroundColor: '#ffebee', borderWidth: 1.5, borderColor: '#d32f2f',
                    borderRadius: 8, padding: 12, marginTop: 10,
                  }}
                  testID="conflicts-banner"
                >
                  <Ionicons name="warning" size={22} color="#d32f2f" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#c62828', textAlign: 'right' }}>
                      ⚠️ تم اكتشاف {conflicts.total_conflicts} تعارض في الجدول الأسبوعي
                    </Text>
                    <Text style={{ fontSize: 11, color: '#a31515', textAlign: 'right', marginTop: 2 }}>
                      {conflicts.total_conflicting_slots} خلية متأثرة • اضغط لعرض التفاصيل
                    </Text>
                  </View>
                  <Ionicons name="chevron-back" size={20} color="#d32f2f" />
                </TouchableOpacity>
              )}
            </View>

            {/* Add Slot Modal */}
            {showAddSlot && Platform.OS === 'web' && (
              <View style={[st.card, { borderWidth: 2, borderColor: '#1565c0' }]}>
                <Text style={[st.label, { fontSize: 15, marginBottom: 12 }]}>إضافة محاضرة يدوياً</Text>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  <View style={{ flex: 1, minWidth: 120 }}>
                    <Text style={st.miniLabel}>اليوم</Text>
                    <View style={st.pickerWrap}><Picker selectedValue={addSlotData.day} onValueChange={v => setAddSlotData(p => ({ ...p, day: v }))} style={{ height: 38 }}>
                      <Picker.Item label="--" value="" />{DAYS.map(d => <Picker.Item key={d} label={d} value={d} />)}
                    </Picker></View>
                  </View>
                  <View style={{ flex: 1, minWidth: 120 }}>
                    <Text style={st.miniLabel}>الفترة</Text>
                    <View style={st.pickerWrap}><Picker selectedValue={addSlotData.slot_number} onValueChange={v => setAddSlotData(p => ({ ...p, slot_number: v }))} style={{ height: 38 }}>
                      <Picker.Item label="--" value="" />{timeSlots.map(s => <Picker.Item key={s.slot_number} label={s.name} value={String(s.slot_number)} />)}
                    </Picker></View>
                  </View>
                  <View style={{ flex: 2, minWidth: 160 }}>
                    <Text style={st.miniLabel}>المقرر</Text>
                    <View style={st.pickerWrap}><Picker selectedValue={addSlotData.course_id} onValueChange={v => setAddSlotData(p => ({ ...p, course_id: v }))} style={{ height: 38 }}>
                      <Picker.Item label="--" value="" />{courses.map((c: any) => <Picker.Item key={c.id} label={`${c.name} (${c.code})`} value={c.id} />)}
                    </Picker></View>
                  </View>
                  <View style={{ flex: 1, minWidth: 120 }}>
                    <Text style={st.miniLabel}>القاعة (الفارغة فقط)</Text>
                    <View style={st.pickerWrap}><Picker selectedValue={addSlotData.room_id} onValueChange={v => setAddSlotData(p => ({ ...p, room_id: v }))} style={{ height: 38 }} testID="add-slot-room-picker">
                      {(!addSlotData.day || !addSlotData.slot_number) ? (
                        <Picker.Item label="اختر اليوم والفترة أولاً" value="" />
                      ) : addSlotFreeRooms === null ? (
                        <Picker.Item label="جاري فحص التوفر..." value="" />
                      ) : (
                        [<Picker.Item key="none" label="--" value="" />,
                         ...addSlotFreeRooms.filter((r: any) => !r.busy).map((r: any) => (
                          <Picker.Item key={r.id} label={`${r.name}${r.capacity ? ` (سعة ${r.capacity})` : ''}`} value={r.id} />
                        ))]
                      )}
                    </Picker></View>
                    {addSlotData.day && addSlotData.slot_number && addSlotFreeRooms && addSlotFreeRooms.filter((r: any) => r.busy).length > 0 && (
                      <Text style={{ fontSize: 10, color: '#e65100', marginTop: 3, textAlign: 'right' }} testID="add-slot-busy-note">
                        🔒 مشغولة: {addSlotFreeRooms.filter((r: any) => r.busy).map((r: any) => r.name).join('، ')}
                      </Text>
                    )}
                  </View>
                </View>
                <View style={{ marginTop: 10, backgroundColor: '#e8f5e9', borderRadius: 8, padding: 10 }} data-testid="merge-lecture-box">
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#2e7d32', textAlign: 'right', marginBottom: 6 }}>🔗 محاضرة مشتركة (اختياري) — تُنشأ في جدول كل مستوى/شعبة بنفس المدرس والقاعة والوقت</Text>
                  <View style={{ flexDirection: 'row-reverse', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Text style={{ fontSize: 11.5, color: '#33691e', fontWeight: '700' }}>مستويات إضافية:</Text>
                    {[1, 2, 3, 4, 5, 6, 7, 8].filter(l => l !== (courses.find((c: any) => c.id === addSlotData.course_id)?.level || 1)).map(l => (
                      <TouchableOpacity
                        key={l}
                        onPress={() => setMergeLevels(p => p.includes(l) ? p.filter(x => x !== l) : [...p, l])}
                        style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14, backgroundColor: mergeLevels.includes(l) ? '#2e7d32' : '#fff', borderWidth: 1, borderColor: '#a5d6a7' }}
                        data-testid={`merge-level-${l}`}
                      >
                        <Text style={{ fontSize: 11.5, fontWeight: '700', color: mergeLevels.includes(l) ? '#fff' : '#33691e' }}>م{l}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={{ flexDirection: 'row-reverse', gap: 6, marginTop: 8, alignItems: 'center' }}>
                    <Text style={{ fontSize: 11.5, color: '#33691e', fontWeight: '700' }}>شُعب إضافية من نفس المستوى:</Text>
                    <TextInput
                      value={mergeSections}
                      onChangeText={setMergeSections}
                      placeholder="مثال: ب أو ب+ج"
                      style={{ borderWidth: 1, borderColor: '#a5d6a7', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, fontSize: 12, textAlign: 'right', backgroundColor: '#fff', minWidth: 110 }}
                      data-testid="merge-sections-input"
                    />
                  </View>
                  {Platform.OS === 'web' && departments.filter((d: any) => d.id !== selectedDept).length > 0 && (
                    <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: '#c8e6c9', paddingTop: 8 }}>
                      <View style={{ flexDirection: 'row-reverse', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Text style={{ fontSize: 11.5, color: '#33691e', fontWeight: '700' }}>🏛️ مشتركة مع قسم آخر (نفس الكلية):</Text>
                        <select
                          value={mergeDept}
                          onChange={(ev: any) => { setMergeDept(ev.target.value); setMergeDeptLevels([]); }}
                          style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #a5d6a7', fontSize: 12, direction: 'rtl', backgroundColor: '#fff' }}
                          data-testid="merge-dept-select"
                        >
                          <option value="">— بدون —</option>
                          {departments.filter((d: any) => d.id !== selectedDept).map((d: any) => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                      </View>
                      {mergeDept ? (
                        <View style={{ flexDirection: 'row-reverse', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
                          <Text style={{ fontSize: 11.5, color: '#33691e', fontWeight: '700' }}>مستويات القسم الآخر:</Text>
                          {[1, 2, 3, 4, 5, 6, 7, 8].map(l => (
                            <TouchableOpacity
                              key={l}
                              onPress={() => setMergeDeptLevels(p => p.includes(l) ? p.filter(x => x !== l) : [...p, l])}
                              style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14, backgroundColor: mergeDeptLevels.includes(l) ? '#00695c' : '#fff', borderWidth: 1, borderColor: '#80cbc4' }}
                              data-testid={`merge-dept-level-${l}`}
                            >
                              <Text style={{ fontSize: 11.5, fontWeight: '700', color: mergeDeptLevels.includes(l) ? '#fff' : '#00695c' }}>م{l}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  )}
                </View>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  <TouchableOpacity style={[st.btn, { backgroundColor: '#1565c0' }]} onPress={handleAddScheduleSlot}>
                    <Text style={st.btnText}>إضافة</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[st.btn, { backgroundColor: '#666' }]} onPress={() => setShowAddSlot(false)}>
                    <Text style={st.btnText}>إلغاء</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Master View - العرض الشامل */}
            {viewMode === 'master' ? (
              !selectedFaculty ? (
                <View style={st.emptyCard}><Ionicons name="grid-outline" size={28} color="#cdd5e0" /><Text style={st.emptyText}>اختر الكلية لعرض الجدول الشامل</Text></View>
              ) : (
                <MasterScheduleView facultyId={selectedFaculty} departmentId={selectedDept || undefined} />
              )
            ) : null}

            {/* Schedule Grid */}
            {viewMode === 'master' ? null : loading ? (
              <View style={st.emptyCard}><ActivityIndicator size="large" color="#1565c0" /></View>
            ) : !selectedFaculty ? (
              <View style={st.emptyCard}><Ionicons name="calendar-outline" size={28} color="#cdd5e0" /><Text style={st.emptyText}>اختر الكلية لعرض الجدول</Text></View>
            ) : schedule.length === 0 ? (
              <View style={st.emptyCard}><Ionicons name="calendar-outline" size={28} color="#cdd5e0" /><Text style={st.emptyText}>لا يوجد جدول - اضغط "توليد تلقائي"</Text></View>
            ) : Platform.OS === 'web' ? (
              <div style={{ overflowX: 'auto', direction: 'rtl' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#1565c0' }}>
                      <th style={{ padding: 10, color: '#fff', fontSize: 13, fontWeight: 600, borderLeft: '1px solid rgba(255,255,255,0.2)', width: 70 }}>اليوم</th>
                      {timeSlots.map(ts => (
                        <th key={ts.slot_number} style={{ padding: 10, color: '#fff', fontSize: 12, fontWeight: 600, borderLeft: '1px solid rgba(255,255,255,0.2)', textAlign: 'center' }}>
                          {ts.name}<br/><span style={{ fontSize: 10, opacity: 0.8 }}>{ts.start_time}-{ts.end_time}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DAYS.map((day, di) => (
                      <tr key={day} style={{ backgroundColor: di % 2 === 0 ? '#fafafa' : '#fff' }}>
                        <td style={{ padding: 10, fontWeight: 600, fontSize: 13, borderLeft: '1px solid #eee', textAlign: 'center', backgroundColor: '#f5f5f5' }}>{day}</td>
                        {timeSlots.map(ts => {
                          const items = grid[day]?.[ts.slot_number] || [];
                          return (
                            <td key={ts.slot_number} style={{ padding: 4, borderLeft: '1px solid #eee', verticalAlign: 'top', minWidth: 140 }}>
                              {items.map((item: any, idx: number) => {
                                const isConflict = conflicts.conflicting_slot_ids?.includes(item.id);
                                return (
                                <div key={item.id} style={{
                                  backgroundColor: isConflict ? '#ffebee' : COLORS[idx % COLORS.length] + '15',
                                  border: isConflict ? '2px solid #d32f2f' : `1px solid ${COLORS[idx % COLORS.length]}30`,
                                  borderRadius: 8, padding: 6, marginBottom: 4, position: 'relative',
                                  boxShadow: isConflict ? '0 0 0 2px rgba(211, 47, 47, 0.15)' : 'none',
                                }}>
                                  {isConflict && (
                                    <div title="هذه الخلية تحتوي على تعارض" style={{
                                      position: 'absolute', top: -8, right: -6,
                                      backgroundColor: '#d32f2f', color: '#fff',
                                      width: 18, height: 18, borderRadius: 9,
                                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                                      fontSize: 11, fontWeight: 700, boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                                    }}>!</div>
                                  )}
                                  <div style={{ fontSize: 12, fontWeight: 600, color: '#333', textAlign: 'right' }}>
                                    {item.course_name}
                                    {(item.merged_with?.length > 0 || item.merge_group_id) && (
                                      <span data-testid={`shared-slot-badge-${item.id}`} style={{ fontSize: 9, color: '#00695c', fontWeight: 800, backgroundColor: '#e0f2f1', borderRadius: 4, padding: '1px 4px', marginRight: 4 }}>🔗 مشترك</span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: 10, color: '#666', textAlign: 'right' }}>{item.course_code}</div>
                                  <div style={{ fontSize: 10, color: '#1565c0', textAlign: 'right' }}>{item.teacher_name}</div>
                                  <div style={{ fontSize: 10, color: '#888', textAlign: 'right' }}>{item.room_name} | {item.department_name} م{item.level}{item.section ? ` ${item.section}` : ''}</div>
                                  {item.merged_with?.length > 0 && (
                                    <div style={{ fontSize: 9.5, color: '#2e7d32', fontWeight: 700, textAlign: 'right', backgroundColor: '#e8f5e9', borderRadius: 4, padding: '1px 4px', marginTop: 2 }}>
                                      🔗 مشتركة مع: {item.merged_with.join('، ')}
                                    </div>
                                  )}
                                  <button onClick={() => handleDeleteSlot(item.id)} style={{ position: 'absolute', top: 2, left: 2, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#e53935' }}>x</button>
                                </div>
                                );
                              })}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}

        {/* ====== TAB: ROOMS ====== */}
        {activeTab === 'rooms' && (
          <>
            {/* Faculty picker for rooms */}
            <View style={st.card}>
              <Text style={st.label}>الكلية</Text>
              <View style={st.pickerWrap}>
                <Picker selectedValue={selectedFaculty} onValueChange={v => { setSelectedFaculty(v); setSelectedDept(''); }} style={{ height: 40 }}>
                  <Picker.Item label="-- اختر الكلية --" value="" />
                  {faculties.map(f => <Picker.Item key={f.id} label={f.name} value={f.id} />)}
                </Picker>
              </View>
            </View>

            {selectedFaculty && (
            <View style={st.card}>
              <Text style={[st.label, { fontSize: 15, marginBottom: 12 }]}>إضافة قاعة جديدة</Text>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {Platform.OS === 'web' ? (
                  <>
                    <input placeholder="اسم القاعة *" value={newRoom.name} onChange={(e: any) => setNewRoom(p => ({ ...p, name: e.target.value }))} style={{ flex: 2, padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 14, direction: 'rtl' }} />
                    <input placeholder="السعة" type="number" value={newRoom.capacity} onChange={(e: any) => setNewRoom(p => ({ ...p, capacity: e.target.value }))} style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 14, textAlign: 'center' }} />
                    <input placeholder="المبنى" value={newRoom.building} onChange={(e: any) => setNewRoom(p => ({ ...p, building: e.target.value }))} style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 14, direction: 'rtl' }} />
                    <input placeholder="الطابق" value={newRoom.floor} onChange={(e: any) => setNewRoom(p => ({ ...p, floor: e.target.value }))} style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 14, direction: 'rtl' }} />
                  </>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <TouchableOpacity style={[st.btn, { backgroundColor: '#2e7d32' }]} onPress={handleAddRoom}>
                  <Ionicons name="add" size={16} color="#fff" /><Text style={st.btnText}>إضافة</Text>
                </TouchableOpacity>
                {Platform.OS === 'web' && (
                  <>
                    <TouchableOpacity
                      style={[st.btn, { backgroundColor: '#1565c0' }]}
                      onPress={async () => {
                        try {
                          const token = await (await import('@react-native-async-storage/async-storage')).default.getItem('token');
                          const res = await fetch(`${(api.defaults as any).baseURL}/rooms/template/excel`, {
                            headers: { Authorization: `Bearer ${token}` }
                          });
                          const blob = await res.blob();
                          const url = window.URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = 'rooms_template.xlsx';
                          a.click();
                          window.URL.revokeObjectURL(url);
                        } catch { if (Platform.OS === 'web') window.alert('خطأ في تحميل القالب'); }
                      }}
                    >
                      <Ionicons name="download-outline" size={16} color="#fff" />
                      <Text style={st.btnText}>تحميل القالب</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[st.btn, { backgroundColor: '#e65100', opacity: importingRooms ? 0.6 : 1 }]}
                      disabled={importingRooms}
                      onPress={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = '.xlsx,.xls,.csv';
                        input.onchange = (e: any) => {
                          const file = e.target.files?.[0];
                          if (file) handleImportRooms(file);
                        };
                        input.click();
                      }}
                    >
                      {importingRooms ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="cloud-upload-outline" size={16} color="#fff" />}
                      <Text style={st.btnText}>{importingRooms ? 'جاري الاستيراد...' : 'استيراد Excel'}</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
            )}

            {selectedFaculty && rooms.map(r => (
              <View key={r.id} style={[st.card, { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' }]}>
                <View>
                  <Text style={{ fontSize: 15, fontWeight: '600', color: '#333', textAlign: 'right' }}>{r.name}</Text>
                  <Text style={{ fontSize: 12, color: '#888', textAlign: 'right' }}>سعة: {r.capacity} | {r.building} {r.floor}</Text>
                </View>
                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 14 }}>
                  <TouchableOpacity onPress={() => openRoomSchedule(r)} testID={`room-schedule-btn-${r.id}`} style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4 }}>
                    <Ionicons name="calendar-outline" size={19} color="#1565c0" />
                    <Text style={{ fontSize: 12, color: '#1565c0', fontWeight: '700' }}>جدول القاعة</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleDeleteRoom(r.id)}><Ionicons name="trash-outline" size={20} color="#e53935" /></TouchableOpacity>
                </View>
              </View>
            ))}
            {selectedFaculty && rooms.length === 0 && <View style={st.emptyCard}><Text style={st.emptyText}>لا توجد قاعات لهذه الكلية</Text></View>}

            {!selectedFaculty && <View style={st.emptyCard}><Ionicons name="business-outline" size={28} color="#cdd5e0" /><Text style={st.emptyText}>اختر الكلية لعرض قاعاتها</Text></View>}
          </>
        )}

        {/* ====== TAB: SETTINGS ====== */}
        {activeTab === 'settings' && (
          <>
            <View style={st.card}>
              <Text style={st.label}>الكلية</Text>
              <View style={st.pickerWrap}>
                <Picker selectedValue={selectedFaculty} onValueChange={v => { setSelectedFaculty(v); setSelectedDept(''); }} style={{ height: 40 }}>
                  <Picker.Item label="-- اختر الكلية (أو عام) --" value="" />
                  {faculties.map(f => <Picker.Item key={f.id} label={f.name} value={f.id} />)}
                </Picker>
              </View>
              <Text style={{ fontSize: 11, color: '#888', marginTop: 4, textAlign: 'right' }}>
                {selectedFaculty ? 'فترات خاصة بالكلية المختارة' : 'فترات عامة لكل الكليات (افتراضي)'}
              </Text>
            </View>
          <View style={st.card}>
            <Text style={[st.label, { fontSize: 15, marginBottom: 8 }]}>أيام العمل</Text>
            <Text style={{ fontSize: 11, color: '#888', marginBottom: 10, textAlign: 'right' }}>
              الأيام المفعلة تُستخدم في توليد الجدول — يجب اختيار يوم واحد على الأقل
            </Text>
            <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 }}>
              {['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'].map(day => {
                const on = editWorkingDays.includes(day);
                return (
                  <TouchableOpacity
                    key={day}
                    onPress={() => setEditWorkingDays(prev => on ? prev.filter(d => d !== day) : [...prev, day])}
                    testID={`working-day-${day}`}
                    style={{
                      paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20,
                      backgroundColor: on ? '#1565c0' : '#f0f2f5',
                      borderWidth: 1, borderColor: on ? '#1565c0' : '#dde3ea',
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '700', color: on ? '#fff' : '#667' }}>{day}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {editWorkingDays.length === 0 && (
              <Text style={{ fontSize: 12, color: '#c62828', fontWeight: '700', marginTop: 8, textAlign: 'right' }}>
                ⚠️ لا توجد أيام عمل محددة — التوليد التلقائي لن يعمل حتى تختار وتحفظ
              </Text>
            )}
          </View>
          <View style={st.card}>
            <Text style={[st.label, { fontSize: 15, marginBottom: 12 }]}>الفترات الزمنية</Text>
            {editSlots.map((s, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                <Text style={{ width: 30, textAlign: 'center', fontWeight: '600' }}>{s.slot_number}</Text>
                {Platform.OS === 'web' ? (
                  <>
                    <input value={s.name} onChange={(e: any) => { const ns = [...editSlots]; ns[i] = { ...ns[i], name: e.target.value }; setEditSlots(ns); }} style={{ flex: 2, padding: 8, borderRadius: 8, border: '1px solid #ddd', direction: 'rtl' }} />
                    <input type="time" value={s.start_time} onChange={(e: any) => { const ns = [...editSlots]; ns[i] = { ...ns[i], start_time: e.target.value }; setEditSlots(ns); }} style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid #ddd' }} />
                    <input type="time" value={s.end_time} onChange={(e: any) => { const ns = [...editSlots]; ns[i] = { ...ns[i], end_time: e.target.value }; setEditSlots(ns); }} style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid #ddd' }} />
                    <button onClick={() => setEditSlots(prev => prev.filter((_, idx) => idx !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e53935', fontSize: 18 }}>x</button>
                  </>
                ) : null}
              </View>
            ))}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <TouchableOpacity style={[st.btn, { backgroundColor: '#1565c0' }]} onPress={() => setEditSlots(prev => [...prev, { slot_number: prev.length + 1, name: `المحاضرة ${prev.length + 1}`, start_time: '', end_time: '' }])}>
                <Text style={st.btnText}>+ فترة</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[st.btn, { backgroundColor: '#2e7d32' }]} onPress={handleSaveSlots} disabled={savingSlots}>
                <Text style={st.btnText}>{savingSlots ? 'جاري...' : 'حفظ'}</Text>
              </TouchableOpacity>
            </View>
          </View>
          </>
        )}

        {/* ====== TAB: PREFS ====== */}
        {activeTab === 'prefs' && (
          <>
            <View style={st.card}>
              <Text style={st.label}>اختر القسم لعرض معلميه وتفضيلاتهم المحفوظة</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <View style={st.pickerWrap}>
                    <Picker selectedValue={selectedFaculty} onValueChange={v => { setSelectedFaculty(v); setSelectedDept(''); setSelectedTeacher(''); setPrefsTeacherSearch(''); }} style={{ height: 40 }} testID="prefs-faculty-picker">
                      <Picker.Item label="-- الكلية --" value="" />{faculties.map(f => <Picker.Item key={f.id} label={f.name} value={f.id} />)}
                    </Picker>
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={st.pickerWrap}>
                    <Picker selectedValue={selectedDept} onValueChange={v => { setSelectedDept(v); setSelectedTeacher(''); setPrefsTeacherSearch(''); setPrefsListOpen(false); }} style={{ height: 40 }} testID="prefs-dept-picker">
                      <Picker.Item label="-- القسم --" value="" />{departments.map(d => <Picker.Item key={d.id} label={d.name} value={d.id} />)}
                    </Picker>
                  </View>
                </View>
              </View>
            </View>

            {/* 📋 قائمة منسدلة لمعلمي القسم مع ملخص التفضيلات */}
            {selectedDept && (
              <View style={st.card} testID="prefs-teachers-panel">
                {/* رأس القائمة المنسدلة (مغلقة افتراضياً) */}
                <TouchableOpacity
                  onPress={() => { setPrefsListOpen(!prefsListOpen); setPrefsTeacherSearch(''); }}
                  testID="prefs-teachers-dropdown-toggle"
                  style={{
                    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
                    backgroundColor: '#f8f9fb', borderWidth: 1, borderColor: prefsListOpen ? '#1565c0' : '#dde3ea',
                    borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12,
                  }}
                >
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, flex: 1 }}>
                    <Ionicons name="person" size={16} color="#1565c0" />
                    {(() => {
                      const sel = prefsSummary.find(s => s.teacher_id === selectedTeacher);
                      return (
                        <Text style={{ fontSize: 13, fontWeight: '700', color: sel ? '#0d47a1' : '#8895a7', textAlign: 'right' }} numberOfLines={1}>
                          {sel ? sel.full_name : `-- اختر المعلم (${prefsSummary.length}) --`}
                        </Text>
                      );
                    })()}
                    {(() => {
                      const sel = prefsSummary.find(s => s.teacher_id === selectedTeacher);
                      if (!sel) return null;
                      return sel.unavailable_count > 0 ? (
                        <View style={{ backgroundColor: '#ffebee', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
                          <Text style={{ fontSize: 11, color: '#c62828', fontWeight: '700' }}>{sel.unavailable_count} فترة محظورة</Text>
                        </View>
                      ) : sel.has_prefs ? (
                        <View style={{ backgroundColor: '#e8f5e9', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
                          <Text style={{ fontSize: 11, color: '#2e7d32', fontWeight: '600' }}>متاح دائماً</Text>
                        </View>
                      ) : (
                        <Text style={{ fontSize: 11, color: '#aab3c0' }}>بدون تفضيلات</Text>
                      );
                    })()}
                  </View>
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                    {prefsSummaryLoading && <ActivityIndicator size="small" color="#1565c0" />}
                    <Ionicons name={prefsListOpen ? 'chevron-up' : 'chevron-down'} size={18} color="#1565c0" />
                  </View>
                </TouchableOpacity>

                {/* المحتوى المنسدل: بحث + قائمة — يظهر عند الفتح فقط */}
                {prefsListOpen && (
                  <View style={{ marginTop: 8, borderWidth: 1, borderColor: '#e3e9f0', borderRadius: 8, padding: 8, backgroundColor: '#fff' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#f5f5f5', borderRadius: 8, borderWidth: 1, borderColor: '#e0e0e0', paddingHorizontal: 10, marginBottom: 8 }}>
                      <Ionicons name="search" size={15} color="#1565c0" />
                      <TextInput
                        style={{ flex: 1, paddingVertical: 7, paddingHorizontal: 8, fontSize: 13, color: '#333', textAlign: 'right' }}
                        value={prefsTeacherSearch}
                        onChangeText={setPrefsTeacherSearch}
                        placeholder="ابحث عن معلم بالاسم..."
                        placeholderTextColor="#999"
                        autoFocus={Platform.OS === 'web'}
                        testID="prefs-teacher-search"
                      />
                      {prefsTeacherSearch.length > 0 && (
                        <TouchableOpacity onPress={() => setPrefsTeacherSearch('')}>
                          <Ionicons name="close-circle" size={16} color="#999" />
                        </TouchableOpacity>
                      )}
                    </View>
                    <ScrollView style={{ maxHeight: 260 }} nestedScrollEnabled>
                      {prefsSummary
                        .filter(s => !prefsTeacherSearch.trim() || (s.full_name || '').includes(prefsTeacherSearch.trim()))
                        .map(s => {
                          const isSel = s.teacher_id === selectedTeacher;
                          return (
                            <TouchableOpacity
                              key={s.teacher_id}
                              onPress={() => { setSelectedTeacher(s.teacher_id); setPrefsListOpen(false); setPrefsTeacherSearch(''); }}
                              testID={`prefs-teacher-row-${s.teacher_id}`}
                              style={{
                                flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
                                paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, marginBottom: 4,
                                backgroundColor: isSel ? '#e3f2fd' : '#fafbfc',
                                borderWidth: 1, borderColor: isSel ? '#1565c0' : '#eef1f5',
                              }}
                            >
                              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, flex: 1 }}>
                                <Ionicons name={isSel ? 'person' : 'person-outline'} size={15} color={isSel ? '#1565c0' : '#8895a7'} />
                                <Text style={{ fontSize: 13, fontWeight: isSel ? '700' : '600', color: isSel ? '#0d47a1' : '#333', textAlign: 'right' }} numberOfLines={1}>
                                  {s.full_name}
                                </Text>
                              </View>
                              {s.unavailable_count > 0 ? (
                                <View style={{ backgroundColor: '#ffebee', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
                                  <Text style={{ fontSize: 11, color: '#c62828', fontWeight: '700' }}>{s.unavailable_count} فترة محظورة</Text>
                                </View>
                              ) : s.has_prefs ? (
                                <View style={{ backgroundColor: '#e8f5e9', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
                                  <Text style={{ fontSize: 11, color: '#2e7d32', fontWeight: '600' }}>متاح دائماً</Text>
                                </View>
                              ) : (
                                <Text style={{ fontSize: 11, color: '#aab3c0' }}>بدون تفضيلات</Text>
                              )}
                            </TouchableOpacity>
                          );
                        })}
                      {!prefsSummaryLoading && prefsSummary.length === 0 && (
                        <Text style={{ fontSize: 12, color: '#999', textAlign: 'center', padding: 12 }}>لا يوجد معلمون في هذا القسم</Text>
                      )}
                      {!prefsSummaryLoading && prefsSummary.length > 0 && prefsTeacherSearch.trim().length > 0 &&
                        prefsSummary.filter(s => (s.full_name || '').includes(prefsTeacherSearch.trim())).length === 0 && (
                        <Text style={{ fontSize: 12, color: '#e65100', textAlign: 'center', padding: 12 }}>لا توجد نتائج للبحث "{prefsTeacherSearch.trim()}"</Text>
                      )}
                    </ScrollView>
                  </View>
                )}
              </View>
            )}

            {selectedTeacher && (
              <View style={st.card}>
                <Text style={[st.label, { fontSize: 15, marginBottom: 12 }]}>
                  تفضيلات المعلم: {prefsSummary.find(s => s.teacher_id === selectedTeacher)?.full_name || teachers.find((t: any) => t.id === selectedTeacher)?.full_name || ''}
                </Text>

                <Text style={st.miniLabel}>غير متاح (شبكة يوم × فترة)</Text>
                <Text style={{ fontSize: 11, color: '#888', marginBottom: 8, textAlign: 'right' }}>
                  اضغط الخلية لتحديد/إلغاء. اضغط «يوم كامل» في نهاية الصف لقلب اليوم كله.
                </Text>
                {(() => {
                  // 🆕 شبكة تفاعلية: أيام × فترات
                  // نستخدم دائماً unavailable_periods كمصدر الحقيقة الوحيد في الفرونت،
                  // ونشتقّ الحقول القديمة عند الحفظ للتوافق الرجعي.
                  const periods: Array<{day: string; slot_number: number}> = Array.isArray(prefs.unavailable_periods) ? prefs.unavailable_periods : [];
                  const isCellUnavailable = (day: string, sn: number) => {
                    return periods.some(p => p.day === day && Number(p.slot_number) === sn);
                  };
                  const toggleCell = (day: string, sn: number) => {
                    setPrefs((p: any) => {
                      const cur: Array<{day: string; slot_number: number}> = Array.isArray(p.unavailable_periods) ? [...p.unavailable_periods] : [];
                      const idx = cur.findIndex(x => x.day === day && Number(x.slot_number) === sn);
                      if (idx >= 0) cur.splice(idx, 1);
                      else cur.push({ day, slot_number: sn });
                      return { ...p, unavailable_periods: cur };
                    });
                  };
                  const toggleWholeDay = (day: string) => {
                    setPrefs((p: any) => {
                      const cur: Array<{day: string; slot_number: number}> = Array.isArray(p.unavailable_periods) ? [...p.unavailable_periods] : [];
                      const allSelected = timeSlots.every(ts => cur.some(x => x.day === day && Number(x.slot_number) === ts.slot_number));
                      const filtered = cur.filter(x => x.day !== day);
                      if (!allSelected) {
                        timeSlots.forEach(ts => filtered.push({ day, slot_number: ts.slot_number }));
                      }
                      return { ...p, unavailable_periods: filtered };
                    });
                  };
                  const totalCells = periods.length;
                  return (
                    <View style={{ marginBottom: 12 }}>
                      {/* رأس الجدول: الفترات */}
                      <View style={{ flexDirection: 'row-reverse', gap: 4, marginBottom: 4 }}>
                        <View style={{ width: 82 }} />
                        {timeSlots.map(ts => (
                          <View key={ts.slot_number} style={{ flex: 1, alignItems: 'center', paddingVertical: 4, backgroundColor: '#f5f5f5', borderRadius: 6 }}>
                            <Text style={{ fontSize: 11, color: '#555', fontWeight: '600' }}>{ts.name}</Text>
                          </View>
                        ))}
                        <View style={{ width: 82, alignItems: 'center', paddingVertical: 4 }}>
                          <Text style={{ fontSize: 11, color: '#c62828', fontWeight: '700' }}>يوم كامل</Text>
                        </View>
                      </View>
                      {/* الصفوف: كل يوم */}
                      {DAYS.map(day => {
                        const dayCellCount = periods.filter(p => p.day === day).length;
                        const allSelected = timeSlots.length > 0 && dayCellCount === timeSlots.length;
                        return (
                          <View key={day} style={{ flexDirection: 'row-reverse', gap: 4, marginBottom: 4, alignItems: 'center' }}>
                            <View style={{ width: 82, alignItems: 'center', paddingVertical: 8, backgroundColor: '#eef2f7', borderRadius: 6 }}>
                              <Text style={{ fontSize: 12, color: '#333', fontWeight: '700' }}>{day}</Text>
                            </View>
                            {timeSlots.map(ts => {
                              const off = isCellUnavailable(day, ts.slot_number);
                              return (
                                <TouchableOpacity
                                  key={ts.slot_number}
                                  onPress={() => toggleCell(day, ts.slot_number)}
                                  style={{
                                    flex: 1,
                                    minHeight: 36,
                                    borderRadius: 6,
                                    backgroundColor: off ? '#e53935' : '#f0f0f0',
                                    borderWidth: off ? 0 : 1,
                                    borderColor: '#ddd',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                  }}
                                  testID={`pref-cell-${day}-${ts.slot_number}`}
                                >
                                  <Ionicons name={off ? 'close' : 'checkmark'} size={14} color={off ? '#fff' : '#9aa4b0'} />
                                </TouchableOpacity>
                              );
                            })}
                            <TouchableOpacity
                              onPress={() => toggleWholeDay(day)}
                              style={{
                                width: 82, paddingVertical: 8, borderRadius: 6,
                                backgroundColor: allSelected ? '#b71c1c' : '#fff5f5',
                                borderWidth: 1, borderColor: allSelected ? '#b71c1c' : '#ffcdd2',
                                alignItems: 'center',
                              }}
                              testID={`pref-day-toggle-${day}`}
                            >
                              <Text style={{ fontSize: 11, fontWeight: '700', color: allSelected ? '#fff' : '#c62828' }}>
                                {allSelected ? '✓ كامل' : 'اليوم كله'}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                      <Text style={{ fontSize: 12, color: '#666', textAlign: 'right', marginTop: 6 }}>
                        عدد الخلايا المحظورة: <Text style={{ fontWeight: '700', color: '#c62828' }}>{totalCells}</Text>
                      </Text>
                    </View>
                  );
                })()}

                <Text style={st.miniLabel}>أقصى محاضرات يومياً (افتراضي: 3)</Text>
                {Platform.OS === 'web' ? (
                  <input type="number" min="1" max="8" value={prefs.max_daily_lectures ?? 3}
                    onChange={(e: any) => setPrefs((p: any) => ({ ...p, max_daily_lectures: parseInt(e.target.value) || 3 }))}
                    style={{ width: 80, padding: 8, borderRadius: 8, border: '1px solid #ddd', textAlign: 'center', fontSize: 14 }}
                    data-testid="max-daily-lectures-input" />
                ) : null}

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, padding: 10, backgroundColor: '#f8f9fa', borderRadius: 8 }}>
                  <TouchableOpacity
                    onPress={() => setPrefs((p: any) => ({ ...p, allow_consecutive_lectures: !p.allow_consecutive_lectures }))}
                    style={{
                      width: 44, height: 24, borderRadius: 12,
                      backgroundColor: prefs.allow_consecutive_lectures ? '#2e7d32' : '#ccc',
                      justifyContent: 'center',
                      padding: 2,
                    }}
                    testID="consecutive-toggle"
                  >
                    <View style={{
                      width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff',
                      alignSelf: prefs.allow_consecutive_lectures ? 'flex-end' : 'flex-start',
                    }} />
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#333', textAlign: 'right' }}>السماح بمحاضرات متتالية</Text>
                    <Text style={{ fontSize: 11, color: '#888', textAlign: 'right', marginTop: 2 }}>
                      {prefs.allow_consecutive_lectures
                        ? 'الافتراضي: يُسمح بمحاضرتين متتاليتين كحد أقصى (لا ثلاث متتالية عند التوليد)'
                        : 'لا يُسمح بوضع محاضرتين متتاليتين (فترة بينهما)'}
                    </Text>
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                  <TouchableOpacity style={[st.btn, { backgroundColor: '#2e7d32', flex: 1 }]} onPress={handleSavePrefs} disabled={savingPrefs}>
                    <Ionicons name="save" size={16} color="#fff" />
                    <Text style={st.btnText}>{savingPrefs ? 'جاري...' : 'حفظ التفضيلات'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[st.btn, { backgroundColor: '#b71c1c' }]} onPress={handleClearPrefs} disabled={savingPrefs} testID="clear-prefs-btn">
                    <Ionicons name="trash" size={16} color="#fff" />
                    <Text style={st.btnText}>مسح كل التفضيلات</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </>
        )}

      </ScrollView>

      {/* ============= Save Draft Modal ============= */}
      {showSaveDraftModal && Platform.OS === 'web' && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ backgroundColor: '#fff', borderRadius: 14, padding: 20, width: 460, maxWidth: '95%', direction: 'rtl' }} data-testid="save-draft-modal">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Ionicons name="bookmark" size={22} color="#6a1b9a" />
              <span style={{ fontSize: 17, fontWeight: 800, color: '#222' }}>حفظ نسخة من الجدول الحالي</span>
            </div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 14, lineHeight: 1.6 }}>
              ستُحفظ نسخة كاملة من جدول الحالي. يمكنك توليد جدول آخر بإعدادات مختلفة ثم المقارنة أو الاسترجاع لاحقاً.
            </div>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#444' }}>اسم النسخة *</label>
            <input type="text" value={draftName} onChange={(e: any) => setDraftName(e.target.value)} placeholder="مثال: المحاولة الأولى - الأحد بداية"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, marginTop: 4, marginBottom: 10, boxSizing: 'border-box' }} data-testid="draft-name-input" />
            <label style={{ fontSize: 12, fontWeight: 700, color: '#444' }}>ملاحظات (اختياري)</label>
            <textarea value={draftNotes} onChange={(e: any) => setDraftNotes(e.target.value)} rows={2}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, marginTop: 4, marginBottom: 14, boxSizing: 'border-box', resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowSaveDraftModal(false)} disabled={savingDraft}
                style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', backgroundColor: '#f5f5f5', cursor: 'pointer', fontWeight: 700 }}>إلغاء</button>
              <button onClick={handleSaveDraft} disabled={savingDraft} data-testid="confirm-save-draft-btn"
                style={{ flex: 2, padding: '10px', borderRadius: 8, border: 'none', backgroundColor: '#6a1b9a', color: '#fff', cursor: 'pointer', fontWeight: 800 }}>
                {savingDraft ? 'جاري الحفظ...' : 'حفظ النسخة'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============= 🗓️ Generate Lectures from Schedule Modal ============= */}
      {showGenLecturesModal && Platform.OS === 'web' && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ backgroundColor: '#fff', borderRadius: 14, padding: 20, width: 520, maxWidth: '95%', direction: 'rtl', maxHeight: '90vh', overflowY: 'auto' }} data-testid="generate-lectures-modal">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Ionicons name="calendar" size={22} color="#00838f" />
              <span style={{ fontSize: 17, fontWeight: 800, color: '#222' }}>توليد المحاضرات من الجدول الأسبوعي</span>
            </div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 6, lineHeight: 1.7 }}>
              سيتم تحويل خانات الجدول إلى محاضرات فعلية بتواريخ محددة (بقاعة ووقت كل خانة).
              <br />✅ <strong>توليد الناقص فقط</strong>: المحاضرات المولدة سابقاً من صفحة المقررات تُتخطى ولا تُمس.
            </div>
            <div style={{ backgroundColor: selectedDept ? '#e8f5e9' : '#fff8e1', border: '1px solid ' + (selectedDept ? '#a5d6a7' : '#ffe082'), borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 700, color: selectedDept ? '#2e7d32' : '#e65100', marginBottom: 12 }}>
              📍 النطاق: {selectedDept ? `قسم ${departments.find(d => d.id === selectedDept)?.name || ''} فقط` : `كامل الكلية (${departments.length} قسم)`}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#444' }}>من تاريخ *</label>
                <input type="date" value={genLecStart} onChange={(e: any) => { setGenLecStart(e.target.value); setGenLecPreview(null); }}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, marginTop: 4, boxSizing: 'border-box' }} data-testid="gen-lec-start" />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#444' }}>إلى تاريخ *</label>
                <input type="date" value={genLecEnd} onChange={(e: any) => { setGenLecEnd(e.target.value); setGenLecPreview(null); }}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, marginTop: 4, boxSizing: 'border-box' }} data-testid="gen-lec-end" />
              </div>
            </div>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#444' }}>الأيام المعطلة / العطلات (تُتخطى)</label>
            <div style={{ display: 'flex', gap: 6, marginTop: 4, marginBottom: 6 }}>
              <input type="date" value={genLecHolidayInput} onChange={(e: any) => setGenLecHolidayInput(e.target.value)}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, boxSizing: 'border-box' }} data-testid="gen-lec-holiday-input" />
              <button
                onClick={() => {
                  if (genLecHolidayInput && !genLecHolidays.includes(genLecHolidayInput)) {
                    setGenLecHolidays([...genLecHolidays, genLecHolidayInput].sort());
                    setGenLecHolidayInput('');
                    setGenLecPreview(null);
                  }
                }}
                style={{ padding: '8px 14px', borderRadius: 8, border: 'none', backgroundColor: '#e65100', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}
                data-testid="gen-lec-add-holiday"
              >+ إضافة</button>
            </div>
            {genLecHolidays.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {genLecHolidays.map(h => (
                  <span key={h} style={{ backgroundColor: '#fff3e0', border: '1px solid #ffcc80', borderRadius: 12, padding: '3px 10px', fontSize: 11, fontWeight: 700, color: '#e65100' }}>
                    {h} <span style={{ cursor: 'pointer', color: '#c62828' }} onClick={() => { setGenLecHolidays(genLecHolidays.filter(x => x !== h)); setGenLecPreview(null); }}>✕</span>
                  </span>
                ))}
              </div>
            )}
            {/* نتيجة المعاينة */}
            {genLecPreview && (
              <div style={{ backgroundColor: '#e0f2f1', border: '1px solid #80cbc4', borderRadius: 10, padding: 12, marginTop: 8, marginBottom: 4 }} data-testid="gen-lec-preview">
                <div style={{ fontSize: 13, fontWeight: 800, color: '#00695c', marginBottom: 6 }}>📊 المعاينة</div>
                <div style={{ fontSize: 12, color: '#004d40', lineHeight: 1.9 }}>
                  ✅ سيتم إنشاء: <strong>{genLecPreview.to_create}</strong> محاضرة
                  <br />📚 عدد المقررات: <strong>{genLecPreview.courses_count}</strong> | خانات الجدول: <strong>{genLecPreview.schedule_slots}</strong>
                  <br />⏭️ موجودة مسبقاً (تُتخطى): <strong>{genLecPreview.already_exist}</strong>
                  {genLecPreview.holidays_count > 0 ? <><br />🏖️ عطلات مستثناة: <strong>{genLecPreview.holidays_count}</strong> يوم</> : null}
                </div>
                {(genLecPreview.slot_times_used || []).length > 0 && (
                  <div style={{ marginTop: 8, borderTop: '1px dashed #80cbc4', paddingTop: 6 }} data-testid="gen-lec-slot-times">
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#00695c', marginBottom: 4 }}>🕑 أوقات الفترات التي ستُستخدم:</div>
                    {genLecPreview.slot_times_used.map((s: any) => {
                      const h = parseInt(String(s.start_time).split(':')[0], 10);
                      const suspicious = !isNaN(h) && (h >= 19 || h < 6);
                      return (
                        <div key={s.slot_number} style={{ fontSize: 11, lineHeight: 1.8, color: suspicious ? '#c62828' : '#004d40', fontWeight: suspicious ? 800 : 500 }}>
                          فترة {s.slot_number}: {s.start_time} - {s.end_time}
                          {suspicious ? ' ⚠️ توقيت ليلي — راجع إعدادات الفترات (ص/م) قبل التوليد!' : ''}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => { setShowGenLecturesModal(false); setGenLecPreview(null); }} disabled={genLecLoading}
                style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', backgroundColor: '#f5f5f5', cursor: 'pointer', fontWeight: 700 }}>إلغاء</button>
              <button onClick={() => runGenLectures(true)} disabled={genLecLoading} data-testid="gen-lec-preview-btn"
                style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid #00838f', backgroundColor: '#fff', color: '#00838f', cursor: 'pointer', fontWeight: 800 }}>
                {genLecLoading ? 'جاري...' : '👁️ معاينة'}
              </button>
              <button onClick={() => runGenLectures(false)} disabled={genLecLoading || !genLecPreview || genLecPreview.to_create === 0} data-testid="gen-lec-confirm-btn"
                style={{ flex: 1.4, padding: '10px', borderRadius: 8, border: 'none', backgroundColor: (!genLecPreview || genLecPreview.to_create === 0) ? '#b0bec5' : '#00838f', color: '#fff', cursor: 'pointer', fontWeight: 800 }}>
                {genLecLoading ? 'جاري...' : `✓ تأكيد التوليد${genLecPreview ? ` (${genLecPreview.to_create})` : ''}`}
              </button>
            </div>
            <div style={{ fontSize: 10, color: '#999', marginTop: 8, textAlign: 'center' }}>
              التأكيد متاح بعد المعاينة فقط — لضمان مراجعتك للأرقام قبل الإنشاء
            </div>
          </div>
        </div>
      )}

      {/* ============= Drafts List Modal ============= */}
      {showDraftsModal && Platform.OS === 'web' && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ backgroundColor: '#fff', borderRadius: 14, padding: 18, width: 820, maxWidth: '95%', maxHeight: '90vh', overflow: 'auto', direction: 'rtl' }} data-testid="drafts-modal">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Ionicons name="folder-open" size={22} color="#ef6c00" />
              <span style={{ fontSize: 17, fontWeight: 800, color: '#222', flex: 1 }}>النسخ المحفوظة من الجدول</span>
              <button onClick={() => { setShowDraftsModal(false); setComparingDraft(null); }}
                style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#888' }}>×</button>
            </div>
            {comparingDraft ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <button onClick={() => setComparingDraft(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#1565c0' }}>← العودة للقائمة</button>
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>مقارنة "{comparingDraft.draft_name}" مع الجدول الحالي:</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {[{ title: 'النسخة المحفوظة', stats: comparingDraft.draft_stats, color: '#6a1b9a' },
                    { title: 'الجدول الحالي', stats: comparingDraft.current_stats, color: '#2e7d32' }].map((box, i) => (
                    <div key={i} style={{ border: `2px solid ${box.color}`, borderRadius: 10, padding: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: box.color, marginBottom: 8 }}>{box.title}</div>
                      <div style={{ fontSize: 12, lineHeight: 1.7 }}>
                        <div>📚 المحاضرات: <strong>{box.stats.total_slots}</strong></div>
                        <div>👨‍🏫 المعلمون: <strong>{box.stats.teachers_count}</strong></div>
                        <div>🏛 القاعات: <strong>{box.stats.rooms_count}</strong></div>
                        <div>📖 المقررات: <strong>{box.stats.courses_count}</strong></div>
                        <div style={{ marginTop: 6, fontSize: 11, color: '#666' }}>التوزيع اليومي:</div>
                        {Object.entries(box.stats.by_day || {}).map(([day, count]: any) => (
                          <div key={day} style={{ fontSize: 11 }}>• {day}: {count}</div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* ============= الفروقات التفصيلية slot-by-slot ============= */}
                {comparingDraft.diff && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>🔎 الفروقات التفصيلية:</div>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 110, background: '#e8f5e9', padding: 8, borderRadius: 8, textAlign: 'center' }}>
                        <div style={{ fontSize: 22, fontWeight: 900, color: '#1b5e20' }}>{comparingDraft.diff.added_count}</div>
                        <div style={{ fontSize: 11, color: '#1b5e20', fontWeight: 700 }}>➕ مضاف (في الحالي فقط)</div>
                      </div>
                      <div style={{ flex: 1, minWidth: 110, background: '#ffebee', padding: 8, borderRadius: 8, textAlign: 'center' }}>
                        <div style={{ fontSize: 22, fontWeight: 900, color: '#c62828' }}>{comparingDraft.diff.removed_count}</div>
                        <div style={{ fontSize: 11, color: '#c62828', fontWeight: 700 }}>➖ محذوف (في النسخة فقط)</div>
                      </div>
                      <div style={{ flex: 1, minWidth: 110, background: '#fff8e1', padding: 8, borderRadius: 8, textAlign: 'center' }}>
                        <div style={{ fontSize: 22, fontWeight: 900, color: '#e65100' }}>{comparingDraft.diff.changed_count}</div>
                        <div style={{ fontSize: 11, color: '#e65100', fontWeight: 700 }}>✏️ معدّل (تغير معلم/قاعة)</div>
                      </div>
                      <div style={{ flex: 1, minWidth: 110, background: '#e3f2fd', padding: 8, borderRadius: 8, textAlign: 'center' }}>
                        <div style={{ fontSize: 22, fontWeight: 900, color: '#0d47a1' }}>{comparingDraft.diff.unchanged_count}</div>
                        <div style={{ fontSize: 11, color: '#0d47a1', fontWeight: 700 }}>✓ متطابق</div>
                      </div>
                    </div>

                    {/* قائمة المضافة */}
                    {comparingDraft.diff.added_count > 0 && (
                      <details open style={{ marginBottom: 8 }}>
                        <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 800, color: '#1b5e20', padding: '6px 8px', background: '#e8f5e9', borderRadius: 6 }}>
                          ➕ مضافة في الجدول الحالي ({comparingDraft.diff.added_count})
                        </summary>
                        <div style={{ marginTop: 4, maxHeight: 200, overflow: 'auto' }}>
                          {comparingDraft.diff.added.map((s: any, i: number) => (
                            <div key={i} style={{ fontSize: 11, padding: '6px 8px', borderBottom: '1px solid #eee', background: '#f1f8e9' }}>
                              <strong>{s.course_code} {s.course_name}</strong> · {s.day_of_week} ف{s.slot_number}
                              {s.section ? ` · شعبة ${s.section}` : ''} · 👨‍🏫 {s.teacher_name || '-'} · 🏛 {s.room_name || '-'}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {/* قائمة المحذوفة */}
                    {comparingDraft.diff.removed_count > 0 && (
                      <details open style={{ marginBottom: 8 }}>
                        <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 800, color: '#c62828', padding: '6px 8px', background: '#ffebee', borderRadius: 6 }}>
                          ➖ محذوفة من الجدول الحالي ({comparingDraft.diff.removed_count})
                        </summary>
                        <div style={{ marginTop: 4, maxHeight: 200, overflow: 'auto' }}>
                          {comparingDraft.diff.removed.map((s: any, i: number) => (
                            <div key={i} style={{ fontSize: 11, padding: '6px 8px', borderBottom: '1px solid #eee', background: '#ffebee' }}>
                              <strong>{s.course_code} {s.course_name}</strong> · {s.day_of_week} ف{s.slot_number}
                              {s.section ? ` · شعبة ${s.section}` : ''} · 👨‍🏫 {s.teacher_name || '-'} · 🏛 {s.room_name || '-'}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {/* قائمة المعدّلة */}
                    {comparingDraft.diff.changed_count > 0 && (
                      <details open style={{ marginBottom: 8 }}>
                        <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 800, color: '#e65100', padding: '6px 8px', background: '#fff8e1', borderRadius: 6 }}>
                          ✏️ معدّلة ({comparingDraft.diff.changed_count})
                        </summary>
                        <div style={{ marginTop: 4, maxHeight: 250, overflow: 'auto' }}>
                          {comparingDraft.diff.changed.map((s: any, i: number) => (
                            <div key={i} style={{ fontSize: 11, padding: '8px', borderBottom: '1px solid #eee', background: '#fffde7' }}>
                              <div style={{ fontWeight: 700, marginBottom: 3 }}>
                                {s.course_code} {s.course_name} · {s.day_of_week} ف{s.slot_number}
                                {s.section ? ` · شعبة ${s.section}` : ''}
                              </div>
                              {Object.entries(s.diffs || {}).map(([field, vals]: any) => (
                                <div key={field} style={{ fontSize: 10, color: '#555', paddingRight: 8 }}>
                                  • <strong>{({
                                    teacher_id: 'المعلم (ID)', teacher_name: 'المعلم',
                                    room_id: 'القاعة (ID)', room_name: 'القاعة', notes: 'ملاحظات'
                                  } as any)[field] || field}</strong>:
                                  <span style={{ color: '#c62828', textDecoration: 'line-through' }}> {vals.draft || '∅'}</span>
                                  {' → '}
                                  <span style={{ color: '#1b5e20', fontWeight: 700 }}>{vals.current || '∅'}</span>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {comparingDraft.diff.added_count === 0 && comparingDraft.diff.removed_count === 0 && comparingDraft.diff.changed_count === 0 && (
                      <div style={{ padding: 16, textAlign: 'center', color: '#2e7d32', background: '#e8f5e9', borderRadius: 8, fontSize: 13, fontWeight: 700 }}>
                        ✓ النسختان متطابقتان تماماً — لا توجد أي فروقات.
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              drafts.length === 0 ? (
                <div style={{ padding: 30, textAlign: 'center', color: '#888' }}>
                  <Ionicons name="folder-open-outline" size={40} color="#ccc" />
                  <div style={{ marginTop: 10 }}>لا توجد نسخ محفوظة بعد</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>اضغط "حفظ نسخة" لإنشاء أول نسخة</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {drafts.map(d => (
                    <div key={d.id} style={{ border: '1px solid #e0e0e0', borderRadius: 10, padding: 10, backgroundColor: '#fafafa' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Ionicons name="bookmark" size={16} color="#6a1b9a" />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 800, color: '#222' }}>{d.name}</div>
                          <div style={{ fontSize: 11, color: '#777', marginTop: 2 }}>
                            {d.slots_count} محاضرة · {d.created_by_name} · {d.created_at ? new Date(d.created_at).toLocaleString('ar') : ''}
                          </div>
                          {d.notes && <div style={{ fontSize: 11, color: '#555', marginTop: 4, fontStyle: 'italic' }}>{d.notes}</div>}
                        </div>
                        <button onClick={() => handleCompareDraft(d.id)} title="مقارنة"
                          style={{ background: '#e3f2fd', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 11, color: '#1565c0', fontWeight: 700 }}>
                          📊 مقارنة
                        </button>
                        <button onClick={() => handleRestoreDraft(d.id, d.name)} title="استرجاع"
                          style={{ background: '#e8f5e9', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 11, color: '#2e7d32', fontWeight: 700 }}>
                          ↩️ استرجاع
                        </button>
                        <button onClick={() => handleDeleteDraft(d.id, d.name)} title="حذف"
                          style={{ background: '#ffebee', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 11, color: '#c62828', fontWeight: 700 }}>
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* ============= 📅 Room Schedule Modal ============= */}
      {roomSchedule && Platform.OS === 'web' && (() => {
        const days = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];
        const extraDays = (roomScheduleEntries || []).some((e: any) => e.day === 'الجمعة') ? [...days, 'الجمعة'] : days;
        const slots = timeSlots.length > 0 ? timeSlots : [1, 2, 3, 4].map(n => ({ slot_number: n, name: `الفترة ${n}`, start_time: '', end_time: '' }));
        const cellOf = (day: string, sn: number) => {
          const raw = (roomScheduleEntries || []).filter((e: any) => e.day === day && e.slot_number === sn);
          const seen = new Set<string>(); const out: any[] = [];
          for (const e of raw) {
            const k = e.merge_group_id || e.id;
            if (seen.has(k)) continue;
            seen.add(k); out.push(e);
          }
          return out;
        };
        const totalCells = extraDays.length * slots.length;
        const busyKeys = new Set((roomScheduleEntries || []).map((e: any) => `${e.day}|${e.slot_number}`));
        const freeCells = totalCells - Array.from(busyKeys).filter(k => extraDays.includes(k.split('|')[0])).length;
        return (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999 }} onClick={() => setRoomSchedule(null)}>
            <div onClick={(ev: any) => ev.stopPropagation()} style={{ backgroundColor: '#fff', borderRadius: 14, padding: 20, width: 900, maxWidth: '96%', maxHeight: '88vh', overflowY: 'auto', direction: 'rtl' }} data-testid="room-schedule-modal">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#1a2540' }}>📅 جدول القاعة: {roomSchedule.name}</div>
                <button onClick={() => setRoomSchedule(null)} style={{ background: '#f5f5f5', border: 'none', width: 30, height: 30, borderRadius: 15, cursor: 'pointer', fontSize: 16, fontWeight: 700 }}>×</button>
              </div>
              <div style={{ fontSize: 12, color: '#5b6678', marginBottom: 12 }}>
                {roomSchedule.building ? `${roomSchedule.building} • ` : ''}سعة {roomSchedule.capacity || '—'} •
                {roomScheduleEntries === null ? ' جاري التحميل...' : (
                  <> مشغولة في <b style={{ color: '#c62828' }}>{busyKeys.size}</b> فترة • فارغة في <b style={{ color: '#2e7d32' }}>{freeCells}</b> فترة أسبوعياً</>
                )}
              </div>
              {roomScheduleEntries === null ? (
                <div style={{ textAlign: 'center', padding: 30, color: '#888' }}>جاري تحميل الجدول...</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }} data-testid="room-schedule-grid">
                  <thead>
                    <tr>
                      <th style={{ border: '1px solid #dde3ec', padding: 8, backgroundColor: '#1a2540', color: '#fff', minWidth: 90 }}>الفترة</th>
                      {extraDays.map(d => <th key={d} style={{ border: '1px solid #dde3ec', padding: 8, backgroundColor: '#1a2540', color: '#fff' }}>{d}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {slots.map((s: any) => (
                      <tr key={s.slot_number}>
                        <td style={{ border: '1px solid #dde3ec', padding: 8, backgroundColor: '#f2f6fc', fontWeight: 700, textAlign: 'center' }}>
                          {s.name || `الفترة ${s.slot_number}`}
                          {s.start_time ? <div style={{ fontSize: 10, color: '#777', fontWeight: 400 }}>{s.start_time} - {s.end_time}</div> : null}
                        </td>
                        {extraDays.map(d => {
                          const items = cellOf(d, s.slot_number);
                          if (items.length === 0) {
                            return <td key={d} style={{ border: '1px solid #dde3ec', padding: 6, backgroundColor: '#e8f5e9', textAlign: 'center', color: '#2e7d32', fontWeight: 700, fontSize: 11 }}>✓ فارغة</td>;
                          }
                          return (
                            <td key={d} style={{ border: '1px solid #dde3ec', padding: 6, backgroundColor: '#fff3e0', verticalAlign: 'top' }}>
                              {items.map((it: any) => (
                                <div key={it.id} style={{ marginBottom: items.length > 1 ? 6 : 0 }}>
                                  <div style={{ fontWeight: 700, color: '#333', fontSize: 11.5 }}>{it.merge_group_id ? '🔗 ' : ''}{it.course_name}</div>
                                  <div style={{ fontSize: 10.5, color: '#666' }}>{it.teacher_name}</div>
                                  <div style={{ fontSize: 10, color: '#999' }}>{it.department_name} · م{it.level}{it.section ? ` ${it.section}` : ''}</div>
                                </div>
                              ))}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        );
      })()}

      {/* ============= Export Modal ============= */}
      {showExportModal && Platform.OS === 'web' && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ backgroundColor: '#fff', borderRadius: 14, padding: 20, width: 480, maxWidth: '95%', direction: 'rtl' }} data-testid="export-modal">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Ionicons name="download" size={22} color="#00838f" />
              <span style={{ fontSize: 17, fontWeight: 800, color: '#222' }}>تصدير الجدول</span>
            </div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 14 }}>اختر الصيغة ونطاق التصدير</div>

            <label style={{ fontSize: 12, fontWeight: 700, color: '#444' }}>الصيغة</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 4, marginBottom: 14 }}>
              {[{ v: 'pdf', l: '📄 PDF (طباعة)' }, { v: 'excel', l: '📊 Excel (تحرير)' }].map(o => (
                <button key={o.v} onClick={() => setExportFormat(o.v as any)}
                  style={{ flex: 1, padding: 10, borderRadius: 8, border: `2px solid ${exportFormat === o.v ? '#00838f' : '#ddd'}`, backgroundColor: exportFormat === o.v ? '#e0f2f1' : '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                  {o.l}
                </button>
              ))}
            </div>

            <label style={{ fontSize: 12, fontWeight: 700, color: '#444' }}>نطاق التصدير</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 4, marginBottom: 10 }}>
              {[
                { v: 'all', l: '📚 الجدول كاملاً' },
                { v: 'department', l: '🏛 حسب القسم' },
                { v: 'section', l: '👨‍🎓 شعبة/مستوى' },
                { v: 'teacher', l: '👨‍🏫 معلم محدد' },
                { v: 'all_teachers', l: '👥 كل الأساتذة (جدول لكل أستاذ)' },
                { v: 'room', l: '🏠 قاعة محددة' },
              ].map(o => (
                <button key={o.v} onClick={() => setExportScope(o.v as any)} data-testid={`export-scope-${o.v}`}
                  style={{ padding: 8, borderRadius: 6, border: `1.5px solid ${exportScope === o.v ? '#00838f' : '#e0e0e0'}`, backgroundColor: exportScope === o.v ? '#e0f2f1' : '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
                  {o.l}
                </button>
              ))}
            </div>

            {exportScope === 'teacher' && (
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#444' }}>اختر المعلم</label>
                <input
                  value={exportTeacherSearch}
                  onChange={(e: any) => setExportTeacherSearch(e.target.value)}
                  placeholder="🔍 ابحث باسم المعلم..."
                  data-testid="export-teacher-search"
                  style={{ width: '100%', padding: 9, borderRadius: 8, border: '1px solid #ddd', fontSize: 13, marginTop: 4, marginBottom: 6, boxSizing: 'border-box', direction: 'rtl' }}
                />
                <select value={exportTeacherId} onChange={(e: any) => setExportTeacherId(e.target.value)}
                  size={exportTeacherSearch ? Math.min(6, Math.max(2, allTeachers.filter((t: any) => (t.full_name || '').includes(exportTeacherSearch.trim())).length + 1)) : undefined}
                  data-testid="export-teacher-select"
                  style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 13 }}>
                  <option value="">-- اختر --</option>
                  {allTeachers
                    .filter((t: any) => !exportTeacherSearch.trim() || (t.full_name || '').includes(exportTeacherSearch.trim()))
                    .map((t: any) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                </select>
              </div>
            )}

            {exportScope === 'room' && (
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#444' }}>اختر القاعة</label>
                <select value={exportRoomId} onChange={(e: any) => setExportRoomId(e.target.value)}
                  style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 13, marginTop: 4 }}>
                  <option value="">-- اختر --</option>
                  {rooms.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            )}

            <div style={{ backgroundColor: '#f5f5f5', borderRadius: 8, padding: 10, marginBottom: 14, fontSize: 11, color: '#555' }}>
              💡 {exportScope === 'all' ? 'تصدير كامل الفلاتر الحالية' :
                  exportScope === 'department' ? 'سيتم التصدير حسب القسم المحدد في الفلتر' :
                  exportScope === 'section' ? `سيتم التصدير لـ م${selectedLevel || '?'} شعبة ${selectedSection || '?'}` :
                  exportScope === 'teacher' ? 'تصدير الجدول الأسبوعي لمعلم محدد فقط' :
                  exportScope === 'all_teachers' ? (selectedDept ? 'جدول مستقل لكل أستاذ في القسم المحدد (صفحة/ورقة لكل أستاذ)' : 'جدول مستقل لكل أستاذ في الكلية (صفحة/ورقة لكل أستاذ) — اختر قسماً من الفلتر لتضييق النطاق') :
                  'تصدير الجدول الأسبوعي لقاعة محددة فقط'}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowExportModal(false)}
                style={{ flex: 1, padding: 10, borderRadius: 8, border: 'none', backgroundColor: '#f5f5f5', cursor: 'pointer', fontWeight: 700 }}>إلغاء</button>
              <button onClick={handleExport} data-testid="confirm-export-btn"
                style={{ flex: 2, padding: 10, borderRadius: 8, border: 'none', backgroundColor: '#00838f', color: '#fff', cursor: 'pointer', fontWeight: 800 }}>
                ⬇️ تصدير الآن
              </button>
            </div>
          </div>
        </div>
      )}

      {/* نافذة تفاصيل التعارضات */}
      {showConflictsModal && Platform.OS === 'web' && conflicts.total_conflicts > 0 && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: '#fff', borderRadius: 12, width: '90%', maxWidth: 720, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}>
            <div style={{ padding: 16, borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#d32f2f', color: '#fff', borderRadius: '12px 12px 0 0' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>⚠️ تفاصيل التعارضات</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  {conflicts.total_conflicts} تعارض • {conflicts.total_conflicting_slots} خلية متأثرة
                </div>
              </div>
              <button onClick={() => setShowConflictsModal(false)} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', width: 32, height: 32, borderRadius: 16, cursor: 'pointer', fontSize: 18, fontWeight: 700 }}>×</button>
            </div>
            <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
              {/* ملخّص بالأنواع */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                {conflicts.section_conflicts?.length > 0 && (
                  <div style={{ background: '#fff3e0', border: '1px solid #ff9800', padding: '8px 12px', borderRadius: 8, flex: 1, minWidth: 140 }}>
                    <div style={{ fontSize: 11, color: '#e65100', fontWeight: 600 }}>تعارض شعبة</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#e65100' }}>{conflicts.section_conflicts.length}</div>
                  </div>
                )}
                {conflicts.teacher_conflicts?.length > 0 && (
                  <div style={{ background: '#e3f2fd', border: '1px solid #1976d2', padding: '8px 12px', borderRadius: 8, flex: 1, minWidth: 140 }}>
                    <div style={{ fontSize: 11, color: '#0d47a1', fontWeight: 600 }}>تعارض معلم</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#0d47a1' }}>{conflicts.teacher_conflicts.length}</div>
                  </div>
                )}
                {conflicts.room_conflicts?.length > 0 && (
                  <div style={{ background: '#f3e5f5', border: '1px solid #7b1fa2', padding: '8px 12px', borderRadius: 8, flex: 1, minWidth: 140 }}>
                    <div style={{ fontSize: 11, color: '#4a148c', fontWeight: 600 }}>تعارض قاعة</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#4a148c' }}>{conflicts.room_conflicts.length}</div>
                  </div>
                )}
              </div>

              {/* قائمة تفصيلية */}
              {conflicts.all_conflicts?.map((c: any, i: number) => {
                const colors: any = {
                  section: { bg: '#fff3e0', border: '#ff9800', text: '#e65100' },
                  teacher: { bg: '#e3f2fd', border: '#1976d2', text: '#0d47a1' },
                  room: { bg: '#f3e5f5', border: '#7b1fa2', text: '#4a148c' },
                };
                const col = colors[c.type] || colors.section;
                const labels: any = { section: 'تعارض شعبة', teacher: 'تعارض معلم', room: 'تعارض قاعة' };
                let detail = '';
                if (c.type === 'section') detail = `قسم: ${c.department_name} • مستوى: ${c.level}${c.section ? ' • شعبة: ' + c.section : ''}`;
                else if (c.type === 'teacher') detail = `معلم: ${c.teacher_name}`;
                else if (c.type === 'room') detail = `قاعة: ${c.room_name}`;
                return (
                  <div key={i} style={{ background: col.bg, border: `1px solid ${col.border}`, borderRadius: 8, padding: 12, marginBottom: 8, textAlign: 'right' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: col.text, fontWeight: 700, background: '#fff', padding: '2px 8px', borderRadius: 4 }}>×{c.count}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: col.text }}>{labels[c.type]}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#333' }}>{detail}</div>
                    <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>📅 {c.day} • الفترة {c.slot_number}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ padding: 12, borderTop: '1px solid #eee', textAlign: 'center' }}>
              <button onClick={() => setShowConflictsModal(false)} style={{ padding: '8px 24px', borderRadius: 8, border: '1px solid #ccc', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f8fb' },
  // Header: compact + matching blue accent line bottom
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e8edf3' },
  headerTitle: { fontSize: 15, fontWeight: '700', color: '#1f2a37', flex: 1, textAlign: 'center' },
  // Tabs: thin underline-style, no big buttons
  tabsBar: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e8edf3', paddingHorizontal: 10, gap: 4 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#1565c0' },
  tabText: { fontSize: 12, color: '#5b6678', fontWeight: '500' },
  tabTextActive: { color: '#1565c0', fontWeight: '700' },
  // Cards: tighter
  card: { backgroundColor: '#fff', borderRadius: 8, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: '#e8edf3' },
  cardCompact: { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8, borderWidth: 1, borderColor: '#e8edf3' },
  label: { fontSize: 11, fontWeight: '600', color: '#5b6678', marginBottom: 4, textAlign: 'right' },
  miniLabel: { fontSize: 11, fontWeight: '600', color: '#7c8898', marginBottom: 4, textAlign: 'right' },
  // Smaller picker
  pickerWrap: { backgroundColor: '#fff', borderRadius: 6, borderWidth: 1, borderColor: '#dfe5ec', overflow: 'hidden' },
  // View-mode chips: small sharp, not big pills
  vmChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: '#dfe5ec', backgroundColor: '#fff' },
  vmChipActive: { backgroundColor: '#1565c0', borderColor: '#1565c0' },
  vmChipText: { fontSize: 12, fontWeight: '600', color: '#3f4b5c' },
  vmChipTextActive: { color: '#fff' },
  // Empty state: small, subtle
  emptyCard: { backgroundColor: '#fff', borderRadius: 8, paddingVertical: 32, paddingHorizontal: 14, alignItems: 'center', borderWidth: 1, borderColor: '#e8edf3' },
  emptyText: { marginTop: 8, fontSize: 12, color: '#8a95a8', textAlign: 'center' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 6 },
  btnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
