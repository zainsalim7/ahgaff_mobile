"""🤖 مرشد الأحقاف — مساعد إرشادي داخل النظام (المرحلة أ: إرشاد فقط، لا يلمس البيانات)"""
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .deps import get_db, get_current_user, has_permission, log_activity
from models.permissions import Permission, UserRole

router = APIRouter(prefix="/assistant", tags=["assistant"])
YEMEN_TZ = timezone(timedelta(hours=3))
SCREENS = json.loads((Path(__file__).resolve().parent.parent / "assistant_screens.json").read_text(encoding="utf-8"))

MODELS = [
    {"provider": "openai", "model": "gpt-5.4", "label": "OpenAI GPT-5.4 (افتراضي — متوازن)"},
    {"provider": "openai", "model": "gpt-5.4-mini", "label": "OpenAI GPT-5.4 mini (سريع واقتصادي)"},
    {"provider": "openai", "model": "gpt-5.6-terra", "label": "OpenAI GPT-5.6 Terra (الأقوى)"},
    {"provider": "anthropic", "model": "claude-sonnet-5-5", "label": "Claude Sonnet 5.5 (دقيق بالعربية)"},
    {"provider": "anthropic", "model": "claude-haiku-4-5-20251001", "label": "Claude Haiku 4.5 (سريع واقتصادي)"},
    {"provider": "gemini", "model": "gemini-3-flash-preview", "label": "Gemini 3 Flash (سريع واقتصادي)"},
    {"provider": "gemini", "model": "gemini-3.1-pro-preview", "label": "Gemini 3.1 Pro (تحليل أعمق)"},
    {"provider": "deepseek", "model": "deepseek-chat", "label": "DeepSeek V3 Chat (اقتصادي جداً)"},
    {"provider": "deepseek", "model": "deepseek-reasoner", "label": "DeepSeek R1 Reasoner (تفكير متسلسل)"},
]
PROVIDERS = [
    {"key": "openai", "label": "OpenAI", "universal": True, "hint": "platform.openai.com/api-keys", "prefix": "sk-"},
    {"key": "anthropic", "label": "Anthropic (Claude)", "universal": True, "hint": "console.anthropic.com", "prefix": "sk-ant-"},
    {"key": "gemini", "label": "Google Gemini", "universal": True, "hint": "aistudio.google.com/apikey", "prefix": "AIza"},
    {"key": "deepseek", "label": "DeepSeek", "universal": False, "hint": "platform.deepseek.com/api_keys", "prefix": "sk-"},
]
UNIVERSAL_PROVIDERS = {p["key"] for p in PROVIDERS if p["universal"]}
DEFAULTS = {"enabled": True, "name": "مرشد الأحقاف", "provider": "openai", "model": "gpt-5.4", "daily_limit": 60,
            "allowed_roles": [], "allowed_user_ids": [], "extra_instructions": "", "provider_keys": {}}


def _fernet():
    import base64, hashlib
    from cryptography.fernet import Fernet
    from config import SECRET_KEY
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(SECRET_KEY.encode()).digest()))


def encrypt_key(raw: str) -> str:
    return _fernet().encrypt(raw.encode()).decode()


def decrypt_key(token: str) -> str:
    return _fernet().decrypt(token.encode()).decode()


def _classify(err: str) -> str:
    low = err.lower()
    if "401" in low or "authentication" in low or "invalid api key" in low or "incorrect api key" in low:
        return "المفتاح مرفوض من المزوّد (غير صحيح أو منتهي)"
    if "402" in low or "insufficient" in low or "balance" in low or "quota" in low or "429" in low:
        return "الرصيد أو الحصة غير كافية لدى المزوّد"
    if "404" in low or "not found" in low or ("model" in low and "not" in low):
        return "النموذج غير متاح لهذا المفتاح/المزوّد"
    if "timeout" in low or "timed out" in low:
        return "انتهت مهلة الاتصال بالمزوّد"
    return "تعذر الاتصال بالمزوّد"


def resolve_key(st: dict, provider: str):
    """يعيد (المفتاح، المصدر): مفتاح المزوّد الخاص أولاً ثم المفتاح الشامل إن كان المزوّد مشمولاً به"""
    enc = (st.get("provider_keys") or {}).get(provider)
    if enc:
        try:
            return decrypt_key(enc), "own"
        except Exception:
            logging.error(f"assistant: failed to decrypt key for {provider}")
    uni = os.environ.get("EMERGENT_LLM_KEY")
    if uni and provider in UNIVERSAL_PROVIDERS:
        return uni, "universal"
    return None, None

