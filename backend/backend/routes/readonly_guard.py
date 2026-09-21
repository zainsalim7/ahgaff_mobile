"""🔒 حارس القراءة فقط — يمنع أي طلب تعديل من الأدوار القرائية (رئيس الجامعة) مهما كانت الشاشة"""
import json
import time
import logging
from bson import ObjectId
from jose import jwt, JWTError
from starlette.types import ASGIApp, Receive, Scope, Send

from .deps import get_db, SECRET_KEY, ALGORITHM
from models.permissions import READ_ONLY_ROLES

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
# مسارات مسموحة للدور القرائي حتى لو كانت تعديلاً (تخص حسابه هو فقط)
ALLOWED_PREFIXES = (
    "/api/auth/login", "/api/auth/logout", "/api/auth/change-password", "/api/auth/force-change-password",
    "/api/auth/refresh", "/api/notifications/register-token", "/api/notifications/read-all",
    "/api/activity-logs/record-view", "/api/fcm",
    "/api/fees/renewal-status",  # قراءة جماعية عبر POST (شارة تجديد القيد في جدول الطلاب)
)
ALLOWED_SUFFIXES = ("/read",)  # /api/notifications/{id}/read
_ROLE_CACHE: dict = {}
_CACHE_TTL = 60


async def _role_of(token: str):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        uid = payload.get("sub")
    except JWTError:
        return None
    if not uid or not ObjectId.is_valid(uid):
        return None
    now = time.time()
    hit = _ROLE_CACHE.get(uid)
    if hit and hit[1] > now:
        return hit[0]
    try:
        u = await get_db().users.find_one({"_id": ObjectId(uid)}, {"role": 1})
    except Exception:
        return None
    role = (u or {}).get("role")
    _ROLE_CACHE[uid] = (role, now + _CACHE_TTL)
    return role


def invalidate_role_cache(user_id: str = None):
    if user_id:
        _ROLE_CACHE.pop(str(user_id), None)
    else:
        _ROLE_CACHE.clear()


def is_path_allowed(path: str) -> bool:
    return path.startswith(ALLOWED_PREFIXES) or (path.startswith("/api/notifications/") and path.endswith(ALLOWED_SUFFIXES))


class ReadOnlyRoleMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http" or scope.get("method", "GET") in SAFE_METHODS:
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        if not path.startswith("/api/") or is_path_allowed(path):
            await self.app(scope, receive, send)
            return
        auth = None
        for k, v in scope.get("headers", []):
            if k == b"authorization":
                auth = v.decode("latin-1")
                break
        if not auth or not auth.lower().startswith("bearer "):
            await self.app(scope, receive, send)
            return
        role = await _role_of(auth[7:].strip())
        if role in READ_ONLY_ROLES:
            logging.info(f"ReadOnly guard blocked {scope.get('method')} {path} for role={role}")
            body = json.dumps({"detail": "حسابك للاطلاع فقط — لا يمكن إجراء أي تعديل"}, ensure_ascii=False).encode("utf-8")
            await send({"type": "http.response.start", "status": 403,
                        "headers": [(b"content-type", b"application/json; charset=utf-8"), (b"content-length", str(len(body)).encode())]})
            await send({"type": "http.response.body", "body": body})
            return
        await self.app(scope, receive, send)
