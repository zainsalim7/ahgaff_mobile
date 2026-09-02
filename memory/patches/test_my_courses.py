import asyncio, os, sys, json, urllib.request

sys.path.insert(0, "/app/backend/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/backend/.env")
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId

API = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].splitlines()[0].strip()

def api(method, path, token=None, body=None):
    req = urllib.request.Request(API + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", "User-Agent": "curl/8.0",
                 **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())

async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    st, r = api("POST", "/api/auth/login", body={"username": "admin", "password": "admin123"})
    admin = r["access_token"]
    dept = await db.departments.find_one({"name": {"$regex": "الشريعة"}})
    sem = await db.semesters.find_one({"status": "active"})
    sem_id = str(sem["_id"])

    # طالب بحساب دخول
    st, r = api("POST", "/api/students", admin, {
        "student_id": "MYC-1", "full_name": "طالب اختبار مقرراتي", "department_id": str(dept["_id"]),
        "faculty_id": dept["faculty_id"], "level": 1, "section": "أ", "password": "test1234",
    })
    sid = r.get("id") or r.get("student", {}).get("id")
    print("student created:", st, sid)
    # قد يكون سجّله التلقائي في مقررات مطابقة — نظف تسجيلاته لبدء نظيف
    await db.enrollments.delete_many({"student_id": sid})

    mk = lambda n, semid: db.courses.insert_one({"name": n, "code": n, "department_id": str(dept["_id"]),
        "faculty_id": dept["faculty_id"], "level": 9, "section": "", "is_active": True, "semester_id": semid})
    c1 = str((await mk("MYC-C1", sem_id)).inserted_id)   # تسجيل بلا semester_id (بيانات قديمة)
    c2 = str((await mk("MYC-C2", sem_id)).inserted_id)   # تسجيل بحقل semester_id
    c3 = str((await mk("MYC-C3", "old-sem-x")).inserted_id)  # مقرر فصل قديم
    await db.enrollments.insert_one({"course_id": c1, "student_id": sid, "enrolled_at": "2026-01-01", "enrolled_by": "test"})
    await db.enrollments.insert_one({"course_id": c2, "student_id": sid, "enrolled_at": "2026-01-01", "enrolled_by": "test", "semester_id": sem_id})
    await db.enrollments.insert_one({"course_id": c3, "student_id": sid, "enrolled_at": "2026-01-01", "enrolled_by": "test"})

    st, r = api("POST", "/api/auth/login", body={"username": "MYC-1", "password": "test1234"})
    stok = r.get("access_token")
    print("student login:", st)
    st, courses = api("GET", "/api/students/me/courses", stok)
    names = sorted(c["name"] for c in courses)
    print("me/courses:", st, names)
    ok = ("MYC-C1" in names) and ("MYC-C2" in names) and ("MYC-C3" not in names)
    print("RESULT:", "PASS ✅" if ok else "FAIL ❌")

    # التسجيل اليدوي الجديد يضع semester_id
    c4 = str((await mk("MYC-C4", sem_id)).inserted_id)
    api("POST", f"/api/enrollments/{c4}", admin, {"course_id": c4, "student_ids": [sid]})
    e4 = await db.enrollments.find_one({"course_id": c4, "student_id": sid})
    print("manual enroll semester_id set:", e4.get("semester_id") == sem_id)

    # cleanup
    stu = await db.students.find_one({"_id": ObjectId(sid)})
    await db.enrollments.delete_many({"student_id": sid})
    await db.courses.delete_many({"_id": {"$in": [ObjectId(x) for x in (c1, c2, c3, c4)]}})
    if stu and stu.get("user_id"):
        await db.users.delete_one({"_id": ObjectId(stu["user_id"])})
    await db.students.delete_one({"_id": ObjectId(sid)})
    await db.notifications.delete_many({"user_id": stu.get("user_id", "")})
    print("cleanup done")

asyncio.run(main())
