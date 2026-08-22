import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

// استخدام URL صحيح حسب البيئة
const getApiUrl = () => {
  // Try to get from expo config first
  const expoBackendUrl = Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL || 
                         process.env.EXPO_PUBLIC_BACKEND_URL || 
                         '';
  
  console.log('Platform:', Platform.OS);
  console.log('EXPO_PUBLIC_BACKEND_URL:', expoBackendUrl);
  
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    // في الويب
    const origin = window.location.origin;
    console.log('Web origin:', origin);
    
    // إذا كنا على localhost:3000، نستخدم localhost:8001 للـ backend
    if (origin.includes('localhost:3000')) {
      return 'http://localhost:8001';
    }
    
    // إذا كنا على Emergent preview
    if (origin.includes('preview.emergentagent.com')) {
      return origin;
    }

    // إذا كنا على Emergent production (emergent.host)
    if (origin.includes('emergent.host')) {
      return origin;
    }
    
    // إذا كنا على Railway (ahgaffweb)، استخدم Backend URL الثابت
    if (origin.includes('railway.app')) {
      return 'https://api.ahgaff.net';
    }

    // إذا كنا على الدومين الرسمي (app.ahgaff.net أو ahgaff.net أو verify.ahgaff.edu)، استخدم api.ahgaff.net
    if (origin.includes('ahgaff.net') || origin.includes('ahgaff.edu')) {
      return 'https://api.ahgaff.net';
    }
    
    // للمواقع الأخرى، استخدم الـ env variable
    if (expoBackendUrl) {
      return expoBackendUrl;
    }
    
    return origin;
  }
  
  // للموبايل، نستخدم الـ env variable
  if (expoBackendUrl) {
    return expoBackendUrl;
  }
  
  // Fallback - استخدم الـ manifest URL إذا كان متاحاً
  const manifestUrl = Constants.expoConfig?.hostUri || Constants.manifest?.hostUri;
  if (manifestUrl) {
    // Convert from expo tunnel format to https
    const baseUrl = `https://${manifestUrl.split(':')[0]}`;
    console.log('Using manifest URL:', baseUrl);
    return baseUrl;
  }
  
  console.warn('No API URL found!');
  return '';
};

// Export API_URL for use in other functions
export const API_URL = getApiUrl();

const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  
  // Don't override Content-Type for FormData (file uploads)
  // Check for FormData in multiple ways for cross-platform compatibility
  const isFormData = config.data instanceof FormData || 
    (config.data && typeof config.data === 'object' && config.data.constructor && config.data.constructor.name === 'FormData') ||
    (config.data && config.data._parts !== undefined);
  
  if (isFormData) {
    console.log('FormData detected, removing Content-Type header');
    delete config.headers['Content-Type'];
  }
  
  console.log('API Request:', config.method?.toUpperCase(), config.url, 'isFormData:', isFormData);
  
  return config;
});

// كاش أوفلاين - يحفظ استجابات GET ويعرضها عند انقطاع الاتصال
const CACHEABLE_PATHS = [
  '/lectures/', '/courses', '/students/me', '/students/me/courses',
  '/my-institution', '/notifications/my', '/reports/summary',
];

const shouldCache = (url: string) => {
  return CACHEABLE_PATHS.some(path => url?.includes(path));
};

// =============================
// In-memory cache للبيانات الثابتة (تتغيّر نادراً) - يقلل تكرار النداءات عبر الصفحات.
// TTL افتراضي 3 دقائق. يمكن إبطاله بعد POST/PUT/DELETE تلقائياً.
// =============================
type MemCacheEntry = { data: any; expiresAt: number };
const memCache = new Map<string, MemCacheEntry>();
const memInflight = new Map<string, Promise<any>>();
const MEM_TTL_MS = 3 * 60 * 1000;

// URLs ثابتة نسبياً (كليات، أقسام، جامعة، إعدادات، أدوار، نطاق)
const MEM_CACHEABLE = [
  '/faculties',
  '/departments',
  '/university',
  '/settings',
  '/my-scope',
  '/permissions/available',
  '/permissions/all',
  '/roles',
];

// مسارات لا يجب تخزينها رغم مطابقة الـ prefix
const MEM_CACHE_EXCLUDE = [
  '/departments/dashboard',
  '/departments/stats',
  '/settings/academic-years',
];

const memCacheKey = (config: any): string | null => {
  if (config.method !== 'get') return null;
  const url: string = config.url || '';
  if (MEM_CACHE_EXCLUDE.some(p => url.includes(p))) return null;
  if (!MEM_CACHEABLE.some(p => url === p || url.startsWith(p + '?') || url.startsWith(p + '/'))) {
    return null;
  }
  const params = config.params ? JSON.stringify(config.params) : '';
  return `${url}|${params}`;
};

