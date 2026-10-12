"""👥 دعم المجموعات في API الأستاذ: enrollments/students?group، lecture-stats?group، absent-lectures?group"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
COURSE_ID = "698f0000d803b27aab0120af"  # مقرر فيه مجموعتان: 1 (222222) و 2 (Saeed)


def _login(u, p):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": u, "password": p}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def admin():
    return _login("admin", "admin123")


@pytest.fixture(scope="module")
def g1_teacher():
    return _login("222222", "test1234")


def test_students_group_param_and_field(admin):
    all_ = requests.get(f"{BASE_URL}/api/enrollments/{COURSE_ID}/students", headers=admin).json()
    g1 = requests.get(f"{BASE_URL}/api/enrollments/{COURSE_ID}/students?group=1", headers=admin).json()
    assert 0 < len(g1) < len(all_)
    assert all(s["group"] == "1" for s in g1)
    assert "group" in all_[0]


def test_group_teacher_scoped_automatically(g1_teacher):
    r = requests.get(f"{BASE_URL}/api/enrollments/{COURSE_ID}/students?fields=id,group", headers=g1_teacher)
    assert r.status_code == 200
    assert r.json() and all(s["group"] == "1" for s in r.json())
    r = requests.get(f"{BASE_URL}/api/enrollments/{COURSE_ID}/students?group=2", headers=g1_teacher)
    assert r.status_code == 403


def test_lecture_stats_group(admin, g1_teacher):
    full = requests.get(f"{BASE_URL}/api/courses/{COURSE_ID}/lecture-stats", headers=admin).json()
    g1 = requests.get(f"{BASE_URL}/api/courses/{COURSE_ID}/lecture-stats?group=1", headers=admin).json()
    assert g1["total"] <= full["total"]
    mine = requests.get(f"{BASE_URL}/api/courses/{COURSE_ID}/lecture-stats", headers=g1_teacher)
    assert mine.status_code == 200 and mine.json() == g1
    assert requests.get(f"{BASE_URL}/api/courses/{COURSE_ID}/lecture-stats?group=2", headers=g1_teacher).status_code == 403


def test_absent_lectures_accepts_group(g1_teacher):
    r = requests.get(f"{BASE_URL}/api/absence-justifications/absent-lectures?course_id={COURSE_ID}&group=1", headers=g1_teacher)
    assert r.status_code == 200
    assert all((i.get("group") or "") == "1" for i in r.json()["items"])
