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
    
    // إذا كنا على Railway (ahgaffweb)، استخدم Backend URL الثابت
    if (origin.includes('railway.app')) {
      return 'https://web-production-1ebc5.up.railway.app';
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

// Departments API
export const departmentsAPI = {
  create: (data: any) => api.post('/departments', data),
  getAll: () => api.get('/departments'),
  getStats: () => api.get('/departments/stats'),
  getDetails: (id: string) => api.get(`/departments/${id}/details`),
  update: (id: string, data: any) => api.put(`/departments/${id}`, data),
  delete: (id: string) => api.delete(`/departments/${id}`),
};

// Students API
export const studentsAPI = {
  create: (data: any) => api.post('/students', data),
  getAll: (params?: { department_id?: string; level?: number; section?: string }) =>
    api.get('/students', { params }),
  getById: (id: string) => api.get(`/students/${id}`),
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
};

// Teachers API (المعلمين)
export const teachersAPI = {
  create: (data: any) => api.post('/teachers', data),
  getAll: (params?: { department_id?: string }) =>
    api.get('/teachers', { params }),
  getById: (id: string) => api.get(`/teachers/${id}`),
  getCourses: (teacherId: string) => api.get(`/teachers/${teacherId}/courses`),
  update: (id: string, data: any) => api.put(`/teachers/${id}`, data),
  delete: (id: string) => api.delete(`/teachers/${id}`),
  // تفعيل/إلغاء تفعيل حساب المعلم
  activateAccount: (teacherId: string) =>
    api.post(`/teachers/${teacherId}/activate`),
  deactivateAccount: (teacherId: string) =>
    api.post(`/teachers/${teacherId}/deactivate`),
  resetPassword: (teacherId: string) =>
    api.post(`/teachers/${teacherId}/reset-password`),
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
  // تصدير التقارير
  exportWarningsExcel: (params?: { department_id?: string }) =>
    api.get('/export/report/warnings/excel', { params, responseType: 'blob' }),
  exportAbsentStudentsExcel: (params?: { department_id?: string; course_id?: string; min_absence_rate?: number }) =>
    api.get('/export/report/absent-students/excel', { params, responseType: 'blob' }),
  exportTeacherWorkloadExcel: (params?: { teacher_id?: string; start_date?: string; end_date?: string }) =>
    api.get('/export/report/teacher-workload/excel', { params, responseType: 'blob' }),
  exportDailyExcel: (params?: { date?: string; department_id?: string }) =>
    api.get('/export/report/daily/excel', { params, responseType: 'blob' }),
  exportStudentReportExcel: (studentId: string) =>
    api.get(`/export/report/student/${studentId}/excel`, { responseType: 'blob' }),
  exportCourseReportExcel: (courseId: string) =>
    api.get(`/export/report/course/${courseId}/excel`, { responseType: 'blob' }),
  exportAttendanceOverviewExcel: (params?: { department_id?: string }) =>
    api.get('/export/report/attendance-overview/excel', { params, responseType: 'blob' }),
};

// Export API - returns blob for file download
export const exportAPI = {
  getStudentsTemplate: () => 
    api.get('/template/students', { responseType: 'blob' }),
  
  exportStudents: (departmentId?: string) => 
    api.get('/export/students', { 
      params: departmentId ? { department_id: departmentId } : {},
      responseType: 'blob' 
    }),
  
  exportStudentsPDF: (departmentId?: string) => 
    api.get('/export/students/pdf', { 
      params: departmentId ? { department_id: departmentId } : {},
      responseType: 'blob' 
    }),
  
  exportAttendance: (courseId: string) => 
    api.get(`/export/attendance/${courseId}`, { responseType: 'blob' }),
  
  exportAttendancePDF: (courseId: string) => 
    api.get(`/export/attendance/${courseId}/pdf`, { responseType: 'blob' }),
  
  exportDeptReport: (deptId: string) => 
    api.get(`/export/report/${deptId}`, { responseType: 'blob' }),
  
  exportDeptReportPDF: (deptId: string) => 
    api.get(`/export/report/${deptId}/pdf`, { responseType: 'blob' }),
  
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
  
  getByCourse: (courseId: string) => 
    api.get(`/lectures/${courseId}`),
  
  getAttendanceStatus: (lectureId: string) =>
    api.get(`/lectures/${lectureId}/attendance-status`),
  
  getDetails: (lectureId: string) => 
    api.get(`/lectures/${lectureId}/details`),
  
  create: (courseId: string, data: { date: string; start_time: string; end_time: string; room?: string; notes?: string }) =>
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
};

export default api;
