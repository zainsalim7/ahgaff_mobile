"""اختبارات ميزة البطاقة الرقمية للطالب (student_cards router)."""
import io
import os

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"


def _login(username, passwords):
    for pw in passwords:
        r = requests.post(f"{API}/auth/login", json={"username": username, "password": pw}, timeout=60)
        if r.status_code == 200:
            return r.json().get("access_token") or r.json().get("token")
    pytest.fail(f"Login failed for {username}: {r.status_code} {r.text[:300]}")


@pytest.fixture(scope="session")
def admin_token():
    return _login("admin", ["admin123"])


@pytest.fixture(scope="session")
def admin(admin_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {admin_token}"})
    return s


@pytest.fixture(scope="session")
def student_session():
    tok = _login("234", ["test1234", "234"])
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="session")
def active_student(admin):
    r = admin.get(f"{API}/students", timeout=60)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    items = data if isinstance(data, list) else data.get("students", [])
    assert items, "no students found"
    for s in items:
        if not s.get("is_alumni") and s.get("status", "active") == "active":
            return s
    return items[0]


def _photo_bytes():
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (200, 260), (10, 120, 90)).save(buf, format="JPEG")
    return buf.getvalue()


# ==================== بيانات البطاقة ====================
class TestCardData:
    def test_get_student_card(self, admin, active_student):
        sid = active_student.get("id") or active_student.get("_id")
        r = admin.get(f"{API}/students/{sid}/card", params={"base_url": BASE_URL}, timeout=60)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        for k in ("student_name", "nationality", "academic_year", "template", "card_token", "verify_url"):
            assert k in d, f"missing {k}"
        assert d["card_token"]
        assert d["verify_url"].startswith(BASE_URL)
        assert d["template"] in ("green", "dark", "horizontal")
        assert "_id" not in d

    def test_card_404_invalid_id(self, admin):
        r = admin.get(f"{API}/students/000000000000000000000000/card", timeout=60)
        assert r.status_code == 404

    def test_card_requires_auth(self, active_student):
        sid = active_student.get("id") or active_student.get("_id")
        r = requests.get(f"{API}/students/{sid}/card", timeout=60)
        assert r.status_code in (401, 403)


# ==================== إعدادات القالب ====================
class TestCardSettings:
    def test_get_put_template(self, admin, active_student):
        card = admin.get(f"{API}/students/{active_student.get('id') or active_student.get('_id')}/card", timeout=60).json()
        fid = card["faculty_id"]
        orig = admin.get(f"{API}/cards/settings/{fid}", timeout=60)
        assert orig.status_code == 200, orig.text[:300]
        original = orig.json()["template"]
        try:
            for tpl in ("green", "dark", "horizontal"):
                r = admin.put(f"{API}/cards/settings/{fid}", json={"template": tpl}, timeout=60)
                assert r.status_code == 200, r.text[:300]
                g = admin.get(f"{API}/cards/settings/{fid}", timeout=60)
                assert g.json()["template"] == tpl
            bad = admin.put(f"{API}/cards/settings/{fid}", json={"template": "rainbow"}, timeout=60)
            assert bad.status_code == 400, bad.text[:300]
        finally:
            admin.put(f"{API}/cards/settings/{fid}", json={"template": original}, timeout=60)


# ==================== الصور ====================
class TestPhotos:
    def test_admin_upload_photo_immediate(self, admin, active_student):
        sid = active_student.get("id") or active_student.get("_id")
        r = admin.post(f"{API}/students/{sid}/photo",
                       files={"file": ("TEST_photo.jpg", _photo_bytes(), "image/jpeg")}, timeout=90)
        assert r.status_code == 200, r.text[:400]
        assert r.json().get("photo_path")
        card = admin.get(f"{API}/students/{sid}/card", timeout=60).json()
        assert card["photo_path"] == r.json()["photo_path"]

    def test_reject_bad_content_type(self, admin, active_student):
        sid = active_student.get("id") or active_student.get("_id")
        r = admin.post(f"{API}/students/{sid}/photo",
                       files={"file": ("a.txt", b"hello", "text/plain")}, timeout=60)
        assert r.status_code == 400, r.text[:300]

    def test_student_photo_pending_and_approve(self, student_session, admin):
        # الطالب يرفع صورته
        me = student_session.get(f"{API}/students/me/card", params={"base_url": BASE_URL}, timeout=60)
        assert me.status_code == 200, me.text[:400]
        my_id = me.json()["student_db_id"]
        up = student_session.post(f"{API}/students/me/photo",
                                  files={"file": ("TEST_me.jpg", _photo_bytes(), "image/jpeg")}, timeout=90)
        assert up.status_code == 200, up.text[:400]
        assert up.json().get("pending_photo_path")
        # الأدمن يرى المعلقة
        pend = admin.get(f"{API}/pending-photos", timeout=60)
        assert pend.status_code == 200, pend.text[:300]
        ids = [p["id"] for p in pend.json()]
        assert my_id in ids, "pending photo not listed for admin"
        # اعتماد
        ap = admin.post(f"{API}/students/{my_id}/photo/approve", timeout=60)
        assert ap.status_code == 200, ap.text[:300]
        card = admin.get(f"{API}/students/{my_id}/card", timeout=60).json()
        assert card["photo_path"] == up.json()["pending_photo_path"]
        assert not card.get("pending_photo_path")
        # الاعتماد مرة ثانية بدون معلقة => 400
        again = admin.post(f"{API}/students/{my_id}/photo/approve", timeout=60)
        assert again.status_code == 400, again.text[:300]

    def test_student_photo_reject(self, student_session, admin):
        my_id = student_session.get(f"{API}/students/me/card", timeout=60).json()["student_db_id"]
        student_session.post(f"{API}/students/me/photo",
                             files={"file": ("TEST_me2.jpg", _photo_bytes(), "image/jpeg")}, timeout=90)
        rj = admin.post(f"{API}/students/{my_id}/photo/reject", timeout=60)
        assert rj.status_code == 200, rj.text[:300]
        card = admin.get(f"{API}/students/{my_id}/card", timeout=60).json()
        assert not card.get("pending_photo_path")

    def test_student_cannot_list_pending(self, student_session):
        r = student_session.get(f"{API}/pending-photos", timeout=60)
        assert r.status_code == 403, r.text[:300]


