"""
نماذج المحاضرات - Lectures Models
"""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class LectureStatus:
    SCHEDULED = "scheduled"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    ABSENT = "absent"

# المحاضرات الفعّالة فقط - غياب الأستاذ والملغاة لا تُحسب على الطالب
ACTIVE_LECTURE_STATUSES = [LectureStatus.SCHEDULED, LectureStatus.COMPLETED]

class LectureCreate(BaseModel):
    course_id: str
    date: str
    start_time: str
    end_time: str
    room: Optional[str] = ""
    notes: Optional[str] = ""
    force: Optional[bool] = False  # تجاوز تحذير تعارض الشعب

class LectureUpdate(BaseModel):
    date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    room: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    cancellation_reason: Optional[str] = None  # سبب الإلغاء (يُستخدم عند تحويل الحالة إلى cancelled)
    apply_to_shared: Optional[bool] = None  # 🔗 تطبيق الإلغاء/التفعيل على الشعب المشتركة (افتراضياً نعم)
    reschedule_note: Optional[str] = None  # ملاحظة عند إعادة الجدولة (اختياري)
    lesson_title: Optional[str] = None  # عنوان الدرس المُنجز (لربط الخطة الدراسية)
    plan_topic_id: Optional[str] = None  # معرف موضوع من الخطة الدراسية

class LectureResponse(BaseModel):
    id: str
    course_id: str
    date: str
    start_time: str
    end_time: str
    room: str
    status: str
    notes: str
    created_at: datetime

class GenerateLecturesRequest(BaseModel):
    course_id: str
    start_date: str
    end_date: str
    day_of_week: int
    start_time: str
    end_time: str
    room: Optional[str] = ""
