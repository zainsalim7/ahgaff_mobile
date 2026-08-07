import os
import uuid
import logging
import requests

logger = logging.getLogger(__name__)

STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
APP_NAME = "ahgaff-university"
DB_PREFIX = "dbfs/"
storage_key = None
_emergent_failed = False

_mongo_db = None


def _get_db():
    global _mongo_db
    if _mongo_db is None:
        from pymongo import MongoClient
        _mongo_db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    return _mongo_db


def _db_put(path: str, data: bytes, content_type: str) -> dict:
    """تخزين احتياطي داخل MongoDB (يعمل على أي سيرفر بدون إعدادات إضافية)."""
    _get_db().storage_files.update_one(
        {"_id": path},
        {"$set": {"data": data, "content_type": content_type, "size": len(data)}},
        upsert=True,
    )
    return {"path": path, "size": len(data)}


def _db_get(path: str):
    doc = _get_db().storage_files.find_one({"_id": path})
    if not doc:
        raise FileNotFoundError(path)
    return bytes(doc["data"]), doc.get("content_type", "application/octet-stream")


def init_storage():
    global storage_key
    if storage_key:
        return storage_key
    resp = requests.post(
        f"{STORAGE_URL}/init",
        json={"emergent_key": os.environ.get("EMERGENT_LLM_KEY")},
        timeout=30
    )
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    logger.info("Object storage initialized successfully")
    return storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120
    )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    if path.startswith(DB_PREFIX):
        return _db_get(path)
    key = init_storage()
    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key},
        timeout=60
    )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


def upload_file(data: bytes, filename: str, content_type: str, folder: str = "uploads") -> dict:
    global _emergent_failed
    ext = filename.split(".")[-1] if "." in filename else "bin"
    file_id = str(uuid.uuid4())
    rel_path = f"{APP_NAME}/{folder}/{file_id}.{ext}"

    if os.environ.get("EMERGENT_LLM_KEY") and not _emergent_failed:
        try:
            result = put_object(rel_path, data, content_type)
            return {
                "file_id": file_id,
                "storage_path": result["path"],
                "original_filename": filename,
                "content_type": content_type,
                "size": result.get("size", len(data)),
            }
        except Exception as e:
            _emergent_failed = True
            logger.warning(f"Object storage failed — falling back to MongoDB storage: {e}")

    result = _db_put(f"{DB_PREFIX}{rel_path}", data, content_type)
    return {
        "file_id": file_id,
        "storage_path": result["path"],
        "original_filename": filename,
        "content_type": content_type,
        "size": result["size"],
    }
