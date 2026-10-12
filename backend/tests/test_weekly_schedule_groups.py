"""Phase D tests — course groups integration with the weekly schedule.
Covers: POST/PUT /weekly-schedule with group, GET filters,
master-view group payload, generate-lectures stamping, and startup dedupe safety.
"""
import os
import pytest
import requests
from datetime import datetime, timedelta

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").rstrip("/")

FACULTY_ID = "698e4fb497fef774e66e93a6"
DEPT_ID = "698e501d97fef774e66e93a9"
LEVEL = 3
SECTION = ""
COURSE_ID = "698f0000d803b27aab0120af"
TEACHER_G1 = "698ad3da31ab437a06176e2a"
TEACHER_G2 = "698bc0593a8982391e9ba188"
ROOM_1 = "6ac249715ad87bb373bdca87"
ROOM_2 = "6ac249715ad87bb373bdca89"

TEST_DAY = "الأربعاء"
TEST_SLOT = 4


# ------------- fixtures -------------
@pytest.fixture(scope="module")
def admin_h():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}", "Content-Type": "application/json"}


@pytest.fixture(autouse=True)
def _cleanup_test_cells(admin_h):
    """Delete anything we created on day=الأربعاء slot=4 for this course before AND after."""
    yield
    r = requests.get(
        f"{BASE_URL}/api/weekly-schedule",
        params={"faculty_id": FACULTY_ID, "department_id": DEPT_ID, "level": LEVEL},
        headers=admin_h,
    )
    if r.status_code != 200:
        return
    data = r.json()
    slots = data.get("slots") if isinstance(data, dict) else data
    for s in (slots or []):
        if s.get("day") == TEST_DAY and s.get("slot_number") == TEST_SLOT and s.get("course_id") == COURSE_ID:
            requests.delete(f"{BASE_URL}/api/weekly-schedule/{s['id']}", headers=admin_h)


def _slot_payload(group=None, slot_type="practical", room=ROOM_1, teacher=TEACHER_G1):
    p = {
        "faculty_id": FACULTY_ID,
        "department_id": DEPT_ID,
        "level": LEVEL,
        "section": SECTION,
        "day": TEST_DAY,
        "slot_number": TEST_SLOT,
        "course_id": COURSE_ID,
        "teacher_id": teacher,
        "room_id": room,
        "slot_type": slot_type,
    }
    if group is not None:
        p["group"] = group
    return p