ROLE_AR = {"admin": "مدير النظام", "dean": "عميد كلية", "department_head": "رئيس قسم", "registrar": "موظف تسجيل", "registration_manager": "مدير التسجيل",
           "teacher": "أستاذ", "student": "طالب", "employee": "موظف", "hr_manager": "مدير الموارد البشرية"}

REGULATION = """قواعد لائحة الغياب المعتمدة في النظام (المصدر: اللائحة الجامعية كما طُبّقت):
- نسبة الغياب تُحسب بالساعات من المحاضرات المنفَّذة فعلاً (لا المجدولة).
- حد الغياب بلا عذر: أكبر من 10% → ترشيح للحرمان. حد الغياب الكلي (بعذر + بلا عذر): أكبر من 25% → ترشيح للحرمان. قرار الحرمان النهائي لمجلس الكلية نهاية الفصل. الحدود قابلة للتعديل من إعدادات الكلية.
- حالة «متأخر» ملغاة (تُعامل حضوراً). الأستاذ لا يسجّل «بعذر»؛ العذر يُقدَّم بطلب موثّق (شاشة أعذار غياب الطلاب): مرضي → التسجيل، غير مرضي حتى يومين → العميد، أكثر من يومين أو عذر عن اختبار → مجلس الكلية (برقم جلسة). الاعتماد يحوّل غياب الفترة إلى «بعذر» تلقائياً.
- الإجازة التحضيرية (آخر 3 أيام من الفصل) تُحتسب حضوراً للجميع (قيد التنفيذ).
المجموعات الدراسية: المقرر قد يُقسَّم لمجموعات لكل منها قائد (أستاذ)؛ كل قائد يرى مجموعته فقط (حتى لو كان مدرّس المقرر المسجّل). مدرّس مقرر لا يقود مجموعة يرى الكل. صفحة المجموعة: /course-group، التوزيع والاستيراد/التصدير من نافذة المجموعات في طلاب المقرر.
فحص تكامل الجدول الأسبوعي: يرصد خلايا بمقررات محذوفة أو أستاذ مختلف عن الإسناد (مع مراعاة قائد المجموعة) ويقترح إصلاحاً — راجع قبل «الإصلاح التلقائي».
أداة «استعادة محاضرات المجموعات» في تبويب الإدارة تعيد محاضرات أُلغيت خطأً كمكررة.
توليد المحاضرات من الجدول الأسبوعي (شاشة الجدول → «توليد المحاضرات»، معاينة dry-run أولاً): لكل خلية × كل تاريخ مطابق لليوم ضمن الفترة تُنشأ محاضرة واحدة بوقت الفترة وقاعتها. الخلية المرتبطة بمجموعة تُنتج محاضرة خاصة بتلك المجموعة (تحمل رمز المجموعة واسمها ومعرّف قائدها) لا يراها ويُسجّل حضورها إلا قائد المجموعة ولطلاب مجموعته فقط. إذا احتوت الخلية نفسها (نفس اليوم والفترة) على المقرر نفسه لمجموعتين مختلفتين، تُولَّد محاضرتان منفصلتان بنفس التاريخ والوقت — واحدة لكل مجموعة بقائدها — ولا تُعدّان تكراراً لأن الفهرس الفريد يشمل (المقرر، التاريخ، وقت البداية، المجموعة). المحاضرات الموجودة مسبقاً (بأي حالة، حتى الملغاة) تُتخطى ولا تُمس، والعطلات من التقويم الجامعي تُستثنى تلقائياً، والتواريخ الماضية تُستثنى ما لم يُفعَّل «تضمين التواريخ الماضية». خلية بلا مجموعة في مقرر له مجموعات تُنتج محاضرة عامة لكل طلاب المقرر (المحاضرة النظرية المشتركة)؛ الخلية العملية لمقرر له مجموعات تُلزم اختيار مجموعة."""

