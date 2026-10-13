"""🔎 أدوات قراءة للمرشد — كل أداة مقيدة بصلاحيات المستخدم الحالي ولا تعدّل أي بيانات"""
import json
import re
from typing import List, Optional

from bson import ObjectId
from fastapi import HTTPException

from models.permissions import UserRole

STAFF_ACADEMIC = {"admin", "dean", "department_head", "registrar", "registration_manager", "teacher", "university_president"}


def _oid(x: str) -> Optional[ObjectId]:
    return ObjectId(x) if x and ObjectId.is_valid(x) else None


def _rx(q: str) -> dict:
    return {"$regex": re.escape((q or "").strip()), "$options": "i"}


def _server():
    import sys
    for name in ("ahgaff_server", "_actual_server", "server", "__main__"):
        m = sys.modules.get(name)
        if m is not None and hasattr(m, "get_user_scope_filter"):
            return m
    raise RuntimeError("server module not found")


async def _scope(user: dict, kind: str) -> dict:
    return await _server().get_user_scope_filter(user, kind)


def _profile_view(p: dict) -> dict:
    return {k: p[k] for k in ("executed_count", "executed_hours", "unexcused_hours", "excused_hours", "pct_unexcused", "pct_total", "attendance_rate",
                              "limit_unexcused", "limit_total", "remaining_unexcused_hours", "status_ar", "exceeded_unexcused", "exceeded_total") if k in p}


async def _visible_course(db, user: dict, course_id: str) -> dict:
    oid = _oid(course_id)
    if not oid:
        raise ValueError("معرّف المقرر غير صالح")
    course = await db.courses.find_one({"_id": oid, **(await _scope(user, "courses"))})
    if not course:
        raise PermissionError("المقرر غير موجود أو خارج نطاق صلاحياتك")
    return course


# ---------------- الأدوات ----------------
async def search_courses(db, user: dict, query: str = "", limit: int = 8) -> dict:
    q = {"is_active": True, **(await _scope(user, "courses"))}
    if query.strip():
        q["$or"] = [{"name": _rx(query)}, {"code": _rx(query)}, {"teacher_name": _rx(query)}]
    if user["role"] in (UserRole.TEACHER, UserRole.STUDENT):
        sem = await db.semesters.find_one({"status": "active"}, {"_id": 1})
        if sem:
            q["semester_id"] = str(sem["_id"])
    rows = await db.courses.find(q, {"name": 1, "code": 1, "level": 1, "section": 1, "teacher_name": 1, "department_id": 1, "groups": 1, "semester_id": 1}).limit(limit).to_list(limit)
    if not rows and "semester_id" in q:
        q.pop("semester_id")
        rows = await db.courses.find(q, {"name": 1, "code": 1, "level": 1, "section": 1, "teacher_name": 1, "department_id": 1, "groups": 1, "semester_id": 1}).sort("_id", -1).limit(limit).to_list(limit)
    sems = {str(s["_id"]): s.get("name", "") for s in await db.semesters.find({}, {"name": 1}).to_list(50)}
    deps = {str(d["_id"]): d.get("name", "") for d in await db.departments.find({"_id": {"$in": [o for o in (_oid(r.get("department_id")) for r in rows) if o]}}, {"name": 1}).to_list(50)}
    return {"count": len(rows), "courses": [{"course_id": str(r["_id"]), "name": r.get("name"), "code": r.get("code"), "level": r.get("level"), "section": r.get("section"),
                                              "teacher": r.get("teacher_name"), "department": deps.get(str(r.get("department_id")), ""), "semester": sems.get(str(r.get("semester_id")), ""),
                                              "groups": [{"key": g.get("key"), "name": g.get("name"), "leader": g.get("teacher_name")} for g in (r.get("groups") or [])]} for r in rows]}