const invalidateMemCache = (urlPrefix: string) => {
  for (const key of Array.from(memCache.keys())) {
    if (key.startsWith(urlPrefix)) memCache.delete(key);
  }
};

// Request interceptor للـ memory cache — يُعيد نسخة مخزّنة إذا وُجدت
api.interceptors.request.use(async (config) => {
  const key = memCacheKey(config);
  if (key) {
    const entry = memCache.get(key);
    if (entry && Date.now() < entry.expiresAt) {
      // نُرجع الاستجابة مباشرة عبر adapter مخصّص
      (config as any).adapter = () => Promise.resolve({
        data: entry.data,
        status: 200,
        statusText: 'OK (mem-cache)',
        headers: {},
        config,
        request: null,
      } as any);
    }
  }
  return config;
}, undefined, { synchronous: false });

api.interceptors.response.use(
  async (response) => {
    // 🔧 سجّل وقت آخر طلب ناجح — يستخدمه interceptor الـ403 لإلغاء التوجيه إن كان 403 ثانوياً
    try {
      const w: any = (typeof globalThis !== 'undefined' ? globalThis : {});
      w.__lastSuccessfulRequestAt = Date.now();
    } catch {}

    // حفظ في الكاش إذا كان GET وقابل للتخزين (AsyncStorage - أوفلاين)
    if (response.config.method === 'get' && shouldCache(response.config.url || '')) {
      const cacheKey = `cache_${response.config.url}`;
      try {
        await AsyncStorage.setItem(cacheKey, JSON.stringify(response.data));
      } catch (e) {}
    }

    // حفظ في الـ memory cache للبيانات الثابتة
    const memKey = memCacheKey(response.config as any);
    if (memKey && response.statusText !== 'OK (mem-cache)') {
      memCache.set(memKey, { data: response.data, expiresAt: Date.now() + MEM_TTL_MS });
    }

    // إبطال الـ memory cache عند تعديل البيانات
    const method = response.config.method;
    const url = response.config.url || '';
    if (method && ['post', 'put', 'delete', 'patch'].includes(method)) {
      // إبطال كل الـ prefix المطابقة (مثال: تعديل /faculties/123 يبطل /faculties)
      for (const prefix of MEM_CACHEABLE) {
        if (url.startsWith(prefix)) {
          invalidateMemCache(prefix);
        }
      }
    }

    return response;
  },
  async (error) => {
    // 🔐 معالجة انتهاء صلاحية التوكن: تسجيل خروج تلقائي + توجيه لصفحة الدخول
    const status = error.response?.status;
    const url: string = error.config?.url || '';
    const isAuthCall =
      url.includes('/auth/login') ||
      url.includes('/init-admin') ||
      url.includes('/auth/me');

    if (status === 401 && !isAuthCall) {
      try {
        // امسح بيانات الجلسة
        await AsyncStorage.multiRemove(['token', 'user']);
        memCache.clear();
      } catch {}

      // وجِّه للـ login (Web و Mobile)
      try {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          // تجنّب التوجيه المتكرر إن كنا على /login أصلاً
          const path = window.location.pathname || '';
          if (!path.includes('/login') && !path.endsWith('/')) {
            window.location.replace('/login');
          } else if (!path.includes('/login')) {
            window.location.replace('/login');
          }
        } else {
          // Mobile: استخدم expo-router
          const { router } = await import('expo-router');
          router.replace('/login');
        }
      } catch {}
    }

    // 🔒 403 (لا توجد صلاحية) — وجّه لصفحة "ليس لديك صلاحية"
    // ⏱️ نُؤخّر التوجيه ~1.5 ثانية، وإن نجح أي طلب آخر خلال هذه الفترة، نُلغي
    // التوجيه — لأن 403 كان ثانوياً (مثلاً /archives فشل لكن /curriculum نجح).
    // 🚫 استثناء: العمليات الكتابية (POST/PUT/PATCH/DELETE) لا تُحوِّل الصفحة.
    //    السبب: غالباً تكون عمليات سياقية (مثل حذف مقرر خارج النطاق) — الواجهة
    //    تعرض Alert/Toast مناسب ولا داعي لطرد المستخدم خارج الصفحة.
    const reqMethod = (error.config?.method || '').toLowerCase();
    const isWriteOp = ['post', 'put', 'patch', 'delete'].includes(reqMethod);
    if (status === 403 && !isAuthCall && !isWriteOp) {
      try {
        const w: any = (typeof globalThis !== 'undefined' ? globalThis : {});
        const now = Date.now();
        if (w.__last403Redirect && now - w.__last403Redirect < 2500) {
          return Promise.reject(error);
        }
        w.__last403Redirect = now;
        if (typeof w.__pending403Id !== 'number') w.__pending403Id = 0;
        w.__pending403Id += 1;
        const pendingId = w.__pending403Id;

        const reason403 = error.response?.data?.detail || '';

        setTimeout(() => {
          // إذا حدث طلب ناجح بعد هذا 403 → ألغِ التوجيه
          if (w.__lastSuccessfulRequestAt && w.__lastSuccessfulRequestAt > now) {
            return;
          }
          // إذا حدث 403 آخر جديد بعدنا → اترك المعالجة له
          if (w.__pending403Id !== pendingId) return;

          if (Platform.OS === 'web' && typeof window !== 'undefined') {
            const path = window.location.pathname || '';
            if (!path.includes('/no-permission') && !path.includes('/login')) {
              const from = encodeURIComponent(path);
              const reason = encodeURIComponent(reason403);
              window.location.replace(`/no-permission?from=${from}${reason ? `&reason=${reason}` : ''}`);
            }
          } else {
            import('expo-router').then(({ router }) => {
              router.replace({
                pathname: '/no-permission',
                params: { reason: reason403 },
              } as any);
            });
          }
        }, 1500);
      } catch {}
    }

    // إذا لا يوجد استجابة (أوفلاين) وكان GET، حاول جلب من الكاش
    if (!error.response && error.config?.method === 'get' && shouldCache(error.config.url || '')) {
      const cacheKey = `cache_${error.config.url}`;
      try {
        const cached = await AsyncStorage.getItem(cacheKey);
        if (cached) {
          return { data: JSON.parse(cached), status: 200, config: error.config, headers: {}, statusText: 'OK (cached)' };
        }
      } catch (e) {}
    }
    return Promise.reject(error);
  }
);