SCREEN_TIPS = {
    "student-excuses": "طوابير حسب المسار (التسجيل/العميد/المجلس)، تبويبات الحالة، زر «تقديم عذر نيابةً عن طالب» بالبحث برقم القيد ثم الفترة والنوع والمستند الإلزامي.",
    "absence-justifications": "تبرير غياب الأساتذة عن المحاضرات (مهلة 72 ساعة، مرفق إلزامي، يراجعه رئيس القسم/العميد).",
    "courses": "قائمة المقررات؛ من بطاقة المقرر: الطلاب، المحاضرات، المجموعات (رقائق بنفسجية)، الإحصائيات. نسخ/نقل الطلاب من شاشة طلاب المقرر مع فلاتر الكلية/القسم/المستوى.",
    "weekly-schedule": "الجدول الأسبوعي: الخلايا بالأيام والفترات، توليد المحاضرات منه، فحص التكامل، استيراد Excel.",
    "students": "قائمة الطلاب: بحث، تحديد جماعي، نقل جماعي (الشعبة اختيارية)، شارات المجموعات 👥 تحت المستوى.",
    "report-warnings": "تقرير الإنذارات والحرمان حسب لائحة الغياب (ساعات منفَّذة، 10%/25%).",
    "general-settings": "الإعدادات العامة: الفصول والسنوات، حدود الغياب لكل كلية، بيانات المؤسسة.",
    "roles": "الأدوار والصلاحيات: إنشاء أدوار مخصصة ومنح صلاحيات مثل مراجعة الأعذار أو استخدام المرشد.",
    "repair": "أداة استعادة محاضرات المجموعات: /repair-group-lectures (معاينة ثم تنفيذ).",
}


def _now():
    return datetime.now(YEMEN_TZ)


async def get_settings(db) -> dict:
    doc = await db.settings.find_one({"type": "assistant"}) or {}
    return {**DEFAULTS, **{k: v for k, v in doc.items() if k in DEFAULTS}}


def can_use(user: dict, st: dict) -> bool:
    if user["role"] == UserRole.ADMIN:
        return True
    if not st.get("enabled"):
        return False
    return has_permission(user, Permission.USE_ASSISTANT) or user["role"] in (st.get("allowed_roles") or []) or user["id"] in (st.get("allowed_user_ids") or [])


def visible_screens(user: dict) -> List[dict]:
    out = []
    for sc in SCREENS:
        if sc["roles"] and user["role"] not in sc["roles"] and user["role"] != UserRole.ADMIN:
            continue
        if sc["permissions"] and user["role"] != UserRole.ADMIN and not any(has_permission(user, p) for p in sc["permissions"]):
            continue
        out.append(sc)
    return out


def system_prompt(user: dict, st: dict, route: Optional[str]) -> str:
    screens = visible_screens(user)
    lines = [f"- {s['label']}: {s['path']}" + (f" — {SCREEN_TIPS[s['id']]}" if s["id"] in SCREEN_TIPS else "") for s in screens]
    perms = ", ".join(sorted(user.get("permissions") or [])[:60]) or "حسب الدور"
    return f"""أنت «{st['name']}»، مساعد إرشادي داخل نظام جامعة الأحقاف لإدارة الحضور والشؤون الأكاديمية والموارد البشرية.
مهمتك: إرشاد المستخدم خطوة بخطوة لإنجاز مهامه داخل النظام بدقة وحرص، وشرح القواعد واللوائح، وتوجيهه إلى الشاشة الصحيحة.
قيود صارمة:
1) أنت لا تنفّذ أي عملية ولا تعدّل بيانات ولا تطّلع على بيانات الطلاب/الموظفين — فقط ترشد. إن طُلب تنفيذ شيء: اشرح كيف يفعله المستخدم بنفسه.
2) أرشد فقط إلى الشاشات المتاحة لدور المستخدم المذكورة أدناه. إن سأل عن شيء خارج صلاحياته فأخبره بلطف أن ذلك من اختصاص دور آخر (اذكر الدور) دون شرح تفاصيله.
3) لا تخترع ميزات أو أزراراً غير مذكورة؛ إن لم تكن متأكداً قل «لست متأكداً — راجع إدارة النظام».
4) أجب بالعربية الفصحى المبسطة، بإيجاز وبنقاط مرقّمة عند الخطوات.
5) عندما ترشد إلى شاشة أضف في نهاية الرد سطراً لكل شاشة بالصيغة الحرفية: [[nav:المسار|اسم الشاشة]] (حتى 3 أسطر).
6) حذّر من العمليات ذات الأثر الواسع (الإصلاح التلقائي، النقل الجماعي، الحذف) واطلب المعاينة أولاً.

المستخدم الحالي: {user.get('full_name') or user.get('username')} — الدور: {ROLE_AR.get(user['role'], user['role'])}. الصلاحيات: {perms}.
الشاشة الحالية: {route or 'غير معروفة'}.

الشاشات المتاحة لهذا المستخدم:
{chr(10).join(lines)}
شاشات فرعية شائعة: طلاب المقرر /course-students?courseId=…، محاضرات المقرر /course-lectures?courseId=…، صفحة المجموعة /course-group?courseId=…&group=…، تفاصيل الطالب /student-details?studentId=…، إعدادات المرشد /assistant-settings (للأدمن).

{REGULATION}
{('تعليمات إضافية من الإدارة: ' + st['extra_instructions']) if st.get('extra_instructions') else ''}"""