# ============== POST /weekly-schedule ==============
class TestPostSlotWithGroup:
    def test_practical_without_group_rejected(self, admin_h):
        r = requests.post(f"{BASE_URL}/api/weekly-schedule", headers=admin_h, json=_slot_payload(group=None))
        assert r.status_code == 400, r.text
        assert "مجموعة" in r.text or "اختر" in r.text

    def test_invalid_group_rejected(self, admin_h):
        r = requests.post(f"{BASE_URL}/api/weekly-schedule", headers=admin_h, json=_slot_payload(group="99"))
        assert r.status_code == 400, r.text

    def test_group1_succeeds_and_stores_group_name(self, admin_h):
        r = requests.post(f"{BASE_URL}/api/weekly-schedule", headers=admin_h, json=_slot_payload(group="1"))
        assert r.status_code in (200, 201), r.text
        slot_id = r.json().get("id")
        assert slot_id
        # GET and verify
        g = requests.get(
            f"{BASE_URL}/api/weekly-schedule",
            params={"faculty_id": FACULTY_ID, "department_id": DEPT_ID, "level": LEVEL},
            headers=admin_h,
        ).json()
        slots = g.get("slots") if isinstance(g, dict) else g
        row = next((s for s in slots if s.get("id") == slot_id), None)
        assert row, "created slot missing in GET"
        assert row.get("group") == "1"
        assert row.get("group_name"), "group_name must be returned"

    def test_two_different_groups_same_slot_ok(self, admin_h):
        r1 = requests.post(f"{BASE_URL}/api/weekly-schedule", headers=admin_h,
                           json=_slot_payload(group="1", room=ROOM_1, teacher=TEACHER_G1))
        assert r1.status_code in (200, 201), r1.text
        r2 = requests.post(f"{BASE_URL}/api/weekly-schedule", headers=admin_h,
                           json=_slot_payload(group="2", room=ROOM_2, teacher=TEACHER_G2))
        assert r2.status_code in (200, 201), f"second group should coexist: {r2.text}"
        # No auto time shift: both share the same start_time (fixture slot_number start)
        r1_body = r1.json(); r2_body = r2.json()
        assert not r2_body.get("shifted"), f"should not auto-shift: {r2_body.get('shifted')}"

    def test_duplicate_same_group_rejected(self, admin_h):
        r1 = requests.post(f"{BASE_URL}/api/weekly-schedule", headers=admin_h, json=_slot_payload(group="1"))
        assert r1.status_code in (200, 201)
        r2 = requests.post(f"{BASE_URL}/api/weekly-schedule", headers=admin_h, json=_slot_payload(group="1"))
        assert r2.status_code == 409, f"dup same group must conflict: {r2.status_code} {r2.text}"

    def test_theory_without_group_conflicts_with_grouped_cell(self, admin_h):
        r1 = requests.post(f"{BASE_URL}/api/weekly-schedule", headers=admin_h,
                           json=_slot_payload(group="1", room=ROOM_1, teacher=TEACHER_G1))
        assert r1.status_code in (200, 201)
        # Different course so no "same course" skip — use a THEORY slot for same section/time, no group
        # Simplest: same course theory=no group => should conflict with grouped cell (section busy)
        th = _slot_payload(group=None, slot_type="theory", room=ROOM_2, teacher=TEACHER_G2)
        r2 = requests.post(f"{BASE_URL}/api/weekly-schedule", headers=admin_h, json=th)
        assert r2.status_code == 409, f"theory (no group) must conflict with grouped cell: {r2.status_code} {r2.text}"

    def test_same_room_two_groups_rejected(self, admin_h):
        r1 = requests.post(f"{BASE_URL}/api/weekly-schedule", headers=admin_h,
                           json=_slot_payload(group="1", room=ROOM_1, teacher=TEACHER_G1))
        assert r1.status_code in (200, 201)
        r2 = requests.post(f"{BASE_URL}/api/weekly-schedule", headers=admin_h,
                           json=_slot_payload(group="2", room=ROOM_1, teacher=TEACHER_G2))
        assert r2.status_code == 409, f"same room must conflict: {r2.status_code} {r2.text}"

    def test_same_teacher_two_groups_rejected(self, admin_h):
        r1 = requests.post(f"{BASE_URL}/api/weekly-schedule", headers=admin_h,
                           json=_slot_payload(group="1", room=ROOM_1, teacher=TEACHER_G1))
        assert r1.status_code in (200, 201)
        r2 = requests.post(f"{BASE_URL}/api/weekly-schedule", headers=admin_h,
                           json=_slot_payload(group="2", room=ROOM_2, teacher=TEACHER_G1))
        assert r2.status_code == 409, f"same teacher must conflict: {r2.status_code} {r2.text}"


# ============== PUT /weekly-schedule/{id} ==============
class TestPutSlotGroup:
    def test_change_group_1_to_2(self, admin_h):
        r1 = requests.post(f"{BASE_URL}/api/weekly-schedule", headers=admin_h,
                           json=_slot_payload(group="1", room=ROOM_1, teacher=TEACHER_G2))
        assert r1.status_code in (200, 201), r1.text
        sid = r1.json()["id"]
        r2 = requests.put(f"{BASE_URL}/api/weekly-schedule/{sid}", headers=admin_h, json={"group": "2"})
        assert r2.status_code == 200, r2.text
        # verify
        g = requests.get(f"{BASE_URL}/api/weekly-schedule",
                         params={"faculty_id": FACULTY_ID, "department_id": DEPT_ID, "level": LEVEL},
                         headers=admin_h).json()
        slots = g.get("slots") if isinstance(g, dict) else g
        row = next((s for s in slots if s.get("id") == sid), None)
        assert row and row.get("group") == "2"

    def test_remove_group_from_practical_rejected(self, admin_h):
        r1 = requests.post(f"{BASE_URL}/api/weekly-schedule", headers=admin_h,
                           json=_slot_payload(group="1", slot_type="practical"))
        assert r1.status_code in (200, 201)
        sid = r1.json()["id"]
        r2 = requests.put(f"{BASE_URL}/api/weekly-schedule/{sid}", headers=admin_h, json={"group": ""})
        assert r2.status_code == 400, f"removing group from practical for grouped course must fail: {r2.status_code} {r2.text}"

    def test_change_to_practical_without_group_rejected(self, admin_h):
        # Create a theory cell with no group first — but theory alone also triggers section-busy if any,
        # so just create as theory then try to set practical.
        p = _slot_payload(group=None, slot_type="theory")
        r1 = requests.post(f"{BASE_URL}/api/weekly-schedule", headers=admin_h, json=p)
        assert r1.status_code in (200, 201), r1.text
        sid = r1.json()["id"]
        r2 = requests.put(f"{BASE_URL}/api/weekly-schedule/{sid}", headers=admin_h, json={"slot_type": "practical"})
        assert r2.status_code == 400, f"switch to practical without group must fail: {r2.status_code} {r2.text}"


