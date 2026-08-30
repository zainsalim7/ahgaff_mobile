"""🔐 Secure Read-Only Integration API — مزامنة البيانات الأكاديمية لنظام النتائج
- مصادقة بمفتاح خدمة: Authorization: Bearer SERVICE_API_KEY (من متغيرات البيئة)
- قراءة فقط (GET) — لا عمليات كتابة إطلاقاً
- كل نقطة تدعم: updated_since / pagination (page, page_size) / active_only
- Rate Limiting + Logging بدون تسجيل المفتاح
"""
import os
import time
import hashlib
import logging
import secrets as _secrets
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from bson import ObjectId

from .deps import get_db

logger = logging.getLogger("integration_api")
router = APIRouter(prefix="/integration", tags=["Integration API"])

API_VERSION = "1.0"
SYSTEM_NAME = "Ahgaff Attendance System"
RATE_LIMIT_PER_MINUTE = 120
_rate_windows: dict = {}


# ==================== المصادقة + Rate Limiting ====================

async def require_service_key(request: Request, authorization: Optional[str] = Header(None)) -> str:
    expected = os.environ.get("SERVICE_API_KEY")
    if not expected:
        raise HTTPException(status_code=503, detail="Integration API disabled (SERVICE_API_KEY not configured)")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    if not _secrets.compare_digest(token, expected):
        # لا نسجل المفتاح المرسل — فقط مصدر المحاولة
        logger.warning("integration_api: invalid service key attempt from %s on %s",
                       request.client.host if request.client else "?", request.url.path)
        raise HTTPException(status_code=403, detail="Invalid service key")

    # Rate limiting — الهوية = hash قصير للمفتاح (لا يُسجل المفتاح نفسه)
    ident = hashlib.sha256(token.encode()).hexdigest()[:12]
    now = time.time()
    window = _rate_windows.setdefault(ident, [])
    window[:] = [t for t in window if now - t < 60]
    if len(window) >= RATE_LIMIT_PER_MINUTE:
        raise HTTPException(status_code=429, detail="Rate limit exceeded (120 req/min)")
    window.append(now)

    logger.info("integration_api: key=%s %s %s", ident, request.method, request.url.path)
    return ident


# ==================== أدوات مساعدة ====================

def _iso(v):
    if isinstance(v, datetime):
        return v.isoformat()
    return v


def _parse_since(updated_since: Optional[str]):
    if not updated_since:
        return None
    try:
        return datetime.fromisoformat(updated_since.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=422, detail="updated_since must be ISO-8601 (e.g. 2026-01-01T00:00:00)")


def _updated_filter(updated_since: Optional[str], fields=("updated_at", "created_at")) -> dict:
    """فلتر updated_since متسامح مع نوعي التخزين (نص ISO أو BSON datetime)"""
    if not updated_since:
        return {}
    dt = _parse_since(updated_since)
    iso = dt.isoformat() if dt else updated_since
    ors = []
    for f in fields:
        ors.append({f: {"$gte": dt}})
        ors.append({f: {"$gte": iso}})
    return {"$or": ors}


async def _paged(col, query: dict, page: int, page_size: int, mapper, sort_field: str = "_id"):
    total = await col.count_documents(query)
    docs = await col.find(query).sort(sort_field, 1).skip((page - 1) * page_size).limit(page_size).to_list(page_size)
    return {
        "items": [mapper(d) for d in docs],
        "page": page,
        "page_size": page_size,
        "total": total,
        "has_more": page * page_size < total,
    }


def _common_params(
    updated_since: Optional[str] = Query(None, description="ISO-8601 — يرجع السجلات المحدّثة/المنشأة بعده"),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
    active_only: bool = Query(False),
):
    return {"updated_since": updated_since, "page": page, "page_size": page_size, "active_only": active_only}


# ==================== Health ====================