class ChatIn(BaseModel):
    session_id: str
    message: str
    current_route: Optional[str] = None
    stream: bool = True


class SettingsIn(BaseModel):
    enabled: Optional[bool] = None
    name: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    daily_limit: Optional[int] = None
    allowed_roles: Optional[List[str]] = None
    allowed_user_ids: Optional[List[str]] = None
    extra_instructions: Optional[str] = None


@router.get("/meta")
async def meta(current_user: dict = Depends(get_current_user)):
    st = await get_settings(get_db())
    return {"can_use": can_use(current_user, st), "enabled": st["enabled"], "name": st["name"], "model": st["model"], "provider": st["provider"],
            "is_admin": current_user["role"] == UserRole.ADMIN}


@router.get("/settings")
async def read_settings(current_user: dict = Depends(get_current_user)):
    if current_user["role"] != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="إعدادات المرشد للأدمن فقط")
    db = get_db()
    st = await get_settings(db)
    users = await db.users.find({"_id": {"$in": [ObjectId(i) for i in st["allowed_user_ids"] if ObjectId.is_valid(i)]}}, {"full_name": 1, "username": 1, "role": 1}).to_list(200)
    today = _now().strftime("%Y-%m-%d")
    usage_today = await db.assistant_usage.aggregate([{"$match": {"date": today}}, {"$group": {"_id": None, "n": {"$sum": "$count"}}}]).to_list(1)
    uni = bool(os.environ.get("EMERGENT_LLM_KEY"))
    keys = st.pop("provider_keys", {}) or {}
    providers = []
    for p in PROVIDERS:
        own = p["key"] in keys
        last4 = ""
        if own:
            try:
                last4 = decrypt_key(keys[p["key"]])[-4:]
            except Exception:
                last4 = "????"
        providers.append({**p, "has_own_key": own, "last4": last4, "source": "own" if own else ("universal" if uni and p["universal"] else None)})
    return {**st, "models": MODELS, "providers": providers, "roles": [{"key": k, "label": v} for k, v in ROLE_AR.items() if k != "admin"],
            "allowed_users": [{"id": str(u["_id"]), "full_name": u.get("full_name"), "username": u.get("username"), "role": u.get("role")} for u in users],
            "usage_today": (usage_today[0]["n"] if usage_today else 0), "key_configured": uni}


@router.put("/settings")
async def write_settings(data: SettingsIn, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="إعدادات المرشد للأدمن فقط")
    upd = {k: v for k, v in data.model_dump().items() if v is not None}
    if "model" in upd and not any(m["model"] == upd["model"] for m in MODELS):
        raise HTTPException(status_code=400, detail="النموذج غير مدعوم")
    if "model" in upd:
        upd["provider"] = next(m["provider"] for m in MODELS if m["model"] == upd["model"])
    db = get_db()
    await db.settings.update_one({"type": "assistant"}, {"$set": {**upd, "type": "assistant", "updated_at": _now().isoformat()}}, upsert=True)
    await log_activity(current_user, "assistant_settings_update", "settings", "assistant", "إعدادات المرشد", upd)
    return await get_settings(db)


class ProviderKeyIn(BaseModel):
    api_key: str


