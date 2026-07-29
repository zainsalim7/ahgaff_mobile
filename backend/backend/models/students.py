"""
نماذج الطلاب - Students Models
"""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class StudentBase(BaseModel):
    student_id: str
    full_name: str
    department_id: str
    faculty_id: Optional[str] = None
    level: int
    section: str
    phone: Optional[str] = None
    email: Optional[str] = None
    nationality: Optional[str] = None
    program_code: Optional[str] = None  # B/M/D/E/P
    enrollment_year: Optional[str] = None  # 25, 26, 27...

class StudentCreate(StudentBase):
    password: Optional[str] = None

class StudentResponse(StudentBase):
    id: str
    user_id: Optional[str] = None
    qr_code: str
    created_at: datetime
    is_active: bool = True
    reference_number: Optional[str] = None
    # حقول حالة الطالب (active/repeat/graduated/expelled/frozen)
    status: Optional[str] = None
    status_changed_at: Optional[str] = None
    status_reason: Optional[str] = None
    graduation_date: Optional[str] = None
    graduated_from_level: Optional[int] = None
    expulsion_date: Optional[str] = None
    frozen_at: Optional[str] = None
