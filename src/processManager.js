const { spawn, spawnSync, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const db = require('./db');
const { decrypt } = require('./crypto');
const { autoInstallPythonDeps } = require('./depResolver');

// خريطة: botId -> { proc, emitter }
const running = new Map();

// ===== اكتشاف بايثون/pip المتاح على النظام =====
let _pythonBin = null;
let _pipBin = null;
let _installAttempted = false;

function tryInstallPython() {
  if (_installAttempted) return;
  _installAttempted = true;
  // محاولة تثبيت بايثون عبر apt-get (متاح على Railway/Debian)
  try {
    const check = spawnSync('which', ['apt-get'], { stdio: 'pipe', shell: true });
    if (check.status === 0) {
      console.log('🐍 عم بحاول ثبّت Python عبر apt-get...');
      execSync('apt-get update -qq && apt-get install -y -qq python3 python3-pip 2>&1', {
        stdio: 'pipe',
        timeout: 120000,
      });
      console.log('✅ Python تم تثبيته عبر apt-get.');
      _pythonBin = null;
      _pipBin = null;
    }
  } catch (err) {
    console.error('تعذّر تثبيت Python عبر apt-get:', err.message);
  }
}

function detectPython() {
  if (_pythonBin !== null) return _pythonBin;
  const candidates = ['python3', 'python'];
  for (const c of candidates) {
    try {
      const r = spawnSync(c, ['--version'], { stdio: 'pipe', shell: true });
      if (r.status === 0) {
        _pythonBin = c;
        return c;
      }
    } catch (_) {}
  }
  // محاولة تثبيت وإعادة المحاولة
  tryInstallPython();
  for (const c of candidates) {
    try {
      const r = spawnSync(c, ['--version'], { stdio: 'pipe', shell: true });
      if (r.status === 0) {
        _pythonBin = c;
        return c;
      }
    } catch (_) {}
  }
  _pythonBin = false;
  return false;
}

function detectPip() {
  if (_pipBin !== null) return _pipBin;
  const py = detectPython();
  if (!py) { _pipBin = false; return false; }
  const candidates = ['pip3', 'pip'];
  for (const c of candidates) {
    try {
      const r = spawnSync(c, ['--version'], { stdio: 'pipe', shell: true });
      if (r.status === 0) {
        _pipBin = c;
        return c;
      }
    } catch (_) {}
  }
  // جرّب python -m pip
  try {
    const r = spawnSync(py, ['-m', 'pip', '--version'], { stdio: 'pipe', shell: true });
    if (r.status === 0) {
      _pipBin = 'module';
      return _pipBin;
    }
  } catch (_) {}
  // حاول نثبّت pip
  try {
    spawnSync(py, ['-m', 'ensurepip', '--upgrade'], { stdio: 'pipe', shell: true, timeout: 60000 });
    const r2 = spawnSync(py, ['-m', 'pip', '--version'], { stdio: 'pipe', shell: true });
    if (r2.status === 0) {
      _pipBin = 'module';
      return _pipBin;
    }
  } catch (_) {}
  _pipBin = false;
  return false;
}

function botsDir(botId) {
  return path.join(__dirname, '..', 'bots-storage', String(botId));
}

async function buildEnv(botId) {
  const secrets = await db.getSecrets(botId);
  const env = { ...process.env };
  delete env.MASTER_KEY;
  delete env.TELEGRAM_BOT_TOKEN;
  delete env.RAILWAY_API_TOKEN;
  for (const s of secrets) {
    env[s.key] = decrypt(s);
  }

  // إصلاح تلقائي لروابط Supabase: بورت 6543 (pooler) بيعطي مشاكل مع psycopg2
  // منحوله لـ 5432 (direct) ومنضيف sslmode=require
  for (const key of Object.keys(env)) {
    if ((key === 'DATABASE_URL' || key.endsWith('_DATABASE_URL') || key === 'SUPABASE_DB_URL') && typeof env[key] === 'string') {
      env[key] = fixSupabaseUrl(env[key]);
    }
  }

  return env;
}

function fixSupabaseUrl(url) {
  try {
    if (!url.includes('supabase.com') && !url.includes('supabase.co')) return url;
    const u = new URL(url);
    // poolerSupabase بيستخدم بورت 6543، حوله لـ 5432 (direct connection)
    if (u.port === '6543') {
      u.port = '5432';
    }
    // أضف sslmode=require إذا مش موجود
    if (!u.searchParams.has('sslmode') && !u.searchParams.has('ssl')) {
      u.searchParams.set('sslmode', 'require');
    }
    return u.toString();
  } catch {
    return url;
  }
}

function detectEntry(dir) {
  const candidates = ['index.js', 'bot.js', 'main.js', 'app.js', 'main.py', 'bot.py'];
  for (const c of candidates) {
    if (fs.existsSync(path.join(dir, c))) return c;
  }
  const files = fs.readdirSync(dir);
  const js = files.find((f) => f.endsWith('.js'));
  if (js) return js;
  const py = files.find((f) => f.endsWith('.py'));
  if (py) return py;
  return null;
}

function needsInstall(dir) {
  return fs.existsSync(path.join(dir, 'package.json'));
}

function needsPipInstall(dir) {
  return fs.existsSync(path.join(dir, 'requirements.txt'));
}

async function startBot(bot, onLog, onExit) {
  if (running.has(bot.id)) {
    throw new Error('البوت شغال أصلاً');
  }

  const dir = botsDir(bot.id);
  if (!fs.existsSync(dir)) {
    throw new Error('ملف البوت غير مرفوع بعد');
  }

  const entry = bot.entry_file || detectEntry(dir);
  if (!entry) {
    throw new Error('ما قدرت ألاقي ملف تشغيل رئيسي (index.js / main.py ...)');
  }

  const env = await buildEnv(bot.id);
  const emitter = new EventEmitter();

  async function runStep(cmd, args, useShell) {
    return new Promise((resolve, reject) => {
      const p = spawn(cmd, args, { cwd: dir, env, shell: useShell === true });
      p.stdout.on('data', (d) => onLog(d.toString(), 'stdout'));
      p.stderr.on('data', (d) => onLog(d.toString(), 'stderr'));
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} فشل بكود ${code}`))));
      p.on('error', reject);
    });
  }

  const isPython = entry.endsWith('.py');
  let runtime;

  try {
    if (needsInstall(dir)) {
      onLog('📦 تثبيت مكتبات npm...\n', 'stdout');
      await runStep('npm', ['install', '--omit=dev'], true);
    }
    if (isPython) {
      // تأكد إن بايثون متاح قبل ما نحاول نثبت أي شي
      runtime = detectPython();
      if (!runtime) {
        const msg = 'Python غير مثبت على السيرفر رغم محاولات التثبيت التلقائي. تأكد من إعدادات Railway.';
        onLog('❌ ' + msg + '\n', 'stderr');
        onExit(1, msg);
        return;
      }

      const pip = detectPip();
      if (!pip) {
        const msg = 'pip غير متاح على السيرفر، تعذّر تثبيت متطلبات البوت.';
        onLog('❌ ' + msg + '\n', 'stderr');
        onExit(1, msg);
        return;
      }

      // 1) لو في requirements.txt ثبت منه
      if (needsPipInstall(dir)) {
        onLog('📦 تثبيت مكتبات pip من requirements.txt...\n', 'stdout');
        if (pip === 'module') {
          await runStep(runtime, ['-m', 'pip', 'install', '-r', 'requirements.txt', '--break-system-packages'], true);
        } else {
          await runStep(pip, ['install', '-r', 'requirements.txt', '--break-system-packages'], true);
        }
      }

      // 2) اكتشاف تلقائي: امسح ملفات .py واستخرج import statements
      //    وثبّت أي مكتبة خارجية مش موجودة (يغطي حالة الملف الواحد بدون requirements.txt)
      const pipMode = pip === 'module' ? 'module' : pip;
      const pyBin = runtime;
      const result = autoInstallPythonDeps(dir, pyBin, pipMode, onLog);
      if (!result.success) {
        const msg = result.error || 'فشل تثبيت بعض مكتبات بايثون تلقائياً';
        onLog('⚠️ ' + msg + '\n', 'stderr');
        // ما نوقف البوت — ممكن المكتبة تكون موجودة جاهزة أو الاستيراد اختياري
      }
    }
  } catch (err) {
    onLog('❌ ' + err.message + '\n', 'stderr');
    onExit(1, err.message);
    return;
  }

  if (!isPython) {
    runtime = 'node';
  }

  let child;
  try {
    child = spawn(runtime, [entry], { cwd: dir, env, shell: true });
  } catch (err) {
    const msg = `فشل spawn(${runtime}): ${err.message}`;
    onLog('❌ ' + msg + '\n', 'stderr');
    onExit(1, msg);
    return;
  }

  if (!child || !child.pid) {
    child.on('error', (err) => {
      const msg = `فشل تشغيل ${runtime}: ${err.message}`;
      onLog('❌ ' + msg + '\n', 'stderr');
      onExit(1, msg);
    });
    return;
  }

  running.set(bot.id, { proc: child, emitter });

  child.stdout.on('data', (d) => onLog(d.toString(), 'stdout'));
  child.stderr.on('data', (d) => onLog(d.toString(), 'stderr'));

  child.on('exit', (code, signal) => {
    running.delete(bot.id);
    onExit(code, signal ? `أوقف بإشارة ${signal}` : null);
  });

  child.on('error', (err) => {
    running.delete(bot.id);
    const msg = `خطأ بعملية ${runtime}: ${err.message}`;
    onLog('❌ ' + msg + '\n', 'stderr');
    onExit(1, msg);
  });

  return child;
}

function stopBot(botId) {
  const entry = running.get(botId);
  if (!entry) return false;
  entry.proc.kill('SIGTERM');
  setTimeout(() => {
    if (running.has(botId)) {
      running.get(botId).proc.kill('SIGKILL');
    }
  }, 5000);
  return true;
}

function isRunning(botId) {
  return running.has(botId);
}

function getRunningIds() {
  return [...running.keys()];
}

module.exports = { startBot, stopBot, isRunning, getRunningIds, botsDir, detectEntry };
