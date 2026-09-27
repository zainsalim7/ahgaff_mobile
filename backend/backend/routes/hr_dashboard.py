"""قسم شؤون الموظفين في لوحة القيادة: الأعداد الثابتة + إحصاءات الفترة + مخطط الدوام الإداري"""
import logging
from collections import defaultdict
from datetime import date, timedelta

from .hr_common import get_hr_settings, is_work_day, _today, enrich_employee_refs

ACTIVE_Q = {"status": {"$nin": ["ended", "suspended"]}}
PRESENT_STATUSES = ("present", "late", "half_day", "mission")
CATEGORY_LABELS = {"academic": "أكاديمي", "administrative": "إداري", "technical": "فني", "service": "خدمات"}
CONTRACT_LABELS = {"permanent": "دائم", "contract": "متعاقد", "part_time": "جزئي", "hourly": "بالساعة", "visiting": "متعاون"}
STATUS_LABELS = {"probation": "تحت التجربة", "active": "على رأس العمل", "leave": "في إجازة", "suspended": "موقوف", "ended": "منتهية خدمته"}
UNIT_TYPE_LABELS = {"presidency": "رئاسة", "faculty": "كلية", "department": "قسم", "administration": "إدارة", "office": "مكتب"}
AR_SHORT = {5: "سبت", 6: "أحد", 0: "اثنين", 1: "ثلاثاء", 2: "أربعاء", 3: "خميس", 4: "جمعة"}


def _rate(ok: int, bad: int):
    t = ok + bad
    return round(ok / t * 100, 1) if t else None


def _cat_bucket():
    return {"total": 0, "academic": 0, "administrative": 0, "other": 0}


def _add_cat(b: dict, cat: str):
    b["total"] += 1
    b["academic" if cat == "academic" else "administrative" if cat == "administrative" else "other"] += 1


async def _headcount(db, emps: list, units: dict, root_id=None) -> dict:
    """الأرقام الثابتة: الإجمالي حسب الفئة/العقد/الحالة، وموظفو كل وحدة (مع فروعها) مقسّمين أكاديمي/إداري/غيرهم.
    بدون نطاق: الوحدات الرئيسية (الجذر + أبنائه). مع نطاق: الوحدات الفرعية المباشرة للوحدة المختارة + «مباشرة في الوحدة»."""
    children = defaultdict(list)
    for uid, u in units.items():
        if u.get("parent_id") in units:
            children[u["parent_id"]].append(uid)
    if root_id:
        heads = set(children.get(root_id, []))
    else:
        roots = {uid for uid, u in units.items() if u.get("parent_id") not in units}
        heads = roots | {c for r in roots for c in children.get(r, [])}

    def head_of(uid):
        seen = set()
        while uid in units and uid not in seen:
            seen.add(uid)
            if uid in heads:
                return uid
            uid = units[uid].get("parent_id")
        return None

    by_cat = defaultdict(int); by_contract = defaultdict(int); by_status = defaultdict(int)
    per_unit = defaultdict(_cat_bucket); own_unit = defaultdict(_cat_bucket); unlinked = _cat_bucket(); direct = _cat_bucket()
    scope_ids = _subtree(units, root_id) if root_id else None
    all_q = {"org_unit_id": {"$in": list(scope_ids)}} if scope_ids is not None else {}
    for e in await db.employees.find(all_q, {"status": 1}).to_list(20000):
        by_status[e.get("status") or "active"] += 1
    for e in emps:
        cat = e.get("category") or "administrative"
        by_cat[cat] += 1
        by_contract[e.get("contract_type") or "permanent"] += 1
        uid = e.get("org_unit_id")
        if not uid or uid not in units:
            _add_cat(unlinked, cat); continue
        _add_cat(own_unit[uid], cat)
        h = head_of(uid)
        if h:
            _add_cat(per_unit[h], cat)
        elif root_id and uid == root_id:
            _add_cat(direct, cat)

    def unit_row(uid, b):
        u = units[uid]
        return {"id": uid, "name": u.get("name", ""), "type": u.get("type"), "type_label": UNIT_TYPE_LABELS.get(u.get("type"), u.get("type") or ""),
                "sub_units": len(children.get(uid, [])), **b}
    rows = sorted((unit_row(uid, b) for uid, b in per_unit.items()), key=lambda r: (-r["total"], r["name"]))
    if direct["total"]:
        rows.insert(0, {"id": root_id, "name": f"مباشرة في {units[root_id].get('name', '')}", "type": None, "type_label": "", "sub_units": 0, **direct})
    if unlinked["total"]:
        rows.append({"id": None, "name": "غير مرتبطين بوحدة", "type": None, "type_label": "", "sub_units": 0, **unlinked})
    by_unit_type = defaultdict(_cat_bucket)
    for uid, b in own_unit.items():
        t = units[uid].get("type") or "office"
        for k in ("total", "academic", "administrative", "other"):
            by_unit_type[t][k] += b[k]
    total_all = sum(by_status.values())
    return {
        "total_active": len(emps), "total_all": total_all,
        "by_category": [{"key": k, "label": CATEGORY_LABELS.get(k, k), "count": by_cat.get(k, 0)} for k in ("academic", "administrative", "technical", "service")],
        "by_contract": [{"key": k, "label": CONTRACT_LABELS.get(k, k), "count": v} for k, v in sorted(by_contract.items(), key=lambda x: -x[1])],
        "by_status": [{"key": k, "label": STATUS_LABELS.get(k, k), "count": by_status.get(k, 0)} for k in ("active", "probation", "leave", "suspended", "ended") if by_status.get(k)],
        "by_unit": rows,
        "by_unit_type": [{"key": k, "label": UNIT_TYPE_LABELS.get(k, k), **b} for k, b in sorted(by_unit_type.items(), key=lambda x: -x[1]["total"])],
        "units_count": len(scope_ids) if scope_ids is not None else len(units), "units_with_staff": len(own_unit),
    }


