"""Tests for admin_tools orphan-lecture endpoints (unmatched / resolve / preview / execute)."""
import os

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"

SEM_SECOND = "698e5cc524745fb79482e099"


@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"username": "admin", "password": "admin123"}, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"admin login failed {r.status_code}: {r.text[:300]}")
    token = r.json().get("access_token") or r.json().get("token")
    if not token:
        pytest.fail(f"no token in login response: {r.text[:300]}")
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


# ---------- preview (regression) ----------
class TestPreview:
    def test_preview_structure(self, admin_client):
        r = admin_client.get(f"{API}/admin/backfill-lecture-semesters/preview", timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        for k in ("total_lectures", "without_semester", "matched_by_course",
                  "matched_by_semester", "matched_total", "unmatched"):
            assert k in d, f"missing {k}"
        assert isinstance(d["total_lectures"], int)
        assert isinstance(d["matched_by_course"], list)
        assert isinstance(d["matched_by_semester"], list)
        assert d["unmatched"] >= 0
        for sem in d["matched_by_semester"]:
            assert {"id", "name", "start_date", "end_date", "lectures_to_update"} <= set(sem)

    def test_execute_dry_run(self, admin_client):
        r = admin_client.post(f"{API}/admin/backfill-lecture-semesters/execute?dry_run=true", timeout=90)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["dry_run"] is True
        assert "total_updated" in d and isinstance(d["total_updated"], int)
        assert "details" in d and isinstance(d["details"], list)


# ---------- unmatched (orphans) ----------
class TestUnmatched:
    def test_unmatched_structure(self, admin_client):
        r = admin_client.get(f"{API}/admin/backfill-lecture-semesters/unmatched", timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert set(("count", "lectures", "semesters")) <= set(d)
        assert d["count"] == len(d["lectures"])
        assert len(d["semesters"]) > 0
        for s in d["semesters"]:
            assert {"id", "name", "status"} <= set(s)
        for l in d["lectures"]:
            assert {"id", "course_name", "date"} <= set(l)
            assert "_id" not in l

    def test_unmatched_matches_preview(self, admin_client):
        p = admin_client.get(f"{API}/admin/backfill-lecture-semesters/preview", timeout=60).json()
        u = admin_client.get(f"{API}/admin/backfill-lecture-semesters/unmatched", timeout=60).json()
        assert u["count"] == p["unmatched"], (
            f"unmatched count mismatch: list={u['count']} preview={p['unmatched']}"
        )

    def test_unmatched_requires_auth(self):
        r = requests.get(f"{API}/admin/backfill-lecture-semesters/unmatched", timeout=30)
        assert r.status_code in (401, 403), r.status_code


# ---------- resolve validation ----------
class TestResolveValidation:
    def test_empty_lecture_ids_400(self, admin_client):
        r = admin_client.post(f"{API}/admin/backfill-lecture-semesters/resolve",
                              json={"lecture_ids": [], "action": "delete"}, timeout=30)
        assert r.status_code == 400, r.text[:300]

    def test_assign_without_semester_400(self, admin_client):
        # use a real orphan id if available, else a syntactically valid ObjectId
        u = admin_client.get(f"{API}/admin/backfill-lecture-semesters/unmatched", timeout=60).json()
        lid = u["lectures"][0]["id"] if u["count"] else "507f1f77bcf86cd799439011"
        r = admin_client.post(f"{API}/admin/backfill-lecture-semesters/resolve",
                              json={"lecture_ids": [lid], "action": "assign"}, timeout=30)
        assert r.status_code == 400, r.text[:300]

    def test_bad_action_400(self, admin_client):
        r = admin_client.post(f"{API}/admin/backfill-lecture-semesters/resolve",
                              json={"lecture_ids": ["507f1f77bcf86cd799439011"], "action": "bogus"},
                              timeout=30)
        assert r.status_code == 400, r.text[:300]

    def test_invalid_object_ids_400(self, admin_client):
        r = admin_client.post(f"{API}/admin/backfill-lecture-semesters/resolve",
                              json={"lecture_ids": ["not-an-oid"], "action": "delete"}, timeout=30)
        assert r.status_code == 400, r.text[:300]

    def test_assign_unknown_semester_404(self, admin_client):
        r = admin_client.post(f"{API}/admin/backfill-lecture-semesters/resolve",
                              json={"lecture_ids": ["507f1f77bcf86cd799439011"],
                                    "action": "assign",
                                    "semester_id": "507f1f77bcf86cd799439099"}, timeout=30)
        assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text[:300]}"