async def course_absence_stats(db, user: dict, course_id: str, group: Optional[str] = None, top: int = 10) -> dict:
    from services.absence_engine import course_profiles, course_limits
    from .course_groups_tools import teacher_group_keys
    course = await _visible_course(db, user, course_id)
    keys = await teacher_group_keys(db, course, user)
    if group and keys is not None and group not in keys:
        raise PermissionError("هذه المجموعة ليست ضمن مجموعاتك")
    enr_q = {"course_id": course_id}
    if group:
        enr_q["group"] = group
    elif keys is not None:
        enr_q["group"] = {"$in": keys}
    enrolls = await db.enrollments.find(enr_q, {"student_id": 1, "group": 1}).to_list(2000)
    sids = [e["student_id"] for e in enrolls if e.get("student_id")]
    limits = await course_limits(db, course)
    profiles = await course_profiles(db, course, sids, limits) if sids else {}
    students = {str(s["_id"]): s for s in await db.students.find({"_id": {"$in": [o for o in (_oid(s) for s in sids) if o]}}, {"full_name": 1, "name": 1, "student_id": 1}).to_list(2000)}
    by_status: dict = {}
    for p in profiles.values():
        by_status[p["status_ar"].split(" ·")[0]] = by_status.get(p["status_ar"].split(" ·")[0], 0) + 1
    ranked = sorted(profiles.items(), key=lambda kv: -max(kv[1]["pct_unexcused"] / (limits["unexcused_limit"] or 1), kv[1]["pct_total"] / (limits["total_limit"] or 1)))
    executed = await db.lectures.count_documents({"course_id": course_id, "status": "completed", **({"group": group} if group else {})})
    at_risk = [{"name": (students.get(sid) or {}).get("full_name") or (students.get(sid) or {}).get("name"), "student_number": (students.get(sid) or {}).get("student_id"),
                **_profile_view(p)} for sid, p in ranked[:top] if p["status"] in ("candidate", "danger", "warning")]
    return {"course": {"name": course.get("name"), "code": course.get("code"), "teacher": course.get("teacher_name"), "level": course.get("level")},
            "scope": f"المجموعة {group}" if group else (f"مجموعاتك {', '.join(keys)}" if keys else "كل طلاب المقرر"),
            "students_count": len(sids), "executed_lectures": executed, "limits": limits, "students_by_status": by_status,
            "at_risk_students": at_risk, "note": "النسب من ساعات المحاضرات المنفَّذة فقط؛ الحرمان قرار مجلس الكلية."}


async def search_students(db, user: dict, query: str, limit: int = 8) -> dict:
    if user["role"] == UserRole.STUDENT:
        raise PermissionError("البحث عن طلاب آخرين غير متاح للطالب")
    q = {**(await _scope(user, "students"))}
    if user["role"] == UserRole.TEACHER:
        cids = [str(c["_id"]) for c in await db.courses.find({**(await _scope(user, "courses"))}, {"_id": 1}).to_list(500)]
        sids = {e["student_id"] for e in await db.enrollments.find({"course_id": {"$in": cids}}, {"student_id": 1}).to_list(20000)}
        q["_id"] = {"$in": [o for o in (_oid(s) for s in sids) if o]}
    q["$or"] = [{"full_name": _rx(query)}, {"name": _rx(query)}, {"student_id": _rx(query)}]
    rows = await db.students.find(q, {"full_name": 1, "name": 1, "student_id": 1, "level": 1, "section": 1, "department_id": 1, "status": 1, "is_active": 1}).limit(limit).to_list(limit)
    deps = {str(d["_id"]): d.get("name", "") for d in await db.departments.find({"_id": {"$in": [o for o in (_oid(r.get("department_id")) for r in rows) if o]}}, {"name": 1}).to_list(50)}
    return {"count": len(rows), "students": [{"student_db_id": str(r["_id"]), "name": r.get("full_name") or r.get("name"), "student_number": r.get("student_id"), "level": r.get("level"),
                                               "section": r.get("section"), "department": deps.get(str(r.get("department_id")), ""), "status": r.get("status")} for r in rows]}


