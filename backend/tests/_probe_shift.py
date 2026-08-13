import json
import os
import requests
from dotenv import dotenv_values

BASE = (dotenv_values("/app/frontend/.env").get("REACT_APP_BACKEND_URL")).rstrip("/")
FAC = "698e4f9297fef774e66e93a4"
s = requests.Session()
r = s.post(f"{BASE}/api/auth/login", json={"username": "admin", "password": "admin123"})
tok = r.json().get("access_token") or r.json().get("token")
print("login", r.status_code, list(r.json().keys()))
s.headers.update({"Authorization": f"Bearer {tok}"})

st = s.get(f"{BASE}/api/schedule-settings", params={"faculty_id": FAC})
print("settings", st.status_code, json.dumps(st.json(), ensure_ascii=False)[:1200])

r = s.get(f"{BASE}/api/weekly-schedule", params={"faculty_id": FAC})
print("list", r.status_code)
data = r.json()
slots = data if isinstance(data, list) else data.get("slots") or data.get("schedule") or []
print("count", len(slots))
if slots:
    print("keys", sorted(slots[0].keys()))
days = {}
for x in slots:
    days.setdefault(x.get("day"), []).append(x)
for d, arr in days.items():
    print("DAY", d, len(arr))
for x in slots:
    if x.get("day") == "السبت":
        print({k: x.get(k) for k in ("id", "_id", "slot_number", "course_name", "teacher_id", "room_id",
                                     "department_id", "level", "section", "duration_minutes",
                                     "computed_start_time", "computed_end_time")})
