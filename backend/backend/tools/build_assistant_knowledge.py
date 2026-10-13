"""🧠 بناء قاعدة معرفة مرشد الأحقاف من كود الشاشات الفعلي (يُشغَّل يدوياً في بيئة التطوير)
الاستخدام: cd /app/backend/backend && python -m tools.build_assistant_knowledge [--force] [--only students,courses] [--model gpt-5.4-mini]
"""
import argparse
import asyncio
import hashlib
import json
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")
FRONTEND_APP = Path("/app/frontend/app")
API_TS = Path("/app/frontend/src/services/api.ts")
OUT = BACKEND_DIR / "assistant_knowledge.json"
SCREENS = json.loads((BACKEND_DIR / "assistant_screens.json").read_text(encoding="utf-8"))
AR = re.compile(r"[\u0600-\u06FF]")
SKIP = {"_layout", "+html", "+not-found"}


BIG_COMPONENT = 60000


def discover_screens():
    out = []
    seen_comp = set()
    for f in sorted(FRONTEND_APP.glob("*.tsx")) + sorted((FRONTEND_APP / "(tabs)").glob("*.tsx")):
        if f.stem in SKIP:
            continue
        path = "/(tabs)" if f.parent.name == "(tabs)" and f.stem == "index" else (f"/(tabs)/{f.stem}" if f.parent.name == "(tabs)" else f"/{f.stem}")
        meta = next((s for s in SCREENS if s["path"] == path), None)
        sid = f.stem if f.parent.name != "(tabs)" or f.stem == "index" else f"tabs-{f.stem}"
        out.append({"id": sid, "path": path, "file": f, "menu": meta})
        # المكوّنات الكبيرة (نوافذ/تبويبات ضخمة) تأخذ بطاقة مستقلة مرتبطة بشاشتها
        for c in component_files(f.read_text(encoding="utf-8"), f):
            if c.stat().st_size >= BIG_COMPONENT and c.stem not in seen_comp:
                seen_comp.add(c.stem)
                out.append({"id": f"component-{c.stem}", "path": path, "file": c, "menu": None, "parent": sid, "parent_menu": meta})
    return out


def component_files(src: str, file: Path):
    out = []
    for rel in re.findall(r"from\s+['\"](\.\.?/[^'\"]*components/[^'\"]+)['\"]", src):
        p = (file.parent / rel).resolve()
        for c in [p.with_suffix(".tsx"), p / "index.tsx", p.with_suffix(".ts")]:
            if c.exists():
                out.append(c)
                break
    return out


def api_method_index():
    """xxxAPI.method → (HTTP, path) من services/api.ts"""
    src = API_TS.read_text(encoding="utf-8")
    idx = {}
    for m in re.finditer(r"export const (\w+API)\s*=\s*\{", src):
        name = m.group(1)
        end = src.find("\n};", m.end())
        block = src[m.end():end if end > 0 else len(src)]
        for mm in re.finditer(r"\n\s*(\w+):\s*(?:async\s*)?\(", block):
            tail = block[mm.end():mm.end() + 500]
            call = re.search(r"api\.(get|post|put|delete|patch)\(\s*[`'\"]([^`'\"]+)", tail)
            if call:
                idx[f"{name}.{mm.group(1)}"] = (call.group(1).upper(), call.group(2))
    return idx


def backend_route_index():
    """مسار → (الدالة، docstring) من server.py والراوترات"""
    idx = {}
    files = [BACKEND_DIR / "server.py"] + sorted((BACKEND_DIR / "routes").glob("*.py"))
    for f in files:
        try:
            src = f.read_text(encoding="utf-8")
        except Exception:
            continue
        pm = re.search(r"router\s*=\s*APIRouter\([^)]*prefix\s*=\s*[\"']([^\"']+)", src)
        prefix = pm.group(1) if pm else ""
        for m in re.finditer(r"@(?:api_router|router)\.(get|post|put|delete|patch)\(\s*[\"']([^\"']+)[\"'][^\n]*\n(?:@[^\n]*\n)*\s*async def (\w+)\([^)]*\)[^:]*:\s*\n(\s*\"\"\"(.*?)\"\"\")?", src, re.S):
            path = (prefix + m.group(2)) if prefix and not m.group(2).startswith("/api") else m.group(2)
            doc = re.sub(r"\s+", " ", m.group(5) or "").strip()[:400]
            idx[(m.group(1).upper(), path.replace("/api", "", 1) if path.startswith("/api") else path)] = (m.group(3), doc)
    return idx