// تصدير دالة لإبطال الـ memory cache يدوياً عند الحاجة
export const clearMemCache = () => {
  memCache.clear();
  memInflight.clear();
};

// Auth API
export const authAPI = {
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password }),
  getMe: () => api.get('/auth/me'),
  initAdmin: () => api.post('/init-admin'),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { current_password: currentPassword, new_password: newPassword }),
  forceChangePassword: (newPassword: string) =>
    api.post('/auth/force-change-password', { new_password: newPassword }),
};

// Users API
export const usersAPI = {
  create: (data: any) => api.post('/users', data),
  getAll: (role?: string) => api.get('/users', { params: { role } }),
  update: (id: string, data: any) => api.put(`/users/${id}`, data),
  delete: (id: string) => api.delete(`/users/${id}`),
  // إعادة تعيين كلمة المرور
  resetPassword: (id: string, newPassword: string) => api.post(`/users/${id}/reset-password`, { new_password: newPassword }),
  // تفعيل/إيقاف المستخدم
  toggleActive: (id: string) => api.post(`/users/${id}/toggle-active`),
  // Permissions - الصلاحيات المتقدمة
  getPermissions: (id: string) => api.get(`/users/${id}/permissions`),
  addPermission: (id: string, data: any) => api.post(`/users/${id}/permissions`, data),
  updateAllPermissions: (id: string, scopes: any[]) => api.put(`/users/${id}/permissions`, { scopes }),
  deletePermission: (id: string, permissionId: string) => api.delete(`/users/${id}/permissions/${permissionId}`),
};

// Permissions API
export const permissionsAPI = {
  getAvailable: () => api.get('/permissions/available'),
  getAll: () => api.get('/permissions/all'),
};

// Settings API
export const settingsAPI = {
  get: () => api.get('/settings'),
  update: (data: any) => api.put('/settings', data),
  getAcademicYears: () => api.get('/settings/academic-years'),
  addAcademicYear: (year: string) => api.post('/settings/academic-years', { year }),
  deleteAcademicYear: (year: string) => api.delete(`/settings/academic-years/${encodeURIComponent(year)}`),
  getSemesters: () => api.get('/settings/semesters'),
};

// Institution API - بيانات المؤسسة حسب المستخدم
export const institutionAPI = {
  get: () => api.get('/my-institution'),
  update: (data: any) => api.put('/my-institution', data),
};

// Scope API - نطاق صلاحيات المستخدم
export const scopeAPI = {
  get: () => api.get('/my-scope'),
};

// Departments API
export const departmentsAPI = {
  create: (data: any) => api.post('/departments', data),
  getAll: () => api.get('/departments'),
  getStats: () => api.get('/departments/stats'),
  getDashboard: () => api.get('/departments/dashboard'),
  getDetails: (id: string) => api.get(`/departments/${id}/details`),
  update: (id: string, data: any) => api.put(`/departments/${id}`, data),
  delete: (id: string) => api.delete(`/departments/${id}`),
};

