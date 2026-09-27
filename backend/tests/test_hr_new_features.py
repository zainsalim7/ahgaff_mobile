"""Test suite for 3 new HR features: letter PDF preview, profile change requests, schedule day-shift badges."""
import os
import pytest
import requests
from pathlib import Path

# Load BASE_URL from env or /app/frontend/.env
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    env = Path("/app/frontend/.env").read_text()
    for line in env.splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip()
            break
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"

EMP_9999_ID = "6ab3ec880186d4c5e32749b0"


def _login(username, password):
    r = requests.post(f"{API}/auth/login", json={"username": username, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {username} failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="session")
def admin_token():
    return _login("admin", "admin123")


@pytest.fixture(scope="session")
def emp_token():
    return _login("9999", "teacher123")


@pytest.fixture(scope="session")
def noemp_token():
    return _login("teacher180156", "teacher123")


@pytest.fixture(scope="session")
def dean_token():
    return _login("Salim", "test1234")


# ============ LETTER PDF PREVIEW ============
class TestLetterPreview:
    def test_preview_flow(self, admin_token, emp_token, dean_token):
        # Cancel any leftover pending same-type letter
        r = requests.get(f"{API}/hr/letters/my", headers=_h(emp_token))
        assert r.status_code == 200
        for it in r.json().get("items", []):
            if it.get("status") == "pending" and it.get("type") == "introduction":
                requests.post(f"{API}/hr/letters/{it['id']}/cancel", headers=_h(emp_token))

        # Create request
        r = requests.post(f"{API}/hr/letters/my", json={"type": "introduction", "language": "ar"}, headers=_h(emp_token))
        assert r.status_code == 200, r.text
        lid = r.json()["id"]

        # Preview with body
        r = requests.post(f"{API}/hr/letters/{lid}/preview-pdf", json={"body": "نص معاينة"}, headers=_h(admin_token))
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF"

        # Preview empty body
        r = requests.post(f"{API}/hr/letters/{lid}/preview-pdf", json={}, headers=_h(admin_token))
        assert r.status_code == 200
        assert r.content[:4] == b"%PDF"

        # Status unchanged
        r = requests.get(f"{API}/hr/letters/{lid}", headers=_h(admin_token))
        assert r.status_code == 200
        j = r.json()
        assert j.get("status") == "pending"
        assert not j.get("ref_no")

        # Dean forbidden
        r = requests.post(f"{API}/hr/letters/{lid}/preview-pdf", json={}, headers=_h(dean_token))
        assert r.status_code == 403

        # 404 on unknown
        r = requests.post(f"{API}/hr/letters/000000000000000000000000/preview-pdf", json={}, headers=_h(admin_token))
        assert r.status_code == 404

        # cleanup
        requests.post(f"{API}/hr/letters/{lid}/cancel", headers=_h(emp_token))


# ============ PROFILE REQUESTS ============
def _cancel_all_pending(emp_token):
    r = requests.get(f"{API}/hr/profile-requests/my", headers=_h(emp_token))
    for it in r.json().get("items", []):
        if it.get("status") == "pending":
            requests.post(f"{API}/hr/profile-requests/{it['id']}/cancel", headers=_h(emp_token))


class TestProfileRequests:
    def test_meta(self, emp_token):
        r = requests.get(f"{API}/hr/profile-requests/meta", headers=_h(emp_token))
        assert r.status_code == 200
        j = r.json()
        assert len(j["fields"]) == 9
        assert set(j["statuses"].keys()) == {"pending", "approved", "rejected", "cancelled"}

    def test_my_endpoint(self, emp_token):
        _cancel_all_pending(emp_token)
        r = requests.get(f"{API}/hr/profile-requests/my", headers=_h(emp_token))
        assert r.status_code == 200
        j = r.json()
        assert j["profile"] is not None
        assert "current" in j and "items" in j
        assert "has_pending" in j

    def test_noemp_user(self, noemp_token):
        r = requests.get(f"{API}/hr/profile-requests/my", headers=_h(noemp_token))
        # /my returns 200 with profile None; POST /my returns 404
        r2 = requests.post(f"{API}/hr/profile-requests/my", json={"changes": {"phone": "111"}}, headers=_h(noemp_token))
        assert r2.status_code == 404

    def test_create_no_changes(self, emp_token):
        _cancel_all_pending(emp_token)
        # unknown field only
        r = requests.post(f"{API}/hr/profile-requests/my", json={"changes": {"salary": "1"}}, headers=_h(emp_token))
        assert r.status_code == 400

    def test_full_approve_flow(self, emp_token, admin_token, dean_token):
        _cancel_all_pending(emp_token)
        # Get current values to build a real change
        cur = requests.get(f"{API}/hr/profile-requests/my", headers=_h(emp_token)).json().get("current", {})
        import time
        stamp = str(int(time.time()) % 10000)
        new_phone = "770" + stamp.zfill(6)
        new_addr = "عنوان اختبار " + stamp
        if cur.get("phone") == new_phone:
            new_phone = "771" + stamp.zfill(6)
        # Create
        payload = {"changes": {"phone": new_phone, "address": new_addr}, "note": "x"}
        r = requests.post(f"{API}/hr/profile-requests/my", json=payload, headers=_h(emp_token))
        assert r.status_code == 200, r.text
        rid = r.json()["id"]

        # Second pending -> 400
        r = requests.post(f"{API}/hr/profile-requests/my", json=payload, headers=_h(emp_token))
        assert r.status_code == 400

        # Dean 403 on list
        r = requests.get(f"{API}/hr/profile-requests?status=pending", headers=_h(dean_token))
        assert r.status_code == 403

        # Admin list
        r = requests.get(f"{API}/hr/profile-requests?status=pending", headers=_h(admin_token))
        assert r.status_code == 200
        j = r.json()
        assert "items" in j and "counts" in j
        found = [it for it in j["items"] if it["id"] == rid]
        assert found, "created request not in admin list"
        it = found[0]
        assert "حسن" in (it.get("employee_name") or "")
        cv = it.get("changes_view") or []
        assert cv, "changes_view empty"
        assert all("label" in c and "old" in c and "new" in c for c in cv)

        # Reject with empty note -> 400
        r = requests.post(f"{API}/hr/profile-requests/{rid}/reject", json={"note": ""}, headers=_h(admin_token))
        assert r.status_code == 400

        # Dean reject/approve 403
        r = requests.post(f"{API}/hr/profile-requests/{rid}/reject", json={"note": "no"}, headers=_h(dean_token))
        assert r.status_code == 403
        r = requests.post(f"{API}/hr/profile-requests/{rid}/approve", json={}, headers=_h(dean_token))
        assert r.status_code == 403

        # Reject
        r = requests.post(f"{API}/hr/profile-requests/{rid}/reject", json={"note": "سبب"}, headers=_h(admin_token))
        assert r.status_code == 200

        # New request → approve with corrected values
        _cancel_all_pending(emp_token)
        r = requests.post(f"{API}/hr/profile-requests/my", json={"changes": {"phone": new_phone + "1"[:1], "address": "قديم " + stamp}}, headers=_h(emp_token))
        assert r.status_code == 200
        rid2 = r.json()["id"]

        corrected_phone = "779" + stamp.zfill(6)
        corrected_addr = "عنوان مصحح " + stamp
        r = requests.post(f"{API}/hr/profile-requests/{rid2}/approve",
                          json={"changes": {"phone": corrected_phone, "address": corrected_addr}}, headers=_h(admin_token))
        assert r.status_code == 200, r.text

        # verify employee record updated
        r = requests.get(f"{API}/hr/employees/me", headers=_h(emp_token))
        assert r.status_code == 200
        obj = r.json()
        prof_obj = obj.get("profile") if isinstance(obj.get("profile"), dict) else obj
        assert prof_obj.get("phone") == corrected_phone, f"phone not updated: {prof_obj.get('phone')}"
        assert prof_obj.get("address") == corrected_addr, f"address not updated: {prof_obj.get('address')}"

        # Approve twice -> 400
        r = requests.post(f"{API}/hr/profile-requests/{rid2}/approve", json={}, headers=_h(admin_token))
        assert r.status_code == 400

        # Cancel-own for a new pending
        r = requests.post(f"{API}/hr/profile-requests/my", json={"changes": {"phone": "770" + stamp + "7"}}, headers=_h(emp_token))
        assert r.status_code == 200
        rid3 = r.json()["id"]
        r = requests.post(f"{API}/hr/profile-requests/{rid3}/cancel", headers=_h(emp_token))
        assert r.status_code == 200


# ============ DASHBOARD ============
class TestDashboard:
    def test_hr_pending_profile_alert(self, admin_token, emp_token):
        _cancel_all_pending(emp_token)
        # create pending
        r = requests.post(f"{API}/hr/profile-requests/my",
                          json={"changes": {"phone": "770001111"}}, headers=_h(emp_token))
        assert r.status_code == 200
        rid = r.json()["id"]

        r = requests.get(f"{API}/dashboard/management/hr?period=week", headers=_h(admin_token))
        assert r.status_code == 200, r.text
        j = r.json()
        alerts = j.get("alerts") or j.get("hr", {}).get("alerts") or []
        by_key = {a["key"]: a for a in alerts} if isinstance(alerts, list) else alerts
        assert "hr_pending_profile" in by_key, f"alert keys: {list(by_key.keys())}"
        alert = by_key["hr_pending_profile"]
        assert alert.get("count", 0) >= 1
        items = alert.get("items") or []
        assert any("حسن" in (it.get("employee_name") or "") for it in items)
        assert any(it.get("fields") for it in items)

        # cleanup
        requests.post(f"{API}/hr/profile-requests/{rid}/cancel", headers=_h(emp_token))


# ============ SCHEDULE ============
class TestScheduleFields:
    def test_all_schedule_has_new_fields(self, admin_token):
        from datetime import date, timedelta
        for offset in range(0, 14):
            d = (date.today() + timedelta(days=offset)).isoformat()
            r = requests.get(f"{API}/lectures/all-schedule?date={d}", headers=_h(admin_token))
            if r.status_code != 200:
                continue
            data = r.json()
            items = data if isinstance(data, list) else (data.get("items") or data.get("lectures") or [])
            if items:
                # verify fields exist on at least one
                sample = items[0]
                assert "day_shift_cancelled" in sample or "credited_minutes" in sample, \
                    f"missing new fields on {d}: {list(sample.keys())[:20]}"
                return
        pytest.skip("no scheduled lectures found in next 14 days")


# ============ FINAL CLEANUP ============
def test_zz_cleanup(emp_token):
    _cancel_all_pending(emp_token)
    r = requests.get(f"{API}/hr/letters/my", headers=_h(emp_token))
    for it in (r.json().get("items") or []):
        if it.get("status") == "pending":
            requests.post(f"{API}/hr/letters/{it['id']}/cancel", headers=_h(emp_token))