def route_lookup(ridx, method, path):
    path = re.sub(r"\?.*$", "", path).replace("${", "{").split("`")[0]
    for (mth, rp), v in ridx.items():
        if mth != method:
            continue
        pat = "^" + re.sub(r"\{[^}]+\}", "[^/]+", re.sub(r"\$\{[^}]+\}", "[^/]+", rp)) + "$"
        if re.match(pat, re.sub(r"\{[^}]+\}", "x", path)):
            return v
    return None


def with_components(src: str, file: Path) -> str:
    """يضمّ نصوص المكوّنات المستوردة من src/components (مستوى واحد) حتى تُوثَّق النوافذ والأزرار داخلها — الكبيرة لها بطاقة مستقلة"""
    extra = []
    for c in component_files(src, file):
        if c.stat().st_size >= BIG_COMPONENT:
            extra.append(f"\n// === مكوّن كبير له بطاقة مستقلة: {c.stem} (يُعرض داخل هذه الشاشة) ===\n")
            continue
        try:
            txt = c.read_text(encoding="utf-8")
            cut = txt.find("StyleSheet.create(")
            extra.append(f"\n// === مكوّن مضمَّن: {c.name} ===\n" + (txt[:cut] if cut > 0 else txt))
        except Exception:
            pass
    return src + "".join(extra)[:120000]


def compress(src: str, api_idx, ridx) -> str:
    cut = src.find("StyleSheet.create(")
    body = src[:cut] if cut > 0 else src
    body = "\n".join(l for l in body.splitlines() if not l.strip().startswith("import "))
    ar_lines, seen = [], set()
    for l in body.splitlines():
        t = l.strip()
        if AR.search(t) and t not in seen and not t.startswith("//"):
            seen.add(t)
            ar_lines.append(t[:220])
    perms = sorted(set(re.findall(r"hasPermission\(\s*(?:PERMISSIONS\.)?['\"]?([\w.]+)['\"]?\s*\)", body)) | set(re.findall(r"Permission\.([A-Z_]+)", body)))
    roles = sorted(set(re.findall(r"role\s*===?\s*['\"](\w+)['\"]", body)) | set(re.findall(r"UserRole\.([A-Z_]+)", body)))
    navs = sorted(set(re.findall(r"router\.(?:push|replace)\(\s*[`'\"](/[^`'\"?]+)", body)) | set(re.findall(r"pathname:\s*[`'\"](/[^`'\"?]+)", body)))
    test_ids = sorted(set(re.findall(r"testID=[\"'{`]+([\w-]+)", body)))[:120]
    apis = []
    for mth, p in re.findall(r"api\.(get|post|put|delete|patch)\(\s*[`'\"]([^`'\"]+)", body):
        apis.append((mth.upper(), p))
    for name in set(re.findall(r"\b(\w+API\.\w+)\(", body)):
        if name in api_idx:
            apis.append(api_idx[name])
    api_lines, seen_api = [], set()
    for mth, p in apis:
        key = (mth, p)
        if key in seen_api:
            continue
        seen_api.add(key)
        hit = route_lookup(ridx, mth, p)
        api_lines.append(f"{mth} {p}" + (f" — {hit[0]}: {hit[1]}" if hit and hit[1] else (f" — {hit[0]}" if hit else "")))
    parts = [
        "## نصوص الواجهة (عناوين/أزرار/حقول/رسائل):", "\n".join(ar_lines[:750]),
        "## صلاحيات/أدوار مذكورة في الكود:", ", ".join(perms + roles) or "لا شيء صريح",
        "## تنقّلات إلى شاشات أخرى:", ", ".join(navs) or "لا شيء",
        "## معرّفات عناصر الاختبار (تدل على الأزرار والحقول):", ", ".join(test_ids) or "لا شيء",
        "## واجهات الخادم المستخدمة:", "\n".join(api_lines[:80]) or "لا شيء",
    ]
    return "\n".join(parts)[:90000]


