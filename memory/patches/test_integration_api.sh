#!/bin/bash
API=$(grep REACT_APP_BACKEND_URL /app/frontend/.env | cut -d '=' -f2)
KEY=$(grep SERVICE_API_KEY /app/backend/.env | cut -d '=' -f2)
H="Authorization: Bearer $KEY"
PASS_ALL=1
check() { if [ "$2" == "1" ]; then echo "$1: PASS"; else echo "$1: FAIL"; PASS_ALL=0; fi }

# ===== AUTH =====
NO_KEY=$(curl -s -o /dev/null -w '%{http_code}' "$API/api/integration/students")
BAD_KEY=$(curl -s -o /dev/null -w '%{http_code}' "$API/api/integration/students" -H "Authorization: Bearer wrong-key-123")
GOOD=$(curl -s -o /dev/null -w '%{http_code}' "$API/api/integration/students" -H "$H")
[ "$NO_KEY" == "401" ] && [ "$BAD_KEY" == "403" ] && [ "$GOOD" == "200" ] && check "AUTH" 1 || check "AUTH" 0

# ===== STUDENTS =====
ST=$(curl -s "$API/api/integration/students?page_size=5" -H "$H" | python3 -c "
import sys, json
d = json.load(sys.stdin)
it = d['items'][0] if d['items'] else {}
required = ['external_student_id','student_number','full_name','gender','status','college_id','department_id','program_id','level_id','admission_year','created_at','updated_at']
print(1 if d['total'] > 0 and all(k in it for k in required) else 0)")
check "STUDENTS ENDPOINT" "$ST"

# ===== COURSES =====
CO=$(curl -s "$API/api/integration/courses?page_size=5" -H "$H" | python3 -c "
import sys, json
d = json.load(sys.stdin)
it = d['items'][0] if d['items'] else {}
required = ['external_course_id','course_code','course_name_ar','course_name_en','credit_hours','program_id','level_id','semester_id','status','created_at','updated_at']
print(1 if d['total'] > 0 and all(k in it for k in required) else 0)")
check "COURSES ENDPOINT" "$CO"

# ===== ENROLLMENTS =====
EN=$(curl -s "$API/api/integration/enrollments?page_size=5" -H "$H" | python3 -c "
import sys, json
d = json.load(sys.stdin)
it = d['items'][0] if d['items'] else {}
required = ['external_enrollment_id','student_id','course_id','academic_year_id','semester_id','registration_status','created_at','updated_at']
print(1 if d['total'] > 0 and all(k in it for k in required) else 0)")
check "ENROLLMENTS ENDPOINT" "$EN"

# ===== UPDATED_SINCE =====
ALL=$(curl -s "$API/api/integration/students?page_size=1" -H "$H" | python3 -c "import sys,json;print(json.load(sys.stdin)['total'])")
FUT=$(curl -s "$API/api/integration/students?page_size=1&updated_since=2099-01-01T00:00:00" -H "$H" | python3 -c "import sys,json;print(json.load(sys.stdin)['total'])")
PAST=$(curl -s "$API/api/integration/students?page_size=1&updated_since=2020-01-01T00:00:00" -H "$H" | python3 -c "import sys,json;print(json.load(sys.stdin)['total'])")
BAD=$(curl -s -o /dev/null -w '%{http_code}' "$API/api/integration/students?updated_since=not-a-date" -H "$H")
[ "$FUT" == "0" ] && [ "$PAST" == "$ALL" ] && [ "$ALL" -gt 0 ] && [ "$BAD" == "422" ] && check "UPDATED_SINCE" 1 || check "UPDATED_SINCE" 0

# ===== PAGINATION =====
P1=$(curl -s "$API/api/integration/students?page=1&page_size=3" -H "$H")
P2=$(curl -s "$API/api/integration/students?page=2&page_size=3" -H "$H")
PG=$(P1="$P1" P2="$P2" python3 -c "
import json, os
p1 = json.loads(os.environ['P1']); p2 = json.loads(os.environ['P2'])
ids1 = {i['external_student_id'] for i in p1['items']}; ids2 = {i['external_student_id'] for i in p2['items']}
ok = len(p1['items']) == 3 and not (ids1 & ids2) and p1['has_more'] and p1['total'] == p2['total'] and p2['page'] == 2
print(1 if ok else 0)")
check "PAGINATION" "$PG"

# ===== READ ONLY =====
M1=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/integration/students" -H "$H" -H "Content-Type: application/json" -d '{}')
M2=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$API/api/integration/courses" -H "$H" -d '{}')
M3=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$API/api/integration/enrollments" -H "$H")
M4=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$API/api/integration/semesters" -H "$H" -d '{}')
[ "$M1" == "405" ] && [ "$M2" == "405" ] && [ "$M3" == "405" ] && [ "$M4" == "405" ] && check "READ ONLY" 1 || check "READ ONLY" 0

echo "-----"
if [ "$PASS_ALL" == "1" ]; then echo "ATTENDANCE MASTER DATA API VERIFIED"; else echo "SOME TESTS FAILED"; fi
