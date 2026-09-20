# منصة استضافة البوتات (Bot Hosting Platform)

بوت تيليجرام شخصي لاستضافة وإدارة بوتاتك الخاصة، كل بوت يشتغل كـ **process معزول** على نفس سيرفر Railway، مع أسرار مشفرة وسجل تشغيل مباشر بالمحادثة.

## 1. تجهيز البوت الرئيسي (BotFather)

1. افتح محادثة مع [@BotFather](https://t.me/BotFather) بتيليجرام
2. أرسل `/newbot` واتبع التعليمات، خدلك **التوكن** (TELEGRAM_BOT_TOKEN)
3. احصل على **الآيدي تبعك** من [@userinfobot](https://t.me/userinfobot) (رقم، هاد OWNER_TELEGRAM_ID)

## 2. رفع الكود على GitHub

```bash
cd bot-platform
git init
git add .
git commit -m "منصة استضافة البوتات - أول نسخة"
git branch -M main
git remote add origin https://github.com/USERNAME/REPO_NAME.git
git push -u origin main
```

## 3. النشر على Railway

1. سجل دخول على [railway.app](https://railway.app)
2. **New Project → Deploy from GitHub repo** واختر الريبو يلي رفعته
3. بنفس المشروع اضغط **+ New → Database → Add PostgreSQL** (هاد رح يعطيك `DATABASE_URL` تلقائياً)
4. روح على Service تبع البوت (مو تبع Postgres) → تبويب **Variables** وأضف:

| المتغير | القيمة |
|---|---|
| `TELEGRAM_BOT_TOKEN` | التوكن من BotFather |
| `OWNER_TELEGRAM_ID` | آيدي حسابك (رقم) |
| `DATABASE_URL` | اضغط **Add Reference** واختار `Postgres.DATABASE_URL` (مش تكتبه يدوي) |
| `MASTER_KEY` | ولّد قيمة عشوائية بجهازك: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` وحطها هون. **لا تغيرها بعدين أبداً** وإلا رح تفقد كل الأسرار المخزنة سابقاً |

5. Railway رح يعمل build و deploy تلقائياً بعد ما تضيف المتغيرات (لأنه في `package.json` مع `start` script)
6. افتح تيليجرام وابعت `/start` لبوتك — إذا اشتغل صح رح يرد عليك بالقائمة الرئيسية

## 4. كيف تستخدمه

- **➕ إنشاء بوت جديد**: تحط اسم، بعدين ترفع ملف الكود (zip أو ملف واحد .js/.py)، بعدين تضيف الأسرار (.env أو سر سر)، وبعدها زر **▶️ تشغيل**
- بعد التشغيل رح تشوف سجل التشغيل المباشر بالمحادثة أول بأول، ونجاح أو فشل واضح
- من **🤖 بوتاتي** تقدر تراقب، توقف، تعيد تشغيل، تعدل أسرار، أو ترفع كود جديد لأي بوت

## ملاحظات مهمة

- **العزل**: كل بوت يشتغل بـ `child_process` مستقل (Node أو Python)، إذا وقع بوت واحد ما بأثر عالباقي ولا عالمنصة نفسها
- **قاعدة بيانات خاصة لبوت معين**: لو بوت معين محتاج قاعدة بيانات خاصة فيه، أنشئها من Railway (+ New → Database)، وضيف رابطها كسر عادي (`DATABASE_URL` أو أي اسم) من شاشة "🔐 الأسرار" الخاصة بهاد البوت بالذات — منفصلة تماماً عن قاعدة بيانات المنصة الأساسية
- **الأمان**: البوت مقفول بس على `OWNER_TELEGRAM_ID` — لا تشارك التوكن أو تشيل هاد المتغير
- **الموارد**: Railway (الخطة المجانية/Hobby) عندها حد أقصى لـ RAM/CPU للـ Service الواحدة. إذا عندك عدد كبير من البوتات الثقيلة وحسيت إنه السيرفر عم يبطئ، هاد قيد فيزيائي من Railway نفسها (المطلوب تترقى للخطة الأعلى أو توزع يدوياً على Service إضافية بنفس الطريقة) — المنصة الحالية ما بتعمل auto-scaling تلقائي لسيرفر ثاني، هاد جزء ممكن نضيفه لاحقاً لو صار عندك حاجة فعلية إله
- **الدعم**: Node.js و Python فقط حالياً (بيكتشف تلقائياً حسب الملف: `.js` أو `.py`)، وبيثبت `npm install` أو `pip install -r requirements.txt` تلقائياً قبل التشغيل لو لقى `package.json` أو `requirements.txt`
