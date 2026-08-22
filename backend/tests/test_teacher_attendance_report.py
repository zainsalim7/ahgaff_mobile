"""Tests for the new Teacher Attendance / Lecture Execution report endpoints.

Covers:
- GET /api/reports/teacher-attendance (data shape, filters, defaults, auth)
- GET /api/reports/teacher-attendance/export/excel
- GET /api/reports/teacher-attendance/export/pdf
"""
import os

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")

START = "2026-04-01"
END = "2026-08-30"
VALID_STATUSES = {"executed", "absent", "cancelled", "pending"}


@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"username": "admin", "password": "admin123"}, timeout=60)
    if r.status_code != 200:
        pytest.fail(f"Admin login failed {r.status_code}: {r.text[:300]}")
    token = r.json().get("access_token") or r.json().get("token")
    if not token:
        pytest.fail(f"No token in login response: {r.text[:300]}")
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def report(admin_client):
    r = admin_client.get(
        f"{BASE_URL}/api/reports/teacher-attendance",
        params={"start_date": START, "end_date": END}, timeout=120,
    )
    assert r.status_code == 200, r.text[:400]
    return r.json()


class TestTeacherAttendanceReport:
    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/reports/teacher-attendance", timeout=60)
        assert r.status_code in (401, 403), r.status_code

    def test_shape_and_summary_consistency(self, report):
        assert set(["start_date", "end_date", "teachers", "lectures", "summary"]).issubset(report.keys())
        assert report["start_date"] == START and report["end_date"] == END
        s = report["summary"]
        for k in ["total_lectures", "total_teachers", "executed", "absent", "cancelled", "pending", "execution_rate"]:
            assert k in s, f"missing summary key {k}"
        assert s["total_lectures"] == len(report["lectures"])
        assert s["total_teachers"] == len(report["teachers"])
        # summary must equal the sum of the per-status buckets
        assert s["executed"] + s["absent"] + s["cancelled"] + s["pending"] == s["total_lectures"]
        denom = s["executed"] + s["absent"]
        expected_rate = round(s["executed"] / denom * 100, 1) if denom else 0
        assert s["execution_rate"] == expected_rate

    def test_has_data_for_range(self, report):
        assert report["summary"]["total_lectures"] > 0, "expected lectures for 2026-04-01..2026-08-30"
        assert len(report["teachers"]) > 0

    def test_no_mongo_object_id_leak(self, report):
        for l in report["lectures"]:
            assert "_id" not in l.keys()
        for t in report["teachers"]:
            assert "_id" not in t.keys()

    def test_lecture_items_fields_and_status(self, report):
        for l in report["lectures"]:
            for k in ["lecture_id", "date", "course_name", "status", "status_label",
                      "teacher_name", "start_time", "end_time", "department_name"]:
                assert k in l, f"missing {k} in lecture item"
            assert l["status"] in VALID_STATUSES, l["status"]
            assert START <= l["date"] <= END

    def test_teacher_grouping_totals_match_flat_list(self, report):
        flat_total = len(report["lectures"])
        grouped_total = sum(t["total"] for t in report["teachers"])
        assert grouped_total == flat_total
        for t in report["teachers"]:
            assert t["total"] == len(t["lectures"])
            assert t["executed"] + t["absent"] + t["cancelled"] + t["pending"] == t["total"]
            assert isinstance(t["execution_rate"], (int, float))

    def test_default_dates_is_today(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/reports/teacher-attendance", timeout=120)
        assert r.status_code == 200
        d = r.json()
        assert d["start_date"] == d["end_date"]

    def test_faculty_filter_reduces_or_equals(self, admin_client, report):
        f = admin_client.get(f"{BASE_URL}/api/faculties", timeout=60)
        assert f.status_code == 200
        faculties = f.json()
        assert isinstance(faculties, list) and faculties
        fid = faculties[0]["id"]
        r = admin_client.get(
            f"{BASE_URL}/api/reports/teacher-attendance",
            params={"start_date": START, "end_date": END, "faculty_id": fid}, timeout=120)
        assert r.status_code == 200, r.text[:300]
        assert r.json()["summary"]["total_lectures"] <= report["summary"]["total_lectures"]

    def test_department_filter(self, admin_client, report):
        d = admin_client.get(f"{BASE_URL}/api/departments", timeout=60)
        assert d.status_code == 200
        depts = d.json()
        assert depts
        did = depts[0]["id"]
        r = admin_client.get(
            f"{BASE_URL}/api/reports/teacher-attendance",
            params={"start_date": START, "end_date": END, "department_id": did}, timeout=120)
        assert r.status_code == 200
        data = r.json()
        assert data["summary"]["total_lectures"] <= report["summary"]["total_lectures"]

    def test_invalid_date_format_does_not_500(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/reports/teacher-attendance",
                             params={"start_date": "not-a-date", "end_date": "also-bad"}, timeout=60)
        assert r.status_code != 500, r.text[:300]

    def test_reversed_range_returns_empty(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/reports/teacher-attendance",
                             params={"start_date": END, "end_date": START}, timeout=60)
        assert r.status_code == 200
        assert r.json()["summary"]["total_lectures"] == 0


class TestTeacherAttendanceExports:
    def test_excel_export(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/reports/teacher-attendance/export/excel",
                             params={"start_date": START, "end_date": END}, timeout=180)
        assert r.status_code == 200, r.text[:300]
        assert "spreadsheet" in r.headers.get("content-type", "").lower()
        assert r.content[:2] == b"PK", "not a valid xlsx (zip) payload"
        assert len(r.content) > 2000

    def test_pdf_export(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/reports/teacher-attendance/export/pdf",
                             params={"start_date": START, "end_date": END}, timeout=180)
        assert r.status_code == 200, r.text[:300]
        assert "pdf" in r.headers.get("content-type", "").lower()
        assert r.content[:4] == b"%PDF"

    def test_exports_require_auth(self):
        for path in ["excel", "pdf"]:
            r = requests.get(f"{BASE_URL}/api/reports/teacher-attendance/export/{path}", timeout=60)
            assert r.status_code in (401, 403), f"{path}: {r.status_code}"

    def test_export_with_filters(self, admin_client):
        d = admin_client.get(f"{BASE_URL}/api/departments", timeout=60).json()
        did = d[0]["id"]
        r = admin_client.get(f"{BASE_URL}/api/reports/teacher-attendance/export/excel",
                             params={"start_date": START, "end_date": END, "department_id": did}, timeout=180)
        assert r.status_code == 200, r.text[:300]