PROMPT = """أنت محلل أنظمة يوثّق شاشة في نظام جامعة الأحقاف (حضور، شؤون أكاديمية، موارد بشرية، مراسلات، أرشيف). أمامك مستخلص من كود الشاشة الفعلي (نصوص الواجهة، الأزرار، الحقول، الصلاحيات، واجهات الخادم مع شروحها).
أنتج بطاقة معرفة عربية دقيقة لمرشد ذكي يرشد المستخدمين داخل النظام. اعتمد فقط على ما في المستخلص؛ لا تخترع أزراراً أو ميزات. اذكر كل زر/إجراء/حقل مهم ووظيفته. اكتب بالعربية الفصحى المبسطة.
أعد JSON فقط بهذا الشكل بالضبط:
{"title": "اسم الشاشة", "purpose": "الغرض في جملتين", "audience": "من يستخدمها (أدوار/صلاحيات)", "elements": [{"name": "اسم الزر/الحقل/التبويب", "does": "ماذا يفعل بالتحديد"}], "tasks": [{"goal": "مهمة شائعة", "steps": ["خطوة 1", "خطوة 2"]}], "rules": ["قاعدة/شرط/حد يطبّقه النظام"], "cautions": ["تحذير لعمليات واسعة الأثر أو غير قابلة للتراجع"], "keywords": ["كلمات مفتاحية عربية وإنجليزية يبحث بها المستخدم عن هذه الشاشة"], "parent_screen_id": "معرّف أقرب شاشة رئيسية من القائمة أو null"}
القائمة الرئيسية (id: label: path):
{menu}

الشاشة: {path} (ملف {file}){menu_label}
المستخلص:
{content}"""


async def summarize(llm_factory, sc, content, menu_txt):
    from emergentintegrations.llm.chat import UserMessage
    label = f" — اسم القائمة: {sc['menu']['label']}" if sc.get("menu") else (f" — مكوّن/نافذة كبيرة تُعرض داخل الشاشة {sc['path']}" if sc.get("parent") else "")
    llm = llm_factory(f"kb-{sc['id']}")
    txt = PROMPT.replace("{menu}", menu_txt).replace("{path}", sc["path"]).replace("{file}", sc["file"].name).replace("{menu_label}", label).replace("{content}", content)
    raw = str(await llm.send_message(UserMessage(text=txt)))
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.S)
    start, end = raw.find("{"), raw.rfind("}")
    return json.loads(raw[start:end + 1])


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--model", default="gpt-5.4-mini")
    ap.add_argument("--concurrency", type=int, default=5)
    args = ap.parse_args()
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        sys.exit("EMERGENT_LLM_KEY غير موجود")
    from emergentintegrations.llm.chat import LlmChat

    def llm_factory(sid):
        return LlmChat(api_key=key, session_id=sid, system_message="أنت موثّق أنظمة دقيق تجيب بـ JSON فقط.").with_model("openai", args.model).with_params(timeout=180)

    existing = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {"cards": {}, "built_at": None, "model": None}
    cards = existing.get("cards", {})
    api_idx, ridx = api_method_index(), backend_route_index()
    screens = discover_screens()
    only = {s.strip() for s in args.only.split(",") if s.strip()}
    menu_txt = "\n".join(f"{s['id']}: {s['label']}: {s['path']}" for s in SCREENS)
    sem = asyncio.Semaphore(args.concurrency)
    done = {"n": 0, "skipped": 0, "failed": []}

    async def work(sc):
        src = sc["file"].read_text(encoding="utf-8")
        h = hashlib.sha1(src.encode()).hexdigest()[:12]
        if not args.force and sc["id"] in cards and cards[sc["id"]].get("source_hash") == h and (not only or sc["id"] in only):
            done["skipped"] += 1
            return
        if only and sc["id"] not in only:
            return
        content = compress(with_components(src, sc["file"]), api_idx, ridx)
        async with sem:
            try:
                card = await summarize(llm_factory, sc, content, menu_txt)
            except Exception as e:
                done["failed"].append(f"{sc['id']}: {str(e)[:120]}")
                print(f"✗ {sc['id']}: {str(e)[:120]}", flush=True)
                return
        card.update({"id": sc["id"], "path": sc["path"], "source_hash": h, "menu_id": sc["menu"]["id"] if sc.get("menu") else ((sc.get("parent_menu") or {}).get("id")),
                     "parent_screen_id": card.get("parent_screen_id") or sc.get("parent"),
                     "permissions": (sc["menu"] or sc.get("parent_menu") or {}).get("permissions", []), "roles": (sc["menu"] or sc.get("parent_menu") or {}).get("roles", [])})
        cards[sc["id"]] = card
        done["n"] += 1
        OUT.write_text(json.dumps({"cards": cards, "built_at": __import__("datetime").datetime.now().isoformat(), "model": args.model}, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"✓ {sc['id']} ({done['n']})", flush=True)

    await asyncio.gather(*(work(sc) for sc in screens))
    print(f"\nتم: {done['n']} بطاقة جديدة، {done['skipped']} بلا تغيير، فشل: {len(done['failed'])}")
    for f in done["failed"]:
        print("  -", f)


if __name__ == "__main__":
    asyncio.run(main())