def _subtree(units: dict, root_id: str) -> set:
    out, stack = set(), [root_id]
    while stack:
        u = stack.pop()
        if u in out:
            continue
        out.add(u)
        stack.extend(uid for uid, x in units.items() if x.get("parent_id") == u)
    return out


async def _period_stats(db, emps: list, d_from: date, d_to: date, settings: dict, period: str, units: dict, scoped: bool) -> dict:
    s_from, s_to = d_from.isoformat(), d_to.isoformat()
    today = _today()
    emp_map = {str(e["_id"]): e for e in emps}
    unit_names = {uid: u.get("name", "") for uid, u in units.items()}
    att_q = {"date": {"$gte": s_from, "$lte": s_to}}
    if scoped:
        att_q["employee_id"] = {"$in": list(emp_map)}
    recs = await db.hr_attendance.find(att_q, {"employee_id": 1, "date": 1, "status": 1, "late_minutes": 1}).to_list(100000)

    work_days = [d_from + timedelta(days=i) for i in range((d_to - d_from).days + 1)]
    work_days = [d for d in work_days if is_work_day(d, settings) and d.isoformat() <= today]

    counts = defaultdict(int); late_minutes = 0
    per_emp = defaultdict(lambda: {"present": 0, "late": 0, "absent": 0, "late_minutes": 0})
    per_unit = defaultdict(lambda: {"present": 0, "late": 0, "absent": 0, "late_minutes": 0})
    by_day = defaultdict(lambda: {"present": 0, "late": 0, "absent": 0})
    for r in recs:
        st = r.get("status"); lm = int(r.get("late_minutes") or 0)
        counts[st] += 1; late_minutes += lm
        eid = r.get("employee_id"); e = emp_map.get(eid)
        uid = (e or {}).get("org_unit_id") or ""
        if st in PRESENT_STATUSES:
            k = "late" if st == "late" else "present"
            by_day[r["date"]][k] += 1
            if e:
                per_emp[eid][k] += 1; per_emp[eid]["late_minutes"] += lm
                per_unit[uid][k] += 1; per_unit[uid]["late_minutes"] += lm
        elif st == "absent":
            by_day[r["date"]]["absent"] += 1
            if e:
                per_emp[eid]["absent"] += 1; per_unit[uid]["absent"] += 1

    attended = sum(counts.get(s, 0) for s in PRESENT_STATUSES)
    absent = counts.get("absent", 0)
    expected = len(emps) * len(work_days)
    unmarked = max(0, expected - attended - absent - counts.get("excused", 0) - counts.get("leave", 0) - counts.get("holiday", 0))

    if period == "day":
        points = [{"label": unit_names.get(uid, "غير مرتبط") if uid else "غير مرتبط", "present": b["present"], "late": b["late"], "absent": b["absent"],
                   "rate": _rate(b["present"] + b["late"], b["absent"])} for uid, b in per_unit.items()]
        points.sort(key=lambda p: -(p["present"] + p["late"] + p["absent"]))
        points = points[:12]; group_by = "unit"
    else:
        points = [{"label": AR_SHORT[d.weekday()] + (f" {d.day}" if period == "month" else ""), "date": d.isoformat(), **by_day[d.isoformat()],
                   "rate": _rate(by_day[d.isoformat()]["present"] + by_day[d.isoformat()]["late"], by_day[d.isoformat()]["absent"])} for d in work_days]
        group_by = "date"
    for p in points:
        p["lectures"] = p["completed"] = p["present"] + p["late"] + p["absent"]

    def emp_row(eid, b):
        e = emp_map[eid]
        return {"employee_id": eid, "name": e.get("full_name", ""), "unit": unit_names.get(e.get("org_unit_id") or "", ""), "category": CATEGORY_LABELS.get(e.get("category"), ""),
                **b, "rate": _rate(b["present"] + b["late"], b["absent"])}
    min_recs = {"day": 1, "week": 2}.get(period, 3)
    ranked = [emp_row(eid, b) for eid, b in per_emp.items() if b["present"] + b["late"] + b["absent"] >= min_recs]
    ranked.sort(key=lambda r: (-(r["rate"] or 0), r["late"], r["late_minutes"]))
    top = ranked[:5]
    bottom = sorted([r for r in ranked if r["absent"] or r["late"]], key=lambda r: ((r["rate"] or 0), -r["absent"], -r["late_minutes"]))[:5]
    units_rows = sorted([{"unit": unit_names.get(uid, "غير مرتبط") if uid else "غير مرتبط", **b, "rate": _rate(b["present"] + b["late"], b["absent"])}
                         for uid, b in per_unit.items()], key=lambda r: (-r["absent"], -r["late_minutes"]))[:8]

    leave_q = {"status": "approved", "start_date": {"$lte": s_to}, "end_date": {"$gte": s_from}}
    task_scope = {}
    if scoped:
        leave_q["employee_id"] = {"$in": list(emp_map)}
        task_scope = {"assignee_employee_id": {"$in": list(emp_map)}}
    leaves = await db.leave_requests.find(leave_q, {"days": 1, "type": 1, "employee_id": 1}).to_list(5000)
    from .hr_leaves import LEAVE_TYPES
    leave_types = defaultdict(int)
    for l in leaves:
        leave_types[LEAVE_TYPES.get(l.get("type"), l.get("type") or "")] += 1
    dt_from, dt_to = s_from, (d_to + timedelta(days=1)).isoformat()
    tasks_done = await db.hr_tasks.count_documents({**task_scope, "status": "done", "completed_at": {"$gte": dt_from, "$lt": dt_to}})
    tasks_created = await db.hr_tasks.count_documents({**task_scope, "created_at": {"$gte": dt_from, "$lt": dt_to}})
    return {
        "work_days": len(work_days), "expected": expected, "attended": attended, "present": counts.get("present", 0), "late": counts.get("late", 0),
        "half_day": counts.get("half_day", 0), "mission": counts.get("mission", 0), "absent": absent, "excused": counts.get("excused", 0), "unmarked": unmarked,
        "late_minutes": late_minutes, "late_hours": round(late_minutes / 60, 1), "commitment_rate": _rate(attended, absent),
        "leaves_approved": len(leaves), "leave_days": sum(int(l.get("days") or 0) for l in leaves),
        "leave_types": [{"label": k, "count": v} for k, v in sorted(leave_types.items(), key=lambda x: -x[1])],
        "tasks_done": tasks_done, "tasks_created": tasks_created,
        "chart": {"group_by": group_by, "points": points}, "top_employees": top, "bottom_employees": bottom, "units_attendance": units_rows,
    }


