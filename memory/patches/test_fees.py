import asyncio, os, sys, json, urllib.request, base64

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

IMG = base64.b64encode(b"x" * 300).decode()

async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    _, r = api("POST", "/api/auth/login", body={"username": "admin", "password": "admin123"})
    admin = r["access_token"]

    st, tr = api("GET", "/api/fees/types", admin)
    types = {t["key"]: t for t in tr["types"]}
    print("1. types:", st, sorted(types.keys()), "| year:", tr.get("academic_year"))
    renewal, dorm = types["renewal"]["id"], types["dormitory"]["id"]

    dept = await db.departments.find_one({"name": {"$regex": "الشريعة"}})
    st, r = api("POST", "/api/students", admin, {"student_id": "FEE-1", "full_name": "طالب سندات تجريبي",
        "department_id": str(dept["_id"]), "faculty_id": dept["faculty_id"], "level": 1, "section": "أ", "password": "test1234"})
    sid = r.get("id") or r.get("student", {}).get("id")
    _, r = api("POST", "/api/auth/login", body={"username": "FEE-1", "password": "test1234"})
    stok = r["access_token"]

    # رفع سند تجديد القيد
    st, r = api("POST", "/api/fees/receipts", stok, {"type_id": renewal, "image_base64": IMG, "receipt_no": "R-100", "amount": "50000"})
    print("2. upload renewal:", st, r.get("status"))
    st, ms = api("GET", "/api/fees/my-status", stok)
    ren = next(x for x in ms["statuses"] if x["type_id"] == renewal)
    print("3. my-status renewal:", ren["status_label"])

    # الأدمن يعمّد
    st, lst = api("GET", "/api/fees/receipts?status=pending", admin)
    rid = next(x["id"] for x in lst["receipts"] if x["student_number"] == "FEE-1")
    st, img = api("GET", f"/api/fees/receipts/{rid}/image", admin)
    print("4. admin sees pending + image:", st, len(img.get("image_base64", "")) > 100)
    st, r = api("POST", f"/api/fees/receipts/{rid}/approve", admin)
    _, ms = api("GET", "/api/fees/my-status", stok)
    ren = next(x for x in ms["statuses"] if x["type_id"] == renewal)
    notif = await db.notifications.find_one({"title": {"$regex": "اعتماد سند"}}, sort=[("created_at", -1)])
    print("5. approve:", st, "| badge now:", ren["status_label"], "| notif:", bool(notif))

    # إعادة رفع سند معتمد ممنوعة
    st, r = api("POST", "/api/fees/receipts", stok, {"type_id": renewal, "image_base64": IMG})
    print("6. re-upload approved blocked:", st == 400, r.get("detail", ""))

    # القسم الداخلي: رفض ثم إعادة رفع
    api("POST", "/api/fees/receipts", stok, {"type_id": dorm, "image_base64": IMG, "receipt_no": "R-100"})
    _, lst = api("GET", "/api/fees/receipts?status=pending", admin)
    d = next(x for x in lst["receipts"] if x["student_number"] == "FEE-1")
    print("7. duplicate receipt_no flagged:", d["duplicate_receipt_no"])
    st, r = api("POST", f"/api/fees/receipts/{d['id']}/reject", admin, {"reason": "الصورة غير واضحة"})
    _, ms = api("GET", "/api/fees/my-status", stok)
    dd = next(x for x in ms["statuses"] if x["type_id"] == dorm)
    print("8. reject:", st, "| badge:", dd["status_label"], "| reason:", dd["rejection_reason"])
    st, r = api("POST", "/api/fees/receipts", stok, {"type_id": dorm, "image_base64": IMG, "receipt_no": "R-200"})
    print("9. re-upload after reject:", st, r.get("status"))

    # نوع حر
    st, r = api("POST", "/api/fees/receipts", stok, {"type_id": "other", "other_label": "رسوم مختبر الحاسوب", "image_base64": IMG})
    _, ms = api("GET", "/api/fees/my-status", stok)
    other = [x for x in ms["statuses"] if x["type_name"] == "رسوم مختبر الحاسوب"]
    print("10. other type:", st, "| appears in status:", len(other) == 1)

    # نوع ديناميكي جديد + حذفه
    st, r = api("POST", "/api/fees/types", admin, {"name": "رسوم اختبارية XYZ"})
    tid = r.get("id")
    st2, _ = api("DELETE", f"/api/fees/types/{tid}", admin)
    st3, _ = api("DELETE", f"/api/fees/types/{renewal}", admin)
    print("11. dynamic type add/del:", st, st2, "| builtin delete blocked:", st3 == 400)

    # الإحصائيات + الحماية
    st, s = api("GET", "/api/fees/stats", admin)
    print("12. stats:", st, [f"{x['type_name'][:12]}:{x['approved']}/{x['pending']}" for x in s["stats"]])
    st, _ = api("GET", "/api/fees/receipts", stok)
    print("13. student blocked from admin list:", st == 403)

    # التذكير الجماعي (نطاق صغير: يشمل كل الطلاب غير الدافعين — نتحقق من العدد فقط)
    st, r = api("POST", "/api/fees/remind-unpaid", admin, {"type_id": dorm})
    print("14. remind:", st, r.get("message", "")[:60])

    # cleanup
    stu = await db.students.find_one({"_id": ObjectId(sid)})
    await db.fee_receipts.delete_many({"student_id": sid})
    await db.enrollments.delete_many({"student_id": sid})
    if stu and stu.get("user_id"):
        await db.users.delete_one({"_id": ObjectId(stu["user_id"])})
        await db.notifications.delete_many({"user_id": stu["user_id"]})
    await db.students.delete_one({"_id": ObjectId(sid)})
    await db.fee_types.delete_many({"name": {"$regex": "XYZ"}})
    await db.notifications.delete_many({"title": {"$regex": "تذكير: رسوم القسم"}})
    print("cleanup done")

asyncio.run(main())