@router.put("/provider-keys/{provider}")
async def set_provider_key(provider: str, data: ProviderKeyIn, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="إعدادات المرشد للأدمن فقط")
    if provider not in {p["key"] for p in PROVIDERS}:
        raise HTTPException(status_code=400, detail="مزوّد غير معروف")
    raw = data.api_key.strip()
    if len(raw) < 16 or any(c.isspace() for c in raw):
        raise HTTPException(status_code=400, detail="المفتاح غير صالح (قصير جداً أو يحتوي مسافات)")
    await get_db().settings.update_one({"type": "assistant"}, {"$set": {f"provider_keys.{provider}": encrypt_key(raw), "type": "assistant", "updated_at": _now().isoformat()}}, upsert=True)
    await log_activity(current_user, "assistant_provider_key_set", "settings", "assistant", f"مفتاح {provider}", {"provider": provider, "last4": raw[-4:]})
    return {"ok": True, "provider": provider, "last4": raw[-4:]}


@router.delete("/provider-keys/{provider}")
async def delete_provider_key(provider: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="إعدادات المرشد للأدمن فقط")
    await get_db().settings.update_one({"type": "assistant"}, {"$unset": {f"provider_keys.{provider}": ""}, "$set": {"updated_at": _now().isoformat()}})
    await log_activity(current_user, "assistant_provider_key_delete", "settings", "assistant", f"مفتاح {provider}", {"provider": provider})
    return {"ok": True, "provider": provider}


@router.get("/users/search")
async def search_users(q: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="غير مصرح")
    users = await get_db().users.find({"is_active": {"$ne": False}, "role": {"$ne": "student"}, "$or": [{"full_name": {"$regex": q, "$options": "i"}}, {"username": {"$regex": q, "$options": "i"}}]},
                                      {"full_name": 1, "username": 1, "role": 1}).limit(15).to_list(15)
    return [{"id": str(u["_id"]), "full_name": u.get("full_name"), "username": u.get("username"), "role": u.get("role"), "role_label": ROLE_AR.get(u.get("role"), u.get("role"))} for u in users]


def _llm_module():
    try:
        from emergentintegrations.llm import chat as m
        return m
    except ImportError as e:
        logging.error(f"assistant: emergentintegrations missing: {e}")
        raise HTTPException(status_code=503, detail="مكتبة الذكاء الاصطناعي (emergentintegrations) غير مثبتة على هذا الخادم — أضفها إلى requirements.txt وأعد النشر")


def _build_chat(st: dict, session_id: str, system: str, timeout: int = 90):
    LlmChat = _llm_module().LlmChat
    key, source = resolve_key(st, st["provider"])
    if not key:
        label = next((p["label"] for p in PROVIDERS if p["key"] == st["provider"]), st["provider"])
        if st["provider"] in UNIVERSAL_PROVIDERS:
            raise HTTPException(status_code=503, detail=f"لا يوجد مفتاح لمزوّد {label}: أدخل مفتاحك الخاص من إعدادات المرشد أو هيّئ المفتاح الشامل (EMERGENT_LLM_KEY)")
        raise HTTPException(status_code=503, detail=f"مزوّد {label} غير مشمول بالمفتاح الشامل — أدخل مفتاحك الخاص من إعدادات المرشد")
    llm = LlmChat(api_key=key, session_id=session_id, system_message=system).with_model(st["provider"], st["model"]).with_params(timeout=timeout)
    llm.key_source = source
    return llm


PROVIDER_PROBE = {
    "openai": lambda k: ("https://api.openai.com/v1/models", {"Authorization": f"Bearer {k}"}),
    "anthropic": lambda k: ("https://api.anthropic.com/v1/models", {"x-api-key": k, "anthropic-version": "2023-06-01"}),
    "gemini": lambda k: (f"https://generativelanguage.googleapis.com/v1beta/models?key={k}", {}),
    "deepseek": lambda k: ("https://api.deepseek.com/models", {"Authorization": f"Bearer {k}"}),
}


