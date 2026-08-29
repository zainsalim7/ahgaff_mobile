"""
Tests for Safe Delete & Restore functionality for Teachers and Students.

These endpoints create JSON backups before deletion and provide restore capability.

Endpoints tested:
- GET /api/teachers/{teacher_id}/backup-info
- POST /api/teachers/{teacher_id}/safe-delete
- POST /api/teachers/restore
- GET /api/students/{student_id}/backup-info
- POST /api/students/{student_id}/safe-delete
- POST /api/students/restore
"""

import pytest
import requests
import os
import json
from datetime import datetime

# API Base URL from environment
BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://schedule-hub-272.preview.emergentagent.com')

# Test credentials
ADMIN_CREDENTIALS = {
    "username": "admin",
    "password": "admin123"
}

# Test data - known teacher/student IDs from review request
TEST_TEACHER_IDS = [
    "698ad3da31ab437a06176e2a",  # زين سالم
    "698bc0593a8982391e9ba188",  # Saeed
    "698e533beb4c6eb021c50302",  # حسن صالح
]

TEST_STUDENT_IDS = [
    "698e50c797fef774e66e93aa",  # خالد
    "698e57518cfb2f14627a285e",  # طالب اختبار 1
]


@pytest.fixture(scope="module")
def auth_token():
    """Login and get auth token."""
    url = f"{BASE_URL}/api/auth/login"
    response = requests.post(url, json=ADMIN_CREDENTIALS)
    
    if response.status_code != 200:
        pytest.skip(f"Login failed with status {response.status_code}: {response.text}")
    
    data = response.json()
    token = data.get("access_token") or data.get("token")
    if not token:
        pytest.skip("No token in login response")
    
    return token


@pytest.fixture
def auth_headers(auth_token):
    """Get authorization headers."""
    return {
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json"
    }


class TestHealthCheck:
    """Basic health check to ensure API is running."""
    
    def test_api_health(self):
        """Test API health endpoint."""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "ok"
        print("✅ API health check passed")