# ============== GET master-view ==============
class TestMasterView:
    def test_master_view_contains_group_fields(self, admin_h):
        r1 = requests.post(f"{BASE_URL}/api/weekly-schedule", headers=admin_h,
                           json=_slot_payload(group="1"))
        assert r1.status_code in (200, 201)
        r = requests.get(f"{BASE_URL}/api/weekly-schedule/master-view",
                         params={"faculty_id": FACULTY_ID}, headers=admin_h)
        assert r.status_code == 200, r.text
        data = r.json()
        entries = data.get("entries") or []
        row = next((e for e in entries if e.get("course_id") == COURSE_ID and e.get("day") == TEST_DAY
                    and e.get("slot_number") == TEST_SLOT and e.get("group") == "1"), None)
        assert row, "master-view missing our group=1 cell"
        assert row.get("group") == "1" and row.get("group_name")

    def test_regular_get_includes_group_fields(self, admin_h):
        r1 = requests.post(f"{BASE_URL}/api/weekly-schedule", headers=admin_h,
                           json=_slot_payload(group="2", teacher=TEACHER_G2, room=ROOM_2))
        assert r1.status_code in (200, 201)
        g = requests.get(f"{BASE_URL}/api/weekly-schedule",
                         params={"faculty_id": FACULTY_ID, "department_id": DEPT_ID, "level": LEVEL},
                         headers=admin_h).json()
        slots = g.get("slots") if isinstance(g, dict) else g
        row = next((s for s in slots if s.get("course_id") == COURSE_ID and s.get("day") == TEST_DAY
                    and s.get("slot_number") == TEST_SLOT and s.get("group") == "2"), None)
        assert row
        assert "group_name" in row


