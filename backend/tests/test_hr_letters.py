"""Backend tests for HR Letters + bulk photo approvals + dashboard alerts."""
import io
import os
import re
import struct
import zlib

import pytest
import requests

def _read_env():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip()
    except Exception:
        pass
    raise RuntimeError("REACT_APP_BACKEND_URL not configured")


BASE_URL = _read_env().rstrip("/")
API = f"{BASE_URL}/api"

EMP_9999_ID = "6ab3ec880186d4c5e32749b0"

# ---------- helpers ----------

def _login(username, password):
    r = requests.post(f"{API}/auth/login", json={"username": username, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {username} failed: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, r.text
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def admin():
    return _login("admin", "admin123")


@pytest.fixture(scope="module")
def emp():
    return _login("9999", "teacher123")


@pytest.fixture(scope="module")
def other_teacher():
    return _login("teacher180156", "teacher123")


@pytest.fixture(scope="module")
def dean():
    return _login("Salim", "test1234")


def _tiny_png():
    """1x1 PNG via zlib."""
    sig = b"\x89PNG\r\n\x1a\n"
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    raw = b"\x00\xff\x00\x00"
    idat = chunk(b"IDAT", zlib.compress(raw))
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


def _tiny_jpeg():
    # Minimal 1x1 JPEG bytes
    import base64
    b64 = ("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJ"
           "CQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEA"
           "AAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6"
           "Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx"
           "8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==")
    return base64.b64decode(b64)


def _cleanup_pending_letter(admin, emp_id, ltype):
    """Cancel any existing pending letter of a type for emp."""
    r = requests.get(f"{API}/hr/letters", params={"status": "pending", "employee_id": emp_id}, headers=admin)
    for it in r.json().get("items", []):
        if it.get("type") == ltype:
            requests.post(f"{API}/hr/letters/{it['id']}/cancel", headers=admin)


# ---------- meta ----------

def test_meta(emp):
    r = requests.get(f"{API}/hr/letters/meta", headers=emp)
    assert r.status_code == 200
    d = r.json()
    assert set(d["types"].keys()) == {"introduction", "experience", "continuity", "addressed"}
    assert "types_en" in d and set(d["languages"].keys()) == {"ar", "en"}
    assert "statuses" in d


# ---------- employee flow ----------

def test_my_letters_teacher180156_no_employee(other_teacher):
    r = requests.get(f"{API}/hr/letters/my", headers=other_teacher)
    assert r.status_code == 200
    assert r.json()["profile"] is None


def test_my_letters_9999_has_profile(emp):
    r = requests.get(f"{API}/hr/letters/my", headers=emp)
    assert r.status_code == 200
    d = r.json()
    assert d["profile"] and d["profile"]["id"] == EMP_9999_ID
    assert isinstance(d["items"], list)


def test_request_letter_invalid_type(emp):
    r = requests.post(f"{API}/hr/letters/my", json={"type": "bad", "language": "ar"}, headers=emp)
    assert r.status_code == 400


def test_request_letter_addressed_missing_target(emp):
    r = requests.post(f"{API}/hr/letters/my", json={"type": "addressed", "language": "ar"}, headers=emp)
    assert r.status_code == 400


def test_request_letter_teacher180156_no_employee(other_teacher):
    r = requests.post(f"{API}/hr/letters/my", json={"type": "introduction", "language": "ar"}, headers=other_teacher)
    assert r.status_code == 404


def test_request_and_cancel_and_duplicate(admin, emp):
    _cleanup_pending_letter(admin, EMP_9999_ID, "introduction")
    r = requests.post(f"{API}/hr/letters/my", json={"type": "introduction", "language": "ar", "purpose": "x"}, headers=emp)
    assert r.status_code in (200, 201), r.text
    lid = r.json()["id"]
    # duplicate
    r2 = requests.post(f"{API}/hr/letters/my", json={"type": "introduction", "language": "ar"}, headers=emp)
    assert r2.status_code == 400
    # cancel
    rc = requests.post(f"{API}/hr/letters/{lid}/cancel", headers=emp)
    assert rc.status_code == 200
    # verify cancelled
    rg = requests.get(f"{API}/hr/letters/{lid}", headers=emp)
    assert rg.status_code == 200 and rg.json()["status"] == "cancelled"


# ---------- admin flow + reject + approve ----------

def test_admin_list(admin):
    r = requests.get(f"{API}/hr/letters", params={"status": "pending"}, headers=admin)
    assert r.status_code == 200
    d = r.json()
    assert "items" in d and "counts" in d


def test_admin_get_letter_draft_body(admin, emp):
    _cleanup_pending_letter(admin, EMP_9999_ID, "introduction")
    r = requests.post(f"{API}/hr/letters/my", json={"type": "introduction", "language": "ar", "purpose": "اختبار"}, headers=emp)
    lid = r.json()["id"]
    g = requests.get(f"{API}/hr/letters/{lid}", headers=admin)
    assert g.status_code == 200
    d = g.json()
    assert "draft_body" in d and "جامعة الأحقاف" in d["draft_body"]
    assert "حسن صالح" in d["draft_body"]
    # employee_name/type_label populated
    listr = requests.get(f"{API}/hr/letters", params={"status": "pending"}, headers=admin).json()
    row = next((x for x in listr["items"] if x["id"] == lid), None)
    assert row and row.get("employee_name") and row.get("type_label")
    # Cleanup
    requests.post(f"{API}/hr/letters/{lid}/cancel", headers=admin)


def test_reject_flow_and_notification(admin, emp):
    _cleanup_pending_letter(admin, EMP_9999_ID, "experience")
    lid = requests.post(f"{API}/hr/letters/my", json={"type": "experience", "language": "ar"}, headers=emp).json()["id"]
    r0 = requests.post(f"{API}/hr/letters/{lid}/reject", json={"note": ""}, headers=admin)
    assert r0.status_code == 400
    r1 = requests.post(f"{API}/hr/letters/{lid}/reject", json={"note": "غير مكتمل"}, headers=admin)
    assert r1.status_code == 200
    g = requests.get(f"{API}/hr/letters/{lid}", headers=admin).json()
    assert g["status"] == "rejected" and g.get("decision_note") == "غير مكتمل"
    # notification on employee
    n = requests.get(f"{API}/notifications/my", headers=emp).json()
    items = n.get("notifications") or n.get("items") or (n if isinstance(n, list) else [])
    titles = [x.get("title", "") for x in items]
    assert any(t.startswith("لم يُعتمد طلب") for t in titles), titles[:5]
    # delete rejected -> 200
    dl = requests.delete(f"{API}/hr/letters/{lid}", headers=admin)
    assert dl.status_code == 200


def test_approve_flow_and_pdf_and_verify(admin, emp):
    _cleanup_pending_letter(admin, EMP_9999_ID, "continuity")
    lid = requests.post(f"{API}/hr/letters/my", json={"type": "continuity", "language": "ar"}, headers=emp).json()["id"]
    r = requests.post(f"{API}/hr/letters/{lid}/approve", json={"body": "نص مخصص للاختبار"}, headers=admin)
    assert r.status_code == 200
    g = requests.get(f"{API}/hr/letters/{lid}", headers=admin).json()
    assert g["status"] == "approved"
    assert g["body"] == "نص مخصص للاختبار"
    assert re.match(r"^HR-L-\d{4}-\d{4}$", g["ref_no"])
    assert re.match(r"^[0-9a-f]{32}$", g["verify_token"])
    assert g.get("issue_date")
    assert g.get("snapshot", {}).get("name")
    # approve again -> 400
    r2 = requests.post(f"{API}/hr/letters/{lid}/approve", json={"body": "x"}, headers=admin)
    assert r2.status_code == 400
    # delete approved -> 400
    d = requests.delete(f"{API}/hr/letters/{lid}", headers=admin)
    assert d.status_code == 400
    # PDF admin
    p = requests.get(f"{API}/hr/letters/{lid}/pdf", headers=admin)
    assert p.status_code == 200
    assert p.headers.get("content-type", "").startswith("application/pdf")
    assert p.content.startswith(b"%PDF") and len(p.content) > 5000
    # PDF owner
    p2 = requests.get(f"{API}/hr/letters/{lid}/pdf", headers=emp)
    assert p2.status_code == 200 and p2.content.startswith(b"%PDF")
    # PDF other teacher -> 403
    other = _login("teacher180156", "teacher123")
    p3 = requests.get(f"{API}/hr/letters/{lid}/pdf", headers=other)
    assert p3.status_code == 403
    # public verify
    v = requests.get(f"{API}/hr/verify/letter/{g['verify_token']}")
    assert v.status_code == 200 and v.json()["valid"] is True
    assert v.json()["ref_no"] == g["ref_no"]
    v2 = requests.get(f"{API}/hr/verify/letter/badtoken")
    assert v2.status_code == 200 and v2.json()["valid"] is False
    # employee notif approve
    n = requests.get(f"{API}/notifications/my", headers=emp).json()
    items = n.get("notifications") or n.get("items") or (n if isinstance(n, list) else [])
    assert any(x.get("title", "").startswith("صدر") for x in items)


def test_pdf_pending_returns_400(admin, emp):
    _cleanup_pending_letter(admin, EMP_9999_ID, "introduction")
    lid = requests.post(f"{API}/hr/letters/my", json={"type": "introduction", "language": "ar"}, headers=emp).json()["id"]
    p = requests.get(f"{API}/hr/letters/{lid}/pdf", headers=admin)
    assert p.status_code == 400
    requests.post(f"{API}/hr/letters/{lid}/cancel", headers=admin)


# ---------- direct issue ----------

def test_direct_issue_by_admin(admin):
    r = requests.post(f"{API}/hr/letters", json={"employee_id": EMP_9999_ID, "type": "experience", "language": "en", "addressed_to": "Embassy of Malaysia"}, headers=admin)
    assert r.status_code == 200, r.text
    lid = r.json()["id"]
    g = requests.get(f"{API}/hr/letters/{lid}", headers=admin).json()
    assert g["status"] == "approved"
    assert g.get("direct") is True
    assert g.get("ref_no", "").startswith("HR-L-")


# ---------- dean permissions ----------

def test_dean_forbidden(dean):
    r = requests.get(f"{API}/hr/letters", headers=dean)
    assert r.status_code == 403
    r2 = requests.post(f"{API}/hr/letters", json={"employee_id": EMP_9999_ID, "type": "introduction"}, headers=dean)
    assert r2.status_code == 403
    r3 = requests.put(f"{API}/hr/letters/settings", json={"signer_name": "x"}, headers=dean)
    assert r3.status_code == 403


# ---------- settings ----------

def test_settings_get_put(admin):
    r = requests.get(f"{API}/hr/letters/settings", headers=admin)
    assert r.status_code == 200
    d = r.json()
    assert "signer_name" in d and "has_letterhead" in d and "has_signature" in d
    payload = {"signer_name": "د. اختبار", "signer_title": "مدير شؤون الموظفين", "signer_name_en": "Dr Test",
               "signer_title_en": "HR Director", "footer_ar": "", "footer_en": "", "top_margin_mm": 45, "bottom_margin_mm": 35}
    p = requests.put(f"{API}/hr/letters/settings", json=payload, headers=admin)
    assert p.status_code == 200
    d2 = requests.get(f"{API}/hr/letters/settings", headers=admin).json()
    assert d2["signer_name"] == "د. اختبار" and d2["signer_name_en"] == "Dr Test"
    assert d2["top_margin_mm"] == 45


def test_signature_upload_delete_reupload(admin):
    files = {"file": ("sig.png", _tiny_png(), "image/png")}
    r = requests.post(f"{API}/hr/letters/settings/signature", files=files, headers=admin)
    assert r.status_code == 200
    g = requests.get(f"{API}/hr/letters/settings", headers=admin).json()
    assert g["has_signature"] is True
    img = requests.get(f"{API}/hr/letters/settings/image/signature", headers=admin)
    assert img.status_code == 200 and img.headers["content-type"].startswith("image/")
    d = requests.delete(f"{API}/hr/letters/settings/signature", headers=admin)
    assert d.status_code == 200
    g2 = requests.get(f"{API}/hr/letters/settings", headers=admin).json()
    assert g2["has_signature"] is False
    # re-upload so signature exists after tests
    files = {"file": ("sig.png", _tiny_png(), "image/png")}
    r2 = requests.post(f"{API}/hr/letters/settings/signature", files=files, headers=admin)
    assert r2.status_code == 200


def test_letterhead_bad_content_type(admin):
    files = {"file": ("x.txt", b"hello", "text/plain")}
    r = requests.post(f"{API}/hr/letters/settings/letterhead", files=files, headers=admin)
    assert r.status_code == 400


# ---------- bulk photos ----------

def _get_pending_photo_ids(admin):
    r = requests.get(f"{API}/hr/photos/pending", headers=admin)
    return [it.get("id") or it.get("_id") for it in r.json().get("items", [])]


def test_bulk_photo_approve(admin, emp):
    # allow upload
    a = requests.post(f"{API}/hr/employees/{EMP_9999_ID}/photo/allow-upload", headers=admin)
    assert a.status_code == 200
    # upload
    files = {"file": ("me.jpg", _tiny_jpeg(), "image/jpeg")}
    up = requests.post(f"{API}/hr/employees/me/photo", files=files, headers=emp)
    assert up.status_code == 200, up.text
    ids = _get_pending_photo_ids(admin)
    assert EMP_9999_ID in ids
    # bulk approve
    r = requests.post(f"{API}/hr/photos/bulk", json={"ids": [EMP_9999_ID], "action": "approve"}, headers=admin)
    assert r.status_code == 200 and r.json().get("count") == 1
    # verify
    card = requests.get(f"{API}/hr/employees/me/card", headers=emp).json()
    assert card.get("has_photo") is True


def test_bulk_photo_reject(admin, emp):
    a = requests.post(f"{API}/hr/employees/{EMP_9999_ID}/photo/allow-upload", headers=admin)
    assert a.status_code == 200
    files = {"file": ("me.jpg", _tiny_jpeg(), "image/jpeg")}
    up = requests.post(f"{API}/hr/employees/me/photo", files=files, headers=emp)
    assert up.status_code == 200
    r = requests.post(f"{API}/hr/photos/bulk", json={"ids": [EMP_9999_ID], "action": "reject"}, headers=admin)
    assert r.status_code == 200 and r.json().get("count") == 1
    card = requests.get(f"{API}/hr/employees/me/card", headers=emp).json()
    assert card.get("can_upload_photo") is True


def test_bulk_photo_validation(admin, dean):
    r1 = requests.post(f"{API}/hr/photos/bulk", json={"ids": [], "action": "approve"}, headers=admin)
    assert r1.status_code == 400
    r2 = requests.post(f"{API}/hr/photos/bulk", json={"ids": [EMP_9999_ID], "action": "nuke"}, headers=admin)
    assert r2.status_code == 400
    r3 = requests.post(f"{API}/hr/photos/bulk", json={"ids": [EMP_9999_ID], "action": "approve"}, headers=dean)
    assert r3.status_code == 403


# ---------- dashboard alerts ----------

def test_dashboard_hr_alerts_letters_and_photos(admin, emp):
    # create a pending photo
    requests.post(f"{API}/hr/employees/{EMP_9999_ID}/photo/allow-upload", headers=admin)
    files = {"file": ("me.jpg", _tiny_jpeg(), "image/jpeg")}
    requests.post(f"{API}/hr/employees/me/photo", files=files, headers=emp)
    # create a pending letter
    _cleanup_pending_letter(admin, EMP_9999_ID, "introduction")
    lid = requests.post(f"{API}/hr/letters/my", json={"type": "introduction", "language": "ar"}, headers=emp).json()["id"]
    # fetch dashboard
    d = requests.get(f"{API}/dashboard/management/hr", params={"period": "week"}, headers=admin)
    assert d.status_code == 200
    data = d.json()
    alerts = (data.get("hr") or data).get("alerts") if isinstance(data, dict) else []
    if not alerts:
        alerts = data.get("alerts", [])
    keys = {a["key"]: a for a in alerts}
    assert "hr_pending_photos" in keys and "hr_pending_letters" in keys
    assert keys["hr_pending_photos"]["count"] >= 1
    assert keys["hr_pending_letters"]["count"] >= 1
    assert keys["hr_pending_photos"]["route"] == "/hr-photo-approvals"
    assert keys["hr_pending_letters"]["route"] == "/hr-letters"
    names_photo = " ".join(x.get("employee_name", "") for x in keys["hr_pending_photos"]["items"])
    assert "حسن صالح" in names_photo
    # cleanup: reject photo, cancel letter
    requests.post(f"{API}/hr/photos/bulk", json={"ids": [EMP_9999_ID], "action": "reject"}, headers=admin)
    requests.post(f"{API}/hr/letters/{lid}/cancel", headers=admin)


# ---------- final cleanup ----------

def test_zz_cleanup(admin, emp):
    # cancel any pending letters for emp
    r = requests.get(f"{API}/hr/letters", params={"status": "pending", "employee_id": EMP_9999_ID}, headers=admin)
    for it in r.json().get("items", []):
        requests.post(f"{API}/hr/letters/{it['id']}/cancel", headers=admin)
    # ensure no pending photo
    card = requests.get(f"{API}/hr/employees/me/card", headers=emp).json()
    if card.get("pending_photo"):
        requests.post(f"{API}/hr/photos/bulk", json={"ids": [EMP_9999_ID], "action": "reject"}, headers=admin)
    # ensure signer_name non-empty
    s = requests.get(f"{API}/hr/letters/settings", headers=admin).json()
    if not s.get("signer_name"):
        requests.put(f"{API}/hr/letters/settings", json={
            "signer_name": "د. اختبار", "signer_title": s.get("signer_title", "مدير شؤون الموظفين"),
            "signer_name_en": s.get("signer_name_en", ""), "signer_title_en": s.get("signer_title_en", ""),
            "footer_ar": s.get("footer_ar", ""), "footer_en": s.get("footer_en", ""),
            "top_margin_mm": s.get("top_margin_mm", 45), "bottom_margin_mm": s.get("bottom_margin_mm", 35)
        }, headers=admin)