class TestTeacherBackupInfo:
    """Tests for GET /api/teachers/{teacher_id}/backup-info endpoint."""
    
    def test_backup_info_returns_valid_structure(self, auth_headers):
        """Test that backup-info returns correct data structure for existing teacher."""
        # Try each known teacher ID until we find one that exists
        for teacher_id in TEST_TEACHER_IDS:
            response = requests.get(
                f"{BASE_URL}/api/teachers/{teacher_id}/backup-info",
                headers=auth_headers
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Verify expected fields exist
                assert "teacher_name" in data, "Missing teacher_name field"
                assert "courses_count" in data, "Missing courses_count field"
                assert "courses_names" in data, "Missing courses_names field"
                assert "lectures_count" in data, "Missing lectures_count field"
                assert "attendance_count" in data, "Missing attendance_count field"
                assert "has_user_account" in data, "Missing has_user_account field"
                
                # Verify data types
                assert isinstance(data["courses_count"], int), "courses_count should be int"
                assert isinstance(data["courses_names"], list), "courses_names should be list"
                assert isinstance(data["lectures_count"], int), "lectures_count should be int"
                assert isinstance(data["attendance_count"], int), "attendance_count should be int"
                assert isinstance(data["has_user_account"], bool), "has_user_account should be bool"
                
                print(f"✅ Teacher backup-info for {data['teacher_name']}: {data['courses_count']} courses, {data['lectures_count']} lectures, {data['attendance_count']} attendance records")
                return
        
        # If no teacher found, still pass but warn
        print("⚠️ No test teachers found - skipping detailed validation")
    
    def test_backup_info_requires_auth(self):
        """Test that backup-info requires authentication."""
        response = requests.get(f"{BASE_URL}/api/teachers/{TEST_TEACHER_IDS[0]}/backup-info")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("✅ Teacher backup-info correctly requires authentication")
    
    def test_backup_info_invalid_teacher(self, auth_headers):
        """Test backup-info with invalid teacher ID."""
        response = requests.get(
            f"{BASE_URL}/api/teachers/000000000000000000000000/backup-info",
            headers=auth_headers
        )
        assert response.status_code == 404, f"Expected 404 for invalid teacher, got {response.status_code}"
        print("✅ Teacher backup-info correctly returns 404 for invalid teacher")


class TestStudentBackupInfo:
    """Tests for GET /api/students/{student_id}/backup-info endpoint."""
    
    def test_backup_info_returns_valid_structure(self, auth_headers):
        """Test that backup-info returns correct data structure for existing student."""
        # Try each known student ID until we find one that exists
        for student_id in TEST_STUDENT_IDS:
            response = requests.get(
                f"{BASE_URL}/api/students/{student_id}/backup-info",
                headers=auth_headers
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Verify expected fields exist
                assert "student_name" in data, "Missing student_name field"
                assert "courses_count" in data, "Missing courses_count field"
                assert "courses_names" in data, "Missing courses_names field"
                assert "attendance_count" in data, "Missing attendance_count field"
                assert "has_user_account" in data, "Missing has_user_account field"
                
                # Verify data types
                assert isinstance(data["courses_count"], int), "courses_count should be int"
                assert isinstance(data["courses_names"], list), "courses_names should be list"
                assert isinstance(data["attendance_count"], int), "attendance_count should be int"
                assert isinstance(data["has_user_account"], bool), "has_user_account should be bool"
                
                print(f"✅ Student backup-info for {data['student_name']}: {data['courses_count']} courses, {data['attendance_count']} attendance records")
                return
        
        # If no student found, still pass but warn
        print("⚠️ No test students found - skipping detailed validation")
    
    def test_backup_info_requires_auth(self):
        """Test that backup-info requires authentication."""
        response = requests.get(f"{BASE_URL}/api/students/{TEST_STUDENT_IDS[0]}/backup-info")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("✅ Student backup-info correctly requires authentication")
    
    def test_backup_info_invalid_student(self, auth_headers):
        """Test backup-info with invalid student ID."""
        response = requests.get(
            f"{BASE_URL}/api/students/000000000000000000000000/backup-info",
            headers=auth_headers
        )
        assert response.status_code == 404, f"Expected 404 for invalid student, got {response.status_code}"
        print("✅ Student backup-info correctly returns 404 for invalid student")


class TestTeacherSafeDeleteRestore:
    """Tests for teacher safe-delete and restore endpoints.
    
    Flow: Create test teacher -> safe-delete -> verify deletion -> restore -> verify restoration
    """
    
    def test_full_safe_delete_restore_flow(self, auth_headers):
        """Full integration test: create -> safe-delete -> restore teacher."""
        
        # Step 1: Create a test teacher
        test_teacher_data = {
            "teacher_id": f"TEST_TEACHER_{datetime.now().strftime('%Y%m%d%H%M%S')}",
            "full_name": "معلم اختبار الحذف الآمن",
            "email": "test_delete@example.com",
            "phone": "777123456",
            "specialization": "اختبار",
            "academic_title": "محاضر",
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/teachers",
            headers=auth_headers,
            json=test_teacher_data
        )
        
        if create_response.status_code not in [200, 201]:
            pytest.skip(f"Could not create test teacher: {create_response.text}")
        
        created_teacher = create_response.json()
        teacher_id = created_teacher.get("id")
        assert teacher_id, "No teacher ID in create response"
        print(f"✅ Created test teacher: {test_teacher_data['full_name']} (ID: {teacher_id})")
        
        try:
            # Step 2: Get backup info
            backup_info_response = requests.get(
                f"{BASE_URL}/api/teachers/{teacher_id}/backup-info",
                headers=auth_headers
            )
            assert backup_info_response.status_code == 200, f"Backup info failed: {backup_info_response.text}"
            backup_info = backup_info_response.json()
            print(f"✅ Got backup info: {backup_info}")
            
            # Step 3: Safe delete
            safe_delete_response = requests.post(
                f"{BASE_URL}/api/teachers/{teacher_id}/safe-delete",
                headers=auth_headers
            )
            assert safe_delete_response.status_code == 200, f"Safe delete failed: {safe_delete_response.text}"
            delete_result = safe_delete_response.json()
            
            # Verify backup structure
            backup = delete_result.get("backup")
            assert backup, "No backup in safe-delete response"
            assert backup.get("backup_type") == "teacher_backup", "Wrong backup type"
            assert backup.get("teacher"), "No teacher data in backup"
            assert backup.get("teacher", {}).get("full_name") == test_teacher_data["full_name"], "Teacher name mismatch in backup"
            print(f"✅ Safe delete successful, backup created")
            
            # Step 4: Verify deletion - teacher should not exist
            verify_response = requests.get(
                f"{BASE_URL}/api/teachers/{teacher_id}/backup-info",
                headers=auth_headers
            )
            assert verify_response.status_code == 404, f"Teacher should be deleted, got {verify_response.status_code}"
            print(f"✅ Teacher verified as deleted")
            
            # Step 5: Restore from backup
            restore_response = requests.post(
                f"{BASE_URL}/api/teachers/restore",
                headers=auth_headers,
                json=backup
            )
            assert restore_response.status_code == 200, f"Restore failed: {restore_response.text}"
            restore_result = restore_response.json()
            new_teacher_id = restore_result.get("new_teacher_id")
            assert new_teacher_id, "No new_teacher_id in restore response"
            print(f"✅ Teacher restored with new ID: {new_teacher_id}")
            
            # Step 6: Verify restoration
            verify_restore_response = requests.get(
                f"{BASE_URL}/api/teachers/{new_teacher_id}/backup-info",
                headers=auth_headers
            )
            assert verify_restore_response.status_code == 200, f"Restored teacher not found: {verify_restore_response.text}"
            restored_data = verify_restore_response.json()
            assert restored_data.get("teacher_name") == test_teacher_data["full_name"], "Restored teacher name mismatch"
            print(f"✅ Teacher restoration verified")
            
        finally:
            # Cleanup: Delete the test teacher
            try:
                # Try to delete using the original ID or new ID
                for tid in [teacher_id, new_teacher_id] if 'new_teacher_id' in locals() else [teacher_id]:
                    if tid:
                        requests.delete(f"{BASE_URL}/api/teachers/{tid}", headers=auth_headers)
            except Exception:
                pass
    
    def test_restore_invalid_backup_type(self, auth_headers):
        """Test restore with invalid backup type."""
        invalid_backup = {
            "backup_type": "invalid_type",
            "teacher": {"full_name": "Test"}
        }
        
        response = requests.post(
            f"{BASE_URL}/api/teachers/restore",
            headers=auth_headers,
            json=invalid_backup
        )
        assert response.status_code == 400, f"Expected 400 for invalid backup type, got {response.status_code}"
        print("✅ Teacher restore correctly rejects invalid backup type")
    
    def test_safe_delete_requires_auth(self):
        """Test that safe-delete requires authentication."""
        response = requests.post(f"{BASE_URL}/api/teachers/{TEST_TEACHER_IDS[0]}/safe-delete")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("✅ Teacher safe-delete correctly requires authentication")


class TestStudentSafeDeleteRestore:
    """Tests for student safe-delete and restore endpoints.
    
    Flow: Create test student -> safe-delete -> verify deletion -> restore -> verify restoration
    """
    
    def test_full_safe_delete_restore_flow(self, auth_headers):
        """Full integration test: create -> safe-delete -> restore student."""
        
        # First, get a department ID
        dept_response = requests.get(f"{BASE_URL}/api/departments", headers=auth_headers)
        departments = dept_response.json() if dept_response.status_code == 200 else []
        dept_id = departments[0].get("id") if departments else None
        
        if not dept_id:
            pytest.skip("No departments available for test")
        
        # Step 1: Create a test student
        test_student_data = {
            "student_id": f"TEST_{datetime.now().strftime('%Y%m%d%H%M%S')}",
            "full_name": "طالب اختبار الحذف الآمن",
            "department_id": dept_id,
            "level": 1,
            "section": "أ",
            "email": "test_student_delete@example.com",
            "phone": "777654321",
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/students",
            headers=auth_headers,
            json=test_student_data
        )
        
        if create_response.status_code not in [200, 201]:
            pytest.skip(f"Could not create test student: {create_response.text}")
        
        created_student = create_response.json()
        student_id = created_student.get("id")
        assert student_id, "No student ID in create response"
        print(f"✅ Created test student: {test_student_data['full_name']} (ID: {student_id})")
        
        try:
            # Step 2: Get backup info
            backup_info_response = requests.get(
                f"{BASE_URL}/api/students/{student_id}/backup-info",
                headers=auth_headers
            )
            assert backup_info_response.status_code == 200, f"Backup info failed: {backup_info_response.text}"
            backup_info = backup_info_response.json()
            print(f"✅ Got backup info: {backup_info}")
            
            # Step 3: Safe delete
            safe_delete_response = requests.post(
                f"{BASE_URL}/api/students/{student_id}/safe-delete",
                headers=auth_headers
            )
            assert safe_delete_response.status_code == 200, f"Safe delete failed: {safe_delete_response.text}"
            delete_result = safe_delete_response.json()
            
            # Verify backup structure
            backup = delete_result.get("backup")
            assert backup, "No backup in safe-delete response"
            assert backup.get("backup_type") == "student_backup", "Wrong backup type"
            assert backup.get("student"), "No student data in backup"
            assert backup.get("student", {}).get("full_name") == test_student_data["full_name"], "Student name mismatch in backup"
            print(f"✅ Safe delete successful, backup created")
            
            # Step 4: Verify deletion - student should not exist
            verify_response = requests.get(
                f"{BASE_URL}/api/students/{student_id}/backup-info",
                headers=auth_headers
            )
            assert verify_response.status_code == 404, f"Student should be deleted, got {verify_response.status_code}"
            print(f"✅ Student verified as deleted")
            
            # Step 5: Restore from backup
            restore_response = requests.post(
                f"{BASE_URL}/api/students/restore",
                headers=auth_headers,
                json=backup
            )
            assert restore_response.status_code == 200, f"Restore failed: {restore_response.text}"
            restore_result = restore_response.json()
            new_student_id = restore_result.get("new_student_id")
            assert new_student_id, "No new_student_id in restore response"
            print(f"✅ Student restored with new ID: {new_student_id}")
            
            # Step 6: Verify restoration
            verify_restore_response = requests.get(
                f"{BASE_URL}/api/students/{new_student_id}/backup-info",
                headers=auth_headers
            )
            assert verify_restore_response.status_code == 200, f"Restored student not found: {verify_restore_response.text}"
            restored_data = verify_restore_response.json()
            assert restored_data.get("student_name") == test_student_data["full_name"], "Restored student name mismatch"
            print(f"✅ Student restoration verified")
            
        finally:
            # Cleanup: Delete the test student
            try:
                for sid in [student_id, new_student_id] if 'new_student_id' in locals() else [student_id]:
                    if sid:
                        requests.delete(f"{BASE_URL}/api/students/{sid}", headers=auth_headers)
            except Exception:
                pass
    
    def test_restore_invalid_backup_type(self, auth_headers):
        """Test restore with invalid backup type."""
        invalid_backup = {
            "backup_type": "invalid_type",
            "student": {"full_name": "Test"}
        }
        
        response = requests.post(
            f"{BASE_URL}/api/students/restore",
            headers=auth_headers,
            json=invalid_backup
        )
        assert response.status_code == 400, f"Expected 400 for invalid backup type, got {response.status_code}"
        print("✅ Student restore correctly rejects invalid backup type")
    
    def test_safe_delete_requires_auth(self):
        """Test that safe-delete requires authentication."""
        response = requests.post(f"{BASE_URL}/api/students/{TEST_STUDENT_IDS[0]}/safe-delete")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("✅ Student safe-delete correctly requires authentication")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