def _hr_alerts(t: dict, hc, p) -> list:
    """تنبيهات إدارية بنفس شكل تنبيهات اللوحة الأكاديمية"""
    def lvl(n, hi="danger"):
        return hi if n else "ok"
    out = [
        {"key": "hr_absent", "level": lvl(len(t["absent_today"])), "count": len(t["absent_today"]), "title": "غائبون اليوم بلا عذر", "hint": "اليوم عطلة" if not t["is_work_day"] else f"{t['unmarked_today']} لم يُسجَّل دوامهم", "items": t["absent_today"], "route": "/hr-attendance"},
        {"key": "hr_pending_leaves", "level": lvl(t["pending_leaves_count"], "warning"), "count": t["pending_leaves_count"], "title": "طلبات إجازة بانتظار قرار", "hint": "لدى المدير المباشر أو شؤون الموظفين", "items": t["pending_leaves"], "route": "/hr-leaves"},
        {"key": "hr_overdue_tasks", "level": lvl(t["overdue_tasks"]), "count": t["overdue_tasks"], "title": "مهام تجاوزت موعدها", "hint": "لم تُنجز بعد تاريخ الاستحقاق", "items": t.get("overdue_tasks_list", []), "route": "/hr-tasks"},
        {"key": "hr_contracts", "level": lvl(len(t["expiring_contracts"]), "warning"), "count": len(t["expiring_contracts"]), "title": "عقود تنتهي خلال 60 يوماً", "hint": "تحتاج تجديداً أو إنهاء", "items": t["expiring_contracts"], "route": "/hr-employees"},
        {"key": "hr_appraisals", "level": lvl(t["pending_appraisals"], "info"), "count": t["pending_appraisals"], "title": "تقييمات سنوية للاعتماد", "hint": "قدّمها المديرون وتنتظر اعتماد HR", "items": t.get("pending_appraisals_list", []), "route": "/hr-appraisals"},
    ]
    if hc and hc["by_unit"] and hc["by_unit"][-1]["id"] is None:
        n = hc["by_unit"][-1]["total"]
        out.append({"key": "hr_unlinked", "level": "warning", "count": n, "title": "موظفون غير مرتبطين بوحدة تنظيمية", "hint": "اربطهم من سجل الموظفين", "items": [], "route": "/hr-employees"})
    if p and p["bottom_employees"]:
        low = [e for e in p["bottom_employees"] if e["rate"] is not None and e["rate"] < 75]
        if low:
            out.append({"key": "hr_low_commitment", "level": "danger", "count": len(low), "title": "موظفون التزامهم أقل من 75%", "hint": "خلال الفترة المختارة", "items": low, "route": "/hr-attendance"})
    out.append({"key": "hr_pending_photos", "level": "warning" if t.get("pending_photos") else "ok", "count": len(t.get("pending_photos") or []), "title": "صور بطاقات بانتظار الاعتماد", "hint": "اعتماد فردي أو جماعي", "items": t.get("pending_photos") or [], "route": "/hr-photo-approvals"})
    out.append({"key": "hr_pending_profile", "level": "warning" if t.get("pending_profile") else "ok", "count": len(t.get("pending_profile") or []), "title": "طلبات تعديل بيانات معلّقة", "hint": "هاتف / عنوان / مؤهل…", "items": t.get("pending_profile") or [], "route": "/hr-profile-requests"})
    out.append({"key": "hr_pending_letters", "level": "warning" if t.get("pending_letters") else "ok", "count": len(t.get("pending_letters") or []), "title": "طلبات خطابات رسمية معلّقة", "hint": "تعريف / خبرة / استمرارية", "items": t.get("pending_letters") or [], "route": "/hr-letters"})
    return out


