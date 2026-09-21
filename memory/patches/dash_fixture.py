import os, sys, asyncio, random
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
load_dotenv('/app/backend/backend/.env')
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId

TAG = {"_dash_fixture": True}
YT = timezone(timedelta(hours=3))


async def main(mode):
    db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    if mode == 'clean':
        for c in ['lectures', 'attendance', 'fee_receipts']:
            r = await db[c].delete_many(TAG)
            print(c, r.deleted_count)
        return
    sem = await db.semesters.find_one({"status": "active"})
    courses = await db.courses.find({"is_active": True, "semester_id": str(sem["_id"])}).to_list(20)
    today = datetime.now(YT).date()
    random.seed(7)
    n_l = n_a = 0
    for c in courses[:5]:
        studs = await db.enrollments.distinct("student_id", {"course_id": str(c["_id"])})
        if not studs:
            studs = [str(s["_id"]) for s in await db.students.find({"department_id": c["department_id"], "is_active": True}).limit(15).to_list(15)]
        for back in range(1, 8):
            d = today - timedelta(days=back)
            start = datetime(d.year, d.month, d.day, 9, 0)
            status = "completed" if back not in (3,) else "cancelled"
            delay = 25 if (back == 2 and c is courses[0]) else 0
            lec = {"course_id": str(c["_id"]), "date": d.isoformat(), "start_time": "09:00", "end_time": "10:30", "room": "A1",
                   "status": status, "semester_id": str(sem["_id"]), "teacher_id": c.get("teacher_id"), "created_at": datetime.utcnow(), **TAG}
            if status == "completed":
                lec["attendance_started_at"] = (start + timedelta(minutes=delay)).isoformat()
            r = await db.lectures.insert_one(lec)
            n_l += 1
            if status == "completed":
                for sid in studs:
                    st = "present" if random.random() > (0.5 if sid == studs[0] else 0.15) else ("late" if random.random() > 0.6 else "absent")
                    await db.attendance.insert_one({"lecture_id": str(r.inserted_id), "course_id": str(c["_id"]), "student_id": sid, "status": st,
                                                    "date": start, "recorded_by": "fixture", "method": "manual", "created_at": datetime.utcnow(), **TAG})
                    n_a += 1
    # محاضرة اليوم فائتة (مجدولة وبدأت قبل ساعتين)
    hm = (datetime.now(YT) - timedelta(hours=2)).strftime("%H:%M")
    await db.lectures.insert_one({"course_id": str(courses[0]["_id"]), "date": today.isoformat(), "start_time": hm, "end_time": "23:59", "room": "B2",
                                  "status": "scheduled", "semester_id": str(sem["_id"]), "created_at": datetime.utcnow(), **TAG})
    # سند معلق
    ft = await db.fee_types.find_one({})
    s = await db.students.find_one({"is_active": True})
    await db.fee_receipts.insert_one({"student_id": str(s["_id"]), "type_id": str(ft["_id"]), "type_name": ft["name"], "academic_year": sem.get("academic_year"),
                                      "status": "pending", "receipt_no": "DASH-1", "amount": 50000, "created_at": datetime.utcnow(), **TAG})
    print("lectures", n_l + 1, "attendance", n_a)

asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else 'seed'))
