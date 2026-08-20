"""
نماذج المعلمين - Teachers Models
"""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class TeacherBase(BaseModel):
    teacher_id: str
    full_name: str
    department_id: Optional[str] = None
    faculty_id: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    specialization: Optional[str] = None
    academic_title: Optional[str] = None
    teaching_load: Optional[int] = None
    weekly_hours: Optional[int] = 12

class TeacherCreate(TeacherBase):
    pass

class TeacherUpdate(BaseModel):
    teacher_id: Optional[str] = None
    full_name: Optional[str] = None
    department_id: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    specialization: Optional[str] = None
    academic_title: Optional[str] = None
    teaching_load: Optional[int] = None
    weekly_hours: Optional[int] = None

class TeacherResponse(TeacherBase):
    id: str
    user_id: Optional[str] = None
    created_at: datetime
    is_active: bool = True
