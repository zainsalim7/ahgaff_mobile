# 🚀 دليل نشر نظام أحقاف على Google Cloud Run

> **الهدف:** نشر نسخة كاملة من النظام على GCP بجانب نسخة Railway الحالية، مع تزامن لحظي عبر MongoDB Atlas المشتركة، وإمكانية الوصول من subdomain خاص بـ `ahgaff.net`.

---

## 📐 المعمارية النهائية

```
┌─────────────────────────────────────────────────────────┐
│                  MongoDB Atlas (مشتركة)                  │
│            تزامن لحظي 100% بين النسختين                  │
└──────────────────┬──────────────────────┬───────────────┘
                   │                      │
         ┌─────────▼─────────┐  ┌────────▼──────────┐
         │   Railway (حالي)  │  │  GCP Cloud Run    │
         │   ahgaff.net      │  │  gcp.ahgaff.net   │
         │   api.ahgaff.net  │  │  api-gcp.ahgaff.. │
         └───────────────────┘  └───────────────────┘
                   ▲                      ▲
                   │                      │
                   └──────── Cloudflare ──┘
                       (DNS لكلا النطاقين)
```

---

## ✅ الخطوة 1: إنشاء مشروع GCP (5 دقائق)

### من Google Cloud Console:

1. اذهب إلى: https://console.cloud.google.com
2. أعلى الصفحة، اضغط زر اختيار المشروع (بجانب شعار Google Cloud) → **"New Project"**
3. الإعدادات:
   - **Project name**: `ahgaff-university`
   - **Project ID**: سيُنشأ تلقائياً (مثلاً `ahgaff-university-123456`) — **احفظه!**
   - **Organization**: اتركها كما هي
4. اضغط **CREATE**
5. انتظر 30 ثانية حتى يكتمل الإنشاء، ثم تأكد أنه مُختار في الأعلى

### تفعيل الفوترة (إجباري لـ Cloud Run):

1. من القائمة الجانبية: **Billing**
2. اربط بطاقة (Free Trial يعطيك $300 لمدة 90 يوم)
3. لا قلق — Free tier يكفي لجامعة كاملة (2M request/شهر مجاناً)

### تفعيل APIs المطلوبة (انسخ والصق):

من القائمة → **APIs & Services → Library** فعّل:
- Cloud Run API
- Cloud Build API
- Artifact Registry API
- Secret Manager API

أو بأمر واحد من **Cloud Shell** (الأيقونة `>_` أعلى يمين الـ Console):

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com
```

---

## ✅ الخطوة 2: تثبيت gcloud CLI على جهازك (Mac/Linux/Windows)

### Mac:
```bash
brew install --cask google-cloud-sdk
```

### Linux (Ubuntu/Debian):
```bash
curl https://sdk.cloud.google.com | bash
exec -l $SHELL
```

### Windows:
حمّل من: https://cloud.google.com/sdk/docs/install-sdk#windows

### بعد التثبيت — على جميع الأنظمة:

```bash
# تسجيل دخول بحساب Google
gcloud auth login

# اضبط المشروع (استبدل YOUR_PROJECT_ID بالـ ID الذي أنشأته)
gcloud config set project YOUR_PROJECT_ID

# تأكد إنه صحيح
gcloud config get-value project
```

---

## ✅ الخطوة 3: إنشاء Artifact Registry (لتخزين Docker images)

من Cloud Shell أو الـ terminal:

```bash
gcloud artifacts repositories create ahgaff \
  --repository-format=docker \
  --location=me-central1 \
  --description="Ahgaff University Docker Images"
```

---

## ✅ الخطوة 4: حفظ الأسرار في Secret Manager

⚠️ **مهم جداً**: لا تضع MONGO_URL أو SECRET_KEY في الكود أو Dockerfile.

```bash
# 1) MongoDB Connection String — الصق نفس الـ connection string الذي تستخدمه Railway
echo -n 'mongodb+srv://USER:PASS@cluster.mongodb.net/?retryWrites=true&w=majority' | \
  gcloud secrets create mongo-url --data-file=-

# 2) JWT Secret — استخدم نفس المفتاح الموجود في Railway (مهم!) حتى يقبل الـ tokens
echo -n 'YOUR_JWT_SECRET_FROM_RAILWAY' | \
  gcloud secrets create jwt-secret --data-file=-

# 3) (اختياري) ALLOWED_ORIGINS للـ CORS
echo -n 'https://gcp.ahgaff.net,https://ahgaff.net,https://www.ahgaff.net' | \
  gcloud secrets create allowed-origins --data-file=-
