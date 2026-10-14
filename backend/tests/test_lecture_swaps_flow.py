"""E2E: تبادل محاضرة بين أستاذين — يزرع محاضرتين مجدولتين الأسبوع القادم ثم يمر بالمسار كاملاً عبر API"""
import asyncio
import os
import sys
from datetime import datetime, timedelta

import requests
from bson import ObjectId
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")
API = [l.split("=", 1)[1].strip() for l in open("/app/frontend/.env") if l.startswith("REACT_APP_BACKEND_URL")][0]
DEPT = "698e501d97fef774e66e93a9"


def login(u, p):
    d = requests.post(f"{API}/api/auth/login", json={"username": u, "password": p}).json()
    return {"Authorization": f"Bearer {d.get('access_token') or d.get('token')}"}


async def seed():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    t1 = await db.users.find_one({"username": "teacher180156"})
    t2u = await db.users.find_one({"username": "9999"})
    t1_id = t1.get("teacher_record_id") or str(t1["_id"])
    t2_id = t2u.get("teacher_record_id") or str(t2u["_id"])
    # ضمان وجود سجل teachers للاثنين في نفس الكلية (للترشيح)
    dept = await db.departments.find_one({"_id": ObjectId(DEPT)})
    for tid, u in ((t1_id, t1), (t2_id, t2u)):
        await db.teachers.update_one({"_id": ObjectId(tid)}, {"$setOnInsert": {"full_name": u.get("full_name") or u["username"], "user_id": str(u["_id"]), "is_active": True},
                                                              "$set": {"faculty_id": dept["faculty_id"], "department_id": DEPT}}, upsert=True)
    courses = await db.courses.find({"department_id": DEPT, "is_active": True}).limit(2).to_list(2)
    assert len(courses) >= 2, "يلزم مقرران في القسم"
    for c in courses:
        await db.courses.update_one({"_id": c["_id"]}, {"$set": {"faculty_id": dept["faculty_id"]}})
    # الأسبوع القادم: السبت + الاثنين
    today = datetime.utcnow()
    sat = today + timedelta(days=(5 - today.weekday()) % 7 + 7)
    mon = sat + timedelta(days=2)
    await db.lectures.delete_many({"swap_test": True})
    await db.lecture_swaps.delete_many({"requester_teacher_id": t1_id, "reason": "ارتباط رسمي"})
    la = {"course_id": str(courses[0]["_id"]), "course_name": courses[0]["name"], "teacher_id": t1_id, "teacher_name": t1.get("full_name"), "date": sat.strftime("%Y-%m-%d"), "start_time": "08:00", "end_time": "09:15", "status": "scheduled", "room": "قاعة اختبار", "swap_test": True, "created_at": datetime.utcnow().isoformat()}
    lb = {"course_id": str(courses[1]["_id"]), "course_name": courses[1]["name"], "teacher_id": t2_id, "teacher_name": t2u.get("full_name"), "date": mon.strftime("%Y-%m-%d"), "start_time": "10:00", "end_time": "11:15", "status": "scheduled", "room": "قاعة اختبار", "swap_test": True, "created_at": datetime.utcnow().isoformat()}
    ra, rb = await db.lectures.insert_one(la), await db.lectures.insert_one(lb)
    await db.lecture_swaps.delete_many({"$or": [{"lecture_a.id": str(ra.inserted_id)}, {"lecture_b.id": str(rb.inserted_id)}]})
    return str(ra.inserted_id), str(rb.inserted_id), t1_id, t2_id, db


