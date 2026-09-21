"""Tests for university_president read-only role."""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://schedule-hub-272.preview.emergentagent.com').rstrip('/')
READONLY_MSG = 'حسابك للاطلاع فقط — لا يمكن إجراء أي تعديل'


def _login(username, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {username}: {r.status_code} {r.text[:200]}"
    return r.json()


@pytest.fixture(scope="module")
def president():
    return _login("president", "test1234")


@pytest.fixture(scope="module")
def admin():
    return _login("admin", "admin123")


@pytest.fixture(scope="module")
def dean():
    return _login("Salim", "test1234")


@pytest.fixture(scope="module")
def teacher():
    return _login("9999", "teacher123")


def _h(tok):
    return {"Authorization": f"Bearer {tok['access_token']}"}


# ---------- login payload sanity ----------
def test_president_login_payload(president):
    user = president.get("user") or {}
    assert user.get("role") == "university_president", user
    perms = set(user.get("permissions") or [])
    for p in ["view_students", "view_reports", "export_reports", "manage_fee_receipts", "search_archive"]:
        assert p in perms, f"missing perm {p}; got {perms}"
    for banned in ["manage_students", "manage_courses", "manage_users"]:
        assert banned not in perms, f"unexpected perm {banned}"


# ---------- read access ----------
READ_ENDPOINTS = [
    "/api/students",
    "/api/teachers",
    "/api/courses",
    "/api/departments",
    "/api/faculties",
    "/api/reports/summary",
    "/api/fees/stats",
    "/api/fees/receipts",
    "/api/activity-logs?limit=5",
    "/api/lectures/all-schedule",
]


@pytest.mark.parametrize("path", READ_ENDPOINTS)
def test_president_read_endpoints(president, path):
    r = requests.get(f"{BASE_URL}{path}", headers=_h(president), timeout=60)
    assert r.status_code == 200, f"{path} -> {r.status_code}: {r.text[:200]}"


def test_president_dashboard_management(president):
    r = requests.get(f"{BASE_URL}/api/dashboard/management", headers=_h(president), timeout=60)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    scope = data.get("scope") or {}
    assert scope.get("label") == "كل الجامعة", scope
    assert scope.get("is_admin") is True, scope
    assert scope.get("read_only") is True, scope
    assert scope.get("can_filter") is True, scope
    assert data.get("finance") is not None
    numbers = data.get("numbers") or {}
    assert numbers.get("students") == 91, numbers


@pytest.mark.parametrize("fmt", ["pdf", "excel"])
def test_president_dashboard_export(president, fmt):
    r = requests.get(f"{BASE_URL}/api/dashboard/management/export?fmt={fmt}", headers=_h(president), timeout=90)
    assert r.status_code == 200, r.text[:200]
    assert r.headers.get("X-Filename"), "missing X-Filename"


# ---------- read-only guard ----------
GUARD_CASES = [
    ("POST",   "/api/students",                     {}),
    ("PUT",    "/api/courses/anyid",                {}),
    ("DELETE", "/api/students/anyid",               None),
    ("POST",   "/api/fees/receipts/anyid/approve",  {}),
    ("POST",   "/api/notifications/manual",         {}),
    ("PUT",    "/api/lectures/anyid",               {}),
    ("POST",   "/api/users",                        {}),
]


@pytest.mark.parametrize("method,path,body", GUARD_CASES)
def test_president_write_blocked(president, method, path, body):
    r = requests.request(method, f"{BASE_URL}{path}", headers=_h(president),
                         json=body if body is not None else None, timeout=30)
    assert r.status_code == 403, f"{method} {path} -> {r.status_code}: {r.text[:200]}"
    try:
        detail = r.json().get("detail")
    except Exception:
        detail = r.text
    assert detail == READONLY_MSG, f"{method} {path} detail={detail!r}"


@pytest.mark.parametrize("method,path,body", GUARD_CASES)
def test_admin_not_readonly_blocked(admin, method, path, body):
    r = requests.request(method, f"{BASE_URL}{path}", headers=_h(admin),
                         json=body if body is not None else None, timeout=30)
    # Admin may return various codes but never the read-only 403 message
    if r.status_code == 403:
        try:
            detail = r.json().get("detail")
        except Exception:
            detail = r.text
        assert detail != READONLY_MSG, f"admin got read-only msg on {method} {path}"


# ---------- guard whitelist ----------
def test_president_notifications_read_all(president):
    r = requests.put(f"{BASE_URL}/api/notifications/read-all", headers=_h(president), timeout=30)
    assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"


def test_president_change_password_wrong_current(president):
    r = requests.post(f"{BASE_URL}/api/auth/change-password", headers=_h(president),
                      json={"current_password": "wrong_xxx", "new_password": "NewPass1234"}, timeout=30)
    assert r.status_code == 400, f"expected 400 got {r.status_code}: {r.text[:200]}"
    try:
        detail = r.json().get("detail")
    except Exception:
        detail = r.text
    assert detail != READONLY_MSG


def test_president_renewal_status(president):
    r = requests.post(f"{BASE_URL}/api/fees/renewal-status", headers=_h(president),
                      json={"student_ids": []}, timeout=30)
    assert r.status_code != 403 or (r.json().get("detail") != READONLY_MSG)


def test_president_record_view(president):
    r = requests.post(f"{BASE_URL}/api/activity-logs/record-view", headers=_h(president),
                      json={}, timeout=30)
    assert r.status_code != 403 or (r.json().get("detail") != READONLY_MSG)


# ---------- admin & dean sanity ----------
def test_admin_renewal_status_ok(admin):
    r = requests.post(f"{BASE_URL}/api/fees/renewal-status", headers=_h(admin),
                      json={"student_ids": []}, timeout=30)
    assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"


def test_dean_dashboard_scope(dean):
    r = requests.get(f"{BASE_URL}/api/dashboard/management", headers=_h(dean), timeout=60)
    assert r.status_code == 200, r.text[:200]
    data = r.json()
    scope = data.get("scope") or {}
    assert scope.get("label") == "كلية الشريعة والقانون", scope
    numbers = data.get("numbers") or {}
    assert numbers.get("students") == 19, numbers


def test_teacher_dashboard_forbidden(teacher):
    r = requests.get(f"{BASE_URL}/api/dashboard/management", headers=_h(teacher), timeout=30)
    assert r.status_code == 403, r.status_code