async def student_absence_summary(db, user: dict, student_db_id: str) -> dict:
    from services.absence_engine import student_profile
    from .course_groups_tools import teacher_group_keys
    if user["role"] == UserRole.STUDENT:
        return await my_absence_summary(db, user)
    oid = _oid(student_db_id)
    if not oid:
        found = await db.students.find_one({"student_id": student_db_id.strip()}, {"_id": 1})
        oid = found["_id"] if found else None
    if not oid:
        raise ValueError("الطالب غير موجود")
    st = await db.students.find_one({"_id": oid, **(await _scope(user, "students"))})
    if not st:
        raise PermissionError("الطالب خارج نطاق صلاحياتك")
    sid = str(oid)
    cids = [e["course_id"] for e in await db.enrollments.find({"student_id": sid}, {"course_id": 1}).to_list(200)]
    courses = await db.courses.find({"_id": {"$in": [o for o in (_oid(c) for c in cids) if o]}, "is_active": True, **(await _scope(user, "courses"))}).to_list(200)
    items = []
    for c in courses:
        try:
            keys = await teacher_group_keys(db, c, user)
        except HTTPException:
            continue
        if keys is not None:
            en = await db.enrollments.find_one({"course_id": str(c["_id"]), "student_id": sid}, {"group": 1})
            if not en or en.get("group") not in keys:
                continue
        p = await student_profile(db, sid, c)
        items.append({"course": c.get("name"), "code": c.get("code"), "teacher": c.get("teacher_name"), **_profile_view(p)})
    items.sort(key=lambda x: -max(x.get("pct_unexcused", 0) / (x.get("limit_unexcused") or 1), x.get("pct_total", 0) / (x.get("limit_total") or 1)))
    return {"student": {"name": st.get("full_name") or st.get("name"), "student_number": st.get("student_id"), "level": st.get("level"), "section": st.get("section"), "status": st.get("status")},
            "courses_count": len(items), "courses": items, "note": "تظهر فقط المقررات ضمن نطاق صلاحياتك"}


async def my_absence_summary(db, user: dict) -> dict:
    data = await _server().my_absence_profile(user)
    return {"student_number": data["student_id"], "rule": data["rule"], "courses": [{"course": c["course_name"], "code": c.get("course_code"), "teacher": c.get("teacher_name"), **_profile_view(c)} for c in data["courses"]]}


async def my_leaves(db, user: dict) -> dict:
    from .hr_leaves import my_leaves as _my
    data = await _my(None, user)
    reqs = [{"type": r.get("type_name") or r.get("leave_type_name") or r.get("type"), "from": r.get("start_date"), "to": r.get("end_date"), "days": r.get("working_days") or r.get("days"), "status": r.get("status_ar") or r.get("status")} for r in (data.get("requests") or [])[:10]]
    return {"profile": data.get("profile"), "balance": data.get("balance"), "recent_requests": reqs, "team_pending_count": len(data.get("team_pending") or [])}


async def my_courses_today(db, user: dict) -> dict:
    from datetime import datetime, timedelta, timezone
    today = (datetime.now(timezone.utc) + timedelta(hours=3)).strftime("%Y-%m-%d")
    q = {"date": today, "status": {"$ne": "cancelled"}}
    if user["role"] == UserRole.STUDENT:
        st = await db.students.find_one({"user_id": user["id"]}) or await db.students.find_one({"student_id": user.get("username")})
        if not st:
            raise ValueError("لا يوجد سجل طالب")
        cids = [e["course_id"] for e in await db.enrollments.find({"student_id": str(st["_id"])}, {"course_id": 1}).to_list(100)]
        q["course_id"] = {"$in": cids}
    else:
        cids = [str(c["_id"]) for c in await db.courses.find({**(await _scope(user, "courses")), "is_active": True}, {"_id": 1}).to_list(1000)]
        q["course_id"] = {"$in": cids}
    lecs = await db.lectures.find(q, {"course_id": 1, "start_time": 1, "end_time": 1, "room": 1, "status": 1, "group_name": 1}).sort("start_time", 1).limit(40).to_list(40)
    names = {str(c["_id"]): c.get("name") for c in await db.courses.find({"_id": {"$in": [o for o in (_oid(l["course_id"]) for l in lecs) if o]}}, {"name": 1}).to_list(100)}
    return {"date": today, "count": len(lecs), "lectures": [{"course": names.get(l["course_id"]), "time": f"{l.get('start_time')}–{l.get('end_time')}", "room": l.get("room"), "status": l.get("status"), "group": l.get("group_name")} for l in lecs]}


async def pending_student_excuses(db, user: dict) -> dict:
    from .student_excuses import list_excuses
    data = await list_excuses(status="pending", current_user=user)
    items = data.get("items") or []
    return {"pending_count": len(items), "pending_by_route": data.get("pending_by_route"),
            "sample": [{"student": i.get("student_name"), "type": i.get("excuse_type") or i.get("type"), "route": i.get("route"), "from": i.get("from_date") or i.get("start_date"), "to": i.get("to_date") or i.get("end_date")} for i in items[:8]]}


