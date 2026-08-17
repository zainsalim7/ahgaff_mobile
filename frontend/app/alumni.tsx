/**
 * صفحة الخريجين — تصميم محدّث 2026
 * - Hero card مع رسم توضيحي
 * - Filter card احترافي مع dropdowns
 * - جدول بألوان معبرة + شارة تقدير
 * - Pagination + per-page selector
 * - تحرير + استرجاع + تصدير Excel/PDF
 */
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Platform, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, Stack } from 'expo-router';
import { alumniAPI, facultiesAPI, departmentsAPI } from '../src/services/api';
import api from '../src/services/api';
import { useAuth, PERMISSIONS } from '../src/contexts/AuthContext';

interface AlumniRow {
  id: string;
  student_id: string;
  full_name: string;
  department_id?: string;
  department_name?: string;
  faculty_id?: string;
  faculty_name?: string;
  graduation_year?: number;
  graduation_semester?: string;
  graduation_date?: string;
  final_gpa?: number;
  total_credit_hours?: number;
  certificate_number?: string;
  honors?: string;
  notes?: string;
}

const SEM_LABEL: Record<string, string> = { first: 'الأول', second: 'الثاني', summer: 'الصيفي' };

// تحويل GPA → شارة "الحالة/الشهادة" (تقدير)
const gradeFromGPA = (gpa?: number) => {
  if (gpa == null) return { label: '-', color: '#5b6678', bg: '#f0f3f7', border: '#e0e7ee' };
  if (gpa >= 3.6) return { label: 'ممتاز', color: '#2e7d32', bg: '#e8f5e9', border: '#a5d6a7' };
  if (gpa >= 3.0) return { label: 'جيد جداً', color: '#2e7d32', bg: '#e8f5e9', border: '#a5d6a7' };
  if (gpa >= 2.5) return { label: 'جيد', color: '#1565c0', bg: '#e3f2fd', border: '#90caf9' };
  if (gpa >= 2.0) return { label: 'مقبول', color: '#ef6c00', bg: '#fff3e0', border: '#ffcc80' };
  return { label: 'ضعيف', color: '#c62828', bg: '#ffebee', border: '#ef9a9a' };
};

const STATUS_OPTIONS = [
  { v: '', label: 'الكل' },
  { v: 'excellent', label: 'ممتاز / جيد جداً' },
  { v: 'good', label: 'جيد' },
  { v: 'pass', label: 'مقبول' },
  { v: 'weak', label: 'ضعيف' },
];