// Notifications API (الإشعارات)
export const notificationsAPI = {
  getAll: (params?: { limit?: number; unread_only?: boolean }) =>
    api.get('/notifications', { params }),
  getCount: () => api.get('/notifications/count'),
  markAsRead: (id: string) => api.put(`/notifications/${id}/read`),
  markAllAsRead: () => api.put('/notifications/read-all'),
  // إنذار يدوي
  sendManual: (data: { student_id: string; title: string; message: string; type?: string; course_id?: string }) =>
    api.post('/notifications/manual', data),
  getStudentNotifications: (studentId: string) =>
    api.get(`/students/${studentId}/notifications`),
  // حذف إشعار محدد أُرسل لطالب (يتطلب صلاحية SEND_NOTIFICATIONS أو admin)
  deleteForStudent: (studentId: string, notifId: string) =>
    api.delete(`/students/${studentId}/notifications/${notifId}`),
  // عدد الإشعارات غير المقروءة لكل طالب
  getUnreadCounts: () => api.get('/students/notifications/unread-counts'),
};

// Students API
export const studentsAPI = {
  create: (data: any) => api.post('/students', data),
  getAll: (params?: { department_id?: string; level?: number; section?: string }) =>
    api.get('/students', { params }),
  getById: (id: string) => api.get(`/students/${id}`),
  getCourses: (id: string) => api.get(`/students/${id}/courses`),
  getByQR: (qrCode: string) => api.get(`/students/qr/${qrCode}`),
  getMe: () => api.get('/students/me'),  // للطالب للحصول على بياناته الخاصة
  update: (id: string, data: any) => api.put(`/students/${id}`, data),
  delete: (id: string) => api.delete(`/students/${id}`),
  // تفعيل/إلغاء تفعيل حساب الطالب
  activateAccount: (studentId: string) =>
    api.post(`/students/${studentId}/activate`),
  deactivateAccount: (studentId: string) =>
    api.post(`/students/${studentId}/deactivate`),
  resetPassword: (studentId: string) =>
    api.post(`/students/${studentId}/reset-password`),
  bulkActivate: () => api.post('/students/bulk-activate'),
  bulkDeactivate: () => api.post('/students/bulk-deactivate'),
  // 🆕 تخريج طالب → ينقله إلى قائمة الخريجين
  graduate: (studentId: string, data: { graduation_year: number; graduation_date?: string; graduation_semester?: string; final_gpa?: number; total_credit_hours?: number; certificate_number?: string; honors?: string; notes?: string }) =>
    api.post(`/students/${studentId}/graduate`, data),
  // 🆕 تخريج جماعي
  bulkGraduate: (data: { student_ids: string[]; graduation_year: number; graduation_date?: string; graduation_semester?: string; honors?: string; notes?: string }) =>
    api.post('/students/bulk-graduate', data),
};

// 🆕 Alumni API (الخريجون)
export const alumniAPI = {
  getAll: (params?: { year?: number; faculty_id?: string; department_id?: string; q?: string }) =>
    api.get('/alumni', { params }),
  getById: (id: string) => api.get(`/alumni/${id}`),
  restore: (id: string) => api.put(`/alumni/${id}/restore`),
  update: (id: string, data: any) => api.put(`/alumni/${id}`, data),
  exportExcel: (params?: { year?: number; faculty_id?: string; department_id?: string; q?: string }) =>
    api.get('/alumni/export/excel', { params, responseType: 'blob' }),
  exportPDF: (params?: { year?: number; faculty_id?: string; department_id?: string; q?: string }) =>
    api.get('/alumni/export/pdf', { params, responseType: 'blob' }),
};

// Teachers API (المعلمين)
export const teachersAPI = {
  create: (data: any) => api.post('/teachers', data),
  getAll: (params?: { department_id?: string }) =>
    api.get('/teachers', { params }),
  getById: (id: string) => api.get(`/teachers/${id}`),
  getCourses: (teacherId: string, params?: { include_all?: boolean; semester_id?: string }) =>
    api.get(`/teachers/${teacherId}/courses`, { params }),
  update: (id: string, data: any) => api.put(`/teachers/${id}`, data),
  delete: (id: string) => api.delete(`/teachers/${id}`),
  // تفعيل/إلغاء تفعيل حساب المعلم
  activateAccount: (teacherId: string) =>
    api.post(`/teachers/${teacherId}/activate`),
  deactivateAccount: (teacherId: string) =>
    api.post(`/teachers/${teacherId}/deactivate`),
  resetPassword: (teacherId: string) =>
    api.post(`/teachers/${teacherId}/reset-password`),
  // استيراد المعلمين
  getTemplate: () =>
    api.get('/template/teachers', { responseType: 'blob' }),
  importFromExcel: async (file: FormData, departmentId: string) => {
    const url = `/import/teachers?department_id=${departmentId}`;
    if (Platform.OS !== 'web') {
      const token = await AsyncStorage.getItem('token');
      const fullUrl = `${API_URL}/api${url}`;
      const response = await fetch(fullUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
        body: file,
      });
      const data = await response.json();
      if (!response.ok) throw { response: { data, status: response.status } };
      return { data };
    }
    return api.post(url, file, { headers: { 'Accept': 'application/json' }, timeout: 60000 });
  },
};