@router.get("/health")
async def integration_health():
    return {
        "status": "ok",
        "system_name": SYSTEM_NAME,
        "api_version": API_VERSION,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ==================== Academic Years ====================

@router.get("/academic-years")
async def integration_academic_years(p: dict = Depends(_common_params), _k: str = Depends(require_service_key)):
    db = get_db()
    sems = await db.semesters.find({}).to_list(2000)
    years: dict = {}
    for s in sems:
        y = s.get("academic_year") or ""
        if not y:
            continue
        info = years.setdefault(y, {"semesters": 0, "has_active": False})
        info["semesters"] += 1
        if s.get("status") == "active":
            info["has_active"] = True
    items = [
        {
            "external_academic_year_id": f"ay-{y}",
            "name": y,
            "semesters_count": info["semesters"],
            "is_active": info["has_active"],
        }
        for y, info in sorted(years.items())
        if (not p["active_only"]) or info["has_active"]
    ]
    total = len(items)
    start = (p["page"] - 1) * p["page_size"]
    return {"items": items[start:start + p["page_size"]], "page": p["page"], "page_size": p["page_size"],
            "total": total, "has_more": p["page"] * p["page_size"] < total}


# ==================== Semesters ====================

@router.get("/semesters")
async def integration_semesters(p: dict = Depends(_common_params), _k: str = Depends(require_service_key)):
    db = get_db()
    q = dict(_updated_filter(p["updated_since"]))
    if p["active_only"]:
        q["status"] = "active"

    def mapper(s):
        return {
            "external_semester_id": str(s["_id"]),
            "name": s.get("name", ""),
            "academic_year_id": f"ay-{s.get('academic_year', '')}" if s.get("academic_year") else None,
            "academic_year": s.get("academic_year"),
            "status": s.get("status"),
            "start_date": s.get("start_date"),
            "end_date": s.get("end_date"),
            "created_at": _iso(s.get("created_at")),
            "updated_at": _iso(s.get("updated_at")),
        }

    return await _paged(db.semesters, q, p["page"], p["page_size"], mapper)


# ==================== Colleges (الكليات) ====================

@router.get("/colleges")
async def integration_colleges(p: dict = Depends(_common_params), _k: str = Depends(require_service_key)):
    db = get_db()
    q = dict(_updated_filter(p["updated_since"]))

    def mapper(f):
        return {
            "external_college_id": str(f["_id"]),
            "code": f.get("code") or f.get("numeric_code"),
            "name": f.get("name", ""),
            "created_at": _iso(f.get("created_at")),
            "updated_at": _iso(f.get("updated_at")),
        }

    return await _paged(db.faculties, q, p["page"], p["page_size"], mapper)


# ==================== Departments (الأقسام) ====================

@router.get("/departments")
async def integration_departments(p: dict = Depends(_common_params), _k: str = Depends(require_service_key)):
    db = get_db()
    q = dict(_updated_filter(p["updated_since"]))

    def mapper(d):
        return {
            "external_department_id": str(d["_id"]),
            "college_id": d.get("faculty_id"),
            "code": d.get("code"),
            "name": d.get("name", ""),
            "created_at": _iso(d.get("created_at")),
            "updated_at": _iso(d.get("updated_at")),
        }

    return await _paged(db.departments, q, p["page"], p["page_size"], mapper)


# ==================== Programs (البرامج — مشتقة من الأقسام) ====================

@router.get("/programs")
async def integration_programs(p: dict = Depends(_common_params), _k: str = Depends(require_service_key)):
    db = get_db()
    q = dict(_updated_filter(p["updated_since"]))

    def mapper(d):
        return {
            "external_program_id": f"prog-{str(d['_id'])}",
            "program_code": d.get("default_program_code"),
            "name": d.get("name", ""),
            "department_id": str(d["_id"]),
            "college_id": d.get("faculty_id"),
            "created_at": _iso(d.get("created_at")),
            "updated_at": _iso(d.get("updated_at")),
        }

    return await _paged(db.departments, q, p["page"], p["page_size"], mapper)


# ==================== Levels (المستويات) ====================

@router.get("/levels")
async def integration_levels(p: dict = Depends(_common_params), _k: str = Depends(require_service_key)):
    db = get_db()
    levels = set()
    for lv in await db.courses.distinct("level"):
        if lv:
            levels.add(int(lv))
    for lv in await db.students.distinct("level"):
        if lv:
            levels.add(int(lv))
    items = [
        {"external_level_id": f"level-{n}", "level_number": n, "name": f"المستوى {n}"}
        for n in sorted(levels)
    ]
    total = len(items)
    start = (p["page"] - 1) * p["page_size"]
    return {"items": items[start:start + p["page_size"]], "page": p["page"], "page_size": p["page_size"],
            "total": total, "has_more": p["page"] * p["page_size"] < total}


# ==================== Courses (المقررات) ====================

@router.get("/courses")
async def integration_courses(p: dict = Depends(_common_params), _k: str = Depends(require_service_key)):
    db = get_db()
    q = dict(_updated_filter(p["updated_since"]))
    if p["active_only"]:
        q["is_active"] = True

    def mapper(c):
        dept = c.get("department_id")
        lvl = c.get("level")
        return {
            "external_course_id": str(c["_id"]),
            "course_code": c.get("code"),
            "course_name_ar": c.get("name", ""),
            "course_name_en": c.get("name_en"),
            "credit_hours": c.get("credit_hours"),
            "department_id": dept,
            "program_id": f"prog-{dept}" if dept else None,
            "level_id": f"level-{lvl}" if lvl else None,
            "level_number": lvl,
            "section": c.get("section"),
            "semester_id": str(c["semester_id"]) if c.get("semester_id") else None,
            "academic_year": c.get("academic_year"),
            "teacher_id": c.get("teacher_id"),
            "status": "active" if c.get("is_active", True) else "inactive",
            "created_at": _iso(c.get("created_at")),
            "updated_at": _iso(c.get("updated_at")),
        }

    return await _paged(db.courses, q, p["page"], p["page_size"], mapper)


# ==================== Students (الطلاب) ====================

@router.get("/students")
async def integration_students(p: dict = Depends(_common_params), _k: str = Depends(require_service_key)):
    db = get_db()
    q = dict(_updated_filter(p["updated_since"], fields=("updated_at", "created_at", "status_changed_at")))
    if p["active_only"]:
        q["is_active"] = True

    def mapper(s):
        dept = s.get("department_id")
        lvl = s.get("level")
        return {
            "external_student_id": str(s["_id"]),
            "student_number": s.get("student_id"),
            "reference_number": s.get("reference_number"),
            "full_name": s.get("full_name", ""),
            "gender": s.get("gender"),
            "status": s.get("status") or ("active" if s.get("is_active", True) else "inactive"),
            "college_id": s.get("faculty_id"),
            "department_id": dept,
            "program_id": f"prog-{dept}" if dept else None,
            "program_code": s.get("program_code"),
            "level_id": f"level-{lvl}" if lvl else None,
            "level_number": lvl,
            "section": s.get("section"),
            "admission_year": s.get("enrollment_year"),
            "is_alumni": bool(s.get("is_alumni")),
            "created_at": _iso(s.get("created_at")),
            "updated_at": _iso(s.get("updated_at") or s.get("status_changed_at")),
        }

    return await _paged(db.students, q, p["page"], p["page_size"], mapper)


# ==================== Enrollments (التسجيلات) ====================

@router.get("/enrollments")
async def integration_enrollments(p: dict = Depends(_common_params), _k: str = Depends(require_service_key)):
    db = get_db()
    q = dict(_updated_filter(p["updated_since"], fields=("updated_at", "enrolled_at")))
    if p["active_only"]:
        inactive_ids = [str(c["_id"]) for c in await db.courses.find({"is_active": False}, {"_id": 1}).to_list(5000)]
        if inactive_ids:
            q["course_id"] = {"$nin": inactive_ids}

    # خرائط الفصل/العام لكل مقرر (لملء academic_year_id عند غيابه على التسجيل)
    course_sem = {str(c["_id"]): (str(c["semester_id"]) if c.get("semester_id") else None, c.get("academic_year"))
                  for c in await db.courses.find({}, {"semester_id": 1, "academic_year": 1}).to_list(10000)}
    sem_year = {str(s["_id"]): s.get("academic_year") for s in await db.semesters.find({}, {"academic_year": 1}).to_list(2000)}

    def mapper(e):
        cid = e.get("course_id")
        sem_id = str(e["semester_id"]) if e.get("semester_id") else (course_sem.get(cid, (None, None))[0])
        year = sem_year.get(sem_id) or course_sem.get(cid, (None, None))[1]
        return {
            "external_enrollment_id": str(e["_id"]),
            "student_id": e.get("student_id"),
            "course_id": cid,
            "semester_id": sem_id,
            "academic_year_id": f"ay-{year}" if year else None,
            "registration_status": "registered",
            "created_at": _iso(e.get("enrolled_at")),
            "updated_at": _iso(e.get("updated_at")),
        }

    return await _paged(db.enrollments, q, p["page"], p["page_size"], mapper)
