"""🧠 قاعدة معرفة المرشد: تحميل بطاقات الشاشات (assistant_knowledge.json) واسترجاع الأنسب لسؤال المستخدم"""
import json
import re
from pathlib import Path
from typing import List, Optional

KB_PATH = Path(__file__).resolve().parent.parent / "assistant_knowledge.json"
_DIACRITICS = re.compile(r"[\u064B-\u0652\u0640]")
_STOP = {"في", "من", "على", "الى", "إلى", "عن", "ما", "هل", "كيف", "ماذا", "لماذا", "متى", "اين", "أين", "هو", "هي", "ان", "أن", "او", "أو", "ثم", "مع", "هذا", "هذه", "ذلك", "التي", "الذي", "لا", "نعم",
         "the", "a", "an", "is", "to", "of", "in", "and", "or", "how", "what", "do", "i", "can", "my", "me", "اريد", "أريد", "ابي", "عايز", "ممكن", "لو", "سمحت", "فضلك", "عند", "عندي", "لي", "له", "لها", "به", "بها", "كل", "بعض", "غير", "بين", "قد", "تم", "يتم"}


def normalize(text: str) -> str:
    t = _DIACRITICS.sub("", (text or "").lower())
    t = re.sub(r"[إأآا]", "ا", t).replace("ى", "ي").replace("ة", "ه").replace("ؤ", "و").replace("ئ", "ي")
    return t


_SYN = {"اكسل": "excel", "إكسل": "excel", "اكسيل": "excel", "واتساب": "whatsapp", "واتس": "whatsapp", "ايميل": "email", "إيميل": "email", "بريد": "email", "بي دي اف": "pdf", "كيو ار": "qr", "باركود": "qr", "جي بي اس": "gps", "موقع": "gps"}


def tokens(text: str) -> List[str]:
    out = []
    for w in re.split(r"[^\w\u0600-\u06FF]+", normalize(text)):
        if len(w) < 2 or w in _STOP:
            continue
        if w.startswith("ال") and len(w) > 4:
            w = w[2:]
        elif w.startswith("و") and len(w) > 4:
            w = w[1:]
        out.append(_SYN.get(w, w))
    return out


def _match(q: str, t: str) -> bool:
    if q == t:
        return True
    return (len(q) >= 4 and t.startswith(q)) or (len(t) >= 4 and q.startswith(t))


class KnowledgeBase:
    def __init__(self):
        self.cards: dict = {}
        self.meta: dict = {}
        self._index: dict = {}
        self.load()

    def load(self):
        if KB_PATH.exists():
            data = json.loads(KB_PATH.read_text(encoding="utf-8"))
            self.cards = data.get("cards", {})
            self.meta = {"built_at": data.get("built_at"), "model": data.get("model"), "count": len(self.cards)}
        else:
            self.cards, self.meta = {}, {"built_at": None, "model": None, "count": 0}
        self._index = {cid: self._fields(c) for cid, c in self.cards.items()}

    @staticmethod
    def _fields(c: dict) -> List[tuple]:
        return [
            (3.0, set(tokens(c.get("title", "")) + tokens(c.get("path", "").replace("-", " ").replace("/", " ")))),
            (3.0, set(t for k in c.get("keywords", []) for t in tokens(k))),
            (2.0, set(tokens(c.get("purpose", "")))),
            (1.5, set(t for e in c.get("elements", []) for t in tokens(e.get("name", "")))),
            (1.5, set(t for t_ in c.get("tasks", []) for t in tokens(t_.get("goal", "")))),
            (0.8, set(t for e in c.get("elements", []) for t in tokens(e.get("does", "")))),
            (0.8, set(t for r in c.get("rules", []) + c.get("cautions", []) for t in tokens(r))),
        ]

    @staticmethod
    def _score(qtoks: List[str], fields: List[tuple]) -> float:
        score = 0.0
        for q in qtoks:
            best = 0.0
            for w, toks in fields:
                if w <= best:
                    continue
                if any(_match(q, t) for t in toks):
                    best = w
            score += best
        return score

    def search(self, query: str, route: Optional[str] = None, allowed_ids=None, notes: Optional[List[dict]] = None, limit: int = 5) -> List[dict]:
        qtoks = list(dict.fromkeys(tokens(query)))
        route_id = (route or "").split("?")[0].strip("/").replace("(tabs)/", "tabs-").replace("(tabs)", "index") or None
        scored = []
        for cid, c in self.cards.items():
            if allowed_ids is not None and cid not in allowed_ids:
                continue
            s = self._score(qtoks, self._index[cid]) if qtoks else 0.0
            if route_id and cid == route_id:
                s += 4.0
            if s > 0 and c.get("menu_id"):
                s += 0.5
            if s > 0:
                scored.append((s, {"kind": "card", **c}))
        for i, n in enumerate(notes or []):
            fields = [(3.5, set(tokens(n.get("title", "")))), (2.0, set(tokens(n.get("text", ""))))]
            s = self._score(qtoks, fields) if qtoks else 0.0
            if s > 0:
                scored.append((s + 1.0, {"kind": "note", "id": f"note-{i}", "title": n.get("title", ""), "text": n.get("text", "")}))
        scored.sort(key=lambda x: -x[0])
        return [{**c, "score": round(s, 1)} for s, c in scored[:limit]]


def render_cards(items: List[dict], max_chars: int = 15000) -> str:
    parts = []
    for it in items:
        if it.get("kind") == "note":
            parts.append(f"### ملاحظة من الإدارة: {it['title']}\n{it['text']}")
            continue
        lines = [f"### {it.get('title')} — المسار: {it.get('path')}", f"الغرض: {it.get('purpose')}", f"المستخدمون: {it.get('audience')}"]
        if it.get("elements"):
            lines.append("العناصر والأزرار:")
            lines += [f"- {e.get('name')}: {e.get('does')}" for e in it["elements"][:28]]
        for t in it.get("tasks", [])[:5]:
            lines.append(f"مهمة «{t.get('goal')}»: " + " ← ".join(t.get("steps", [])[:8]))
        if it.get("rules"):
            lines.append("قواعد: " + " | ".join(it["rules"][:8]))
        if it.get("cautions"):
            lines.append("تحذيرات: " + " | ".join(it["cautions"][:5]))
        parts.append("\n".join(lines))
    out = "\n\n".join(parts)
    return out[:max_chars]


KB = KnowledgeBase()