TOOLS = {
    "search_courses": {"fn": search_courses, "roles": STAFF_ACADEMIC, "desc": "البحث عن مقرر بالاسم أو الرمز أو اسم الأستاذ ضمن نطاق صلاحيات المستخدم (يعيد course_id والمجموعات).",
                       "params": {"query": {"type": "string", "description": "جزء من اسم المقرر أو رمزه أو اسم الأستاذ (قد يكون فارغاً لعرض أول المقررات)"}}},
    "course_absence_stats": {"fn": course_absence_stats, "roles": STAFF_ACADEMIC, "desc": "إحصائيات غياب مقرر وفق اللائحة: عدد المحاضرات المنفذة، توزيع الطلاب حسب الحالة، والطلاب المعرّضون للإنذار/الحرمان. استخدم search_courses أولاً للحصول على course_id.",
                             "params": {"course_id": {"type": "string"}, "group": {"type": "string", "description": "رمز المجموعة (اختياري)"}}, "required": ["course_id"]},
    "search_students": {"fn": search_students, "roles": STAFF_ACADEMIC, "desc": "البحث عن طالب بالاسم أو رقم القيد ضمن نطاق صلاحيات المستخدم.",
                        "params": {"query": {"type": "string"}}, "required": ["query"]},
    "student_absence_summary": {"fn": student_absence_summary, "roles": STAFF_ACADEMIC, "desc": "نسب غياب طالب في كل مقرراته (ضمن نطاق المستخدم) وفق اللائحة. يقبل student_db_id من نتائج البحث أو رقم القيد.",
                                "params": {"student_db_id": {"type": "string"}}, "required": ["student_db_id"]},
    "my_absence_summary": {"fn": my_absence_summary, "roles": {"student"}, "desc": "نسب غياب الطالب الحالي في كل مقرراته وما تبقى له قبل الإنذار/الحرمان.", "params": {}},
    "my_leaves": {"fn": my_leaves, "roles": None, "desc": "رصيد إجازات الموظف/الأستاذ الحالي وطلباته الأخيرة وعدد طلبات فريقه المعلّقة.", "params": {}},
    "my_courses_today": {"fn": my_courses_today, "roles": None, "desc": "محاضرات اليوم للمستخدم الحالي (مقرراته أو مقررات نطاقه).", "params": {}},
    "pending_student_excuses": {"fn": pending_student_excuses, "roles": {"admin", "dean", "registrar", "registration_manager", "department_head"}, "desc": "عدد طلبات أعذار غياب الطلاب المعلّقة التي تنتظر المراجعة ضمن صلاحيات المستخدم.", "params": {}},
}


def tools_for(user: dict) -> List[dict]:
    out = []
    for name, t in TOOLS.items():
        if t["roles"] is not None and user["role"] not in t["roles"] and user["role"] != UserRole.ADMIN:
            continue
        if name == "my_absence_summary" and user["role"] != UserRole.STUDENT:
            continue
        out.append({"type": "function", "function": {"name": name, "description": t["desc"],
                                                      "parameters": {"type": "object", "properties": t["params"], "required": t.get("required", [])}}})
    return out


TOOL_LABELS = {"search_courses": "يبحث عن المقرر", "course_absence_stats": "يقرأ إحصائيات غياب المقرر", "search_students": "يبحث عن الطالب", "student_absence_summary": "يقرأ نسب غياب الطالب",
               "my_absence_summary": "يقرأ نسب غيابك", "my_leaves": "يقرأ رصيد إجازاتك", "my_courses_today": "يقرأ محاضرات اليوم", "pending_student_excuses": "يعدّ الأعذار المعلّقة"}


async def run_tool(db, user: dict, name: str, args: dict) -> str:
    t = TOOLS.get(name)
    if not t or (t["roles"] is not None and user["role"] not in t["roles"] and user["role"] != UserRole.ADMIN):
        return json.dumps({"error": "الأداة غير متاحة لدورك"}, ensure_ascii=False)
    try:
        allowed = set(t["params"].keys())
        res = await t["fn"](db, user, **{k: v for k, v in (args or {}).items() if k in allowed})
        return json.dumps(res, ensure_ascii=False, default=str)[:12000]
    except (PermissionError, ValueError) as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False)
    except HTTPException as e:
        return json.dumps({"error": str(e.detail)}, ensure_ascii=False)
    except Exception as e:
        import logging
        logging.exception(f"assistant tool {name} failed: {e}")
        return json.dumps({"error": f"تعذر تنفيذ الأداة: {type(e).__name__}: {str(e)[:120]}"}, ensure_ascii=False)
