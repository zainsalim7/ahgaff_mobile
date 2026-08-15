import { goBack } from '../src/utils/navigation';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import { useFocusEffect } from 'expo-router';
import api, { teachingLoadAPI, teachersAPI, departmentsAPI, API_URL } from '../src/services/api';
import { useAuth } from '../src/contexts/AuthContext';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface CourseLoad {
  course_id: string;
  course_name: string;
  course_code: string;
  section: string;
  level: number;
  credit_hours: number;
  weekly_hours?: number | null;  // 🆕 الساعات الأسبوعية من الخطة الدراسية (يُعرض كقيمة افتراضية في الإسناد)
  department_id?: string;
  current_teacher_name: string;
  existing_load_id: string | null;
  existing_weekly_hours: number | null;
  existing_notes: string;
}

interface LoadItem {
  id: string;
  teacher_id: string;
  teacher_name: string;
  teacher_employee_id: string;
  department_id: string;
  course_id: string;
  course_name: string;
  course_code: string;
  course_section: string;
  weekly_hours: number;
  actual_weekly_hours?: number;
  notes: string;
}

function TeacherSearch({ teachers, selectedId, onSelect, departments = [], faculties = [], crossDept = false }: { teachers: any[], selectedId: string, onSelect: (id: string) => void, departments?: any[], faculties?: any[], crossDept?: boolean }) {
  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const selectedTeacher = teachers.find(t => t.id === selectedId);
  const filtered = q ? teachers.filter(t => t.full_name?.includes(q) || t.teacher_id?.includes(q)) : teachers;
  const getDeptName = (deptId: string) => departments.find(d => d.id === deptId)?.name || '';
  const facById = React.useMemo(() => Object.fromEntries(faculties.map((f:any) => [f.id, f.name])), [faculties]);
  const deptToFaculty: Record<string, string> = React.useMemo(() => {
    const m: Record<string,string> = {};
    for (const d of departments as any[]) {
      const fname = d.faculty_name || facById[d.faculty_id] || '';
      if (fname) m[d.id] = fname;
    }
    return m;
  }, [departments, facById]);
  /** كل أقسام المعلم (يدمج department_ids مع department_id للتوافق) */
  const getAllDeptIds = (t: any): string[] => {
    const ids = Array.isArray(t.department_ids) && t.department_ids.length > 0
      ? t.department_ids
      : (t.department_id ? [t.department_id] : []);
    return ids.filter(Boolean);
  };
  /** كلية المعلم: من faculty_id مباشرة أو عبر أول قسم */
  const getTeacherFaculty = (t: any): string => {
    if (t.faculty_name) return t.faculty_name;
    if (t.faculty_id && facById[t.faculty_id]) return facById[t.faculty_id];
    const ids = getAllDeptIds(t);
    for (const did of ids) if (deptToFaculty[did]) return deptToFaculty[did];
    return '';
  };

  // إذا معلم مختار، اعرض بطاقته فقط مع زر تغيير
  if (selectedId && !open) {
    const facName = selectedTeacher ? getTeacherFaculty(selectedTeacher) : '';
    const deptNames = selectedTeacher ? getAllDeptIds(selectedTeacher).map(getDeptName).filter(Boolean) : [];
    return (
      <div style={{ direction: 'rtl' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', border: '1px solid #1565c0', borderRadius: 8, backgroundColor: '#e3f2fd' }}>
          <div style={{ flex: 1, textAlign: 'right' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1565c0' }}>✓ {selectedTeacher?.full_name}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4, justifyContent: 'flex-end' }}>
              {facName && <span style={{ fontSize: 11, color: '#0d47a1', background: '#bbdefb', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>🏛️ {facName}</span>}
              {deptNames.map((n, i) => <span key={i} style={{ fontSize: 11, color: '#4a148c', background: '#e1bee7', padding: '2px 6px', borderRadius: 4 }}>🏢 {n}</span>)}
            </div>
          </div>
          <button onClick={() => { onSelect(''); setQ(''); setOpen(true); }} style={{ background: 'none', border: '1px solid #1565c0', color: '#1565c0', padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
            تغيير
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ direction: 'rtl' }}>
      <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #ddd', borderRadius: 8, backgroundColor: '#f5f5f5' }}>
        <input
          type="text"
          value={q}
          onChange={(e: any) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="ابحث عن المعلم بالاسم..."
          style={{ flex: 1, padding: '10px 12px', border: 'none', background: 'transparent', fontSize: 14, outline: 'none', textAlign: 'right' }}
          data-testid="teaching-load-teacher-search"
        />
      </div>
      {/* قائمة المعلمين inline (تدفع التخطيط لأسفل) */}
      {open && (
        <div style={{ marginTop: 4, backgroundColor: '#fff', border: '1px solid #ddd', borderRadius: 8, maxHeight: 320, overflowY: 'auto' }}>
          {filtered.length === 0 && <div style={{ padding: 16, color: '#999', textAlign: 'center' }}>لا توجد نتائج</div>}
          {filtered.map((t: any) => {
            const facName = getTeacherFaculty(t);
            const deptIds = getAllDeptIds(t);
            const deptNames = deptIds.map(getDeptName).filter(Boolean);
            return (
              <div key={t.id} onClick={() => { onSelect(t.id); setQ(''); setOpen(false); }}
                style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', textAlign: 'right' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>{t.full_name}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 3, justifyContent: 'flex-end' }}>
                  {facName && <span style={{ fontSize: 10.5, color: '#0d47a1', background: '#e3f2fd', padding: '1px 6px', borderRadius: 3, fontWeight: 600 }}>🏛️ {facName}</span>}
                  {deptNames.slice(0, 3).map((n, i) => <span key={i} style={{ fontSize: 10.5, color: '#4a148c', background: '#f3e5f5', padding: '1px 6px', borderRadius: 3 }}>🏢 {n}</span>)}
                  {deptNames.length > 3 && <span style={{ fontSize: 10.5, color: '#5a6c7d' }}>+{deptNames.length - 3}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function TeachingLoadPage() {
  const { user } = useAuth();
  const [departments, setDepartments] = useState<any[]>([]);
  const [faculties, setFaculties] = useState<any[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [selectedDept, setSelectedDept] = useState('');
  const [selectedTeacher, setSelectedTeacher] = useState('');
  const [selectedCourses, setSelectedCourses] = useState<CourseLoad[]>([]);
  const [hoursMap, setHoursMap] = useState<Record<string, string>>({});
  const [loadingDepts, setLoadingDepts] = useState(true);
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [existingLoads, setExistingLoads] = useState<LoadItem[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [viewMode, setViewMode] = useState<'assign' | 'summary'>('assign');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CourseLoad[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchTimeout = React.useRef<any>(null);
  // Summary teacher filter
  const [summaryTeacherId, setSummaryTeacherId] = useState('');
  // 🆕 فلتر الفصل الدراسي (يدعم الفصول المؤرشفة)
  const [summarySemesterId, setSummarySemesterId] = useState<string>(''); // فارغ = الفصل النشط
  const [summaryAllSemesters, setSummaryAllSemesters] = useState(false); // عرض كل الفصول
  const [summaryExecuted, setSummaryExecuted] = useState(false); // هل تم الضغط على زر التنفيذ؟

  // Load departments + faculties on mount
  useEffect(() => {
    (async () => {
      try {
        const [deptsRes, facsRes] = await Promise.all([
          departmentsAPI.getAll(),
          api.get('/faculties').catch(() => ({ data: [] })),
        ]);
        setDepartments(deptsRes.data);
        setFaculties(Array.isArray(facsRes.data) ? facsRes.data : []);
      } catch (e) {
        console.error('Error loading departments:', e);
      } finally {
        setLoadingDepts(false);
      }
    })();
  }, []);

  const [crossDept, setCrossDept] = useState(false); // عرض أساتذة ومقررات من كل الأقسام
  const [hideAssignedToOthers, setHideAssignedToOthers] = useState(true); // إخفاء المقررات المسندة لمعلمين آخرين
  const [activeSemester, setActiveSemester] = useState<{ id: string; name: string; academic_year: string } | null>(null);
  
  // ============= قوالب الأعباء =============
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [showApplyTemplateModal, setShowApplyTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateTerm, setTemplateTerm] = useState<'first' | 'second' | 'summer'>('first');
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [allSemesters, setAllSemesters] = useState<any[]>([]);
  const [targetSemesterId, setTargetSemesterId] = useState('');
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [applyResult, setApplyResult] = useState<any>(null);

  // جلب الفصل النشط
  useEffect(() => {
    (async () => {
      try {
        const token = await AsyncStorage.getItem('token');
        const res = await fetch(`${API_URL}/api/semesters/current`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.id) setActiveSemester(data);
        }
      } catch (e) {
        console.error('Error loading active semester:', e);
      }
    })();
  }, []);

  // جلب كل الفصول للقوالب
  const fetchAllSemesters = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/semesters`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAllSemesters(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error('Error loading semesters:', e);
    }
  }, []);

  // جلب القوالب
  const fetchTemplates = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/teaching-load/templates`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTemplates(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error('Error loading templates:', e);
    }
  }, []);

  // حفظ القالب
  const handleSaveTemplate = async () => {
    if (!activeSemester) {
      Alert.alert('تنبيه', 'لا يوجد فصل نشط');
      return;
    }
    if (!templateName.trim()) {
      Alert.alert('تنبيه', 'يرجى إدخال اسم القالب');
      return;
    }
    setSavingTemplate(true);
    try {
      const token = await AsyncStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/teaching-load/templates`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          semester_id: activeSemester.id,
          template_name: templateName.trim(),
          term: templateTerm,
          department_id: selectedDept || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        Alert.alert('تم بنجاح', data.message || 'تم حفظ القالب');
        setShowSaveTemplateModal(false);
        setTemplateName('');
      } else {
        Alert.alert('خطأ', data.detail || 'فشل حفظ القالب');
      }
    } catch (e) {
      Alert.alert('خطأ', 'فشل حفظ القالب');
    } finally {
      setSavingTemplate(false);
    }
  };

  // تطبيق القالب
  const handleApplyTemplate = async () => {
    if (!selectedTemplateId) {
      Alert.alert('تنبيه', 'يرجى اختيار قالب');
      return;
    }
    if (!targetSemesterId) {
      Alert.alert('تنبيه', 'يرجى اختيار الفصل المستهدف');
      return;
    }
    setApplyingTemplate(true);
    setApplyResult(null);
    try {
      const token = await AsyncStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/teaching-load/templates/${selectedTemplateId}/apply`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_id: selectedTemplateId,
          target_semester_id: targetSemesterId,
          overwrite_existing: overwriteExisting,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setApplyResult(data);
        // refresh teaching loads
        await fetchSummary();
      } else {
        Alert.alert('خطأ', data.detail || 'فشل تطبيق القالب');
      }
    } catch (e) {
      Alert.alert('خطأ', 'فشل تطبيق القالب');
    } finally {
      setApplyingTemplate(false);
    }
  };

  // حذف قالب
  const handleDeleteTemplate = async (templateId: string, templateNameToDelete: string) => {
    if (!confirm(`حذف القالب "${templateNameToDelete}"؟`)) return;
    try {
      const token = await AsyncStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/teaching-load/templates/${templateId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        await fetchTemplates();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Load teachers when department changes or cross-dept toggled
  useEffect(() => {
    if (!selectedDept && !crossDept) {
      setTeachers([]);
      setSelectedTeacher('');
      return;
    }
    (async () => {
      setLoadingTeachers(true);
      try {
        // إذا فعّل "كل الأقسام": احضر كل الأساتذة بدون فلتر قسم
        // 🌐 cross_university=true → Backend يتجاوز RBAC إذا للمستخدم صلاحية cross_university_assignment أو admin
        const params: any = crossDept ? { cross_university: true } : { department_id: selectedDept };
        const res = await teachersAPI.getAll(params);
        setTeachers(res.data);
      } catch (e) {
        console.error('Error loading teachers:', e);
      } finally {
        setLoadingTeachers(false);
      }
    })();
  }, [selectedDept, crossDept]);

  // Load existing teacher loads when teacher changes
  const [loadingExisting, setLoadingExisting] = useState(false);
  // 🆕 جلب أحمال المعلم المختار (يُستدعى عند تغيير المعلم أو عند العودة للصفحة)
  const refetchSelectedTeacherLoads = useCallback(async () => {
    if (!selectedTeacher) {
      setSelectedCourses([]);
      setHoursMap({});
      return;
    }
    setLoadingExisting(true);
    try {
      const res = await teachingLoadAPI.getAll({ teacher_id: selectedTeacher });
      const items = res.data.items || [];
      const existing: CourseLoad[] = items.map((i: any) => ({
        course_id: i.course_id,
        course_name: i.course_name,
        course_code: i.course_code,
        section: i.course_section || '',
        level: i.course_level || 0,
        credit_hours: i.course_credit_hours || 3,
        department_id: i.course_department_id || '',
        current_teacher_name: '',
        existing_load_id: i.id,
        existing_weekly_hours: i.weekly_hours,
        existing_notes: i.notes || '',
      }));
      setSelectedCourses(existing);
      const map: Record<string, string> = {};
      for (const c of existing) {
        const v = c.existing_weekly_hours ?? c.credit_hours ?? null;
        map[c.course_id] = v != null ? String(v) : '';
      }
      setHoursMap(map);
    } catch (e) {
      console.error('Error loading teacher loads:', e);
    } finally {
      setLoadingExisting(false);
    }
  }, [selectedTeacher]);

  useEffect(() => {
    if (!selectedTeacher) {
      setSelectedCourses([]);
      setHoursMap({});
      setSearchQuery('');
      setSearchResults([]);
      return;
    }
    refetchSelectedTeacherLoads();
  }, [selectedTeacher, refetchSelectedTeacherLoads]);

  // 🆕 إعادة الجلب التلقائي عند العودة للصفحة (focus) لإظهار الإسنادات الجديدة فوراً
  useFocusEffect(
    useCallback(() => {
      if (selectedTeacher) {
        refetchSelectedTeacherLoads();
      }
      // أيضاً نُعيد تشغيل ملخص الجدول إن كان مُنفّذاً بالفعل
      if (summaryExecuted) {
        loadSummary();
      }
      return () => {};
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedTeacher, summaryExecuted])
  );


  // Search courses with debounce
  const handleSearch = (text: string) => {
    setSearchQuery(text);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!text || text.length < 1) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        // إذا "كل الأقسام" مفعّل: ابحث في كل المقررات بدون تقييد بالقسم
        const deptParam = crossDept ? undefined : (selectedDept || undefined);
        const res = await teachingLoadAPI.searchCourses(text, deptParam);
        const selectedTeacherName = teachers.find(t => t.id === selectedTeacher)?.full_name;
        const filtered = res.data.filter((c: CourseLoad) => {
          // استبعد المقررات المختارة بالفعل (في القائمة)
          if (selectedCourses.some(s => s.course_id === c.course_id)) return false;
          // إذا الإخفاء مفعّل: استبعد المسندة لمعلم آخر
          if (hideAssignedToOthers && c.current_teacher_name && c.current_teacher_name !== selectedTeacherName) {
            return false;
          }
          return true;
        });
        setSearchResults(filtered);
        setShowResults(true);
      } catch (e) {
        console.error('Search error:', e);
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  const addCourseToList = (course: CourseLoad) => {
    if (selectedCourses.some(c => c.course_id === course.course_id)) return;
    setSelectedCourses(prev => [...prev, course]);
    // 🆕 الأولوية: تكليف سابق → credit_hours من الخطة (= الساعات الأسبوعية في الأحقاف)
    const defaultHours = course.existing_weekly_hours ?? course.credit_hours ?? null;
    setHoursMap(prev => ({
      ...prev,
      [course.course_id]: defaultHours != null ? String(defaultHours) : ''
    }));
    setSearchQuery('');
    setSearchResults([]);
    setShowResults(false);
  };

  const removeCourseFromList = (courseId: string) => {
    setSelectedCourses(prev => prev.filter(c => c.course_id !== courseId));
    setHoursMap(prev => { const m = { ...prev }; delete m[courseId]; return m; });
  };

  // Load summary view data
  const loadSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const params: any = {};
      if (selectedDept) params.department_id = selectedDept;
      if (summaryTeacherId) params.teacher_id = summaryTeacherId;
      // 🆕 منطق فلتر الفصل الدراسي:
      // - لو تم اختيار فصل محدد (مؤرشف أو نشط) → نمرر semester_id
      // - لو طُلب "كل الفصول" → نمرر all_semesters=true
      // - الافتراضي (لا شيء) → backend يستخدم الفصل النشط
      if (summarySemesterId) {
        params.semester_id = summarySemesterId;
      } else if (summaryAllSemesters) {
        params.all_semesters = true;
      }
      const res = await teachingLoadAPI.getAll(params);
      setExistingLoads(res.data.items || []);
      setSummaryExecuted(true);
    } catch (e) {
      console.error('Error loading summary:', e);
    } finally {
      setLoadingSummary(false);
    }
  }, [selectedDept, summaryTeacherId, summarySemesterId, summaryAllSemesters]);

  // 🆕 إعادة تعيين النتيجة عند تغيير أي فلتر (يجب الضغط على "تنفيذ" مجدداً)
  useEffect(() => {
    setSummaryExecuted(false);
    setExistingLoads([]);
  }, [selectedDept, summaryTeacherId, summarySemesterId, summaryAllSemesters]);

  // 🆕 جلب كل الفصول عند فتح عرض الجدول (للـ dropdown)
  useEffect(() => {
    if (viewMode === 'summary' && allSemesters.length === 0) {
      fetchAllSemesters();
    }
  }, [viewMode, allSemesters.length, fetchAllSemesters]);

  const handleSave = async () => {
    if (!selectedTeacher) return;
    const items = selectedCourses
      .filter(c => hoursMap[c.course_id] && parseFloat(hoursMap[c.course_id]) > 0)
      .map(c => ({
        teacher_id: selectedTeacher,
        course_id: c.course_id,
        weekly_hours: parseFloat(hoursMap[c.course_id]),
      }));

    if (items.length === 0) {
      Alert.alert('تنبيه', 'لم يتم إدخال أي ساعات');
      return;
    }

    // 🆕 رسالة تأكيد قبل الإسناد - تعرض ملخص العملية
    const teacherObj = teachers.find(t => t.id === selectedTeacher);
    const teacherName = teacherObj?.full_name || 'المعلم';
    const totalHours = items.reduce((s, i) => s + (i.weekly_hours || 0), 0);
    const newCount = items.filter(i => {
      const c = selectedCourses.find(x => x.course_id === i.course_id);
      return c && !c.existing_load_id;
    }).length;
    const updateCount = items.length - newCount;
    const summaryLines = [
      `📝 تأكيد إسناد العبء التدريسي`,
      ``,
      `👤 المعلم: ${teacherName}`,
      `📚 عدد المقررات: ${items.length}${newCount ? ` (${newCount} جديد)` : ''}${updateCount ? ` (${updateCount} تحديث)` : ''}`,
      `⏱️ إجمالي الساعات: ${totalHours}`,
      ``,
      `هل تريد المتابعة؟`,
    ];
    const confirmMessage = summaryLines.join('\n');
    if (Platform.OS === 'web') {
      if (!window.confirm(confirmMessage)) return;
    } else {
      const ok = await new Promise<boolean>(resolve => {
        Alert.alert('تأكيد الإسناد', confirmMessage, [
          { text: 'إلغاء', style: 'cancel', onPress: () => resolve(false) },
          { text: 'تأكيد', onPress: () => resolve(true) },
        ]);
      });
      if (!ok) return;
    }

    setSaving(true);
    try {
      const res = await teachingLoadAPI.bulkSave(items);
      Alert.alert('نجاح', res.data.message);
      // Reload existing loads
      const refreshRes = await teachingLoadAPI.getAll({ teacher_id: selectedTeacher });
      const refreshItems = refreshRes.data.items || [];
      const existing: CourseLoad[] = refreshItems.map((i: any) => ({
        course_id: i.course_id,
        course_name: i.course_name,
        course_code: i.course_code,
        section: i.course_section || '',
        level: i.course_level || 0,
        credit_hours: i.course_credit_hours || 0,
        current_teacher_name: '',
        existing_load_id: i.id,
        existing_weekly_hours: i.weekly_hours,
        existing_notes: i.notes || '',
      }));
      setSelectedCourses(existing);
      const map: Record<string, string> = {};
      for (const c of existing) {
        // 🆕 الأولوية: weekly_hours المحفوظة → credit_hours من المقرر
        const v = c.existing_weekly_hours ?? c.credit_hours ?? null;
        map[c.course_id] = v != null ? String(v) : '';
      }
      setHoursMap(map);
    } catch (e: any) {
      Alert.alert('خطأ', e?.response?.data?.detail || 'حدث خطأ');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (loadId: string, courseName: string) => {
    if (Platform.OS === 'web') {
      if (!window.confirm(`حذف العبء التدريسي لمقرر "${courseName}"؟`)) return;
    }
    try {
      await teachingLoadAPI.delete(loadId);
      // أزله فوراً من القائمة المحلية
      const removed = selectedCourses.find(c => c.existing_load_id === loadId);
      if (removed) {
        setSelectedCourses(prev => prev.filter(c => c.existing_load_id !== loadId));
        setHoursMap(prev => { const m = { ...prev }; delete m[removed.course_id]; return m; });
      }
      if (Platform.OS === 'web') window.alert('تم الحذف ✓');
      else Alert.alert('نجاح', 'تم الحذف');
      // أعد التحميل من الخادم للتحديث الكامل
      if (viewMode === 'summary') {
        await loadSummary();
      } else if (selectedTeacher) {
        const refreshRes = await teachingLoadAPI.getAll({ teacher_id: selectedTeacher });
        const refreshItems = refreshRes.data.items || [];
        const existing: CourseLoad[] = refreshItems.map((i: any) => ({
          course_id: i.course_id,
          course_name: i.course_name,
          course_code: i.course_code,
          section: i.course_section || '',
          level: i.course_level || 0,
          credit_hours: i.course_credit_hours || 0,
          department_id: i.course_department_id || '',
          current_teacher_name: '',
          existing_load_id: i.id,
          existing_weekly_hours: i.weekly_hours,
          existing_notes: i.notes || '',
        }));
        setSelectedCourses(existing);
        const map: Record<string, string> = {};
        for (const c of existing) {
          // 🆕 الأولوية: weekly_hours المحفوظة → credit_hours من المقرر
          const v = c.existing_weekly_hours ?? c.credit_hours ?? null;
          map[c.course_id] = v != null ? String(v) : '';
        }
        setHoursMap(map);
      }
    } catch (e: any) {
      Alert.alert('خطأ', e?.response?.data?.detail || 'حدث خطأ');
    }
  };

  const handleExport = async (format: 'excel' | 'pdf') => {
    if (format === 'excel') setExportingExcel(true);
    else setExportingPDF(true);
    try {
      const token = await AsyncStorage.getItem('token');
      let url = `${API_URL}/api/export/teaching-load/${format}?`;
      if (selectedDept) url += `department_id=${selectedDept}&`;
      if (startDate) url += `start_date=${startDate}&`;
      if (endDate) url += `end_date=${endDate}&`;

      if (Platform.OS === 'web') {
        const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) throw new Error('فشل التصدير');
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = format === 'excel' ? 'teaching_load.xlsx' : 'teaching_load.pdf';
        a.click();
        window.URL.revokeObjectURL(blobUrl);
      }
      Alert.alert('نجاح', 'تم تصدير الملف بنجاح');
    } catch (e: any) {
      console.error('Export error:', e);
      Alert.alert('خطأ', 'فشل التصدير');
    } finally {
      setExportingExcel(false);
      setExportingPDF(false);
    }
  };

  // Group summary by teacher + حساب ساعات داخل/خارج القسم
  const groupedByTeacher = existingLoads.reduce((acc: Record<string, { name: string; empId: string; teacherDeptId: string; items: LoadItem[]; totalHours: number; actualHours: number; inHours: number; outHours: number }>, item) => {
    if (!acc[item.teacher_id]) {
      const t = teachers.find(tt => tt.id === item.teacher_id) as any;
      const tDept = String(t?.department_id || (Array.isArray(t?.department_ids) ? t.department_ids[0] : '') || '');
      acc[item.teacher_id] = { name: item.teacher_name, empId: item.teacher_employee_id, teacherDeptId: tDept, items: [], totalHours: 0, actualHours: 0, inHours: 0, outHours: 0 };
    }
    acc[item.teacher_id].items.push(item);
    acc[item.teacher_id].totalHours += item.weekly_hours;
    acc[item.teacher_id].actualHours = Math.round((acc[item.teacher_id].actualHours + (item.actual_weekly_hours || 0)) * 100) / 100;
    const courseDept = String((item as any).course_department_id || '');
    const teacherDept = acc[item.teacher_id].teacherDeptId;
    if (teacherDept && courseDept && courseDept !== teacherDept) {
      acc[item.teacher_id].outHours += item.weekly_hours;
    } else {
      acc[item.teacher_id].inHours += item.weekly_hours;
    }
    return acc;
  }, {});

  if (loadingDepts) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1565c0" />
        <Text style={styles.loadingText}>جاري التحميل...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Header مدمج: زر الرجوع + العنوان + شارة الفصل النشط + الأزرار على نفس السطر */}
      <View style={{
        flexDirection: 'row-reverse',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
        flexWrap: 'wrap',
      }}>
        <TouchableOpacity onPress={() => goBack()} data-testid="teaching-load-back-btn">
          <Ionicons name="arrow-forward" size={22} color="#333" />
        </TouchableOpacity>
        <Text style={{ fontSize: 15, fontWeight: '700', color: '#222' }}>العبء التدريسي</Text>
        {activeSemester ? (
          <View
            data-testid="active-semester-badge"
            style={{
              flexDirection: 'row-reverse',
              alignItems: 'center',
              gap: 4,
              backgroundColor: '#e8f5e9',
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: '#a5d6a7',
            }}
          >
            <Ionicons name="calendar" size={11} color="#2e7d32" />
            <Text style={{ fontSize: 11, color: '#1b5e20', fontWeight: '700' }}>
              {activeSemester.name} {activeSemester.academic_year}
            </Text>
          </View>
        ) : null}
        {/* Template Actions مدمجة كأيقونات بنفس السطر */}
        <View style={{ flexDirection: 'row-reverse', gap: 6, marginRight: 'auto' }}>
          <TouchableOpacity
            data-testid="save-template-btn"
            onPress={() => {
              setTemplateName(`قالب ${activeSemester?.name || ''} ${activeSemester?.academic_year || ''}`.trim());
              setShowSaveTemplateModal(true);
            }}
            disabled={!activeSemester}
            style={{
              flexDirection: 'row-reverse',
              alignItems: 'center',
              gap: 4,
              backgroundColor: activeSemester ? '#6a1b9a' : '#bdbdbd',
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 6,
            }}
          >
            <Ionicons name="save-outline" size={13} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 11 }}>حفظ كقالب</Text>
          </TouchableOpacity>
          <TouchableOpacity
            data-testid="apply-template-btn"
            onPress={async () => {
              await Promise.all([fetchTemplates(), fetchAllSemesters()]);
              if (activeSemester) setTargetSemesterId(activeSemester.id);
              setApplyResult(null);
              setShowApplyTemplateModal(true);
            }}
            style={{
              flexDirection: 'row-reverse',
              alignItems: 'center',
              gap: 4,
              backgroundColor: '#00838f',
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 6,
            }}
          >
            <Ionicons name="download-outline" size={13} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 11 }}>تطبيق قالب</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* View Mode Toggle */}
      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleBtn, viewMode === 'assign' && styles.toggleBtnActive]}
          onPress={() => setViewMode('assign')}
          data-testid="teaching-load-assign-tab"
        >
          <Ionicons name="create-outline" size={18} color={viewMode === 'assign' ? '#fff' : '#1565c0'} />
          <Text style={[styles.toggleText, viewMode === 'assign' && styles.toggleTextActive]}>تعيين الساعات</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, viewMode === 'summary' && styles.toggleBtnActive]}
          onPress={() => setViewMode('summary')}
          data-testid="teaching-load-summary-tab"
        >
          <Ionicons name="list-outline" size={18} color={viewMode === 'summary' ? '#fff' : '#1565c0'} />
          <Text style={[styles.toggleText, viewMode === 'summary' && styles.toggleTextActive]}>عرض الجدول</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView}>
        {/* Department Filter - shared, grouped by faculty */}
        <View style={styles.filterCard}>
          <Text style={styles.filterLabel}>القسم</Text>
          <View style={styles.pickerWrapper}>
            <Picker
              selectedValue={selectedDept}
              onValueChange={(v) => { setSelectedDept(v); setSelectedTeacher(''); }}
              style={styles.picker}
              enabled={!crossDept}
              data-testid="teaching-load-dept-picker"
            >
              <Picker.Item label="-- اختر القسم --" value="" />
              {(() => {
                // 🔧 تجميع الأقسام حسب الكلية ليُظهر "[الكلية] القسم"
                const byFac: Record<string, any[]> = {};
                for (const d of departments) {
                  const fname = d.faculty_name || faculties.find(f => f.id === d.faculty_id)?.name || 'بدون كلية';
                  (byFac[fname] = byFac[fname] || []).push(d);
                }
                const items: any[] = [];
                Object.keys(byFac).sort().forEach(fname => {
                  byFac[fname].forEach((d: any) => {
                    items.push(
                      <Picker.Item key={d.id} label={`[${fname}] ${d.name}`} value={d.id} />
                    );
                  });
                });
                return items;
              })()}
            </Picker>
          </View>

          {/* Cross-department toggle */}
          <TouchableOpacity
            onPress={() => {
              const next = !crossDept;
              setCrossDept(next);
              if (next) setSelectedDept('');
              setSelectedTeacher('');
              setSearchResults([]);
              setSearchQuery('');
            }}
            style={{
              marginTop: 10,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              padding: 10,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: crossDept ? '#1565c0' : '#e0e0e0',
              backgroundColor: crossDept ? '#e3f2fd' : '#fff',
            }}
            testID="cross-dept-toggle"
          >
            <Ionicons name={crossDept ? 'checkbox' : 'square-outline'} size={20} color={crossDept ? '#1565c0' : '#888'} />
            <Text style={{ fontSize: 13, color: crossDept ? '#1565c0' : '#444', fontWeight: crossDept ? '700' : '500', flex: 1, textAlign: 'right' }}>
              عرض كل أساتذة ومقررات الجامعة (لجميع الكليات والأقسام) — للإسناد العابر للحدود
            </Text>
          </TouchableOpacity>
        </View>

        {viewMode === 'assign' && (
          <>
            {/* Teacher Picker */}
            {(selectedDept || crossDept) && (
              <View style={styles.filterCard}>
                <Text style={[styles.filterLabel, { textAlign: 'right' }]}>
                  المعلم {crossDept ? '(جميع الأقسام)' : ''}
                </Text>
                {loadingTeachers ? (
                  <ActivityIndicator size="small" color="#1565c0" />
                ) : Platform.OS === 'web' ? (
                  <TeacherSearch teachers={teachers} selectedId={selectedTeacher} onSelect={setSelectedTeacher} departments={departments} faculties={faculties} crossDept={crossDept} />
                ) : (
                  <View style={styles.pickerWrapper}>
                    <Picker
                      selectedValue={selectedTeacher}
                      onValueChange={(v) => setSelectedTeacher(v)}
                      style={styles.picker}
                    >
                      <Picker.Item label="-- اختر المعلم --" value="" />
                      {teachers.map(t => {
                        const dept = departments.find((d: any) => d.id === t.department_id);
                        const label = dept ? `${t.full_name} • ${dept.name}` : t.full_name;
                        return <Picker.Item key={t.id} label={label} value={t.id} />;
                      })}
                    </Picker>
                  </View>
                )}
              </View>
            )}

            {/* Course Search + Selected Courses */}
            {selectedTeacher && loadingExisting && (
              <View style={styles.emptyCard}>
                <ActivityIndicator size="large" color="#1565c0" />
                <Text style={styles.emptyText}>جاري تحميل المقررات المسندة...</Text>
              </View>
            )}
            {selectedTeacher && !loadingExisting && (
              <View style={styles.tableCard}>
                {/* Search Box */}
                <Text style={[styles.filterLabel, { textAlign: 'right' }]}>بحث عن مقرر لإضافته</Text>

                {/* خيار إخفاء المقررات المسندة لمعلمين آخرين */}
                <TouchableOpacity
                  onPress={() => {
                    setHideAssignedToOthers(v => !v);
                    // إعادة تشغيل البحث الحالي إن وُجد
                    if (searchQuery && searchQuery.length >= 1) handleSearch(searchQuery);
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingVertical: 8,
                    paddingHorizontal: 10,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: hideAssignedToOthers ? '#1565c0' : '#e0e0e0',
                    backgroundColor: hideAssignedToOthers ? '#e3f2fd' : '#fafafa',
                    marginBottom: 10,
                  }}
                  testID="hide-assigned-to-others-toggle"
                >
                  <Ionicons
                    name={hideAssignedToOthers ? 'checkbox' : 'square-outline'}
                    size={18}
                    color={hideAssignedToOthers ? '#1565c0' : '#666'}
                  />
                  <Text style={{ flex: 1, fontSize: 12, color: hideAssignedToOthers ? '#1565c0' : '#444', textAlign: 'right', fontWeight: hideAssignedToOthers ? '600' : '400' }}>
                    إخفاء المقررات المسندة لمعلمين آخرين من نتائج البحث
                  </Text>
                </TouchableOpacity>
                {Platform.OS === 'web' ? (
                  <View style={{ position: 'relative', marginBottom: 16, zIndex: 100 }}>
                    <div style={{ display: 'flex', alignItems: 'center', backgroundColor: '#f5f5f5', borderRadius: 10, border: '1px solid #ddd', padding: '0 12px', direction: 'rtl' }}>
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e: any) => handleSearch(e.target.value)}
                        onFocus={() => { if (searchResults.length > 0) setShowResults(true); }}
                        placeholder="ابحث بالرمز أو اسم المقرر..."
                        style={{ flex: 1, padding: '12px 8px', border: 'none', background: 'transparent', fontSize: 15, outline: 'none', direction: 'rtl', textAlign: 'right' }}
                        data-testid="course-search-input"
                      />
                      {searching ? <ActivityIndicator size="small" color="#1565c0" /> : <Ionicons name="search" size={20} color="#999" />}
                    </div>
                    {/* Search Results Panel (in-flow: لا يغطي المحتوى ويسمح بالتمرير الطبيعي) */}
                    {showResults && searchResults.length > 0 && (
                      <div style={{ marginTop: 8, backgroundColor: '#fff', borderRadius: 10, border: '1px solid #cfd8dc', direction: 'rtl', overflow: 'hidden' }} data-testid="course-search-results-panel">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #e8ecef', backgroundColor: '#f7f9fb' }}>
                          <span style={{ fontSize: 12, color: '#455a64', fontWeight: 700 }}>نتائج البحث ({searchResults.length})</span>
                          <button
                            onClick={() => setShowResults(false)}
                            data-testid="close-search-results-btn"
                            style={{ display: 'flex', alignItems: 'center', gap: 4, border: '1px solid #ddd', backgroundColor: '#fff', borderRadius: 6, padding: '3px 10px', fontSize: 12, color: '#c62828', cursor: 'pointer', fontWeight: 600 }}
                          >
                            ✕ إغلاق النتائج
                          </button>
                        </div>
                        <div style={{ maxHeight: 340, overflowY: 'auto', scrollbarWidth: 'thin' as any }}>
                        {searchResults.map(c => {
                          const cDept = departments.find((d: any) => d.id === c.department_id);
                          // أولوية لاسم القسم/الكلية من الـ API (يعمل حتى لو كان القسم خارج نطاق المستخدم)
                          const cDeptName = (c as any).department_name || cDept?.name;
                          const cFacName = (c as any).faculty_name || cDept?.faculty_name || faculties.find(f => f.id === cDept?.faculty_id)?.name;
                          // 🔒 تحديد إن كان المقرر "ضيف" (خارج كلية/أقسام المستخدم الحالي)
                          const userRole = (user as any)?.role;
                          const isAdminRole = userRole === 'admin' || userRole === 'university_president';
                          const userFacultyId = (user as any)?.faculty_id || '';
                          const userDeptIds: string[] = (user as any)?.department_ids
                            || ((user as any)?.department_id ? [(user as any).department_id] : []);
                          const courseFacultyId = (c as any).faculty_id || cDept?.faculty_id || '';
                          const courseDeptId = c.department_id || '';
                          // المقرر "ضيف" إذا: المستخدم ليس admin، وكليته/قسمه لا يطابق
                          let isOutsideScope = false;
                          if (!isAdminRole) {
                            if (userDeptIds.length > 0) {
                              // رئيس قسم: يقارن بقسمه
                              isOutsideScope = courseDeptId ? !userDeptIds.includes(courseDeptId) : false;
                            } else if (userFacultyId) {
                              // عميد/مسجل/إلخ: يقارن بكليته
                              isOutsideScope = courseFacultyId ? courseFacultyId !== userFacultyId : false;
                            }
                          }
                          return (
                          <TouchableOpacity
                            key={c.course_id}
                            style={{ flexDirection: 'row-reverse', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: '#f0f0f0', backgroundColor: isOutsideScope ? '#fff8e1' : 'transparent' }}
                            onPress={() => addCourseToList(c)}
                            data-testid={`search-result-${c.course_id}`}
                          >
                            <View style={{ flex: 1 }}>
                              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                                <Text style={{ fontSize: 14, fontWeight: '600', color: '#333', textAlign: 'right' }}>{c.course_name}</Text>
                                {isOutsideScope && (
                                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 3, backgroundColor: '#fff3cd', borderWidth: 1, borderColor: '#f0ad4e', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 }}>
                                    <Ionicons name="lock-closed" size={11} color="#b26a00" />
                                    <Text style={{ fontSize: 10, color: '#b26a00', fontWeight: '700' }}>ضيف (خارج نطاقك)</Text>
                                  </View>
                                )}
                              </View>
                              <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 4, marginTop: 3 }}>
                                {c.course_code && <Text style={{ fontSize: 10.5, color: '#5a6c7d', background: '#f0f3f7', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 3 }}>{c.course_code}</Text>}
                                {c.level != null && <Text style={{ fontSize: 10.5, color: '#0277bd', background: '#e1f5fe', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 3 }}>المستوى {c.level}</Text>}
                                {c.section && <Text style={{ fontSize: 10.5, color: '#558b2f', background: '#f1f8e9', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 3 }}>شعبة {c.section}</Text>}
                                {cFacName && <Text style={{ fontSize: 10.5, color: '#0d47a1', background: '#e3f2fd', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 3, fontWeight: '600' }}>🏛️ {cFacName}</Text>}
                                {cDeptName && <Text style={{ fontSize: 10.5, color: '#4a148c', background: '#f3e5f5', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 3 }}>🏢 {cDeptName}</Text>}
                              </View>
                              {c.current_teacher_name ? <Text style={{ fontSize: 11, color: '#e65100', textAlign: 'right', marginTop: 3 }}>⚠️ مسند حالياً لـ: {c.current_teacher_name}</Text> : null}
                            </View>
                            <Ionicons name="add-circle" size={26} color="#4caf50" style={{ marginLeft: 12 }} />
                          </TouchableOpacity>
                          );
                        })}
                        </div>
                      </div>
                    )}
                    {showResults && searchQuery.length > 0 && searchResults.length === 0 && !searching && (
                      <div style={{ marginTop: 8, backgroundColor: '#fff', borderRadius: 10, border: '1px solid #ddd', padding: 16, textAlign: 'center' }}>
                        <Text style={{ color: '#999' }}>لا توجد نتائج</Text>
                      </div>
                    )}
                  </View>
                ) : null}

                {/* Selected Courses List */}
                {selectedCourses.length > 0 && (
                  <View style={{ marginTop: 4 }}>
                    <Text style={[styles.tableTitle, { textAlign: 'right' }]}>المقررات المختارة ({selectedCourses.length})</Text>
                    {selectedCourses.map((c) => {
                      const cDept = departments.find((d: any) => d.id === (c as any).department_id)?.name;
                      const isOtherTeacher = c.current_teacher_name && c.current_teacher_name !== teachers.find(t => t.id === selectedTeacher)?.full_name;
                      return (
                      <View key={c.course_id} style={{ flexDirection: 'row-reverse', alignItems: 'center', padding: 12, marginBottom: 8, backgroundColor: c.existing_load_id ? '#f1f8e9' : '#fafafa', borderRadius: 10, borderWidth: 1, borderColor: c.existing_load_id ? '#c8e6c9' : '#eee' }}>
                        {/* Course Info */}
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text style={{ fontSize: 15, fontWeight: '600', color: '#333', textAlign: 'right' }}>{c.course_name}</Text>
                          <Text style={{ fontSize: 12, color: '#888', textAlign: 'right', marginTop: 2 }}>
                            {c.course_code} - م{c.level} {c.section ? `| الشعبة ${c.section}` : ''}
                          </Text>
                          {cDept ? (
                            <Text style={{ fontSize: 11, color: '#1565c0', textAlign: 'right', marginTop: 2 }}>
                              🏢 {cDept}
                            </Text>
                          ) : null}
                          {/* حالة الإسناد */}
                          {c.existing_load_id ? (
                            <Text style={{ fontSize: 11, color: '#2e7d32', textAlign: 'right', marginTop: 2, fontWeight: '600' }}>
                              ✓ مسند للمعلم الحالي
                            </Text>
                          ) : isOtherTeacher ? (
                            <Text style={{ fontSize: 11, color: '#e65100', textAlign: 'right', marginTop: 2, fontWeight: '600' }}>
                              ⚠️ مسند حالياً لـ: {c.current_teacher_name}
                            </Text>
                          ) : null}
                        </View>
                        {/* Hours Input */}
                        <View style={{ width: 100, marginHorizontal: 8 }}>
                          {Platform.OS === 'web' ? (
                            <input
                              type="number"
                              min="0"
                              step="0.5"
                              value={hoursMap[c.course_id] || ''}
                              onChange={(e: any) => setHoursMap(prev => ({ ...prev, [c.course_id]: e.target.value }))}
                              placeholder="الساعات"
                              style={{
                                width: '100%', padding: '8px 4px', borderRadius: 8, border: '1px solid #ccc',
                                fontSize: 15, textAlign: 'center', fontWeight: '600',
                                backgroundColor: c.existing_load_id ? '#e8f5e9' : '#fff',
                              }}
                              data-testid={`teaching-load-hours-${c.course_id}`}
                            />
                          ) : (
                            <Text style={{ textAlign: 'center', fontSize: 15, fontWeight: '600' }}>{hoursMap[c.course_id] || '0'}</Text>
                          )}
                          <Text style={{ fontSize: 10, color: '#999', textAlign: 'center', marginTop: 2 }}>ساعة/أسبوع</Text>
                        </View>
                        {/* Delete Button */}
                        <TouchableOpacity
                          onPress={() => {
                            if (c.existing_load_id) handleDelete(c.existing_load_id, c.course_name);
                            else removeCourseFromList(c.course_id);
                          }}
                          style={{ padding: 6 }}
                          data-testid={`remove-course-${c.course_id}`}
                        >
                          <Ionicons name={c.existing_load_id ? "trash-outline" : "close-circle"} size={22} color="#e53935" />
                        </TouchableOpacity>
                      </View>
                      );
                    })}

                    {/* Total */}
                    <View style={[styles.totalRow, { flexDirection: 'row-reverse' }]}>
                      <Text style={styles.totalLabel}>المجموع الأسبوعي</Text>
                      <Text style={styles.totalValue}>
                        {Object.values(hoursMap).reduce((sum, v) => sum + (parseFloat(v) || 0), 0)} ساعة
                      </Text>
                    </View>

                    {/* Save Button */}
                    <TouchableOpacity
                      style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                      onPress={handleSave}
                      disabled={saving}
                      data-testid="teaching-load-save-btn"
                    >
                      {saving ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Ionicons name="save-outline" size={20} color="#fff" />
                          <Text style={styles.saveBtnText}>حفظ العبء التدريسي</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  </View>
                )}

                {selectedCourses.length === 0 && (
                  <View style={{ alignItems: 'center', paddingVertical: 24 }}>
                    <Ionicons name="search-outline" size={40} color="#ccc" />
                    <Text style={{ color: '#999', marginTop: 8, textAlign: 'center' }}>ابحث عن مقرر بالرمز أو الاسم لإضافته</Text>
                  </View>
                )}
              </View>
            )}

            {/* Empty state - يظهر فقط إذا لم يُختر قسم ولم يُفعَّل وضع جميع الأقسام */}
            {!selectedDept && !crossDept && (
              <View style={styles.emptyCard} data-testid="teaching-load-empty">
                <Ionicons name="grid-outline" size={24} color="#bbb" />
                <Text style={styles.emptyText}>اختر القسم ثم المعلم لتعيين العبء التدريسي</Text>
              </View>
            )}
          </>
        )}

        {viewMode === 'summary' && selectedDept && (
              <View style={styles.filterCard}>
                <Text style={[styles.filterLabel, { textAlign: 'right' }]}>المعلم (اختياري)</Text>
                {Platform.OS === 'web' ? (
                  <TeacherSearch teachers={[{ id: '', full_name: 'كل المعلمين' }, ...teachers]} selectedId={summaryTeacherId} onSelect={setSummaryTeacherId} />
                ) : (
                <View style={styles.pickerWrapper}>
                  <Picker
                    selectedValue={summaryTeacherId}
                    onValueChange={(v) => setSummaryTeacherId(v)}
                    style={styles.picker}
                  >
                    <Picker.Item label="-- كل المعلمين --" value="" />
                    {teachers.map(t => (
                      <Picker.Item key={t.id} label={t.full_name} value={t.id} />
                    ))}
                  </Picker>
                </View>
                )}

                {/* 🆕 فلتر الفصل الدراسي (يشمل المؤرشف) */}
                <Text style={[styles.filterLabel, { textAlign: 'right', marginTop: 12 }]}>الفصل الدراسي</Text>
                <View style={styles.pickerWrapper}>
                  <Picker
                    selectedValue={summaryAllSemesters ? '__all__' : (summarySemesterId || '__active__')}
                    onValueChange={(v: string) => {
                      if (v === '__all__') {
                        setSummaryAllSemesters(true);
                        setSummarySemesterId('');
                      } else if (v === '__active__') {
                        setSummaryAllSemesters(false);
                        setSummarySemesterId('');
                      } else {
                        setSummaryAllSemesters(false);
                        setSummarySemesterId(v);
                      }
                    }}
                    style={styles.picker}
                  >
                    <Picker.Item label="🟢 الفصل النشط الحالي (افتراضي)" value="__active__" />
                    <Picker.Item label="📚 كل الفصول (يشمل المؤرشفة)" value="__all__" />
                    {allSemesters.filter(s => s.status !== 'active').map(s => (
                      <Picker.Item
                        key={s.id}
                        label={`📦 ${s.name} ${s.academic_year} (مؤرشف)`}
                        value={s.id}
                      />
                    ))}
                  </Picker>
                </View>
                {/* مؤشّر الفصل المختار */}
                {summarySemesterId ? (
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4, marginTop: 6, backgroundColor: '#fff3e0', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}>
                    <Ionicons name="archive-outline" size={12} color="#e65100" />
                    <Text style={{ fontSize: 11, color: '#e65100', fontWeight: '700' }}>
                      عرض بيانات فصل مؤرشف
                    </Text>
                  </View>
                ) : summaryAllSemesters ? (
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4, marginTop: 6, backgroundColor: '#e3f2fd', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}>
                    <Ionicons name="layers-outline" size={12} color="#1565c0" />
                    <Text style={{ fontSize: 11, color: '#1565c0', fontWeight: '700' }}>
                      عرض جميع الفصول مجتمعة
                    </Text>
                  </View>
                ) : null}

                {/* 🆕 زر تنفيذ الاستعلام */}
                <TouchableOpacity
                  data-testid="summary-execute-btn"
                  onPress={loadSummary}
                  disabled={loadingSummary}
                  style={{
                    flexDirection: 'row-reverse',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    backgroundColor: loadingSummary ? '#90a4ae' : '#1565c0',
                    paddingVertical: 11,
                    borderRadius: 8,
                    marginTop: 12,
                  }}
                >
                  {loadingSummary ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="search" size={16} color="#fff" />
                      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>
                        {summaryExecuted ? 'تحديث النتائج' : 'تنفيذ الاستعلام'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
        )}

        {viewMode === 'summary' && Platform.OS === 'web' && (
              <View style={styles.filterCard}>
                <Text style={styles.filterLabel}>فترة حساب إجمالي الساعات</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>من تاريخ</Text>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e: any) => setStartDate(e.target.value)}
                      style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 14 }}
                      data-testid="export-start-date"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>إلى تاريخ</Text>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e: any) => setEndDate(e.target.value)}
                      style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 14 }}
                      data-testid="export-end-date"
                    />
                  </View>
                </View>
                {(startDate && endDate) && (
                  <View style={{ backgroundColor: '#fff3e0', padding: 8, borderRadius: 8, marginBottom: 12 }}>
                    <Text style={{ fontSize: 12, color: '#e65100', textAlign: 'center' }}>
                      الفترة: {startDate} إلى {endDate} ({Math.max(1, Math.ceil(((new Date(endDate)).getTime() - (new Date(startDate)).getTime()) / (7 * 24 * 60 * 60 * 1000) + 1/7))} أسبوع تقريباً)
                    </Text>
                  </View>
                )}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    style={[styles.exportBtn, { backgroundColor: '#4caf50' }]}
                    onPress={() => handleExport('excel')}
                    disabled={exportingExcel}
                    data-testid="export-excel-btn"
                  >
                    {exportingExcel ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Ionicons name="download-outline" size={18} color="#fff" />
                        <Text style={styles.exportBtnText}>تصدير Excel</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.exportBtn, { backgroundColor: '#e53935' }]}
                    onPress={() => handleExport('pdf')}
                    disabled={exportingPDF}
                    data-testid="export-pdf-btn"
                  >
                    {exportingPDF ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Ionicons name="document-text-outline" size={18} color="#fff" />
                        <Text style={styles.exportBtnText}>تصدير PDF</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </View>
                {!startDate && !endDate && (
                  <Text style={{ fontSize: 11, color: '#999', marginTop: 8, textAlign: 'center' }}>
                    بدون تحديد تاريخ: سيتم حساب الإجمالي على أساس فصل دراسي (16 أسبوع)
                  </Text>
                )}
              </View>
        )}

        {viewMode === 'summary' && loadingSummary && (
            <View style={styles.emptyCard}>
              <ActivityIndicator size="large" color="#1565c0" />
              <Text style={styles.emptyText}>جاري تحميل الجدول...</Text>
            </View>
        )}

        {viewMode === 'summary' && !loadingSummary && Object.keys(groupedByTeacher).length === 0 && (
            <View style={styles.emptyCard}>
              <Ionicons name="document-text-outline" size={24} color="#ccc" />
              <Text style={styles.emptyText}>
                {!selectedDept
                  ? 'اختر القسم لعرض جدول العبء التدريسي'
                  : !summaryExecuted
                    ? 'اختر الفصل ثم اضغط "تنفيذ الاستعلام" لعرض البيانات'
                    : 'لا توجد بيانات عبء تدريسي بالفلاتر المختارة'}
              </Text>
            </View>
        )}

        {viewMode === 'summary' && !loadingSummary && Object.keys(groupedByTeacher).length > 0 &&
            Object.entries(groupedByTeacher).map(([tId, group]) => (
              <View key={tId} style={styles.summaryCard}>
                <View style={styles.summaryHeader}>
                  <View>
                    <Text style={styles.summaryTeacherName}>{group.name}</Text>
                    {group.empId ? <Text style={styles.summaryEmpId}>الرقم الوظيفي: {group.empId}</Text> : null}
                  </View>
                  <View style={{ alignItems: 'flex-start' }}>
                    <View style={styles.summaryBadge}>
                      <Text style={styles.summaryBadgeText}>{group.totalHours} ساعة/أسبوع</Text>
                    </View>
                    {group.actualHours > 0 && group.actualHours !== group.totalHours && (
                      <View style={{ backgroundColor: group.actualHours > group.totalHours ? '#ffedd5' : '#e0f2fe', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginTop: 6, alignSelf: 'flex-end' }} testID={`actual-hours-badge-${tId}`}>
                        <Text style={{ fontSize: 10.5, color: group.actualHours > group.totalHours ? '#c2410c' : '#0369a1', fontWeight: '800' }}>
                          ⚖️ الفعلي من الجدول: {group.actualHours} ساعة {group.actualHours > group.totalHours ? `(+${Math.round((group.actualHours - group.totalHours) * 100) / 100})` : ''}
                        </Text>
                      </View>
                    )}
                    {group.outHours > 0 && (
                      <View style={{ flexDirection: 'row-reverse', gap: 6, marginTop: 6 }}>
                        <View style={{ backgroundColor: '#dcfce7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                          <Text style={{ fontSize: 10.5, color: '#15803d', fontWeight: '700' }}>داخل القسم: {group.inHours}</Text>
                        </View>
                        <View style={{ backgroundColor: '#fef3c7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                          <Text style={{ fontSize: 10.5, color: '#a16207', fontWeight: '700' }}>خارج القسم: {group.outHours}</Text>
                        </View>
                      </View>
                    )}
                  </View>
                </View>
                <View style={styles.summaryTableHeader}>
                  <Text style={[styles.summaryTableHeaderCell, { flex: 2 }]}>المقرر</Text>
                  <Text style={[styles.summaryTableHeaderCell, { flex: 1 }]}>الرمز</Text>
                  <Text style={[styles.summaryTableHeaderCell, { flex: 1 }]}>الشعبة</Text>
                  <Text style={[styles.summaryTableHeaderCell, { flex: 1 }]}>الساعات</Text>
                  <Text style={[styles.summaryTableHeaderCell, { flex: 1 }]}>الفعلي بالجدول (🧪 العملي=نصف)</Text>
                  <Text style={[styles.summaryTableHeaderCell, { flex: 0.5 }]}></Text>
                </View>
                {group.items.map((item) => {
                  const cDept = String((item as any).course_department_id || '');
                  const isOutside = !!(group.teacherDeptId && cDept && cDept !== group.teacherDeptId);
                  return (
                  <View key={item.id} style={[styles.summaryTableRow, isOutside && { backgroundColor: '#fffbeb' }]}>
                    <View style={{ flex: 2, flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                      <Text style={[styles.summaryTableCell, { flex: 0 }]}>{item.course_name}</Text>
                      {isOutside && (
                        <View style={{ backgroundColor: '#fef3c7', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 }}>
                          <Text style={{ fontSize: 9.5, color: '#a16207', fontWeight: '800' }}>🏛️ خارج القسم</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.summaryTableCell, { flex: 1, color: '#666' }]}>{item.course_code}</Text>
                    <Text style={[styles.summaryTableCell, { flex: 1, color: '#888' }]}>{item.course_section || '-'}</Text>
                    <Text style={[styles.summaryTableCell, { flex: 1, textAlign: 'center', fontWeight: '600' }]}>{item.weekly_hours}</Text>
                    <Text style={[styles.summaryTableCell, { flex: 1, textAlign: 'center', fontWeight: '700', color: (item.actual_weekly_hours || 0) > item.weekly_hours ? '#c2410c' : '#64748b' }]}>
                      {item.actual_weekly_hours ? `${item.actual_weekly_hours}${(item.actual_weekly_hours || 0) > item.weekly_hours ? ' 🔺' : ''}` : '-'}
                    </Text>
                    <View style={[{ flex: 0.5, alignItems: 'center', justifyContent: 'center' }]}>
                      <TouchableOpacity
                        onPress={() => handleDelete(item.id, item.course_name)}
                        data-testid={`summary-delete-${item.id}`}
                      >
                        <Ionicons name="trash-outline" size={16} color="#e53935" />
                      </TouchableOpacity>
                    </View>
                  </View>
                  );
                })}
                {/* صف المجموع */}
                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', padding: 10, backgroundColor: '#f1f5f9', borderTopWidth: 2, borderTopColor: '#cbd5e1', marginTop: 4 }}>
                  <Text style={{ flex: 3, fontSize: 13, fontWeight: '800', color: '#0f172a', textAlign: 'right' }}>المجموع الكلي</Text>
                  <Text style={{ flex: 1, fontSize: 14, fontWeight: '800', color: '#1565c0', textAlign: 'center' }}>{group.totalHours} ساعة</Text>
                  <Text style={{ flex: 1, fontSize: 13, fontWeight: '800', color: group.actualHours > group.totalHours ? '#c2410c' : '#64748b', textAlign: 'center' }}>{group.actualHours ? `${group.actualHours} فعلياً` : '-'}</Text>
                  <View style={{ flex: 0.5 }} />
                </View>
              </View>
            ))
        }
      </ScrollView>

      {/* ============= Save Template Modal ============= */}
      <Modal visible={showSaveTemplateModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 20, width: '95%', maxWidth: 460 }} data-testid="save-template-modal">
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Ionicons name="save" size={22} color="#6a1b9a" />
              <Text style={{ fontSize: 17, fontWeight: '800', color: '#222', flex: 1, textAlign: 'right' }}>حفظ القالب</Text>
            </View>
            <Text style={{ fontSize: 12, color: '#666', textAlign: 'right', marginBottom: 14, lineHeight: 18 }}>
              سيتم حفظ جميع إسنادات معلمي الفصل النشط مع ساعات العبء كقالب يمكن تطبيقه على فصول مستقبلية.
            </Text>

            <Text style={{ fontSize: 12, color: '#444', textAlign: 'right', marginBottom: 4, fontWeight: '700' }}>اسم القالب *</Text>
            <TextInput
              data-testid="template-name-input"
              value={templateName}
              onChangeText={setTemplateName}
              placeholder="مثال: خطة قسم البرمجة - الفصل الأول"
              placeholderTextColor="#aaa"
              style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, textAlign: 'right', marginBottom: 12 }}
            />

            <Text style={{ fontSize: 12, color: '#444', textAlign: 'right', marginBottom: 4, fontWeight: '700' }}>نوع الفصل</Text>
            <View style={{ flexDirection: 'row-reverse', gap: 6, marginBottom: 12 }}>
              {[
                { v: 'first', l: 'الأول' },
                { v: 'second', l: 'الثاني' },
                { v: 'summer', l: 'الصيفي' },
              ].map(o => (
                <TouchableOpacity
                  key={o.v}
                  onPress={() => setTemplateTerm(o.v as any)}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    borderRadius: 8,
                    borderWidth: 1.5,
                    borderColor: templateTerm === o.v ? '#6a1b9a' : '#ddd',
                    backgroundColor: templateTerm === o.v ? '#f3e5f5' : '#fff',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '700', color: templateTerm === o.v ? '#6a1b9a' : '#666' }}>{o.l}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ backgroundColor: '#f5f5f5', padding: 10, borderRadius: 8, marginBottom: 14 }}>
              <Text style={{ fontSize: 11, color: '#555', textAlign: 'right' }}>
                المصدر: <Text style={{ fontWeight: '800' }}>{activeSemester ? `${activeSemester.name} ${activeSemester.academic_year}` : '—'}</Text>
              </Text>
              {selectedDept ? (
                <Text style={{ fontSize: 11, color: '#555', textAlign: 'right', marginTop: 2 }}>
                  القسم: <Text style={{ fontWeight: '800' }}>{departments.find(d => d.id === selectedDept)?.name || ''}</Text>
                </Text>
              ) : (
                <Text style={{ fontSize: 11, color: '#888', textAlign: 'right', marginTop: 2 }}>كل الأقسام</Text>
              )}
            </View>

            <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
              <TouchableOpacity
                onPress={() => setShowSaveTemplateModal(false)}
                disabled={savingTemplate}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: '#f5f5f5', alignItems: 'center' }}
              >
                <Text style={{ color: '#666', fontWeight: '700' }}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                data-testid="confirm-save-template-btn"
                onPress={handleSaveTemplate}
                disabled={savingTemplate}
                style={{ flex: 2, paddingVertical: 12, borderRadius: 8, backgroundColor: '#6a1b9a', alignItems: 'center', opacity: savingTemplate ? 0.6 : 1 }}
              >
                {savingTemplate ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '800' }}>حفظ القالب</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ============= Apply Template Modal ============= */}
      <Modal visible={showApplyTemplateModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 18, width: '95%', maxWidth: 560, maxHeight: '90%' }} data-testid="apply-template-modal">
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Ionicons name="download" size={22} color="#00838f" />
              <Text style={{ fontSize: 17, fontWeight: '800', color: '#222', flex: 1, textAlign: 'right' }}>تطبيق قالب سابق</Text>
            </View>

            <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator>
              {!applyResult ? (
                <>
                  <Text style={{ fontSize: 12, color: '#444', textAlign: 'right', marginBottom: 4, fontWeight: '700' }}>اختر القالب *</Text>
                  {templates.length === 0 ? (
                    <View style={{ padding: 14, backgroundColor: '#fff3e0', borderRadius: 8, borderRightWidth: 3, borderRightColor: '#ef6c00' }}>
                      <Text style={{ fontSize: 12, color: '#e65100', textAlign: 'right' }}>
                        لا توجد قوالب محفوظة. احفظ قالباً أولاً من فصل سابق.
                      </Text>
                    </View>
                  ) : (
                    <View style={{ gap: 6 }}>
                      {templates.map(t => (
                        <TouchableOpacity
                          key={t.id}
                          data-testid={`template-option-${t.id}`}
                          onPress={() => setSelectedTemplateId(t.id)}
                          style={{
                            padding: 10,
                            borderRadius: 8,
                            borderWidth: 1.5,
                            borderColor: selectedTemplateId === t.id ? '#00838f' : '#e0e0e0',
                            backgroundColor: selectedTemplateId === t.id ? '#e0f2f1' : '#fafafa',
                          }}
                        >
                          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
                            <Ionicons
                              name={selectedTemplateId === t.id ? 'radio-button-on' : 'radio-button-off'}
                              size={18}
                              color={selectedTemplateId === t.id ? '#00838f' : '#999'}
                            />
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 13, fontWeight: '800', color: '#222', textAlign: 'right' }}>{t.name}</Text>
                              <Text style={{ fontSize: 10, color: '#777', textAlign: 'right', marginTop: 2 }}>
                                المصدر: {t.source_semester_name} | {t.items_count} إسناد
                                {t.department_name ? ` | ${t.department_name}` : ''}
                              </Text>
                            </View>
                            <TouchableOpacity
                              onPress={() => handleDeleteTemplate(t.id, t.name)}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                              <Ionicons name="trash-outline" size={16} color="#c62828" />
                            </TouchableOpacity>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  <Text style={{ fontSize: 12, color: '#444', textAlign: 'right', marginTop: 14, marginBottom: 4, fontWeight: '700' }}>الفصل المستهدف *</Text>
                  <View style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, overflow: 'hidden' }}>
                    <Picker selectedValue={targetSemesterId} onValueChange={setTargetSemesterId}>
                      <Picker.Item label="اختر فصلاً..." value="" />
                      {allSemesters.map(s => (
                        <Picker.Item
                          key={s.id}
                          label={`${s.name} ${s.academic_year} ${s.status === 'active' ? '(نشط)' : '(مؤرشف)'}`}
                          value={s.id}
                        />
                      ))}
                    </Picker>
                  </View>

                  <TouchableOpacity
                    onPress={() => setOverwriteExisting(!overwriteExisting)}
                    style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, marginTop: 12 }}
                  >
                    <Ionicons name={overwriteExisting ? 'checkbox' : 'square-outline'} size={20} color={overwriteExisting ? '#c62828' : '#999'} />
                    <Text style={{ fontSize: 12, color: '#444', textAlign: 'right', flex: 1 }}>
                      استبدال الإسنادات الموجودة (إذا كان للمقرر معلم بالفعل في الفصل المستهدف)
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <View>
                  <View style={{ backgroundColor: '#e8f5e9', padding: 12, borderRadius: 8, marginBottom: 10 }}>
                    <Text style={{ fontSize: 13, color: '#1b5e20', textAlign: 'right', fontWeight: '700' }}>
                      {applyResult.message}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row-reverse', gap: 6, marginBottom: 10 }}>
                    <View style={{ flex: 1, backgroundColor: '#e3f2fd', padding: 8, borderRadius: 6, alignItems: 'center' }}>
                      <Text style={{ fontSize: 18, fontWeight: '800', color: '#1565c0' }}>{applyResult.stats?.created || 0}</Text>
                      <Text style={{ fontSize: 10, color: '#1565c0' }}>إسناد جديد</Text>
                    </View>
                    <View style={{ flex: 1, backgroundColor: '#fff8e1', padding: 8, borderRadius: 6, alignItems: 'center' }}>
                      <Text style={{ fontSize: 18, fontWeight: '800', color: '#f57f17' }}>{applyResult.stats?.updated || 0}</Text>
                      <Text style={{ fontSize: 10, color: '#f57f17' }}>تحديث</Text>
                    </View>
                    <View style={{ flex: 1, backgroundColor: '#f5f5f5', padding: 8, borderRadius: 6, alignItems: 'center' }}>
                      <Text style={{ fontSize: 18, fontWeight: '800', color: '#616161' }}>{applyResult.stats?.skipped_existing || 0}</Text>
                      <Text style={{ fontSize: 10, color: '#616161' }}>متجاهل</Text>
                    </View>
                  </View>
                  {applyResult.no_course_match?.length ? (
                    <View style={{ backgroundColor: '#fff3e0', padding: 10, borderRadius: 8, marginBottom: 8 }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#e65100', textAlign: 'right', marginBottom: 4 }}>
                        ⚠️ مقررات لم تطابق ({applyResult.no_course_match.length}):
                      </Text>
                      {applyResult.no_course_match.slice(0, 10).map((nc: any, i: number) => (
                        <Text key={i} style={{ fontSize: 11, color: '#bf360c', textAlign: 'right' }}>
                          • {nc.code} - {nc.name} (م{nc.level} ش{nc.section || '-'})
                        </Text>
                      ))}
                    </View>
                  ) : null}
                  {applyResult.no_teacher_match?.length ? (
                    <View style={{ backgroundColor: '#ffebee', padding: 10, borderRadius: 8 }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#b71c1c', textAlign: 'right', marginBottom: 4 }}>
                        🚫 معلمون غير موجودين ({applyResult.no_teacher_match.length}):
                      </Text>
                      {applyResult.no_teacher_match.slice(0, 10).map((nt: any, i: number) => (
                        <Text key={i} style={{ fontSize: 11, color: '#c62828', textAlign: 'right' }}>
                          • {nt.teacher_name} → {nt.course}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </View>
              )}
            </ScrollView>

            <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: 12 }}>
              {applyResult ? (
                <TouchableOpacity
                  onPress={() => {
                    setShowApplyTemplateModal(false);
                    setApplyResult(null);
                    setSelectedTemplateId('');
                  }}
                  style={{ flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: '#00838f', alignItems: 'center' }}
                >
                  <Text style={{ color: '#fff', fontWeight: '800' }}>تم</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity
                    onPress={() => setShowApplyTemplateModal(false)}
                    disabled={applyingTemplate}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: '#f5f5f5', alignItems: 'center' }}
                  >
                    <Text style={{ color: '#666', fontWeight: '700' }}>إلغاء</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    data-testid="confirm-apply-template-btn"
                    onPress={handleApplyTemplate}
                    disabled={applyingTemplate || !selectedTemplateId || !targetSemesterId}
                    style={{ flex: 2, paddingVertical: 12, borderRadius: 8, backgroundColor: '#00838f', alignItems: 'center', opacity: (applyingTemplate || !selectedTemplateId || !targetSemesterId) ? 0.5 : 1 }}
                  >
                    {applyingTemplate ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '800' }}>تطبيق</Text>}
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 10, fontSize: 16, color: '#666' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#333', flex: 1, textAlign: 'center' },
  toggleRow: {
    flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 6, gap: 6, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  toggleBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 7, borderRadius: 6, backgroundColor: '#e3f2fd',
  },
  toggleBtnActive: { backgroundColor: '#1565c0' },
  toggleText: { fontSize: 12, color: '#1565c0', fontWeight: '600' },
  toggleTextActive: { color: '#fff' },
  scrollView: { flex: 1, padding: 12 },
  filterCard: {
    backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 2, elevation: 1,
  },
  filterLabel: { fontSize: 13, fontWeight: '600', color: '#333', marginBottom: 6 },
  pickerWrapper: {
    backgroundColor: '#f5f5f5', borderRadius: 6, borderWidth: 1, borderColor: '#ddd', overflow: 'hidden',
  },
  picker: { height: 40 },
  emptyCard: {
    backgroundColor: '#fff', borderRadius: 10, paddingVertical: 18, paddingHorizontal: 16, alignItems: 'center',
    flexDirection: 'row-reverse', gap: 10, justifyContent: 'center',
    borderWidth: 1, borderColor: '#f0f0f0',
  },
  emptyText: { fontSize: 13, color: '#888', textAlign: 'center' },
  tableCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 2, elevation: 2,
  },
  tableTitle: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 12 },
  tableHeaderRow: {
    flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 4,
    backgroundColor: '#1565c0', borderRadius: 8, marginBottom: 4,
  },
  tableHeaderCell: { fontSize: 12, fontWeight: '700', color: '#fff', textAlign: 'center' },
  tableRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  tableCell: { fontSize: 13, color: '#333' },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 8, marginTop: 8,
    backgroundColor: '#e3f2fd', borderRadius: 8,
  },
  totalLabel: { fontSize: 14, fontWeight: '600', color: '#1565c0' },
  totalValue: { fontSize: 18, fontWeight: '700', color: '#1565c0' },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 16, backgroundColor: '#1565c0', paddingVertical: 14, borderRadius: 10,
  },
  saveBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  // Summary styles
  summaryCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 2, elevation: 2,
  },
  summaryHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12,
  },
  summaryTeacherName: { fontSize: 16, fontWeight: '600', color: '#333' },
  summaryEmpId: { fontSize: 12, color: '#888', marginTop: 2 },
  summaryBadge: { backgroundColor: '#e3f2fd', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  summaryBadgeText: { fontSize: 14, fontWeight: '600', color: '#1565c0' },
  summaryTableHeader: {
    flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 4,
    backgroundColor: '#f5f5f5', borderRadius: 6, marginBottom: 4,
  },
  summaryTableHeaderCell: { fontSize: 11, fontWeight: '700', color: '#666', textAlign: 'center' },
  summaryTableRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: '#f5f5f5',
  },
  summaryTableCell: { fontSize: 13, color: '#333' },
  exportBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 8,
  },
  exportBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },
});
