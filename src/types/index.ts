export interface User {
  id: string;
  username: string;
  full_name: string;
  role: 'admin' | 'teacher' | 'student' | 'employee';
  email?: string;
  phone?: string;
  created_at: string;
  is_active: boolean;
  permissions?: string[];
  must_change_password?: boolean;
  student_id?: string;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  description?: string;
  created_at: string;
}

export interface Student {
  id: string;
  student_id: string;
  full_name: string;
  department_id: string;
  level: number;
  section: string;
  phone?: string;
  email?: string;
  user_id?: string;
  qr_code: string;
  created_at: string;
  is_active: boolean;
}

export interface Course {
  id: string;
  name: string;
  code: string;
  department_id: string;
  teacher_id: string;
  level: number;
  section: string;
  semester: string;
  academic_year: string;
  created_at: string;
  is_active: boolean;
}

export interface AttendanceRecord {
  id: string;
  course_id: string;
  student_id: string;
  student_name?: string;
  student_number?: string;
  course_name?: string;
  status: 'present' | 'absent' | 'late' | 'excused';
  date: string;
  method: 'manual' | 'qr';
  notes?: string;
}

export interface AttendanceStats {
  total_sessions: number;
  present_count: number;
  absent_count: number;
  late_count: number;
  excused_count: number;
  attendance_rate: number;
}

export interface OfflineAttendance {
  local_id: string;
  course_id: string;
  student_id: string;
  status: string;
  date: string;
  method: string;
  notes?: string;
  synced: boolean;
}