async def main():
    la, lb, t1_id, t2_id, db = await seed()
    H1, H2, HH = login("teacher180156", "teacher123"), login("9999", "teacher123"), login("Saeed", "test1234")
    r = requests.get(f"{API}/api/lecture-swaps/my-lectures", headers=H1).json()
    assert any(l["id"] == la and l["eligible"] for l in r["lectures"]), r
    print("✓ my-lectures: eligible", r["month_used"], "/", r["settings"]["monthly_limit"])
    c = requests.get(f"{API}/api/lecture-swaps/candidates", params={"lecture_id": la, "type": "swap"}, headers=H1).json()
    cand = next(t for t in c["teachers"] if t["teacher_id"] == t2_id)
    assert cand["available"] and any(s["id"] == lb and s["ok"] for s in cand["swappable"]), cand
    print("✓ candidates: colleague available with swappable lecture")
    bad = requests.post(f"{API}/api/lecture-swaps", json={"type": "swap", "lecture_a_id": la, "counterpart_teacher_id": t1_id, "lecture_b_id": lb}, headers=H1)
    assert bad.status_code == 400, bad.text
    s = requests.post(f"{API}/api/lecture-swaps", json={"type": "swap", "lecture_a_id": la, "counterpart_teacher_id": t2_id, "lecture_b_id": lb, "reason": "ارتباط رسمي"}, headers=H1)
    assert s.status_code == 200, s.text
    sid = s.json()["id"]
    print("✓ request created", s.json()["status"])
    dup = requests.post(f"{API}/api/lecture-swaps", json={"type": "cover", "lecture_a_id": la, "counterpart_teacher_id": t2_id}, headers=H1)
    print("✓ duplicate blocked:", dup.status_code, dup.json().get("detail", "")[:60])
    lst = requests.get(f"{API}/api/lecture-swaps", headers=H2).json()
    item = next(i for i in lst["items"] if i["id"] == sid)
    assert item["can_respond"] and not item["can_decide"]
    forbidden = requests.post(f"{API}/api/lecture-swaps/{sid}/decide", json={"accept": True}, headers=H2)
    assert forbidden.status_code in (403, 404), forbidden.text
    r = requests.post(f"{API}/api/lecture-swaps/{sid}/respond", json={"accept": True}, headers=H2)
    assert r.status_code == 200 and r.json()["status"] == "pending_head", r.text
    print("✓ counterpart accepted → pending_head")
    lst = requests.get(f"{API}/api/lecture-swaps", headers=HH).json()
    item = next(i for i in lst["items"] if i["id"] == sid)
    assert item["can_decide"], item
    r = requests.post(f"{API}/api/lecture-swaps/{sid}/decide", json={"accept": True, "note": "موافق"}, headers=HH)
    assert r.status_code == 200 and r.json()["status"] == "approved", r.text
    A = await db.lectures.find_one({"_id": ObjectId(la)})
    B = await db.lectures.find_one({"_id": ObjectId(lb)})
    assert A["teacher_id"] == t2_id and A["original_teacher_id"] == t1_id and A["swap_id"] == sid, A
    assert B["teacher_id"] == t1_id and B["original_teacher_id"] == t2_id, B
    print("✓ approved: lectures swapped (A→T2, B→T1), original kept")
    n = await db.notifications.count_documents({"type": "lecture_swap"})
    print("✓ notifications created:", n)
    again = requests.get(f"{API}/api/lecture-swaps/my-lectures", headers=H2).json()
    la_item = next((l for l in again["lectures"] if l["id"] == la), None)
    assert la_item and not la_item["eligible"], la_item
    print("✓ swapped lecture not eligible for another swap")
    r = requests.post(f"{API}/api/lecture-swaps/{sid}/cancel", json={"accept": False, "note": "اختبار"}, headers=H1)
    assert r.status_code == 200, r.text
    A = await db.lectures.find_one({"_id": ObjectId(la)})
    assert A["teacher_id"] == t1_id and "swap_id" not in A, A
    print("✓ cancel reverted lectures")
    rep = requests.get(f"{API}/api/lecture-swaps/report", headers=HH).json()
    print("✓ report:", {k: rep[k] for k in ("total", "swaps", "covers")})
    await db.lectures.delete_many({"swap_test": True})
    await db.lecture_swaps.delete_many({"lecture_a.id": la})
    print("ALL OK")


asyncio.run(main())