// Courses API
export const coursesAPI = {
  create: (data: any) => api.post('/courses', data),
  getAll: (params?: { teacher_id?: string; department_id?: string }) =>
    api.get('/courses', { params }),
  getById: (id: string) => api.get(`/courses/${id}`),
  update: (id: string, data: any) => api.put(`/courses/${id}`, data),
  delete: (id: string) => api.delete(`/courses/${id}`),
};

// Attendance API
export const attendanceAPI = {
  // New lecture-based attendance
  recordSession: (data: { lecture_id: string; notes?: string; records: Array<{ student_id: string; status: string }> }) =>
    api.post('/attendance/session', data),
  recordSingle: (data: { lecture_id: string; student_id: string; status?: string; method?: string }) =>
    api.post('/attendance/single', data),
  
  // Get attendance
  getByCourse: (courseId: string) => 
    api.get(`/attendance/course/${courseId}`),
  getByStudent: (studentId: string) => 
    api.get(`/attendance/student/${studentId}`),
  getByLecture: (lectureId: string) =>
    api.get(`/attendance/lecture/${lectureId}`),
  getCourseAttendance: (courseId: string, date?: string) =>
    api.get(`/attendance/course/${courseId}`, { params: { date } }),
  getStudentAttendance: (studentId: string, courseId?: string) =>
    api.get(`/attendance/student/${studentId}`, { params: { course_id: courseId } }),
  
  // Stats
  getStudentStats: (studentId: string, courseId?: string) =>
    api.get(`/attendance/stats/student/${studentId}`, { params: { course_id: courseId } }),
  getCourseStats: (courseId: string) => api.get(`/attendance/stats/course/${courseId}`),
  
  // Sync
  sync: (records: any[]) => api.post('/sync/attendance', { attendance_records: records }),
};

// Reports API
export const reportsAPI = {
  getSummary: () => api.get('/reports/summary'),
  getDepartmentReport: (deptId: string, startDate?: string, endDate?: string) =>
    api.get(`/reports/department/${deptId}`, { params: { start_date: startDate, end_date: endDate } }),
  // تقارير جديدة
  getAttendanceOverview: (params?: { department_id?: string; start_date?: string; end_date?: string }) =>
    api.get('/reports/attendance-overview', { params }),
  getAbsentStudents: (params?: { department_id?: string; course_id?: string; min_absence_rate?: number }) =>
    api.get('/reports/absent-students', { params }),
  getStudentReport: (studentId: string) =>
    api.get(`/reports/student/${studentId}`),
  getDailyReport: (params?: { date?: string; department_id?: string }) =>
    api.get('/reports/daily', { params }),
  getWarningsReport: (params?: { department_id?: string; warning_threshold?: number; deprivation_threshold?: number }) =>
    api.get('/reports/warnings', { params }),
  getCourseDetailedReport: (courseId: string) =>
    api.get(`/reports/course/${courseId}/detailed`),
  getTeacherWorkload: (params?: { teacher_id?: string; start_date?: string; end_date?: string }) =>
    api.get('/reports/teacher-workload', { params }),
  getTeacherSummary: (params?: { teacher_id?: string }) =>
    api.get('/reports/teacher-summary', { params }),
  // تصدير التقارير
  exportWarningsExcel: (params?: { department_id?: string }) =>
    api.get('/export/report/warnings/excel', { params, responseType: 'blob' }),
  exportAbsentStudentsExcel: (params?: { department_id?: string; course_id?: string; min_absence_rate?: number }) =>
    api.get('/export/report/absent-students/excel', { params, responseType: 'blob' }),
  exportTeacherWorkloadExcel: (params?: { teacher_id?: string; start_date?: string; end_date?: string; department_id?: string; monthly?: boolean }) =>
    api.get('/export/report/teacher-workload/excel', { params, responseType: 'blob' }),
  exportTeacherSummaryExcel: (params?: { teacher_id?: string }) =>
    api.get('/export/report/teacher-summary/excel', { params, responseType: 'blob' }),
  exportDailyExcel: (params?: { date?: string; department_id?: string }) =>
    api.get('/export/report/daily/excel', { params, responseType: 'blob' }),
  exportStudentReportExcel: (studentId: string) =>
    api.get(`/export/report/student/${studentId}/excel`, { responseType: 'blob' }),
  exportStudentReportPDF: (studentId: string) =>
    api.get(`/export/report/student/${studentId}/pdf`, { responseType: 'blob' }),
  exportCourseReportExcel: (courseId: string) =>
    api.get(`/export/report/course/${courseId}/excel`, { responseType: 'blob' }),
  exportAttendanceOverviewExcel: (params?: { department_id?: string }) =>
    api.get('/export/report/attendance-overview/excel', { params, responseType: 'blob' }),
  // تقرير حضور الأساتذة / تنفيذ المحاضرات
  getTeacherAttendance: (params?: { start_date?: string; end_date?: string; department_id?: string; faculty_id?: string; teacher_id?: string }) =>
    api.get('/reports/teacher-attendance', { params }),
  exportTeacherAttendanceExcel: (params?: { start_date?: string; end_date?: string; department_id?: string; faculty_id?: string; teacher_id?: string }) =>
    api.get('/reports/teacher-attendance/export/excel', { params, responseType: 'blob' }),
  exportTeacherAttendancePDF: (params?: { start_date?: string; end_date?: string; department_id?: string; faculty_id?: string; teacher_id?: string }) =>
    api.get('/reports/teacher-attendance/export/pdf', { params, responseType: 'blob' }),
};