# ============== generate-lectures ==============
class TestGenerateLecturesWithGroups:
    @pytest.fixture
    def seeded_two_groups(self, admin_h):
        """Create two parallel group cells; yield their slot ids and cleanup."""
        r1 = requests.post(f"{BASE_URL}/api/weekly-schedule", headers=admin_h,
                           json=_slot_payload(group="1", room=ROOM_1, teacher=TEACHER_G1))
        assert r1.status_code in (200, 201), r1.text
        r2 = requests.post(f"{BASE_URL}/api/weekly-schedule", headers=admin_h,
                           json=_slot_payload(group="2", room=ROOM_2, teacher=TEACHER_G2))
        assert r2.status_code in (200, 201), r2.text
        yield (r1.json()["id"], r2.json()["id"])

    def _window(self):
        # Pick a wednesday within the course's semester (الفصل الثاني 2025-12-20 → 2026-05-07)
        d = datetime(2026, 4, 1)  # Wednesday
        while d.weekday() != 2:
            d += timedelta(days=1)
        return d.strftime("%Y-%m-%d"), (d + timedelta(days=7)).strftime("%Y-%m-%d")

    def test_dry_run_two_candidates_per_date(self, admin_h, seeded_two_groups):
        start, end = self._window()
        r = requests.post(f"{BASE_URL}/api/weekly-schedule/generate-lectures", headers=admin_h, json={
            "faculty_id": FACULTY_ID, "department_id": DEPT_ID,
            "start_date": start, "end_date": end, "dry_run": True, "allow_past": True,
        })
        assert r.status_code == 200, r.text
        d = r.json()
        if d.get("skipped_no_time", 0) and d.get("to_create", 0) == 0:
            pytest.skip("no slot_times configured for this slot — can't test generation")
        # Expect at least 2 (one per group) if the window hits exactly one wednesday
        assert d.get("to_create", 0) >= 2, f"should include both groups: {d}"

    def test_real_generate_stamps_group_and_teacher(self, admin_h, seeded_two_groups):
        start, end = self._window()
        # Clean any leftover lectures in window before test
        from pymongo import MongoClient
        _c = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        _db = _c[os.environ.get("DB_NAME", "test_database")]
        _db.lectures.delete_many({"course_id": COURSE_ID, "date": {"$gte": start, "$lte": end}, "generated_from_schedule": True})

        r = requests.post(f"{BASE_URL}/api/weekly-schedule/generate-lectures", headers=admin_h, json={
            "faculty_id": FACULTY_ID, "department_id": DEPT_ID,
            "start_date": start, "end_date": end, "dry_run": False, "allow_past": True,
        })
        assert r.status_code == 200, r.text
        d = r.json()
        if d.get("skipped_no_time", 0) and (d.get("created", 0) == 0):
            pytest.skip("no slot_times")
        assert d.get("created", 0) >= 2, f"must create at least 2 (one per group): {d}"

        # Verify directly from Mongo (API GET filters teacher_id out at serialization layer)
        rows = list(_db.lectures.find({
            "course_id": COURSE_ID, "date": {"$gte": start, "$lte": end},
            "generated_from_schedule": True,
        }))
        g1 = [l for l in rows if l.get("group") == "1"]
        g2 = [l for l in rows if l.get("group") == "2"]
        assert g1 and g2, f"both groups must have lectures: g1={len(g1)} g2={len(g2)}"
        for l in g1:
            assert l.get("teacher_id") == TEACHER_G1, f"g1 teacher must be stamped: {l}"
            assert l.get("group_name")
            assert l.get("room"), "room must be stamped"
        for l in g2:
            assert l.get("teacher_id") == TEACHER_G2, f"g2 teacher: {l}"

        # Re-run → both groups already exist (dry_run)
        r2 = requests.post(f"{BASE_URL}/api/weekly-schedule/generate-lectures", headers=admin_h, json={
            "faculty_id": FACULTY_ID, "department_id": DEPT_ID,
            "start_date": start, "end_date": end, "dry_run": True, "allow_past": True,
        })
        d2 = r2.json()
        assert d2.get("to_create", 0) == 0, f"regen should skip both: {d2}"
        assert d2.get("already_exist", 0) >= 2

        # Cleanup created lectures
        _db.lectures.delete_many({"course_id": COURSE_ID, "date": {"$gte": start, "$lte": end},
                                  "generated_from_schedule": True})


# ============== Startup dedupe safety ==============
class TestStartupDedupe:
    def test_two_groups_survive_restart(self, admin_h):
        """Create 2 cells with different groups → restart backend → both must remain."""
        import subprocess, time
        r1 = requests.post(f"{BASE_URL}/api/weekly-schedule", headers=admin_h,
                           json=_slot_payload(group="1", room=ROOM_1, teacher=TEACHER_G1))
        assert r1.status_code in (200, 201)
        r2 = requests.post(f"{BASE_URL}/api/weekly-schedule", headers=admin_h,
                           json=_slot_payload(group="2", room=ROOM_2, teacher=TEACHER_G2))
        assert r2.status_code in (200, 201)
        sid1, sid2 = r1.json()["id"], r2.json()["id"]
        # restart backend
        subprocess.run(["sudo", "supervisorctl", "restart", "backend"], check=False)
        # wait for healthy
        for _ in range(30):
            try:
                h = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "admin", "password": "admin123"}, timeout=3)
                if h.status_code == 200:
                    admin_h["Authorization"] = f"Bearer {h.json()['access_token']}"
                    break
            except Exception:
                pass
            time.sleep(1)
        g = requests.get(f"{BASE_URL}/api/weekly-schedule",
                        params={"faculty_id": FACULTY_ID, "department_id": DEPT_ID, "level": LEVEL},
                        headers=admin_h).json()
        slots = g.get("slots") if isinstance(g, dict) else g
        ids = {s.get("id") for s in slots}
        assert sid1 in ids and sid2 in ids, f"both cells must survive dedupe: sid1in={sid1 in ids} sid2in={sid2 in ids}"