@router.get("/diagnose/{provider}")
async def diagnose_provider(provider: str, current_user: dict = Depends(get_current_user)):
    """تشخيص مباشر: هل يوجد مفتاح؟ هل يصل الخادم إلى المزوّد؟ هل يقبل المزوّد المفتاح؟ (بدون المرور عبر مكتبة النماذج)"""
    import httpx
    if current_user["role"] != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="غير مصرح")
    if provider not in PROVIDER_PROBE:
        raise HTTPException(status_code=400, detail="مزوّد غير معروف")
    st = await get_settings(get_db())
    key, source = resolve_key(st, provider)
    out = {"provider": provider, "key_source": source, "key_last4": key[-4:] if key else None, "universal_env": bool(os.environ.get("EMERGENT_LLM_KEY")), "steps": []}
    try:
        import emergentintegrations  # noqa: F401
        import litellm  # noqa: F401
        out["steps"].append({"step": "مكتبة النماذج", "ok": True, "msg": "emergentintegrations + litellm مثبتتان"})
    except ImportError as e:
        out["steps"].append({"step": "مكتبة النماذج", "ok": False, "msg": f"غير مثبتة على الخادم ({str(e)[:80]}) — أضف emergentintegrations إلى requirements.txt وأعد النشر"})
    if not key:
        out["steps"].append({"step": "المفتاح", "ok": False, "msg": "لا يوجد مفتاح لهذا المزوّد"})
        return out
    out["steps"].append({"step": "المفتاح", "ok": True, "msg": f"المصدر: {'مفتاح خاص' if source == 'own' else 'المفتاح الشامل'} (••••{key[-4:]})"})
    if source == "universal":
        out["steps"].append({"step": "الاتصال", "ok": True, "msg": "المفتاح الشامل يمر عبر وسيط Emergent؛ استخدم زر «اختبار» للتحقق الفعلي"})
        return out
    url, headers = PROVIDER_PROBE[provider](key)
    t0 = _now()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(12.0, connect=6.0)) as client:
            r = await client.get(url, headers=headers)
        ms = int((_now() - t0).total_seconds() * 1000)
        host = url.split("/")[2]
        out["steps"].append({"step": "الاتصال بالمزوّد", "ok": True, "msg": f"الخادم وصل إلى {host} خلال {ms} ms"})
        if r.status_code == 200:
            out["steps"].append({"step": "صحة المفتاح", "ok": True, "msg": "المزوّد قبل المفتاح ✅"})
        elif r.status_code in (401, 403):
            out["steps"].append({"step": "صحة المفتاح", "ok": False, "msg": f"المزوّد رفض المفتاح ({r.status_code}): {r.text[:160]}"})
        elif r.status_code == 402 or r.status_code == 429:
            out["steps"].append({"step": "الرصيد", "ok": False, "msg": f"رصيد/حصة غير كافية ({r.status_code}): {r.text[:160]}"})
        else:
            out["steps"].append({"step": "رد المزوّد", "ok": False, "msg": f"رد غير متوقع ({r.status_code}): {r.text[:160]}"})
    except httpx.ConnectError as e:
        out["steps"].append({"step": "الاتصال بالمزوّد", "ok": False, "msg": f"الخادم لا يستطيع الوصول إلى المزوّد (DNS/شبكة/حجب): {str(e)[:160]}"})
    except httpx.TimeoutException:
        out["steps"].append({"step": "الاتصال بالمزوّد", "ok": False, "msg": "انتهت المهلة (12 ث) — الاتصال من الخادم إلى المزوّد معلّق/محجوب"})
    except Exception as e:
        out["steps"].append({"step": "الاتصال بالمزوّد", "ok": False, "msg": f"{type(e).__name__}: {str(e)[:160]}"})
    out["ok"] = all(s["ok"] for s in out["steps"])
    return out


async def _check_quota(db, user: dict, st: dict):
    if user["role"] == UserRole.ADMIN:
        return
    today = _now().strftime("%Y-%m-%d")
    doc = await db.assistant_usage.find_one({"user_id": user["id"], "date": today})
    if doc and doc.get("count", 0) >= st["daily_limit"]:
        raise HTTPException(status_code=429, detail=f"بلغت الحد اليومي ({st['daily_limit']} رسالة). حاول غداً.")


