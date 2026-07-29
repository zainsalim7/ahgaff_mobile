"""
نماذج المستخدمين - Users Models
"""
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class UserPermissionScope(BaseModel):
    """نموذج نطاق الصلاحية للمستخدم"""
    scope_type: str  # global, department, course
    scope_id: Optional[str] = None
    permissions: List[str]

class UserPermissionsUpdate(BaseModel):
    """نموذج تحديث صلاحيات المستخدم"""
    scopes: List[UserPermissionScope]

class UserPermissionResponse(BaseModel):
    """نموذج استجابة صلاحيات المستخدم"""
    user_id: str
    scopes: List[dict]

class UserBase(BaseModel):
    username: str
    full_name: str
    role: Optional[str] = None
    role_id: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    permissions: Optional[List[str]] = None
    university_id: Optional[str] = None
    faculty_id: Optional[str] = None
    department_id: Optional[str] = None
    faculty_ids: Optional[List[str]] = None
    department_ids: Optional[List[str]] = None
    course_ids: Optional[List[str]] = None
    permission_level: Optional[str] = None

class UserCreate(UserBase):
    password: str

class UserLogin(BaseModel):
    username: str
    password: str

class UserResponse(UserBase):
    id: str
    created_at: datetime
    is_active: bool = True
    permissions: List[str] = []
    faculty_name: Optional[str] = None
    faculty_names: Optional[List[str]] = None
    department_name: Optional[str] = None
    department_names: Optional[List[str]] = None

class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse
