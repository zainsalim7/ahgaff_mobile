"""Iteration 104 — Phase 1 of new faculty absence regulation.

Tests the new absence engine via public API:
  - GET /api/reports/warnings (admin)
  - GET /api/students/me/absence-profile (student)
  - GET /api/dashboard/student (student) — regression (was 500)
  - PUT /api/faculties/{id}/settings max_unexcused_percent
  - GET /api/reports/student/{id} (routes/student_report.py) still returns 200
  - Edge rule check with real DB manipulation

Run:
  BASE_URL=$REACT_APP_BACKEND_URL pytest backend/tests/test_absence_phase1_iter104.py -v
"""
import os
import pytest
import requests
import asyncio
import uuid
from datetime import datetime
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://schedule-hub-272.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "university_db")


# ---------- helpers ----------
def _login(username: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"username": username, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed {username}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login("admin", "admin123")


@pytest.fixture(scope="module")
def student_token():
    return _login("1001", "test1234")


@pytest.fixture(scope="module")
def student_headers(student_token):
    return {"Authorization": f"Bearer {student_token}"}


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ========== /api/reports/warnings ==========
class TestWarningsReport:
    def test_warnings_structure_and_limits(self, admin_headers):
        r = requests.get(f"{API}/reports/warnings", headers=admin_headers, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert set(["warnings", "deprivations", "summary"]).issubset(data.keys())
        s = data["summary"]
        for k in ("unexcused_limit", "total_limit", "min_executed", "rule", "total_warnings", "total_deprivations"):
            assert k in s, f"missing summary.{k}"
        # Defaults
        assert s["min_executed"] == 4
        assert s["unexcused_limit"] in (10, 10.0)
        assert s["total_limit"] in (25, 25.0)
        assert "مرشَّح" in s["rule"] or "مرشح" in s["rule"]

    def test_row_fields(self, admin_headers):
        r = requests.get(f"{API}/reports/warnings", headers=admin_headers, timeout=60)
        data = r.json()
        required = {"executed_hours", "unexcused_hours", "excused_hours", "pct_unexcused", "pct_total",
                    "remaining_allowed", "early", "status_key"}
        for row in (data["warnings"] + data["deprivations"])[:30]:
            missing = required - set(row.keys())
            assert not missing, f"row missing fields {missing}"
        # Status partitioning
        for row in data["deprivations"]:
            assert row["status_key"] == "candidate"
            assert row["pct_unexcused"] > row.get("limit_unexcused", 10) or row["pct_total"] > row.get("limit_total", 25) \
                or row["pct_unexcused"] > 10 or row["pct_total"] > 25
        for row in data["warnings"]:
            assert row["status_key"] in ("warning", "danger")

    def test_level_filter(self, admin_headers):
        r = requests.get(f"{API}/reports/warnings?level=1", headers=admin_headers, timeout=60)
        assert r.status_code == 200


# ========== /api/students/me/absence-profile ==========
class TestStudentAbsenceProfile:
    def test_profile_shape(self, student_headers):
        r = requests.get(f"{API}/students/me/absence-profile", headers=student_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "limits" in data and "courses" in data and "rule" in data
        assert data["limits"]["unexcused_limit"] in (10, 10.0)
        assert data["limits"]["total_limit"] in (25, 25.0)
        assert data["limits"]["min_executed"] == 4
        for c in data["courses"]:
            for k in ("course_id", "course_name", "executed_count", "executed_hours",
                      "unexcused_hours", "excused_hours", "pct_unexcused", "pct_total",
                      "status", "status_ar", "early"):
                assert k in c, f"course missing {k}"

    def test_profile_matches_db(self, student_headers):
        """Pick one course, recompute manually from DB."""
        r = requests.get(f"{API}/students/me/absence-profile", headers=student_headers, timeout=30)
        data = r.json()
        if not data["courses"]:
            pytest.skip("student has no enrolled courses")

        async def _check():
            cli = AsyncIOMotorClient(MONGO_URL)
            db = cli[DB_NAME]
            try:
                # Get the student doc for user 1001
                stu = await db.students.find_one({"student_id": "1001"})
                assert stu, "student 1001 not found"
                sid = str(stu["_id"])
                # Pick first course from API
                c0 = data["courses"][0]
                cid = c0["course_id"]
                # enrollment date
                enr = await db.enrollments.find_one({"student_id": sid, "course_id": cid})
                en_date = enr.get("enrolled_at") if enr else None
                if isinstance(en_date, datetime):
                    en_date_s = en_date.strftime("%Y-%m-%d")
                else:
                    en_date_s = None
                # executed lectures
                lecs = await db.lectures.find({"course_id": cid, "status": "completed"}).to_list(2000)
                lec_hours = {}
                for L in lecs:
                    try:
                        s = datetime.strptime(L.get("start_time", "00:00"), "%H:%M")
                        e = datetime.strptime(L.get("end_time", "00:00"), "%H:%M")
                        h = round(((e - s).seconds / 3600) or 1.0, 2)
                    except Exception:
                        h = 1.0
                    if L.get("credited_minutes"):
                        h = round(float(L["credited_minutes"]) / 60, 2)
                    lec_hours[str(L["_id"])] = (h, L.get("date", ""))
                recs = {}
                async for a in db.attendance.find({"course_id": cid, "student_id": sid}):
                    recs[a["lecture_id"]] = a.get("status")
                exec_h = unexc = exc = 0.0
                exec_n = 0
                for lid, (h, d) in lec_hours.items():
                    st = recs.get(lid)
                    if st is None and en_date_s and d < en_date_s:
                        continue
                    exec_h += h; exec_n += 1
                    if st == "absent" or st is None:
                        unexc += h
                    elif st == "excused":
                        exc += h
                print(f"[manual] course={cid} executed_h={exec_h} unexc={unexc} exc={exc} n={exec_n}")
                print(f"[api]    executed_h={c0['executed_hours']} unexc={c0['unexcused_hours']} exc={c0['excused_hours']} n={c0['executed_count']}")
                assert abs(c0["executed_hours"] - round(exec_h, 2)) < 0.05
                assert abs(c0["unexcused_hours"] - round(unexc, 2)) < 0.05
                assert abs(c0["excused_hours"] - round(exc, 2)) < 0.05
                assert c0["executed_count"] == exec_n
            finally:
                cli.close()

        asyncio.get_event_loop().run_until_complete(_check())


# ========== /api/dashboard/student ==========
class TestStudentDashboard:
    def test_dashboard_200(self, student_headers):
        r = requests.get(f"{API}/dashboard/student", headers=student_headers, timeout=30)
        assert r.status_code == 200, f"regression: {r.status_code} {r.text[:400]}"
        data = r.json()
        assert "courses_stats" in data
        assert "absence_rule" in data
        assert "max_unexcused_percent" in data
        for cs in data["courses_stats"]:
            for k in ("pct_unexcused", "pct_total", "status_ar"):
                assert k in cs, f"missing {k} in courses_stats item"


# ========== Faculty settings PUT max_unexcused_percent ==========
class TestFacultyLimitUpdate:
    def test_put_and_warnings_reflect(self, admin_headers):
        # Find a faculty
        r = requests.get(f"{API}/faculties", headers=admin_headers, timeout=20)
        assert r.status_code == 200
        facs = r.json()
        if not facs:
            pytest.skip("no faculties")
        fac = facs[0]
        fid = fac.get("id") or fac.get("_id")
        orig = fac.get("max_unexcused_percent") or 10
        try:
            # Change to 15
            r = requests.put(f"{API}/faculties/{fid}/settings", headers=admin_headers,
                             json={"max_unexcused_percent": 15}, timeout=20)
            assert r.status_code == 200, r.text
            # Verify via warnings report filtered on this faculty
            r = requests.get(f"{API}/reports/warnings?faculty_id={fid}", headers=admin_headers, timeout=60)
            assert r.status_code == 200
            summary = r.json()["summary"]
            # Only verify when faculty has courses (otherwise defaults used)
            # Still check that no exception; limit should be 15 if courses exist in this fac
            print(f"faculty {fid} warnings summary unexcused_limit={summary['unexcused_limit']}")
            if summary.get("total_warnings", 0) + summary.get("total_deprivations", 0) > 0:
                assert summary["unexcused_limit"] in (15, 15.0)
        finally:
            # Restore
            requests.put(f"{API}/faculties/{fid}/settings", headers=admin_headers,
                         json={"max_unexcused_percent": orig}, timeout=20)


# ========== /api/reports/student/{id} ==========
class TestStudentReportRoute:
    def test_200_and_rule_object(self, admin_headers):
        async def _getsid():
            cli = AsyncIOMotorClient(MONGO_URL); db = cli[DB_NAME]
            try:
                s = await db.students.find_one({"student_id": "1001"})
                return str(s["_id"]) if s else None
            finally:
                cli.close()
        sid = asyncio.get_event_loop().run_until_complete(_getsid())
        if not sid:
            pytest.skip("student 1001 not found")
        r = requests.get(f"{API}/reports/student/{sid}/detailed", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        # courses entries should have 'rule'
        courses = data.get("courses") or data.get("course_details") or []
        if courses:
            found_rule = False
            for c in courses:
                if "rule" in c and isinstance(c["rule"], dict):
                    r_obj = c["rule"]
                    assert "pct_unexcused" in r_obj and "pct_total" in r_obj and "status" in r_obj
                    found_rule = True
                    break
            assert found_rule, f"no 'rule' object on course entries; keys: {list(courses[0].keys()) if courses else []}"


# ========== Edge rule check — direct engine (DB manipulation would be invasive, use classify) ==========
class TestEngineEdges:
    def test_exact_10_not_candidate(self):
        from backend.services.absence_engine import classify  # type: ignore
        # 1h unexcused out of 10h => 10% exact — should NOT be candidate
        p = classify(1.0, 0.0, 10.0, 5, {"unexcused_limit": 10, "total_limit": 25, "min_executed": 4})
        assert p["status"] != "candidate", p

    def test_above_10_is_candidate(self):
        from backend.services.absence_engine import classify
        p = classify(1.1, 0.0, 10.0, 5, {"unexcused_limit": 10, "total_limit": 25, "min_executed": 4})
        assert p["status"] == "candidate", p

    def test_excused_25_not_candidate(self):
        from backend.services.absence_engine import classify
        p = classify(0.0, 2.5, 10.0, 5, {"unexcused_limit": 10, "total_limit": 25, "min_executed": 4})
        assert p["status"] != "candidate", p

    def test_excused_total_above_25_candidate(self):
        from backend.services.absence_engine import classify
        p = classify(0.0, 2.6, 10.0, 5, {"unexcused_limit": 10, "total_limit": 25, "min_executed": 4})
        assert p["status"] == "candidate", p

    def test_early_indicator(self):
        from backend.services.absence_engine import classify
        p = classify(0.5, 0.0, 3.0, 2, {"unexcused_limit": 10, "total_limit": 25, "min_executed": 4})
        assert p["early"] is True
        assert "مؤشر مبكر" in p["status_ar"]
