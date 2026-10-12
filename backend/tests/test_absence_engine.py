"""اختبارات محرك احتساب الغياب وفق لائحة الكلية (بالساعات، المنفَّذ فقط، حدّان، تجاوز = أكبر من)"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
from services.absence_engine import classify, lecture_hours

L = {"unexcused_limit": 10.0, "total_limit": 25.0, "min_executed": 4}


def test_exactly_at_limit_is_not_candidate():
    # 10 ساعات منفَّذة، غياب بلا عذر ساعة واحدة = 10% بالضبط → ليس تجاوزاً
    p = classify(1.0, 0.0, 10.0, 7, L)
    assert p["pct_unexcused"] == 10.0 and not p["exceeded_unexcused"] and p["status"] != "candidate"


def test_just_above_unexcused_limit_is_candidate():
    p = classify(1.5, 0.0, 10.0, 7, L)   # 15% بلا عذر
    assert p["exceeded_unexcused"] and p["status"] == "candidate"


def test_excused_counts_toward_total_only():
    # 1 س بلا عذر (10%) + 1.5 س بعذر = 25% إجمالي بالضبط → سليم (الحدّان مستقلان)
    p = classify(1.0, 1.5, 10.0, 7, L)
    assert p["pct_total"] == 25.0 and not p["exceeded_total"] and p["status"] != "candidate"
    # زيادة نصف ساعة بعذر → 30% إجمالي → مرشَّح رغم أن بلا عذر عند الحد
    p2 = classify(1.0, 2.0, 10.0, 7, L)
    assert p2["exceeded_total"] and not p2["exceeded_unexcused"] and p2["status"] == "candidate"


def test_excused_alone_up_to_25_is_safe():
    p = classify(0.0, 2.5, 10.0, 7, L)
    assert p["status"] != "candidate" and p["remaining_total_hours"] == 0.0


def test_levels_follow_student_app_scale():
    assert classify(0.0, 0.0, 10.0, 6, L)["status"] == "excellent"
    assert classify(0.4, 0.0, 10.0, 6, L)["status"] == "good"       # 4% = 40% من الحد
    assert classify(0.65, 0.0, 10.0, 6, L)["status"] == "warning"   # 6.5% = 65%
    assert classify(0.85, 0.0, 10.0, 6, L)["status"] == "danger"    # 8.5% = 85%


def test_early_indicator_before_min_executed():
    p = classify(1.5, 0.0, 1.5, 1, L)
    assert p["early"] and p["status"] == "candidate" and "مؤشر مبكر" in p["status_ar"]
    assert not classify(0.0, 0.0, 6.0, 4, L)["early"]


def test_hours_not_lecture_count():
    assert lecture_hours({"start_time": "08:00", "end_time": "09:30"}) == 1.5
    assert lecture_hours({"start_time": "16:30", "end_time": "18:30"}) == 2.0
    assert lecture_hours({"start_time": "08:00", "end_time": "09:30", "credited_minutes": 60}) == 1.0
    # غياب عن محاضرة ساعتين من 10 ساعات = 20% بلا عذر (لو عُدّت محاضرات: 1 من 6 = 16.7%)
    p = classify(2.0, 0.0, 10.0, 6, L)
    assert p["pct_unexcused"] == 20.0 and p["status"] == "candidate"


def test_remaining_hours():
    p = classify(0.5, 0.0, 10.0, 6, L)
    assert p["remaining_unexcused_hours"] == 0.5 and p["remaining_total_hours"] == 2.0
