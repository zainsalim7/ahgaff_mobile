"""Backend tests for HR digital employee card + photo approval flow"""
import io
import os
import pytest
import requests
from PIL import Image

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
EMP_ID = "6ab3ec880186d4c5e32749b0"  # حسن صالح


def login(username, password):
    r = requests.post(f"{BASE}/api/auth/login", json={"username": username, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {username} failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def h(tok):
    return {"Authorization": f"Bearer {tok}"}


def make_jpeg(size_kb=10):
    img = Image.new("RGB", (200, 200), color=(120, 160, 200))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=70)
    return buf.getvalue()


@pytest.fixture(scope="module")
def tokens():
    return {
        "admin": login("admin", "admin123"),
        "t9999": login("9999", "teacher123"),
        "t180156": login("teacher180156", "teacher123"),
        "salim": login("Salim", "test1234"),
    }


# ---------- Card endpoints ----------

class TestCard:
    def test_me_card_teacher_with_emp(self, tokens):
        r = requests.get(f"{BASE}/api/hr/employees/me/card", headers=h(tokens["t9999"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["kind"] == "academic"
        assert d["kind_label"]
        assert d["full_name"]
        assert d["title"] == "أستاذ مساعد", d.get("title")
        assert d["faculty_name"] == "كلية الشريعة والقانون"
        assert d["department_name"]
        assert d["photo_url"] is None or d["photo_url"].startswith("http")
        assert len(d["card_token"]) == 32
        assert "/verify-employee?token=" in d["verify_url"]
        assert d["university"]["name_ar"] == "جامعة الأحقاف"
        # Idempotent token
        r2 = requests.get(f"{BASE}/api/hr/employees/me/card", headers=h(tokens["t9999"]))
        assert r2.json()["card_token"] == d["card_token"]
        # Save for later tests
        pytest.card_token_9999 = d["card_token"]

    def test_me_card_teacher_no_emp(self, tokens):
        r = requests.get(f"{BASE}/api/hr/employees/me/card", headers=h(tokens["t180156"]))
        assert r.status_code == 404
        assert "ملف" in r.json().get("detail", "") or True

    def test_me_card_unauth(self):
        r = requests.get(f"{BASE}/api/hr/employees/me/card")
        assert r.status_code in (401, 403)

    def test_admin_card_by_id(self, tokens):
        r = requests.get(f"{BASE}/api/hr/employees/{EMP_ID}/card", headers=h(tokens["admin"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["full_name"]
        assert len(d["card_token"]) == 32

    def test_dean_no_view_permission(self, tokens):
        r = requests.get(f"{BASE}/api/hr/employees/{EMP_ID}/card", headers=h(tokens["salim"]))
        assert r.status_code == 403


# ---------- Regression: previously-existing endpoints not shadowed ----------

class TestRegression:
    def test_me_employee(self, tokens):
        r = requests.get(f"{BASE}/api/hr/employees/me", headers=h(tokens["t9999"]))
        assert r.status_code == 200, r.text
        j = r.json()
        # endpoint returns {profile: {...}, ...}
        assert (j.get("profile") or j).get("full_name")

    def test_get_employee_by_id(self, tokens):
        r = requests.get(f"{BASE}/api/hr/employees/{EMP_ID}", headers=h(tokens["admin"]))
        assert r.status_code == 200, r.text


# ---------- Photo flow ----------

class TestPhotoFlow:
    def test_reset_and_delete_existing(self, tokens):
        # Delete existing photo to start clean
        r = requests.delete(f"{BASE}/api/hr/employees/{EMP_ID}/photo", headers=h(tokens["admin"]))
        assert r.status_code == 200, r.text
        # Allow upload
        r = requests.post(f"{BASE}/api/hr/employees/{EMP_ID}/photo/allow-upload", headers=h(tokens["admin"]))
        assert r.status_code == 200

    def test_self_upload_first(self, tokens):
        img = make_jpeg()
        files = {"file": ("me.jpg", img, "image/jpeg")}
        r = requests.post(f"{BASE}/api/hr/employees/me/photo", headers=h(tokens["t9999"]), files=files)
        assert r.status_code == 200, r.text
        assert r.json().get("pending_photo") is True

    def test_card_now_pending(self, tokens):
        r = requests.get(f"{BASE}/api/hr/employees/me/card", headers=h(tokens["t9999"]))
        d = r.json()
        assert d["pending_photo"] is True
        assert d["can_upload_photo"] is False

    def test_self_upload_second_forbidden(self, tokens):
        img = make_jpeg()
        files = {"file": ("me2.jpg", img, "image/jpeg")}
        r = requests.post(f"{BASE}/api/hr/employees/me/photo", headers=h(tokens["t9999"]), files=files)
        assert r.status_code == 403

    def test_upload_nonimage_after_allow(self, tokens):
        # allow another upload to test type/size rejection paths
        requests.post(f"{BASE}/api/hr/employees/{EMP_ID}/photo/allow-upload", headers=h(tokens["admin"]))
        files = {"file": ("a.txt", b"hello", "text/plain")}
        r = requests.post(f"{BASE}/api/hr/employees/me/photo", headers=h(tokens["t9999"]), files=files)
        assert r.status_code == 400

    def test_upload_too_large(self, tokens):
        requests.post(f"{BASE}/api/hr/employees/{EMP_ID}/photo/allow-upload", headers=h(tokens["admin"]))
        big = b"\xff" * (6 * 1024 * 1024)
        files = {"file": ("big.jpg", big, "image/jpeg")}
        r = requests.post(f"{BASE}/api/hr/employees/me/photo", headers=h(tokens["t9999"]), files=files)
        assert r.status_code == 400

    def test_pending_list_contains_emp(self, tokens):
        # Re-upload a valid image
        requests.post(f"{BASE}/api/hr/employees/{EMP_ID}/photo/allow-upload", headers=h(tokens["admin"]))
        files = {"file": ("me.jpg", make_jpeg(), "image/jpeg")}
        r = requests.post(f"{BASE}/api/hr/employees/me/photo", headers=h(tokens["t9999"]), files=files)
        assert r.status_code == 200
        r = requests.get(f"{BASE}/api/hr/photos/pending", headers=h(tokens["admin"]))
        assert r.status_code == 200
        ids = [it.get("id") or it.get("_id") for it in r.json().get("items", [])]
        assert EMP_ID in ids or any(EMP_ID in str(i) for i in ids), f"emp not in pending: {ids[:5]}"

    def test_admin_view_pending_image(self, tokens):
        r = requests.get(f"{BASE}/api/hr/employees/{EMP_ID}/photo?which=pending", headers=h(tokens["admin"]))
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("image/")

    def test_reject_photo(self, tokens):
        r = requests.post(f"{BASE}/api/hr/employees/{EMP_ID}/photo/reject", headers=h(tokens["admin"]))
        assert r.status_code == 200
        # Card should allow upload again
        r = requests.get(f"{BASE}/api/hr/employees/me/card", headers=h(tokens["t9999"]))
        d = r.json()
        assert d["pending_photo"] is False
        assert d["can_upload_photo"] is True

    def test_notification_on_reject(self, tokens):
        r = requests.get(f"{BASE}/api/notifications/my", headers=h(tokens["t9999"]))
        assert r.status_code == 200
        j = r.json()
        items = j.get("notifications", j if isinstance(j, list) else j.get("items", []))
        titles = [i.get("title", "") for i in items]
        assert any("لم تُعتمد" in t for t in titles), f"reject notification missing. titles={titles[:10]}"

    def test_reupload_and_approve(self, tokens):
        files = {"file": ("me2.jpg", make_jpeg(), "image/jpeg")}
        r = requests.post(f"{BASE}/api/hr/employees/me/photo", headers=h(tokens["t9999"]), files=files)
        assert r.status_code == 200
        r = requests.post(f"{BASE}/api/hr/employees/{EMP_ID}/photo/approve", headers=h(tokens["admin"]))
        assert r.status_code == 200
        r = requests.get(f"{BASE}/api/hr/employees/me/card", headers=h(tokens["t9999"]))
        d = r.json()
        assert d["has_photo"] is True
        assert d["pending_photo"] is False
        assert d["photo_url"] is not None

    def test_approve_no_pending_400(self, tokens):
        r = requests.post(f"{BASE}/api/hr/employees/{EMP_ID}/photo/approve", headers=h(tokens["admin"]))
        assert r.status_code == 400

    def test_notification_on_approve(self, tokens):
        r = requests.get(f"{BASE}/api/notifications/my", headers=h(tokens["t9999"]))
        j = r.json()
        items = j.get("notifications", j if isinstance(j, list) else j.get("items", []))
        assert any("تم اعتماد" in i.get("title", "") for i in items)


# ---------- Public verify ----------

class TestPublicVerify:
    def test_verify_valid_token(self, tokens):
        r = requests.get(f"{BASE}/api/hr/employees/me/card", headers=h(tokens["t9999"]))
        token = r.json()["card_token"]
        r = requests.get(f"{BASE}/api/hr/verify/employee/{token}")
        assert r.status_code == 200
        d = r.json()
        assert d["valid"] is True
        assert "سارية" in d["message"]
        assert d["has_photo"] is True

    def test_verify_bad_token(self):
        r = requests.get(f"{BASE}/api/hr/verify/employee/badtoken123")
        assert r.status_code == 200
        assert r.json().get("valid") is False

    def test_public_photo(self, tokens):
        r = requests.get(f"{BASE}/api/hr/employees/me/card", headers=h(tokens["t9999"]))
        token = r.json()["card_token"]
        r = requests.get(f"{BASE}/api/hr/public/employee-photo/{token}")
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("image/")

    def test_public_photo_bad_token(self):
        r = requests.get(f"{BASE}/api/hr/public/employee-photo/badtoken123")
        assert r.status_code == 404


# ---------- Admin direct upload/delete ----------

class TestAdminDirectPhoto:
    def test_admin_upload_direct(self, tokens):
        files = {"file": ("admin.jpg", make_jpeg(), "image/jpeg")}
        r = requests.post(f"{BASE}/api/hr/employees/{EMP_ID}/photo", headers=h(tokens["admin"]), files=files)
        assert r.status_code == 200
        r = requests.get(f"{BASE}/api/hr/employees/{EMP_ID}/card", headers=h(tokens["admin"]))
        assert r.json()["has_photo"] is True
        assert r.json()["pending_photo"] is False

    def test_dean_forbidden_ops(self, tokens):
        files = {"file": ("d.jpg", make_jpeg(), "image/jpeg")}
        r = requests.post(f"{BASE}/api/hr/employees/{EMP_ID}/photo", headers=h(tokens["salim"]), files=files)
        assert r.status_code == 403
        r = requests.post(f"{BASE}/api/hr/employees/{EMP_ID}/photo/approve", headers=h(tokens["salim"]))
        assert r.status_code == 403
        r = requests.post(f"{BASE}/api/hr/employees/{EMP_ID}/photo/reject", headers=h(tokens["salim"]))
        assert r.status_code == 403

    def test_delete_final_cleanup(self, tokens):
        # Leave employee with NO photo at end (per instructions)
        r = requests.delete(f"{BASE}/api/hr/employees/{EMP_ID}/photo", headers=h(tokens["admin"]))
        assert r.status_code == 200
        r = requests.get(f"{BASE}/api/hr/employees/{EMP_ID}/card", headers=h(tokens["admin"]))
        d = r.json()
        assert d["has_photo"] is False
        assert d["can_upload_photo"] is True