// Export API - returns blob for file download
export const exportAPI = {
  getStudentsTemplate: () => 
    api.get('/template/students', { responseType: 'blob' }),
  
  exportStudents: (params?: { department_id?: string; level?: number; section?: string }) =>
    api.get('/export/students', { 
      params: params || {},
      responseType: 'blob' 
    }),
  
  exportStudentsPDF: (departmentId?: string) => 
    api.get('/export/students/pdf', { 
      params: departmentId ? { department_id: departmentId } : {},
      responseType: 'blob' 
    }),
  
  exportAttendance: (courseId: string, params?: { date_from?: string; date_to?: string }) => 
    api.get(`/export/attendance/${courseId}`, { params, responseType: 'blob' }),
  
  exportAttendancePDF: (courseId: string, params?: { date_from?: string; date_to?: string }) => 
    api.get(`/export/attendance/${courseId}/pdf`, { params, responseType: 'blob' }),
  
  exportDeptReport: (deptId: string) => 
    api.get(`/export/report/${deptId}`, { responseType: 'blob' }),
  
  exportDeptReportPDF: (deptId: string) => 
    api.get(`/export/report/${deptId}/pdf`, { responseType: 'blob' }),
  
  exportSemesterReportPDF: (params?: { course_id?: string; department_id?: string }) =>
    api.get('/export/semester-report/pdf', { params, responseType: 'blob' }),
  
  importStudents: async (file: FormData, departmentId: string, level?: string, section?: string) => {
    let url = `/import/students?department_id=${departmentId}`;
    if (level) url += `&level=${level}`;
    if (section) url += `&section=${section}`;
    console.log('importStudents API called, url:', url);
    
    const token = await AsyncStorage.getItem('token');
    const fullUrl = `${API_URL}/api${url}`;
    console.log('Full URL:', fullUrl);
    console.log('Token exists:', !!token);
    console.log('API_URL:', API_URL);
    
    // For React Native mobile, we need to use a different approach
    // The standard axios/XHR doesn't work well with FormData on mobile
    if (Platform.OS !== 'web') {
      console.log('Using React Native fetch for mobile file upload...');
      
      try {
        const response = await fetch(fullUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            // Don't set Content-Type - let fetch set it automatically for FormData
          },
          body: file,
        });
        
        console.log('Mobile fetch response status:', response.status);
        const responseText = await response.text();
        console.log('Mobile fetch response text:', responseText);
        
        let data;
        try {
          data = JSON.parse(responseText);
        } catch (e) {
          console.error('Failed to parse response:', e);
          throw { message: 'استجابة غير صالحة من الخادم', response: { data: responseText } };
        }
        
        if (!response.ok) {
          throw { response: { data, status: response.status } };
        }
        
        return { data };
      } catch (error: any) {
        console.error('Mobile fetch error:', error);
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        
        // If it's a network error, provide a clearer message
        if (error.message === 'Network request failed' || error.name === 'TypeError') {
          throw { message: 'فشل الاتصال بالخادم. تحقق من اتصالك بالإنترنت.' };
        }
        throw error;
      }
    }
    
    // For web, use axios as it works well there
    console.log('Using axios for web file upload...');
    return api.post(url, file, {
      headers: {
        'Accept': 'application/json',
      },
      timeout: 60000,
    });
  },
};

// Enrollment API - تسجيل الطلاب في المقررات
export const enrollmentAPI = {
  getEnrolled: (courseId: string) => 
    api.get(`/enrollments/${courseId}`),
  
  getEnrolledStudents: (courseId: string) => 
    api.get(`/enrollments/${courseId}/students`),
  
  enroll: (courseId: string, studentIds: string[]) => 
    api.post(`/enrollments/${courseId}`, { course_id: courseId, student_ids: studentIds }),
  
  unenroll: (courseId: string, studentId: string) => 
    api.delete(`/enrollments/${courseId}/${studentId}`),
  
  importFromExcel: (courseId: string, file: FormData) => {
    console.log('importFromExcel API called for courseId:', courseId);
    // Don't set Content-Type - let browser set it automatically with boundary
    return api.post(`/enrollments/${courseId}/import`, file);
  },
};