@router.post("/chat")
async def chat(data: ChatIn, current_user: dict = Depends(get_current_user)):
    db = get_db()
    st = await get_settings(db)
    if not can_use(current_user, st):
        raise HTTPException(status_code=403, detail="المرشد غير متاح لحسابك")
    msg = (data.message or "").strip()
    if not msg or len(msg) > 2000:
        raise HTTPException(status_code=400, detail="الرسالة فارغة أو طويلة جداً")
    await _check_quota(db, current_user, st)
    sess = await db.assistant_sessions.find_one({"session_id": data.session_id, "user_id": current_user["id"]})
    history = (sess or {}).get("messages", [])[-12:]
    transcript = "\n".join(f"{'المستخدم' if m['role'] == 'user' else 'المرشد'}: {m['content']}" for m in history)
    prompt = (f"سياق المحادثة السابقة:\n{transcript}\n\n" if transcript else "") + f"رسالة المستخدم الجديدة: {msg}"
    system = system_prompt(current_user, st, data.current_route)
    now = _now().isoformat()
    _m = _llm_module()
    UserMessage, TextDelta, StreamDone = _m.UserMessage, _m.TextDelta, _m.StreamDone

    async def persist(answer: str):
        await db.assistant_sessions.update_one({"session_id": data.session_id, "user_id": current_user["id"]}, {
            "$push": {"messages": {"$each": [{"role": "user", "content": msg, "at": now}, {"role": "assistant", "content": answer, "at": _now().isoformat()}]}},
            "$set": {"updated_at": _now().isoformat(), "model": st["model"], "route": data.current_route}, "$setOnInsert": {"created_at": now, "title": msg[:60]}}, upsert=True)
        await db.assistant_usage.update_one({"user_id": current_user["id"], "date": _now().strftime("%Y-%m-%d")}, {"$inc": {"count": 1}}, upsert=True)

    llm = _build_chat(st, data.session_id, system)
    if not data.stream:
        try:
            answer = await llm.send_message(UserMessage(text=prompt))
        except Exception as e:
            logging.error(f"assistant error [{st['provider']}/{st['model']} via {llm.key_source}]: {e}")
            raise HTTPException(status_code=424, detail=f"تعذر الاتصال بنموذج {st['model']}: {_classify(str(e))}")
        await persist(answer)
        return {"reply": answer, "model": st["model"]}

    async def gen():
        buf = []
        try:
            async for ev in llm.stream_message(UserMessage(text=prompt)):
                if isinstance(ev, TextDelta):
                    buf.append(ev.content)
                    yield f"data: {json.dumps({'delta': ev.content}, ensure_ascii=False)}\n\n"
                elif isinstance(ev, StreamDone):
                    break
        except Exception as e:
            logging.error(f"assistant stream error [{st['provider']}/{st['model']} via {llm.key_source}]: {e}")
            err_msg = f"تعذر الاتصال بنموذج {st['model']}: {_classify(str(e))}"
            yield f"data: {json.dumps({'error': err_msg}, ensure_ascii=False)}\n\n"
            return
        await persist("".join(buf))
        yield f"data: {json.dumps({'done': True, 'model': st['model']})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/sessions")
async def my_sessions(current_user: dict = Depends(get_current_user)):
    docs = await get_db().assistant_sessions.find({"user_id": current_user["id"]}, {"session_id": 1, "title": 1, "updated_at": 1}).sort("updated_at", -1).limit(20).to_list(20)
    return [{"session_id": d["session_id"], "title": d.get("title", ""), "updated_at": d.get("updated_at")} for d in docs]


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, current_user: dict = Depends(get_current_user)):
    d = await get_db().assistant_sessions.find_one({"session_id": session_id, "user_id": current_user["id"]})
    return {"messages": (d or {}).get("messages", [])}


@router.post("/test")
async def test_model(request: Request, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="غير مصرح")
    body = await request.json()
    model = body.get("model")
    m = next((x for x in MODELS if x["model"] == model), None)
    if not m:
        raise HTTPException(status_code=400, detail="النموذج غير مدعوم")
    UserMessage = _llm_module().UserMessage
    st = await get_settings(get_db())
    llm = _build_chat({**st, **m}, f"test-{current_user['id']}", "أجب بكلمة واحدة فقط.", timeout=40)
    source_ar = "مفتاحك الخاص" if llm.key_source == "own" else "المفتاح الشامل"
    t0 = _now()
    try:
        reply = await llm.send_message(UserMessage(text="قل: جاهز"))
    except Exception as e:
        err = str(e)
        hint = _classify(err)
        logging.error(f"assistant test failed [{m['provider']}/{m['model']} via {llm.key_source}]: {err[:300]}")
        raise HTTPException(status_code=424, detail=f"فشل الاختبار ({source_ar}): {hint}\n{err[:160]}")
    return {"ok": True, "reply": str(reply)[:80], "ms": int((_now() - t0).total_seconds() * 1000), "key_source": llm.key_source, "key_source_label": source_ar}