```

> 💡 **كيف تجلب القيم الحالية من Railway؟**
> Railway Dashboard → Service → Variables → انسخ `MONGO_URL` و `SECRET_KEY`

### إعطاء Cloud Run صلاحية قراءة الأسرار:

```bash
# جلب رقم المشروع تلقائياً
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format="value(projectNumber)")

# إعطاء الصلاحية للحساب الافتراضي
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

---

## ✅ الخطوة 5: ربط GitHub بـ Cloud Build (Auto-Deploy)

### من Console (أسهل):

1. اذهب إلى **Cloud Build → Triggers**: https://console.cloud.google.com/cloud-build/triggers
2. اضغط **"CONNECT REPOSITORY"** → اختر **GitHub (Cloud Build GitHub App)**
3. ثبّت تطبيق Cloud Build على repo الخاص بك (يفتح نافذة GitHub لتوثيق الصلاحيات)
4. اختر الـ repository الخاص بمشروعك

### إنشاء Trigger للـ Backend:

5. اضغط **"CREATE TRIGGER"**
   - **Name**: `deploy-backend`
   - **Event**: Push to a branch
   - **Source**: اختر repo والـ branch (مثل `main` أو `master`)
   - **Included files filter (glob)**: `backend/**`
   - **Configuration**: Cloud Build configuration file
   - **Cloud Build configuration file location**: `/cloudbuild-backend.yaml`
   - اضغط **CREATE**

### إنشاء Trigger للـ Frontend:

6. كرر الخطوة 5 لكن:
   - **Name**: `deploy-frontend`
   - **Included files filter (glob)**: `frontend/**`
   - **Cloud Build configuration file location**: `/cloudbuild-frontend.yaml`

✅ الآن أي push إلى GitHub سيُطلق build و deploy تلقائياً!

---

## ✅ الخطوة 6: أول نشر يدوي (لتجربة كل شيء)

من جذر المشروع على جهازك:

### Backend أولاً:
```bash
cd /path/to/your/repo
gcloud builds submit --config=cloudbuild-backend.yaml .
```

⏱️ ينتظر 3-5 دقائق. عند النجاح سيُظهر رابط مثل:
```
Service URL: https://ahgaff-backend-XXXXX-me.run.app
```

### تجربة الـ Backend:
```bash
curl https://ahgaff-backend-XXXXX-me.run.app/api/health
```

### Frontend (لاحظ: عدّل الـ _BACKEND_URL في cloudbuild-frontend.yaml قبل البناء):

افتح `cloudbuild-frontend.yaml` وغيّر السطر:
```yaml
_BACKEND_URL: 'https://ahgaff-backend-XXXXX-me.run.app'
```
(أو اتركه `https://api-gcp.ahgaff.net` إذا كنت ستربط الـ domain أولاً)

```bash
gcloud builds submit --config=cloudbuild-frontend.yaml .
```

---

## ✅ الخطوة 7: ربط Subdomain من Cloudflare

### في Cloud Run Console:

1. https://console.cloud.google.com/run
2. اضغط على خدمة `ahgaff-backend` → تبويب **"DOMAIN MAPPINGS"** (أو Custom Domains)
3. اضغط **"+ ADD MAPPING"**
4. اختر service: `ahgaff-backend`، Domain: `api-gcp.ahgaff.net`
5. GCP سيعطيك سجلات DNS — احفظها

### في Cloudflare:

1. Dashboard → ahgaff.net → **DNS → Records**
2. أضف:
   ```
   Type: CNAME
   Name: api-gcp
   Target: ghs.googlehosted.com
   Proxy status: DNS only (السحابة الرمادية) ⚠️ مهم!
   TTL: Auto
   ```
3. كرر لـ `gcp` (للـ frontend):
   ```
   Type: CNAME
   Name: gcp
   Target: ghs.googlehosted.com
   Proxy status: DNS only
   ```

⚠️ **مهم**: يجب أن يكون Proxy = **DNS only** (رمادي وليس برتقالي) لأن Cloud Run يدير الـ SSL بنفسه.

ينتظر 5-15 دقيقة حتى يصدر Google شهادة SSL تلقائياً.

---

## ✅ الخطوة 8: التحقق النهائي

```bash
# Backend
curl https://api-gcp.ahgaff.net/api/health

# Frontend (افتح في المتصفح)
open https://gcp.ahgaff.net
```

سجّل الدخول بنفس بيانات Railway — يجب أن يعمل لأن قاعدة البيانات مشتركة!

---

## 🔄 سير العمل اليومي بعد الإعداد

