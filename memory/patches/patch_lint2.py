import ast, re

# 1) حذف reports.py الميت (غير مستورد في أي مكان)
import os
os.remove("/app/backend/backend/routes/reports.py")
print("reports.py deleted")

# 2) server.py: bare except → except Exception + إعادة تسمية root المكرر
P = "/app/backend/backend/server.py"
s = open(P, encoding="utf-8").read()
n = len(re.findall(r"(?m)^(\s*)except\s*:", s))
s = re.sub(r"(?m)^(\s*)except\s*:", r"\1except Exception:", s)
old = '''@api_router.get("/")
async def root():
    return {"message": "نظام حضور كلية الشريعة والقانون", "version": "1.0"}'''
assert s.count(old) == 1
s = s.replace(old, '''@api_router.get("/")
async def api_root():
    return {"message": "نظام حضور كلية الشريعة والقانون", "version": "1.0"}''')
ast.parse(s)
open(P, "w", encoding="utf-8").write(s)
print("server.py: bare excepts fixed:", n, "+ api_root renamed")

# 3) tests: bare except
P = "/app/backend/backend/tests/test_safe_delete_restore.py"
s = open(P, encoding="utf-8").read()
n = len(re.findall(r"(?m)^(\s*)except\s*:", s))
s = re.sub(r"(?m)^(\s*)except\s*:", r"\1except Exception:", s)
ast.parse(s)
open(P, "w", encoding="utf-8").write(s)
print("tests fixed:", n)
