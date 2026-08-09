"""Tests for POST /api/teachers/export-selected/pdf and Excel regression."""
import os
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "admin", "password": "admin123"}, timeout=60)
    if r.status_code != 200:
        pytest.fail(f"Admin login failed {r.status_code}: {r.text[:300]}")
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"no token in {r.json()}"
    return tok


@pytest.fixture(scope="module")
def teacher_ids(admin_token):
    r = requests.get(f"{BASE_URL}/api/teachers?limit=5", headers={"Authorization": f"Bearer {admin_token}"}, timeout=90)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    items = data if isinstance(data, list) else (data.get("teachers") or data.get("items") or [])
    ids = [t.get("id") or t.get("_id") for t in items][:3]
    assert ids, "no teachers returned"
    return ids


def test_export_pdf_success(admin_token, teacher_ids):
    r = requests.post(f"{BASE_URL}/api/teachers/export-selected/pdf",
                      headers={"Authorization": f"Bearer {admin_token}"},
                      json={"teacher_ids": teacher_ids}, timeout=120)
    assert r.status_code == 200, r.text[:300]
    assert "application/pdf" in r.headers.get("content-type", "")
    assert r.content[:4] == b"%PDF", r.content[:20]
    assert len(r.content) > 1000
    assert "attachment" in r.headers.get("content-disposition", "")


def test_export_pdf_empty_ids(admin_token):
    r = requests.post(f"{BASE_URL}/api/teachers/export-selected/pdf",
                      headers={"Authorization": f"Bearer {admin_token}"},
                      json={"teacher_ids": []}, timeout=60)
    assert r.status_code == 400, r.status_code


def test_export_pdf_no_token(teacher_ids):
    r = requests.post(f"{BASE_URL}/api/teachers/export-selected/pdf", json={"teacher_ids": teacher_ids}, timeout=60)
    assert r.status_code in (401, 403), r.status_code


def test_export_pdf_bad_token(teacher_ids):
    r = requests.post(f"{BASE_URL}/api/teachers/export-selected/pdf",
                      headers={"Authorization": "Bearer invalid.token.here"},
                      json={"teacher_ids": teacher_ids}, timeout=60)
    assert r.status_code in (401, 403), r.status_code


def test_export_excel_regression(admin_token, teacher_ids):
    r = requests.post(f"{BASE_URL}/api/teachers/export-selected",
                      headers={"Authorization": f"Bearer {admin_token}"},
                      json={"teacher_ids": teacher_ids}, timeout=120)
    assert r.status_code == 200, r.text[:300]
    ct = r.headers.get("content-type", "")
    assert "spreadsheet" in ct or "excel" in ct, ct
    assert r.content[:2] == b"PK", r.content[:10]