```
أنت تكتب كود → git push → 
   ↓
GitHub → Cloud Build Trigger يكتشف التغيير
   ↓
يبني صورة Docker → يرفعها → ينشرها على Cloud Run
   ↓
خلال 2-3 دقائق، النسخة الجديدة live على gcp.ahgaff.net
   ↓
Railway أيضاً يستقبل نفس الـ push (إذا كانت triggers مفعّلة)
   ↓
كلا النسختين محدّثتان ومتزامنتان
```

---

## 💰 التكلفة المتوقعة (جامعة 5000 طالب)

| المكوّن | Free Tier | تجاوز Free Tier |
|---------|-----------|------------------|
| Cloud Run (Backend) | 2M requests/شهر | $0.40 لكل مليون |
| Cloud Run (Frontend) | 2M requests/شهر | $0.40 لكل مليون |
| Cloud Build | 120 دقيقة/يوم | $0.003/دقيقة |
| Artifact Registry | 0.5GB | $0.10/GB |
| Secret Manager | 6 secrets | $0.06/شهر |
| **التكلفة المتوقعة** | **~$0/شهر** | **~$5-15/شهر** |

---

## 🛠️ أوامر مفيدة للإدارة

```bash
# عرض الخدمات
gcloud run services list --region=me-central1

# عرض الـ logs المباشرة للـ backend
gcloud run services logs read ahgaff-backend --region=me-central1 --limit=50

# عرض الـ logs المباشرة للـ frontend
gcloud run services logs read ahgaff-frontend --region=me-central1 --limit=50

# الرجوع لإصدار سابق (rollback)
gcloud run services list-revisions ahgaff-backend --region=me-central1
gcloud run services update-traffic ahgaff-backend --to-revisions=REVISION_NAME=100 --region=me-central1

# إيقاف خدمة مؤقتاً (للتوفير)
gcloud run services update ahgaff-backend --min-instances=0 --max-instances=0 --region=me-central1

# حذف خدمة كاملة (إذا قررت العودة لـ Railway فقط)
gcloud run services delete ahgaff-backend --region=me-central1
gcloud run services delete ahgaff-frontend --region=me-central1
```

---

## 🔒 ملاحظات أمنية مهمة

1. ✅ **MongoDB Atlas**: تأكد من إضافة IP `0.0.0.0/0` في Network Access (Cloud Run IPs ديناميكية) أو استخدم **VPC Connector**.
2. ✅ **JWT_SECRET نفسه على Railway و GCP** — مهم جداً وإلا الـ tokens لن تعمل بين النسختين.
3. ✅ **ALLOWED_ORIGINS** في الـ backend يجب أن يحوي كل الـ frontend domains:
   ```
   https://gcp.ahgaff.net,https://ahgaff.net,https://www.ahgaff.net
   ```
4. ⚠️ **لا ترفع** ملف `.env` أو Firebase service account لـ GitHub — استخدم Secret Manager.

---

## 📞 إذا واجهت مشكلة

شارك معي:
1. اسم الخطوة التي فشلت فيها
2. الرسالة الكاملة من Terminal (screenshot)
3. آخر 20 سطر من Cloud Build logs (`gcloud builds log BUILD_ID`)

وسأساعدك في الحل فوراً.

---

## 🎯 ملخص الـ Subdomain

| النسخة | Frontend URL | Backend URL |
|--------|--------------|-------------|
| Railway (حالي) | `https://ahgaff.net` | `https://api.ahgaff.net` |
| GCP (جديد) | `https://gcp.ahgaff.net` | `https://api-gcp.ahgaff.net` |

**كلاهما يعمل في نفس الوقت، نفس قاعدة البيانات، نفس بيانات الدخول.** ✨

## 📬 الملخص الأسبوعي للوحة القيادة (كل سبت 07:00 بتوقيت اليمن)
- يعمل تلقائياً من داخل الباكند إذا كانت الخدمة دائمة التشغيل (`--min-instances=1`).
- إذا كان Cloud Run يتوقف عند الخمول، أنشئ مهمة Cloud Scheduler (كل سبت 04:00 UTC = 07:00 اليمن):
  `POST https://<BACKEND_URL>/api/internal/weekly-digest` مع الهيدر `X-Internal-Key: <INTERNAL_PUSH_KEY>`
- الملفات تُحفظ في `uploads/digests/` — يُفضَّل ربط المجلد بقرص/تخزين دائم وإلا تُفقد الملفات القديمة عند إعادة النشر (يُعاد توليد ملخص الأسبوع الحالي بزر «إرسال الآن»).