// Lectures API - المحاضرات/الحصص
export const lecturesAPI = {
  getToday: () => api.get('/lectures/today'),
  
  getMonth: (year: number, month: number) => 
    api.get(`/lectures/month/${year}/${month}`),
  
  getByCourse: (courseId: string, page: number = 1, perPage: number = 50, status?: string) => 
    api.get(`/lectures/${courseId}`, { params: { page, per_page: perPage, ...(status ? { status } : {}) } }),
  
  getAttendanceStatus: (lectureId: string) =>
    api.get(`/lectures/${lectureId}/attendance-status`),
  
  getDetails: (lectureId: string) => 
    api.get(`/lectures/${lectureId}/details`),
  
  create: (courseId: string, data: { date: string; start_time: string; end_time: string; room?: string; notes?: string; force?: boolean }) =>
    api.post('/lectures', { course_id: courseId, ...data }),
  
  generate: (data: { course_id: string; start_date: string; end_date: string; day_of_week: number; start_time: string; end_time: string; room?: string }) =>
    api.post('/lectures/generate', data),
  
  generateBulk: (data: { 
    course_id: string; 
    room: string; 
    schedule: { day: string; slots: { start_time: string; end_time: string }[] }[];
    start_date: string | null;
    end_date: string | null;
  }) =>
    api.post('/lectures/generate-semester', data),
  
  update: (lectureId: string, data: any) => 
    api.put(`/lectures/${lectureId}`, data),
  
  updateStatus: (lectureId: string, status: string) =>
    api.put(`/lectures/${lectureId}/status`, { status }),
  
  delete: (lectureId: string) => 
    api.delete(`/lectures/${lectureId}`),
};

// Roles API (إدارة الأدوار)
export const rolesAPI = {
  getAll: () => api.get('/roles'),
  getById: (roleId: string) => api.get(`/roles/${roleId}`),
  create: (data: { name: string; description?: string; permissions: string[] }) => 
    api.post('/roles', data),
  update: (roleId: string, data: { name?: string; description?: string; permissions?: string[] }) => 
    api.put(`/roles/${roleId}`, data),
  delete: (roleId: string) => api.delete(`/roles/${roleId}`),
  initDefaults: () => api.post('/roles/init'),
};

// User Role Assignment (إسناد الأدوار للمستخدمين)
export const userRoleAPI = {
  getPermissions: (userId: string) => api.get(`/users/${userId}/permissions`),
  assignRole: (userId: string, roleId: string) => 
    api.put(`/users/${userId}/role`, { role_id: roleId }),
};

// Semesters API (الفصول الدراسية)
export const semestersAPI = {
  getAll: (params?: { academic_year?: string; status?: string }) =>
    api.get('/semesters', { params }),
  getCurrent: () => api.get('/semesters/current'),
  getById: (id: string) => api.get(`/semesters/${id}`),
  getStats: (id: string) => api.get(`/semesters/${id}/stats`),
  create: (data: { name: string; academic_year: string; start_date?: string; end_date?: string }) =>
    api.post('/semesters', data),
  update: (id: string, data: { name?: string; start_date?: string; end_date?: string; status?: string }) =>
    api.put(`/semesters/${id}`, data),
  activate: (id: string) => api.post(`/semesters/${id}/activate`),
  close: (id: string) => api.post(`/semesters/${id}/close`),
  archive: (id: string) => api.post(`/semesters/${id}/archive`),
  delete: (id: string) => api.delete(`/semesters/${id}`),
};

// Teaching Load API (العبء التدريسي)
export const teachingLoadAPI = {
  getAll: (params?: { department_id?: string; teacher_id?: string; semester_id?: string }) =>
    api.get('/teaching-load', { params }),
  create: (data: { teacher_id: string; course_id: string; weekly_hours: number; semester_id?: string; notes?: string }) =>
    api.post('/teaching-load', data),
  update: (id: string, data: { weekly_hours?: number; notes?: string }) =>
    api.put(`/teaching-load/${id}`, data),
  delete: (id: string) => api.delete(`/teaching-load/${id}`),
  getTeacherCourses: (teacherId: string, departmentId?: string) =>
    api.get(`/teaching-load/teacher/${teacherId}/courses`, { params: { department_id: departmentId } }),
  searchCourses: (q: string, departmentId?: string) =>
    api.get('/teaching-load/search-courses', { params: { q, department_id: departmentId } }),
  bulkSave: (items: { teacher_id: string; course_id: string; weekly_hours: number; semester_id?: string; notes?: string }[]) =>
    api.post('/teaching-load/bulk', items),
  advancedReport: (params?: { department_id?: string; teacher_id?: string; semester_id?: string; term?: number }) =>
    api.get('/teaching-load/report/advanced', { params }),
  exportPDF: (params?: { department_id?: string; teacher_id?: string; semester_id?: string; start_date?: string; end_date?: string }) =>
    api.get('/export/teaching-load/pdf', { params, responseType: 'blob' }),
  exportExcel: (params?: { department_id?: string; teacher_id?: string; semester_id?: string; start_date?: string; end_date?: string }) =>
    api.get('/export/teaching-load/excel', { params, responseType: 'blob' }),
};