async def hr_units_list(db) -> list:
    units = await db.org_units.find({"is_active": {"$ne": False}}, {"name": 1, "type": 1, "parent_id": 1, "order": 1}).sort([("order", 1), ("name", 1)]).to_list(2000)
    return [{"id": str(u["_id"]), "name": (u.get("name") or "").strip(), "type": u.get("type"), "type_label": UNIT_TYPE_LABELS.get(u.get("type"), u.get("type") or ""), "parent_id": u.get("parent_id")} for u in units]


async def hr_dashboard_section(db, period: str, d_from: date, d_to: date, org_unit_id=None) -> dict:
    """القسم الكامل: ملخص اليوم + الأعداد + الفترة + التنبيهات — كل الجامعة أو وحدة تنظيمية مع فروعها"""
    from .hr_alerts import hr_dashboard_summary
    settings = await get_hr_settings(db)
    units = {str(u["_id"]): u for u in await db.org_units.find({}, {"name": 1, "type": 1, "parent_id": 1}).to_list(2000)}
    root = org_unit_id if org_unit_id in units else None
    emp_q = dict(ACTIVE_Q)
    if root:
        emp_q["org_unit_id"] = {"$in": list(_subtree(units, root))}
    emps = await db.employees.find(emp_q, {"full_name": 1, "employee_no": 1, "category": 1, "contract_type": 1, "org_unit_id": 1, "status": 1}).to_list(20000)
    today = await hr_dashboard_summary(db, [str(e["_id"]) for e in emps] if root else None)
    emp_scope = {"_id": {"$in": [e["_id"] for e in emps]}} if root else {}
    today["pending_photos"] = [{"employee_id": str(e["_id"]), "employee_name": e.get("full_name", ""), "employee_no": e.get("employee_no", ""), "pending_photo_at": (e.get("pending_photo_at") or "")[:10]}
                               for e in await db.employees.find({**emp_scope, "pending_photo_path": {"$exists": True, "$ne": ""}}, {"full_name": 1, "employee_no": 1, "pending_photo_at": 1}).sort("pending_photo_at", 1).limit(50).to_list(50)]
    lq = {"status": "pending"}
    if root:
        lq["employee_id"] = {"$in": [str(e["_id"]) for e in emps]}
    from .hr_letters import LETTER_TYPES
    today["pending_letters"] = [{"letter_id": str(l["_id"]), "employee_id": l["employee_id"], "type_label": LETTER_TYPES.get(l.get("type"), ""), "created_at": (l.get("created_at") or "")[:10]}
                                for l in await db.hr_letters.find(lq, {"employee_id": 1, "type": 1, "created_at": 1}).sort("created_at", 1).limit(50).to_list(50)]
    await enrich_employee_refs(db, today["pending_letters"])
    pq = {"status": "pending"}
    if root:
        pq["employee_id"] = {"$in": [str(e["_id"]) for e in emps]}
    from .hr_profile_requests import EDITABLE_FIELDS
    today["pending_profile"] = [{"request_id": str(r["_id"]), "employee_id": r["employee_id"], "fields": "، ".join(EDITABLE_FIELDS.get(k, k) for k in (r.get("changes") or {})), "created_at": (r.get("created_at") or "")[:10]}
                                for r in await db.hr_profile_requests.find(pq, {"employee_id": 1, "changes": 1, "created_at": 1}).sort("created_at", 1).limit(50).to_list(50)]
    await enrich_employee_refs(db, today["pending_profile"])
    try:
        headcount = await _headcount(db, emps, units, root)
    except Exception as e:
        logging.warning(f"hr headcount failed: {e}"); headcount = None
    try:
        stats = await _period_stats(db, emps, d_from, d_to, settings, period, units, bool(root))
    except Exception as e:
        logging.warning(f"hr period stats failed: {e}"); stats = None
    scope_label = units[root].get("name", "").strip() if root else "كل الوحدات التنظيمية"
    return {**today, "headcount": headcount, "period": stats, "alerts": _hr_alerts(today, headcount, stats),
            "scope": {"org_unit_id": root, "label": scope_label, "type_label": UNIT_TYPE_LABELS.get(units[root].get("type"), "") if root else ""}}