# ==================== التحقق العام ====================
class TestPublicVerify:
    def test_verify_active_student_valid(self, admin, active_student):
        sid = active_student.get("id") or active_student.get("_id")
        token = admin.get(f"{API}/students/{sid}/card", timeout=60).json()["card_token"]
        r = requests.get(f"{API}/verify/card/{token}", timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["valid"] is True, d
        assert d["student_name"]

    def test_verify_alumni_invalid(self, student_session):
        d0 = student_session.get(f"{API}/students/me/card", timeout=60).json()
        r = requests.get(f"{API}/verify/card/{d0['card_token']}", timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["valid"] is False, d
        assert "لم تعد سارية" in d["message"], d["message"]

    def test_verify_random_token(self):
        r = requests.get(f"{API}/verify/card/deadbeefdeadbeefdeadbeef", timeout=60)
        assert r.status_code == 200
        assert r.json()["valid"] is False

    def test_public_card_photo(self, admin, active_student):
        sid = active_student.get("id") or active_student.get("_id")
        token = admin.get(f"{API}/students/{sid}/card", timeout=60).json()["card_token"]
        r = requests.get(f"{API}/public/card-photo/{token}", timeout=60)
        assert r.status_code == 200, r.text[:200]
        assert r.headers.get("content-type", "").startswith("image/")
        assert len(r.content) > 100

    def test_public_card_photo_bad_token(self):
        r = requests.get(f"{API}/public/card-photo/notarealtoken", timeout=60)
        assert r.status_code == 404


# ==================== تنزيل PNG / PDF ====================
class TestDownload:
    @pytest.mark.parametrize("tpl", ["green", "dark", "horizontal"])
    def test_download_png_pdf_all_templates(self, admin, active_student, tpl):
        sid = active_student.get("id") or active_student.get("_id")
        fid = admin.get(f"{API}/students/{sid}/card", timeout=60).json()["faculty_id"]
        orig = admin.get(f"{API}/cards/settings/{fid}", timeout=60).json()["template"]
        try:
            admin.put(f"{API}/cards/settings/{fid}", json={"template": tpl}, timeout=60)
            png = admin.get(f"{API}/students/{sid}/card/download",
                            params={"fmt": "png", "base_url": BASE_URL}, timeout=120)
            assert png.status_code == 200, png.text[:400]
            assert png.content[:8] == b"\x89PNG\r\n\x1a\n"
            assert len(png.content) > 5000
            pdf = admin.get(f"{API}/students/{sid}/card/download",
                            params={"fmt": "pdf", "base_url": BASE_URL}, timeout=120)
            assert pdf.status_code == 200, pdf.text[:400]
            assert pdf.content[:4] == b"%PDF"
        finally:
            admin.put(f"{API}/cards/settings/{fid}", json={"template": orig}, timeout=60)

    def test_download_bad_fmt(self, admin, active_student):
        sid = active_student.get("id") or active_student.get("_id")
        r = admin.get(f"{API}/students/{sid}/card/download", params={"fmt": "svg"}, timeout=60)
        assert r.status_code == 422


# ==================== ماسح QR ====================
class TestQrScanner:
    def test_qr_lookup_by_card_token(self, admin, active_student):
        sid = active_student.get("id") or active_student.get("_id")
        card = admin.get(f"{API}/students/{sid}/card", timeout=60).json()
        r = admin.get(f"{API}/students/qr/{card['card_token']}", timeout=60)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert (d.get("id") or d.get("student", {}).get("id")) == sid, d

    def test_qr_lookup_legacy_qr_code(self, admin, active_student):
        sid = active_student.get("id") or active_student.get("_id")
        det = admin.get(f"{API}/students/{sid}", timeout=60)
        assert det.status_code == 200, det.text[:200]
        qr = det.json().get("qr_code")
        if not qr:
            pytest.skip("student has no legacy qr_code")
        r = admin.get(f"{API}/students/qr/{qr}", timeout=60)
        assert r.status_code == 200, r.text[:300]

    def test_qr_lookup_unknown(self, admin):
        r = admin.get(f"{API}/students/qr/UNKNOWN_TOKEN_XYZ", timeout=60)
        assert r.status_code == 404