// Weekly Schedule API (الجدول الأسبوعي)
export const scheduleAPI = {
  // القاعات
  getRooms: (facultyId?: string) => api.get('/rooms', { params: { faculty_id: facultyId } }),
  createRoom: (data: any) => api.post('/rooms', data),
  updateRoom: (id: string, data: any) => api.put(`/rooms/${id}`, data),
  deleteRoom: (id: string) => api.delete(`/rooms/${id}`),
  importRooms: (facultyId: string, file: FormData) =>
    api.post(`/rooms/import/upload?faculty_id=${facultyId}`, file, { headers: { 'Content-Type': 'multipart/form-data' } }),
  // الإعدادات
  getSettings: (facultyId?: string) => api.get('/schedule-settings', { params: { faculty_id: facultyId } }),
  saveTimeSlots: (slots: any[], facultyId?: string) => api.post(`/schedule-settings/time-slots${facultyId ? `?faculty_id=${facultyId}` : ''}`, slots),
  saveWorkingDays: (days: string[], facultyId?: string) => api.post(`/schedule-settings/working-days${facultyId ? `?faculty_id=${facultyId}` : ''}`, { days }),
  // تفضيلات المعلمين
  getTeacherPrefs: (id: string) => api.get(`/teacher-preferences/${id}`),
  getTeacherPrefsSummary: (departmentId: string) => api.get('/teacher-preferences', { params: { department_id: departmentId } }),
  generateLecturesFromSchedule: (data: any) => api.post('/weekly-schedule/generate-lectures', data),
  saveTeacherPrefs: (id: string, data: any) => api.put(`/teacher-preferences/${id}`, data),
  // الجدول
  getSchedule: (params?: any) => api.get('/weekly-schedule', { params }),
  createSlot: (data: any) => api.post('/weekly-schedule', data),
  updateSlot: (id: string, data: any) => api.put(`/weekly-schedule/${id}`, data),
  deleteSlot: (id: string) => api.delete(`/weekly-schedule/${id}`),
  clearSchedule: (params?: any) => api.delete('/weekly-schedule/clear/all', { params }),
  autoGenerate: (facultyId: string, deptId?: string) =>
    api.post(`/weekly-schedule/auto-generate?faculty_id=${facultyId}${deptId ? `&department_id=${deptId}` : ''}`),
};

// Activity Logs API (سجلات النشاط)
export const activityLogsAPI = {
  getAll: (params?: { 
    page?: number; 
    limit?: number; 
    user_id?: string; 
    action?: string; 
    start_date?: string; 
    end_date?: string;
  }) => api.get('/activity-logs', { params }),
  getStats: (params?: { start_date?: string; end_date?: string }) => 
    api.get('/activity-logs/stats', { params }),
  recordView: (data: { action: string; details?: any }) => 
    api.post('/activity-logs/record-view', data),
};

// University API (إدارة الجامعة)
export const universityAPI = {
  get: () => api.get('/university'),
  create: (data: { name: string; code: string; address?: string; description?: string }) =>
    api.post('/university', data),
  update: (data: { name?: string; address?: string; description?: string }) =>
    api.put('/university', data),
};

// Faculties API (إدارة الكليات)
export const facultiesAPI = {
  getAll: () => api.get('/faculties'),
  getById: (id: string) => api.get(`/faculties/${id}`),
  create: (data: { name: string; code: string; description?: string }) =>
    api.post('/faculties', data),
  update: (id: string, data: { name?: string; code?: string; description?: string }) =>
    api.put(`/faculties/${id}`, data),
  delete: (id: string) => api.delete(`/faculties/${id}`),
  updateSettings: (id: string, data: any) => api.put(`/faculties/${id}/settings`, data),
};

// Dashboard API - endpoints موحّدة لتسريع الصفحة الرئيسية (نداء واحد بدلاً من 5-7)
export const dashboardAPI = {
  student: () => api.get('/dashboard/student'),
  teacher: (month?: number, year?: number) =>
    api.get('/dashboard/teacher', { params: { month, year } }),
  admin: () => api.get('/dashboard/admin'),
};

export default api;