export default function AlumniScreen() {
  const router = useRouter();
  const { hasAnyPermission, isLoading: authLoading, isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<AlumniRow[]>([]);
  const [byYear, setByYear] = useState<Record<string, number>>({});
  const [faculties, setFaculties] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [yearFilter, setYearFilter] = useState<string>('');
  const [facultyFilter, setFacultyFilter] = useState<string>('');
  const [deptFilter, setDeptFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchQ, setSearchQ] = useState('');
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  // Edit modal
  const [editing, setEditing] = useState<AlumniRow | null>(null);
  // 🆕 إصدار شهادة تخرج
  const [certAlumni, setCertAlumni] = useState<AlumniRow | null>(null);
  const [certGrade, setCertGrade] = useState('');
  const [certDate, setCertDate] = useState('');
  const [certIssuing, setCertIssuing] = useState(false);
  const [certMsg, setCertMsg] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState<any>({});

  // 🆕 Selection mode for bulk actions
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRestoring, setBulkRestoring] = useState(false);

  const canView = isAdmin || hasAnyPermission([PERMISSIONS.VIEW_STUDENTS, PERMISSIONS.MANAGE_STUDENTS]);
  const canManage = isAdmin || hasAnyPermission([PERMISSIONS.MANAGE_STUDENTS]);

  useEffect(() => {
    if (!authLoading && !canView) router.replace('/no-permission?from=/alumni' as any);
  }, [authLoading, canView, router]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (yearFilter) params.year = parseInt(yearFilter, 10);
      if (facultyFilter) params.faculty_id = facultyFilter;
      if (deptFilter) params.department_id = deptFilter;
      if (searchQ.trim()) params.q = searchQ.trim();
      const r = await alumniAPI.getAll(params);
      setItems(r.data.items || []);
      setByYear(r.data.by_year || {});
      setPage(1);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'فشل تحميل قائمة الخريجين';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('خطأ', msg);
    } finally {
      setLoading(false);
    }
  }, [yearFilter, facultyFilter, deptFilter, searchQ]);

  useEffect(() => {
    if (!canView) return;
    Promise.allSettled([facultiesAPI.getAll(), departmentsAPI.getAll()]).then(([fRes, dRes]: any[]) => {
      setFaculties(fRes.status === 'fulfilled' ? (fRes.value.data || []) : []);
      setDepartments(dRes.status === 'fulfilled' ? (dRes.value.data || []) : []);
    });
  }, [canView]);

  useEffect(() => {
    if (!canView) return;
    const t = setTimeout(fetchData, 250);
    return () => clearTimeout(t);
  }, [fetchData, canView]);

  const availableYears = useMemo(
    () => Object.keys(byYear).map(Number).sort((a, b) => b - a),
    [byYear]
  );

  const filteredDepts = useMemo(() => {
    if (!facultyFilter) return departments;
    return departments.filter((d: any) => String(d.faculty_id || '') === facultyFilter);
  }, [departments, facultyFilter]);

  // فلترة محلية بالحالة (لأن الـ API لا يدعمها)
  const visibleItems = useMemo(() => {
    if (!statusFilter) return items;
    return items.filter(a => {
      const g = gradeFromGPA(a.final_gpa);
      switch (statusFilter) {
        case 'excellent': return g.label === 'ممتاز' || g.label === 'جيد جداً';
        case 'good': return g.label === 'جيد';
        case 'pass': return g.label === 'مقبول';
        case 'weak': return g.label === 'ضعيف';
        default: return true;
      }
    });
  }, [items, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(visibleItems.length / perPage));
  const pageItems = useMemo(
    () => visibleItems.slice((page - 1) * perPage, page * perPage),
    [visibleItems, page, perPage]
  );

  const handleRestore = async (a: AlumniRow) => {
    const ok = Platform.OS === 'web'
      ? window.confirm(`استرجاع "${a.full_name}" إلى قائمة الطلاب؟\n(ستُحذف بيانات التخرج)`)
      : await new Promise<boolean>((resolve) => Alert.alert(
        'استرجاع خريج', `استرجاع ${a.full_name}؟`,
        [{ text: 'إلغاء', onPress: () => resolve(false) }, { text: 'استرجاع', onPress: () => resolve(true), style: 'destructive' }]
      ));
    if (!ok) return;
    setRestoringId(a.id);
    try {
      const r = await alumniAPI.restore(a.id);
      if (Platform.OS === 'web') window.alert(r.data.message);
      else Alert.alert('تم', r.data.message);
      fetchData();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'فشل الاسترجاع';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('خطأ', msg);
    } finally {
      setRestoringId(null);
    }
  };

  const openCert = (a: AlumniRow) => {
    setCertGrade((a as any).honors || '');
    setCertDate(((a as any).graduation_date || '').slice(0, 10));
    setCertMsg('');
    setCertAlumni(a);
  };

  const issueCertificate = async () => {
    if (!certAlumni) return;
    if (!certGrade.trim()) { setCertMsg('أدخل التقدير العام'); return; }
    setCertIssuing(true);
    setCertMsg('');
    try {
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const res = await api.post('/certificates/issue', {
        student_id: certAlumni.id,
        grade: certGrade.trim(),
        graduation_date: certDate.trim() || undefined,
        base_url: baseUrl,
      });
      try {
        const pdf = await api.get(`/certificates/${res.data.id}/pdf`, { responseType: 'blob' });
        if (Platform.OS === 'web') {
          const url = window.URL.createObjectURL(new Blob([pdf.data]));
          const el = document.createElement('a');
          el.href = url;
          el.download = `certificate_${certAlumni.student_id || 'alumni'}.pdf`;
          el.click();
          window.URL.revokeObjectURL(url);
        }
        setCertMsg(`✅ صدرت الشهادة رقم ${res.data.number} وتم تنزيل ملف PDF`);
      } catch (pdfErr: any) {
        let d = pdfErr?.response?.data?.detail;
        if (pdfErr?.response?.data instanceof Blob) {
          try { d = JSON.parse(await pdfErr.response.data.text()).detail; } catch {}
        }
        setCertMsg(`⚠️ صدرت الشهادة رقم ${res.data.number} لكن تعذر تنزيل الملف: ${d || pdfErr?.message || 'خطأ غير معروف'}`);
      }
    } catch (e: any) {
      setCertMsg(`فشل إصدار الشهادة: ${e?.response?.data?.detail || e?.message || 'خطأ غير معروف'}`);
    } finally {
      setCertIssuing(false);
    }
  };

  const openEdit = (a: AlumniRow) => {
    setEditing(a);
    setEditForm({
      graduation_year: a.graduation_year != null ? String(a.graduation_year) : '',
      graduation_semester: a.graduation_semester || '',
      graduation_date: a.graduation_date || '',
      final_gpa: a.final_gpa != null ? String(a.final_gpa) : '',
      total_credit_hours: a.total_credit_hours != null ? String(a.total_credit_hours) : '',
      certificate_number: a.certificate_number || '',
      honors: a.honors || '',
      notes: a.notes || '',
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSavingEdit(true);
    try {
      const payload: any = {};
      if (editForm.graduation_year !== '') payload.graduation_year = parseInt(editForm.graduation_year, 10);
      if (editForm.graduation_semester) payload.graduation_semester = editForm.graduation_semester;
      if (editForm.graduation_date) payload.graduation_date = editForm.graduation_date;
      if (editForm.final_gpa !== '') payload.final_gpa = parseFloat(editForm.final_gpa);
      if (editForm.total_credit_hours !== '') payload.total_credit_hours = parseInt(editForm.total_credit_hours, 10);
      if (editForm.certificate_number !== '') payload.certificate_number = editForm.certificate_number;
      if (editForm.honors !== '') payload.honors = editForm.honors;
      if (editForm.notes !== '') payload.notes = editForm.notes;
      await alumniAPI.update(editing.id, payload);
      if (Platform.OS === 'web') window.alert('تم حفظ التعديلات بنجاح');
      else Alert.alert('تم', 'تم حفظ التعديلات بنجاح');
      setEditing(null);
      fetchData();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'فشل الحفظ';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('خطأ', msg);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleExport = async (kind: 'excel' | 'pdf') => {
    setExporting(kind);
    try {
      const params: any = {};
      if (yearFilter) params.year = parseInt(yearFilter, 10);
      if (facultyFilter) params.faculty_id = facultyFilter;
      if (deptFilter) params.department_id = deptFilter;
      if (searchQ.trim()) params.q = searchQ.trim();
      const fn = kind === 'excel' ? alumniAPI.exportExcel : alumniAPI.exportPDF;
      const res = await fn(params);
      const blob = new Blob([res.data], { type: kind === 'excel'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const xf = (res.headers as any)?.['x-filename'];
      a.download = xf ? decodeURIComponent(xf) : (kind === 'excel' ? `alumni-${Date.now()}.xlsx` : `alumni-${Date.now()}.pdf`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'فشل التصدير';
      if (Platform.OS === 'web') window.alert(msg);
    } finally {
      setExporting(null);
    }
  };

  const resetFilters = () => {
    setYearFilter('');
    setFacultyFilter('');
    setDeptFilter('');
    setStatusFilter('');
    setSearchQ('');
  };

  // 🆕 Bulk restore
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === visibleItems.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(visibleItems.map(a => a.id)));
  };
  const handleBulkRestore = async () => {
    if (selectedIds.size === 0) return;
    const ok = Platform.OS === 'web'
      ? window.confirm(`استرجاع ${selectedIds.size} خريج إلى قائمة الطلاب؟\n(ستُحذف بيانات تخرجهم)`)
      : true;
    if (!ok) return;
    setBulkRestoring(true);
    const ids = Array.from(selectedIds);
    let ok_count = 0, fail = 0;
    for (const id of ids) {
      try { await alumniAPI.restore(id); ok_count++; } catch { fail++; }
    }
    if (Platform.OS === 'web') window.alert(`تم استرجاع ${ok_count}${fail ? ` · فشل ${fail}` : ''}`);
    setBulkRestoring(false);
    setSelectedIds(new Set());
    setSelectionMode(false);
    fetchData();
  };

  if (authLoading || !canView) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#1565c0" style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  const hasActiveFilter = !!yearFilter || !!facultyFilter || !!deptFilter || !!statusFilter || !!searchQ.trim();
  const latestYear = availableYears[0];

  // Helper to render a styled web <select>
  const renderSelect = (value: string, onChange: (v: string) => void, options: { value: string; label: string }[], testId: string) => {
    if (Platform.OS === 'web') {
      return (
        <select
          value={value}
          onChange={(e: any) => onChange(e.target.value)}
          data-testid={testId}
          style={{
            width: '100%', padding: '10px 12px', fontSize: 14, color: '#1a2540',
            backgroundColor: '#fff', border: '1px solid #d6dde6', borderRadius: 8,
            textAlign: 'right', direction: 'rtl', outline: 'none', cursor: 'pointer',
            appearance: 'none', backgroundImage: 'url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'7\' viewBox=\'0 0 12 7\'%3E%3Cpath fill=\'%235b6678\' d=\'M6 7L0 0h12z\'/%3E%3C/svg%3E")',
            backgroundRepeat: 'no-repeat', backgroundPosition: 'left 12px center', backgroundSize: '12px',
            paddingLeft: 32,
          }}
        >
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    }
    // Fallback for native: simple TextInput-like row (rarely used since this is web admin)
    return (
      <TextInput
        style={styles.fieldInput}
        value={options.find(o => o.value === value)?.label || ''}
        editable={false}
      />
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: 'الخريجون', headerShown: false }} />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        {/* ---------- Compact header (مثل صفحة الطلاب) ---------- */}
        <View style={styles.compactHeader}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
              <Ionicons name="school" size={22} color="#0d47a1" />
              <Text style={styles.pageTitle}>الخريجون</Text>
              <View style={styles.totalBadge}>
                <Text style={styles.totalBadgeText}>{items.length}</Text>
              </View>
            </View>
            {latestYear && (
              <Text style={styles.pageSubtitle}>
                أحدث دفعة: <Text style={{ color: '#1565c0', fontWeight: '700' }}>{latestYear}</Text>
                {' '}بعدد <Text style={{ color: '#1565c0', fontWeight: '700' }}>{byYear[String(latestYear)]}</Text>
              </Text>
            )}
          </View>
          <View style={styles.compactActions}>
            {canManage && (
              <TouchableOpacity
                onPress={() => { setSelectionMode(v => !v); setSelectedIds(new Set()); }}
                style={[styles.compactActionBtn, selectionMode && { backgroundColor: '#1565c0' }]}
                data-testid="toggle-select-mode"
              >
                <Ionicons name="checkmark-done" size={15} color={selectionMode ? '#fff' : '#1565c0'} />
                <Text style={[styles.compactActionBtnText, selectionMode && { color: '#fff' }]}>تحديد</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => handleExport('excel')}
              disabled={exporting !== null}
              style={[styles.compactActionBtn, { backgroundColor: '#e8f5e9', borderColor: '#a5d6a7' }]}
              data-testid="alumni-export-excel"
            >
              {exporting === 'excel' ? <ActivityIndicator size="small" color="#2e7d32" /> : <Ionicons name="document-text" size={15} color="#2e7d32" />}
              <Text style={[styles.compactActionBtnText, { color: '#2e7d32' }]}>Excel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleExport('pdf')}
              disabled={exporting !== null}
              style={[styles.compactActionBtn, { backgroundColor: '#ffebee', borderColor: '#ef9a9a' }]}
              data-testid="alumni-export-pdf"
            >
              {exporting === 'pdf' ? <ActivityIndicator size="small" color="#c62828" /> : <Ionicons name="document-text" size={15} color="#c62828" />}
              <Text style={[styles.compactActionBtnText, { color: '#c62828' }]}>PDF</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ---------- Bulk action bar ---------- */}
        {selectionMode && (
          <View style={styles.bulkActionBar}>
            <Text style={styles.bulkSelectedText}>{selectedIds.size} محدّد من {visibleItems.length}</Text>
            <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
              <TouchableOpacity onPress={toggleSelectAll} style={styles.bulkSecBtn}>
                <Text style={styles.bulkSecBtnText}>
                  {selectedIds.size === visibleItems.length && visibleItems.length > 0 ? 'إلغاء الكل' : 'تحديد الكل'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleBulkRestore}
                disabled={selectedIds.size === 0 || bulkRestoring}
                style={[styles.bulkActionBtn, (selectedIds.size === 0 || bulkRestoring) && { opacity: 0.5 }]}
                data-testid="bulk-restore-btn"
              >
                {bulkRestoring ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="arrow-undo" size={14} color="#fff" />}
                <Text style={styles.bulkActionBtnText}>استرجاع المحددين</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}


        {/* ---------- Year chips selector ---------- */}
        {availableYears.length > 0 && (
          <View style={styles.yearChipsRow}>
            <TouchableOpacity
              onPress={() => setYearFilter('')}
              style={[styles.yearChip, !yearFilter && styles.yearChipActive]}
              data-testid="year-chip-all"
            >
              <Ionicons name="calendar" size={14} color={!yearFilter ? '#fff' : '#1565c0'} />
              <Text style={[styles.yearChipText, !yearFilter && styles.yearChipTextActive]}>كل السنوات</Text>
              <View style={[styles.yearChipCount, !yearFilter && styles.yearChipCountActive]}>
                <Text style={[styles.yearChipCountText, !yearFilter && { color: '#1565c0' }]}>{items.length}</Text>
              </View>
            </TouchableOpacity>
            {availableYears.map(y => (
              <TouchableOpacity
                key={y}
                onPress={() => setYearFilter(String(y))}
                style={[styles.yearChip, yearFilter === String(y) && styles.yearChipActive]}
                data-testid={`year-chip-${y}`}
              >
                <Ionicons name="calendar" size={14} color={yearFilter === String(y) ? '#fff' : '#1565c0'} />
                <Text style={[styles.yearChipText, yearFilter === String(y) && styles.yearChipTextActive]}>{y}</Text>
                <View style={[styles.yearChipCount, yearFilter === String(y) && styles.yearChipCountActive]}>
                  <Text style={[styles.yearChipCountText, yearFilter === String(y) && { color: '#1565c0' }]}>{byYear[String(y)]}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ---------- Filter card ---------- */}
        <View style={styles.filterCard}>
          <View style={styles.filterGrid}>
            <View style={styles.filterFieldWide}>
              <Text style={styles.filterLabel}>بحث</Text>
              <View style={styles.searchInputWrap}>
                <Ionicons name="search" size={16} color="#8a95a8" style={styles.searchIcon} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="بـاسم أو رقم القيد..."
                  placeholderTextColor="#a8b1c2"
                  value={searchQ}
                  onChangeText={setSearchQ}
                  data-testid="alumni-search-input"
                />
              </View>
            </View>
            <View style={styles.filterField}>
              <Text style={styles.filterLabel}>الكلية</Text>
              {renderSelect(
                facultyFilter,
                (v) => { setFacultyFilter(v); setDeptFilter(''); },
                [{ value: '', label: 'كل الكليات' }, ...faculties.map((f: any) => ({ value: f.id, label: f.name }))],
                'faculty-select'
              )}
            </View>
            <View style={styles.filterField}>
              <Text style={styles.filterLabel}>القسم</Text>
              {renderSelect(
                deptFilter,
                setDeptFilter,
                [{ value: '', label: 'كل الأقسام' }, ...filteredDepts.map((d: any) => ({ value: d.id, label: d.name }))],
                'department-select'
              )}
            </View>
            <View style={styles.filterField}>
              <Text style={styles.filterLabel}>سنة التخرج</Text>
              {renderSelect(
                yearFilter,
                setYearFilter,
                [{ value: '', label: 'كل السنوات' }, ...availableYears.map(y => ({ value: String(y), label: String(y) }))],
                'year-select'
              )}
            </View>
            <View style={styles.filterField}>
              <Text style={styles.filterLabel}>الحالة</Text>
              {renderSelect(
                statusFilter,
                setStatusFilter,
                STATUS_OPTIONS.map(o => ({ value: o.v, label: o.label })),
                'status-select'
              )}
            </View>
            <View style={styles.filterActions}>
              {hasActiveFilter && (
                <TouchableOpacity onPress={resetFilters} style={styles.resetBtn} data-testid="reset-filters-btn">
                  <Ionicons name="refresh" size={14} color="#5b6678" />
                  <Text style={styles.resetBtnText}>إعادة تعيين</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={fetchData} style={styles.applyBtn} data-testid="apply-filter-btn">
                <Ionicons name="filter" size={14} color="#fff" />
                <Text style={styles.applyBtnText}>تصفية</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* ---------- Table ---------- */}
        {loading ? (
          <ActivityIndicator size="large" color="#1565c0" style={{ marginTop: 40 }} />
        ) : visibleItems.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="school-outline" size={56} color="#cfd6e1" />
            <Text style={styles.emptyText}>لا يوجد خريجون مطابقون</Text>
            <Text style={styles.emptyHint}>عدّل الفلاتر أو خرّج طلاباً جدد من صفحة الطلاب</Text>
          </View>
        ) : (
          <View style={styles.tableCard}>
            {/* Header */}
            <View style={styles.tableHeader}>
              {selectionMode && (
                <TouchableOpacity onPress={toggleSelectAll} style={styles.checkboxCol}>
                  <View style={[styles.checkbox, selectedIds.size === visibleItems.length && visibleItems.length > 0 && styles.checkboxOn]}>
                    {selectedIds.size === visibleItems.length && visibleItems.length > 0 && (
                      <Ionicons name="checkmark" size={12} color="#fff" />
                    )}
                  </View>
                </TouchableOpacity>
              )}
              <Text style={styles.th_idx}>#</Text>
              <Text style={[styles.th, { flex: 2 }]}>الاسم</Text>
              <Text style={styles.th}>رقم القيد</Text>
              <Text style={[styles.th, { flex: 1.4 }]}>الكلية</Text>
              <Text style={[styles.th, { flex: 1.3 }]}>القسم</Text>
              <Text style={styles.th}>سنة التخرج</Text>
              <Text style={styles.th}>المعدل</Text>
              <Text style={styles.th}>الشهادة</Text>
              <Text style={styles.th}>التقدير</Text>
              {canManage && <Text style={[styles.th, { width: 110, flex: 0 }]}>إجراءات</Text>}
            </View>
            {/* Rows */}
            {pageItems.map((a, idx) => {
              const globalIdx = (page - 1) * perPage + idx + 1;
              const g = gradeFromGPA(a.final_gpa);
              return (
                <View key={a.id} style={[styles.tr, idx % 2 === 1 && { backgroundColor: '#fafbfd' }]}>
                  {selectionMode && (
                    <TouchableOpacity onPress={() => toggleSelect(a.id)} style={styles.checkboxCol} data-testid={`select-alumni-${a.id}`}>
                      <View style={[styles.checkbox, selectedIds.has(a.id) && styles.checkboxOn]}>
                        {selectedIds.has(a.id) && <Ionicons name="checkmark" size={12} color="#fff" />}
                      </View>
                    </TouchableOpacity>
                  )}
                  <Text style={styles.td_idx}>{globalIdx}</Text>
                  <View style={[styles.td_cell, { flex: 2 }]}>
                    <View style={styles.avatarMini}>
                      <Ionicons name="person" size={14} color="#1565c0" />
                    </View>
                    <Text style={styles.td_name} numberOfLines={1}>{a.full_name}</Text>
                  </View>
                  <Text style={styles.td}>{a.student_id || '-'}</Text>
                  <View style={[styles.td_cell, { flex: 1.4 }]}>
                    <View style={styles.entityIcon}>
                      <Ionicons name="business" size={12} color="#5b6678" />
                    </View>
                    <Text style={styles.td_text} numberOfLines={1}>{a.faculty_name || '-'}</Text>
                  </View>
                  <View style={[styles.td_cell, { flex: 1.3 }]}>
                    <View style={styles.entityIcon}>
                      <Ionicons name="business-outline" size={12} color="#5b6678" />
                    </View>
                    <Text style={styles.td_text} numberOfLines={1}>{a.department_name || '-'}</Text>
                  </View>
                  <View style={[styles.td, { alignItems: 'flex-end' }]}>
                    <View style={styles.yearBadge}>
                      <Text style={styles.yearBadgeText}>{a.graduation_year || '-'}</Text>
                    </View>
                  </View>
                  <Text style={[styles.td, { fontWeight: '700', color: g.color, fontSize: 14 }]}>
                    {a.final_gpa != null ? a.final_gpa.toFixed(2) : '-'}
                  </Text>
                  <View style={[styles.td, { alignItems: 'flex-end' }]}>
                    <View style={[styles.gradeBadge, { backgroundColor: g.bg, borderColor: g.border }]}>
                      <Text style={[styles.gradeBadgeText, { color: g.color }]}>{g.label}</Text>
                    </View>
                  </View>
                  <Text style={styles.td} numberOfLines={1}>{a.honors || 'البكالوريوس'}</Text>
                  {canManage && (
                    <View style={[styles.tdActions, { width: 110, flex: 0 }]}>
                      <TouchableOpacity onPress={() => openCert(a)} style={[styles.iconBtnBlue, { backgroundColor: '#e8f5e9' }]} data-testid={`cert-alumni-${a.id}`}>
                        <Ionicons name="ribbon" size={14} color="#2e7d32" />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => openEdit(a)} style={styles.iconBtnBlue} data-testid={`edit-alumni-${a.id}`}>
                        <Ionicons name="create" size={14} color="#1565c0" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleRestore(a)}
                        disabled={restoringId === a.id}
                        style={styles.iconBtnOrange}
                        data-testid={`restore-${a.id}`}
                      >
                        {restoringId === a.id
                          ? <ActivityIndicator size="small" color="#ef6c00" />
                          : <Ionicons name="ellipsis-vertical" size={14} color="#5b6678" />}
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* Pagination Footer */}
        {visibleItems.length > 0 && (
          <View style={styles.paginationBar}>
            <View style={styles.paginationLeft}>
              <Text style={styles.paginationInfo}>
                عرض {(page - 1) * perPage + 1} إلى {Math.min(page * perPage, visibleItems.length)} من {visibleItems.length} خريجين
              </Text>
            </View>
            <View style={styles.paginationCenter}>
              <TouchableOpacity
                onPress={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                style={[styles.pageArrow, page === 1 && { opacity: 0.4 }]}
              >
                <Ionicons name="chevron-forward" size={16} color="#1565c0" />
              </TouchableOpacity>
              {Array.from({ length: totalPages }).slice(0, 5).map((_, i) => {
                const n = i + 1;
                const active = n === page;
                return (
                  <TouchableOpacity
                    key={n}
                    onPress={() => setPage(n)}
                    style={[styles.pageNum, active && styles.pageNumActive]}
                  >
                    <Text style={[styles.pageNumText, active && styles.pageNumTextActive]}>{n}</Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                onPress={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                style={[styles.pageArrow, page === totalPages && { opacity: 0.4 }]}
              >
                <Ionicons name="chevron-back" size={16} color="#1565c0" />
              </TouchableOpacity>
            </View>
            <View style={styles.paginationRight}>
              {Platform.OS === 'web' && (
                <select
                  value={String(perPage)}
                  onChange={(e: any) => { setPerPage(parseInt(e.target.value, 10)); setPage(1); }}
                  style={{
                    padding: '6px 24px 6px 10px', border: '1px solid #d6dde6', borderRadius: 6,
                    fontSize: 13, color: '#1a2540', backgroundColor: '#fff', outline: 'none', cursor: 'pointer',
                  }}
                >
                  <option value="10">10</option>
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
              )}
              <Text style={styles.paginationInfo}>لكل صفحة</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* ============ مودال التحرير ============ */}
      <Modal visible={certAlumni !== null} animationType="fade" transparent onRequestClose={() => setCertAlumni(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '92%', maxWidth: 430 }} data-testid="cert-modal">
            <Ionicons name="ribbon" size={36} color="#2e7d32" style={{ alignSelf: 'center', marginBottom: 10 }} />
            <Text style={{ fontSize: 17, fontWeight: '800', color: '#1a2540', textAlign: 'center', marginBottom: 4 }}>
              إصدار شهادة تخرج
            </Text>
            <Text style={{ fontSize: 13, color: '#5b6678', textAlign: 'center', marginBottom: 14 }}>
              {certAlumni?.full_name} — {certAlumni?.department_name || ''}
            </Text>
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#1a2540', textAlign: 'right', marginBottom: 4 }}>التقدير العام (كما سيظهر في الشهادة)</Text>
            <TextInput
              value={certGrade}
              onChangeText={setCertGrade}
              placeholder="مثال: جيد جداً"
              style={{ borderWidth: 1, borderColor: '#dde3ec', borderRadius: 8, padding: 10, textAlign: 'right', marginBottom: 12, fontSize: 13 }}
              data-testid="cert-grade-input"
            />
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#1a2540', textAlign: 'right', marginBottom: 4 }}>تاريخ المنح الميلادي (YYYY-MM-DD — فارغ = تاريخ التخرج أو اليوم)</Text>
            <TextInput
              value={certDate}
              onChangeText={setCertDate}
              placeholder="2025-08-06"
              style={{ borderWidth: 1, borderColor: '#dde3ec', borderRadius: 8, padding: 10, textAlign: 'right', marginBottom: 6, fontSize: 13 }}
              data-testid="cert-date-input"
            />
            <Text style={{ fontSize: 11, color: '#8a95a8', textAlign: 'right', marginBottom: 10 }}>
              يُحسب التاريخ الهجري تلقائياً — وتُطبع صورة الخريج إن وُجدت في ملفه
            </Text>
            {!!certMsg && <Text style={{ fontSize: 12.5, fontWeight: '700', color: certMsg.startsWith('✅') ? '#2e7d32' : '#c62828', textAlign: 'right', marginBottom: 10 }} data-testid="cert-msg">{certMsg}</Text>}
            <TouchableOpacity
              onPress={issueCertificate}
              disabled={certIssuing}
              style={{ backgroundColor: '#2e7d32', padding: 13, borderRadius: 10, alignItems: 'center', opacity: certIssuing ? 0.6 : 1 }}
              data-testid="cert-issue-btn"
            >
              {certIssuing ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>إصدار وتنزيل الشهادة PDF</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setCertAlumni(null)}
              style={{ backgroundColor: '#f5f5f5', padding: 12, borderRadius: 10, alignItems: 'center', marginTop: 10 }}
            >
              <Text style={{ color: '#666', fontWeight: '600' }}>إغلاق</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={editing !== null} animationType="fade" transparent onRequestClose={() => setEditing(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
                <Ionicons name="create" size={20} color="#1565c0" />
                <Text style={styles.modalTitle}>تحرير بيانات التخرج</Text>
              </View>
              <TouchableOpacity onPress={() => setEditing(null)} data-testid="close-edit-modal" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={22} color="#5b6678" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 18, paddingVertical: 14, gap: 12 }}>
              {editing && (
                <View style={styles.editStudentInfo}>
                  <Text style={styles.editStudentName}>{editing.full_name}</Text>
                  <Text style={styles.editStudentMeta}>رقم القيد: {editing.student_id} · {editing.department_name || '-'}</Text>
                </View>
              )}
              <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>سنة التخرج</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={editForm.graduation_year}
                    onChangeText={(v) => setEditForm((p: any) => ({ ...p, graduation_year: v.replace(/[^0-9]/g, '').slice(0, 4) }))}
                    keyboardType="numeric"
                    placeholder="2025"
                    placeholderTextColor="#a8b1c2"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>المعدل (0 - 4)</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={editForm.final_gpa}
                    onChangeText={(v) => setEditForm((p: any) => ({ ...p, final_gpa: v }))}
                    keyboardType="decimal-pad"
                    placeholder="3.85"
                    placeholderTextColor="#a8b1c2"
                  />
                </View>
              </View>
              <View>
                <Text style={styles.fieldLabel}>الفصل</Text>
                <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
                  {[{ v: 'first', label: 'الأول' }, { v: 'second', label: 'الثاني' }, { v: 'summer', label: 'الصيفي' }].map(s => {
                    const active = editForm.graduation_semester === s.v;
                    return (
                      <TouchableOpacity
                        key={s.v}
                        onPress={() => setEditForm((p: any) => ({ ...p, graduation_semester: active ? '' : s.v }))}
                        style={[styles.segBtn, active && styles.segBtnActive]}
                      >
                        <Text style={[styles.segBtnText, active && styles.segBtnTextActive]}>{s.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
              <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>تاريخ التخرج</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={editForm.graduation_date}
                    onChangeText={(v) => setEditForm((p: any) => ({ ...p, graduation_date: v }))}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#a8b1c2"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>الساعات المعتمدة</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={editForm.total_credit_hours}
                    onChangeText={(v) => setEditForm((p: any) => ({ ...p, total_credit_hours: v.replace(/[^0-9]/g, '') }))}
                    keyboardType="numeric"
                    placeholder="132"
                    placeholderTextColor="#a8b1c2"
                  />
                </View>
              </View>
              <View>
                <Text style={styles.fieldLabel}>رقم الشهادة</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={editForm.certificate_number}
                  onChangeText={(v) => setEditForm((p: any) => ({ ...p, certificate_number: v }))}
                  placeholder="AHG-2025-0001"
                  placeholderTextColor="#a8b1c2"
                />
              </View>
              <View>
                <Text style={styles.fieldLabel}>التقدير / الدرجة</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={editForm.honors}
                  onChangeText={(v) => setEditForm((p: any) => ({ ...p, honors: v }))}
                  placeholder="البكالوريوس / الماجستير / مع مرتبة الشرف"
                  placeholderTextColor="#a8b1c2"
                />
              </View>
              <View>
                <Text style={styles.fieldLabel}>ملاحظات</Text>
                <TextInput
                  style={[styles.fieldInput, { minHeight: 70, textAlignVertical: 'top', paddingTop: 10 }]}
                  value={editForm.notes}
                  onChangeText={(v) => setEditForm((p: any) => ({ ...p, notes: v }))}
                  multiline
                  numberOfLines={3}
                  placeholder="ملاحظات إضافية..."
                  placeholderTextColor="#a8b1c2"
                />
              </View>
            </ScrollView>
            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setEditing(null)} disabled={savingEdit}>
                <Text style={styles.modalCancelBtnText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, savingEdit && { opacity: 0.6 }]}
                onPress={saveEdit}
                disabled={savingEdit}
                data-testid="save-edit-btn"
              >
                {savingEdit ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="checkmark" size={16} color="#fff" />}
                <Text style={styles.modalConfirmBtnText}>{savingEdit ? 'جاري الحفظ...' : 'حفظ التعديلات'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6fa' },

  // ===== Compact header (مثل صفحة الطلاب) =====
  compactHeader: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', padding: 14, borderRadius: 12,
    borderWidth: 1, borderColor: '#e7ebf1', marginBottom: 12,
  },
  pageTitle: { fontSize: 18, fontWeight: '800', color: '#0d47a1' },
  pageSubtitle: { fontSize: 12, color: '#5b6678', textAlign: 'right', marginTop: 4 },
  totalBadge: {
    backgroundColor: '#e3f2fd', paddingHorizontal: 10, paddingVertical: 3,
    borderRadius: 12, minWidth: 28, alignItems: 'center',
  },
  totalBadgeText: { fontSize: 13, fontWeight: '800', color: '#1565c0' },
  compactActions: { flexDirection: 'row-reverse', gap: 8 },
  compactActionBtn: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#f0f6ff', borderWidth: 1, borderColor: '#bbdefb',
  },
  compactActionBtnText: { color: '#1565c0', fontSize: 12, fontWeight: '700' },

  // ===== Bulk action bar =====
  bulkActionBar: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff8e1', borderWidth: 1, borderColor: '#ffe082',
    padding: 12, borderRadius: 10, marginBottom: 12, gap: 8,
  },
  bulkSelectedText: { fontSize: 13, fontWeight: '700', color: '#e65100' },
  bulkSecBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 6,
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#ffcc80',
  },
  bulkSecBtnText: { fontSize: 12, color: '#e65100', fontWeight: '700' },
  bulkActionBtn: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 5,
    backgroundColor: '#ef6c00', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6,
  },
  bulkActionBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // Checkboxes
  checkboxCol: { width: 32, alignItems: 'center', justifyContent: 'center' },
  checkbox: {
    width: 18, height: 18, borderRadius: 4,
    borderWidth: 1.5, borderColor: '#a8b1c2',
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: '#1565c0', borderColor: '#1565c0' },

  // Year chips
  yearChipsRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginBottom: 14, justifyContent: 'flex-start' },
  yearChip: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 6,
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#bbdefb',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 24,
  },
  yearChipActive: { backgroundColor: '#1565c0', borderColor: '#1565c0' },
  yearChipText: { fontSize: 14, fontWeight: '700', color: '#1565c0' },
  yearChipTextActive: { color: '#fff' },
  yearChipCount: {
    backgroundColor: '#e3f2fd', paddingHorizontal: 8, paddingVertical: 1, borderRadius: 12, minWidth: 22, alignItems: 'center',
  },
  yearChipCountActive: { backgroundColor: '#fff' },
  yearChipCountText: { fontSize: 11, fontWeight: '700', color: '#1565c0' },

  // Filter card
  filterCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: '#e7ebf1',
  },
  filterGrid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' },
  filterField: { minWidth: 160, flex: 1 },
  filterFieldWide: { minWidth: 220, flex: 1.4 },
  filterLabel: { fontSize: 12, color: '#5b6678', fontWeight: '600', textAlign: 'right', marginBottom: 6 },
  fieldInput: {
    backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: '#1a2540', textAlign: 'right',
    borderWidth: 1, borderColor: '#d6dde6',
  },
  searchInputWrap: { position: 'relative' },
  searchIcon: { position: 'absolute' as any, right: 12, top: 13, zIndex: 1 },
  searchInput: {
    backgroundColor: '#fff', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, paddingRight: 36,
    fontSize: 14, color: '#1a2540', textAlign: 'right',
    borderWidth: 1, borderColor: '#d6dde6',
  },
  filterActions: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  applyBtn: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 6,
    backgroundColor: '#1565c0', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8,
  },
  applyBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  resetBtn: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 5,
    backgroundColor: '#f4f6fa', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8,
    borderWidth: 1, borderColor: '#d6dde6',
  },
  resetBtnText: { color: '#5b6678', fontWeight: '700', fontSize: 13 },

  // Table
  tableCard: {
    backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden',
    borderWidth: 1, borderColor: '#e7ebf1',
  },
  tableHeader: {
    flexDirection: 'row-reverse', backgroundColor: '#0d47a1',
    paddingVertical: 14, paddingHorizontal: 12, gap: 8, alignItems: 'center',
  },
  th: { flex: 1, fontSize: 13, fontWeight: '700', color: '#fff', textAlign: 'right' },
  th_idx: { width: 32, fontSize: 13, fontWeight: '700', color: '#fff', textAlign: 'center' },
  tr: {
    flexDirection: 'row-reverse', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 12, gap: 8,
    borderBottomWidth: 1, borderBottomColor: '#f0f3f7',
  },
  td: { flex: 1, fontSize: 13, color: '#1a2540', textAlign: 'right' },
  td_idx: { width: 32, fontSize: 12, color: '#8a95a8', fontWeight: '700', textAlign: 'center' },
  td_cell: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  td_name: { fontSize: 14, fontWeight: '700', color: '#0d47a1', flex: 1, textAlign: 'right' },
  td_text: { fontSize: 13, color: '#1a2540', flex: 1, textAlign: 'right' },
  avatarMini: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#e3f2fd', alignItems: 'center', justifyContent: 'center',
  },
  entityIcon: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#f0f3f7', alignItems: 'center', justifyContent: 'center',
  },
  yearBadge: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#bbdefb',
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6,
  },
  yearBadgeText: { fontSize: 12, fontWeight: '700', color: '#1565c0' },
  gradeBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  gradeBadgeText: { fontSize: 12, fontWeight: '700' },
  tdActions: { flexDirection: 'row-reverse', gap: 6, justifyContent: 'flex-end' },
  iconBtnBlue: {
    width: 30, height: 30, borderRadius: 6,
    backgroundColor: '#e3f2fd', alignItems: 'center', justifyContent: 'center',
  },
  iconBtnOrange: {
    width: 30, height: 30, borderRadius: 6,
    backgroundColor: '#f5f7fa', borderWidth: 1, borderColor: '#e0e7ee',
    alignItems: 'center', justifyContent: 'center',
  },

  // Empty
  emptyBox: {
    backgroundColor: '#fff', padding: 60, borderRadius: 12, alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: '#e7ebf1',
  },
  emptyText: { fontSize: 16, color: '#5b6678', fontWeight: '700' },
  emptyHint: { fontSize: 12, color: '#8a95a8' },

  // Pagination
  paginationBar: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 4, paddingVertical: 14, gap: 12, flexWrap: 'wrap',
  },
  paginationLeft: { flex: 1, alignItems: 'flex-end' },
  paginationCenter: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  paginationRight: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 8, justifyContent: 'flex-start' },
  paginationInfo: { fontSize: 12, color: '#5b6678' },
  pageArrow: {
    width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#d6dde6',
  },
  pageNum: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#d6dde6',
  },
  pageNumActive: { backgroundColor: '#0d47a1', borderColor: '#0d47a1' },
  pageNumText: { fontSize: 13, fontWeight: '700', color: '#5b6678' },
  pageNumTextActive: { color: '#fff' },

  // Modal (reused from previous)
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalContent: { backgroundColor: '#fff', borderRadius: 12, width: '100%', maxWidth: 560, maxHeight: '90%', overflow: 'hidden' },
  modalHeader: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#e7ebf1',
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#1a2540' },
  editStudentInfo: {
    backgroundColor: '#e3f2fd', padding: 10, borderRadius: 8,
    borderRightWidth: 3, borderRightColor: '#1565c0',
  },
  editStudentName: { fontSize: 14, fontWeight: '700', color: '#0d47a1', textAlign: 'right' },
  editStudentMeta: { fontSize: 11, color: '#5b6678', textAlign: 'right', marginTop: 3 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#1a2540', marginBottom: 5, textAlign: 'right' },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1.5, borderColor: '#d6dde6', backgroundColor: '#fff', alignItems: 'center' },
  segBtnActive: { borderColor: '#0d47a1', backgroundColor: '#0d47a1' },
  segBtnText: { color: '#5b6678', fontSize: 12.5, fontWeight: '700' },
  segBtnTextActive: { color: '#fff' },
  modalFooter: {
    flexDirection: 'row-reverse', gap: 10, paddingHorizontal: 18, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: '#e7ebf1', backgroundColor: '#fafbfd',
  },
  modalConfirmBtn: {
    flex: 1, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, borderRadius: 8, backgroundColor: '#1565c0',
  },
  modalConfirmBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  modalCancelBtn: {
    paddingVertical: 12, paddingHorizontal: 22, borderRadius: 8,
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#d6dde6',
  },
  modalCancelBtnText: { color: '#5b6678', fontWeight: '700', fontSize: 14 },
});
