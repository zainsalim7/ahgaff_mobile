"""📄 اختبار مسار أعذار غياب الطلاب (المرحلة 2) — يزرع محاضرات مؤقتة وينظفها"""
import os, io, asyncio, requests
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
load_dotenv('/app/frontend/.env'); load_dotenv('/app/backend/.env')
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId

B = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
PNG = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000100e5279d5f0000000049454e44ae426082')


def login(u, p):
    r = requests.post(f"{B}/api/auth/login", json={"username": u, "password": p}); assert r.ok, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}


def ok(cond, msg):
    print(("✅" if cond else "❌"), msg)
    assert cond, msg


async def main():
    S, A, D, H = login("1001", "test1234"), login("admin", "admin123"), login("Salim", "test1234"), login("Saeed", "test1234")
    st = await db.students.find_one({"student_id": "1001"}); sid = str(st["_id"])
    enr = await db.enrollments.find_one({"student_id": sid}); cid = enr["course_id"]
    today = datetime.now(timezone(timedelta(hours=3)))
    d1, d2, d3 = [(today - timedelta(days=k)).strftime("%Y-%m-%d") for k in (3, 2, 1)]
    lec_ids, exc_ids = [], []
    try:
        l1 = (await db.lectures.insert_one({"course_id": cid, "date": d1, "start_time": "08:00", "end_time": "10:00", "status": "completed", "_test": True})).inserted_id
        l2 = (await db.lectures.insert_one({"course_id": cid, "date": d2, "start_time": "08:00", "end_time": "09:00", "status": "completed", "_test": True})).inserted_id
        lec_ids += [l1, l2]
        await db.attendance.insert_one({"lecture_id": str(l1), "course_id": cid, "student_id": sid, "status": "absent", "_test": True})
        # لا سجل للمحاضرة l2 → مفقود = غياب بلا عذر

        m = requests.get(f"{B}/api/student-excuses/meta", headers=S).json(); ok(m["is_student"] and not m["can_manage"], "meta للطالب")
        r = requests.post(f"{B}/api/student-excuses", headers=S, data={"from_date": d1, "to_date": d3, "excuse_type": "sick", "description": "تقرير طبي"})
        ok(r.status_code == 400 and "إلزامي" in r.text, "بلا مرفق → 400")
        r = requests.post(f"{B}/api/student-excuses", headers=S, data={"from_date": d1, "to_date": d3, "excuse_type": "sick", "description": "تقرير طبي"}, files=[("files", ("r.png", io.BytesIO(PNG), "image/png"))])
        ok(r.status_code == 200, f"تقديم عذر مرضي 3 أيام: {r.text[:120]}"); e1 = r.json()["request"]; exc_ids.append(e1["id"])
        ok(e1["route"] == "registration" and e1["days"] == 3, "مرضي 3 أيام → التسجيل (بلا حد للأيام)")
        r = requests.post(f"{B}/api/student-excuses", headers=S, data={"from_date": d1, "to_date": d2, "excuse_type": "family", "description": "x"}, files=[("files", ("r.png", io.BytesIO(PNG), "image/png"))])
        ok(r.status_code == 400 and "يتداخل" in r.text, "طلب متداخل → 400")
        my = requests.get(f"{B}/api/student-excuses/my", headers=S).json(); ok(len(my["items"]) >= 1 and my["stats"]["pending"] >= 1 and my["courses"], "/my يرجع الطلب والمقررات")
        r = requests.get(f"{B}/api/student-excuses/{e1['id']}/attachments/0?token={S['Authorization'][7:]}"); ok(r.status_code == 200 and r.content[:4] == PNG[:4], "تحميل المرفق بالتوكن")

        ok(requests.get(f"{B}/api/student-excuses", headers=S).status_code == 403, "الطالب لا يرى قائمة المراجعة")
        lst = requests.get(f"{B}/api/student-excuses?status=pending", headers=A).json(); ok(any(i["id"] == e1["id"] and i["can_decide"] for i in lst["items"]), "الأدمن يرى الطلب ويستطيع البت")
        r = requests.post(f"{B}/api/student-excuses/{e1['id']}/decide", headers=D, json={"decision": "approved"}); ok(r.status_code == 403, f"العميد لا يبت في مسار التسجيل: {r.json().get('detail')}")
        r = requests.post(f"{B}/api/student-excuses/{e1['id']}/decide", headers=A, json={"decision": "needs_info", "note": "أرفق التقرير الأصلي"}); ok(r.ok, "needs_info")
        r = requests.post(f"{B}/api/student-excuses/{e1['id']}/attachments", headers=S, files=[("files", ("r2.png", io.BytesIO(PNG), "image/png"))]); ok(r.ok, "الطالب يضيف مرفقاً → pending")
        r = requests.post(f"{B}/api/student-excuses/{e1['id']}/decide", headers=A, json={"decision": "approved"}); ok(r.ok, f"اعتماد: {r.json().get('message')}")
        ap = r.json()["applied"]; ok(ap["updated"] == 1 and ap["created"] == 1, f"أثر الاعتماد: updated=1 created=1 → {ap}")
        a1 = await db.attendance.find_one({"lecture_id": str(l1), "student_id": sid}); a2 = await db.attendance.find_one({"lecture_id": str(l2), "student_id": sid})
        ok(a1["status"] == "excused" and a1.get("prev_status") == "absent" and a2["status"] == "excused", "سجلات الحضور تحولت إلى excused")
        n = await db.notifications.find_one({"user_id": st.get("user_id"), "type": "student_excuse"}, sort=[("created_at", -1)]); ok(n is not None, "إشعار للطالب")

        # محاضرة تُنفَّذ لاحقاً داخل الفترة → بعذر تلقائياً عند التحضير (أدمن يحضّر ويحاول late/absent)
        now = today
        l3 = (await db.lectures.insert_one({"course_id": cid, "date": d3, "start_time": (now - timedelta(minutes=5)).strftime("%H:%M"), "end_time": (now + timedelta(minutes=55)).strftime("%H:%M"), "status": "scheduled", "_test": True})).inserted_id
        lec_ids.append(l3)
        other = await db.enrollments.find_one({"course_id": cid, "student_id": {"$ne": sid}})
        recs = [{"student_id": sid, "status": "absent"}] + ([{"student_id": other["student_id"], "status": "late"}] if other else [])
        r = requests.post(f"{B}/api/attendance/session", headers=A, json={"lecture_id": str(l3), "records": recs}); ok(r.ok and r.json().get("auto_excused") == 1, f"تحضير: auto_excused=1 → {r.json()}")
        a3 = await db.attendance.find_one({"lecture_id": str(l3), "student_id": sid}); ok(a3["status"] == "excused", "الطالب المعذور سُجّل بعذر تلقائياً")
        if other:
            a4 = await db.attendance.find_one({"lecture_id": str(l3), "student_id": other["student_id"]}); ok(a4["status"] == "present", "late → present")

        # عذر غير مرضي 2 أيام → العميد؛ 3 أيام → المجلس (يتطلب رقم جلسة)
        await db.student_excuses.update_many({"_id": {"$in": [ObjectId(i) for i in exc_ids]}}, {"$set": {"status": "cancelled"}})
        r = requests.post(f"{B}/api/student-excuses", headers=A, data={"from_date": d1, "to_date": d2, "excuse_type": "family", "description": "ظرف", "student_db_id": sid}, files=[("files", ("r.png", io.BytesIO(PNG), "image/png"))])
        ok(r.ok and r.json()["request"]["route"] == "dean", "الأدمن نيابةً: غير مرضي يومان → العميد"); exc_ids.append(r.json()["request"]["id"])
        await db.student_excuses.update_one({"_id": ObjectId(exc_ids[-1])}, {"$set": {"status": "cancelled"}})
        r = requests.post(f"{B}/api/student-excuses", headers=A, data={"from_date": d1, "to_date": d3, "excuse_type": "official", "description": "مهمة", "student_db_id": sid}, files=[("files", ("r.png", io.BytesIO(PNG), "image/png"))])
        e3 = r.json()["request"]; exc_ids.append(e3["id"]); ok(e3["route"] == "board", "3 أيام غير مرضي → مجلس الكلية")
        r = requests.post(f"{B}/api/student-excuses/{e3['id']}/decide", headers=A, json={"decision": "rejected", "note": "غير مقنع"}); ok(r.status_code == 400 and "جلسة" in r.text, "مجلس بلا رقم جلسة → 400")
        r = requests.post(f"{B}/api/student-excuses/{e3['id']}/decide", headers=A, json={"decision": "rejected", "note": "غير مقنع", "board_session_no": "7", "board_session_date": d3}); ok(r.ok, "رفض بقرار مجلس مع رقم جلسة")
        r = requests.post(f"{B}/api/student-excuses", headers=S, data={"from_date": d3, "to_date": d3, "excuse_type": "exam", "description": "اختبار"}, files=[("files", ("r.png", io.BytesIO(PNG), "image/png"))])
        ok(r.ok and r.json()["request"]["route"] == "board", "عذر عن اختبار يوم واحد → المجلس"); exc_ids.append(r.json()["request"]["id"])
        r = requests.post(f"{B}/api/student-excuses/{exc_ids[-1]}/cancel", headers=S); ok(r.ok, "الطالب يلغي طلبه المعلّق")
        ok(requests.get(f"{B}/api/student-excuses/students/search?q=1001", headers=H).status_code == 200, "بحث الطلاب لرئيس القسم (نطاقه)")
        print("ALL PASSED")
    finally:
        await db.lectures.delete_many({"_id": {"$in": lec_ids}})
        await db.attendance.delete_many({"lecture_id": {"$in": [str(i) for i in lec_ids]}})
        await db.student_excuses.delete_many({"_id": {"$in": [ObjectId(i) for i in exc_ids]}})
        await db.notifications.delete_many({"type": "student_excuse"})
        print("cleaned")

asyncio.run(main())
