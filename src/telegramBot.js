const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { encrypt } = require('./crypto');
const { saveUploadedFile, parseEnvFile } = require('./fileHandler');
const pm = require('./processManager');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// ===== حماية: بس صاحب البوت يقدر يستخدمه =====
const OWNER_ID = process.env.OWNER_TELEGRAM_ID ? Number(process.env.OWNER_TELEGRAM_ID) : null;
bot.use((ctx, next) => {
  if (!OWNER_ID) {
    // ما في حماية معرّفة - تحذير بالسجل فقط، بس منكمل (المستخدم مسؤول عن ضبط هاد المتغير)
    return next();
  }
  const fromId = ctx.from && ctx.from.id;
  if (fromId !== OWNER_ID) {
    return ctx.reply('🚫 هاد البوت خاص، غير مصرح لك تستخدمه.');
  }
  return next();
});

// ===== جلسة بسيطة بالذاكرة لكل مستخدم =====
const sessions = new Map();
function getSession(chatId) {
  if (!sessions.has(chatId)) sessions.set(chatId, { state: 'idle', data: {} });
  return sessions.get(chatId);
}
function resetSession(chatId) {
  sessions.set(chatId, { state: 'idle', data: {} });
}

// ===== مراقبين مباشرين للسجلات: botId -> Set(chatId) =====
const watchers = new Map();
function addWatcher(botId, chatId) {
  if (!watchers.has(botId)) watchers.set(botId, new Set());
  watchers.get(botId).add(chatId);
}
function removeWatcher(botId, chatId) {
  if (watchers.has(botId)) watchers.get(botId).delete(chatId);
}

// ===== بافر السجلات المباشرة (لكل بوت) لتقليل عدد الرسائل =====
const logBuffers = new Map(); // botId -> string[]
const flushTimers = new Map();

function pushLog(botId, chunk) {
  if (!logBuffers.has(botId)) logBuffers.set(botId, []);
  logBuffers.get(botId).push(chunk);
  scheduleFlush(botId);
}

function scheduleFlush(botId) {
  if (flushTimers.has(botId)) return;
  const t = setTimeout(() => flushLogs(botId), 2000);
  flushTimers.set(botId, t);
}

async function flushLogs(botId) {
  flushTimers.delete(botId);
  const buf = logBuffers.get(botId);
  if (!buf || buf.length === 0) return;
  const text = buf.join('').slice(-3500); // حد تيليجرام تقريباً
  logBuffers.set(botId, []);
  const subs = watchers.get(botId);
  if (!subs || subs.size === 0) return;
  const safe = escapeHtml(text || '(فاضي)');
  for (const chatId of subs) {
    try {
      await bot.telegram.sendMessage(chatId, `📜 <pre>${safe}</pre>`, { parse_mode: 'HTML' });
    } catch (e) {
      // تجاهل أخطاء إرسال (مثلاً block أو رسالة غير صالحة)
    }
  }
}

// ===== أدوات مساعدة =====
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatDate(d) {
  if (!d) return '-';
  const dt = new Date(d);
  return dt.toISOString().slice(0, 16).replace('T', ' ');
}

async function getOwnedBot(ctx, botId) {
  const b = await db.getBot(botId);
  if (!b || Number(b.owner_id) !== Number(ctx.from.id)) return null;
  return b;
}

// ===== قوائم =====
function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🤖 بوتاتي', 'menu:mybots')],
    [Markup.button.callback('➕ إنشاء بوت جديد', 'menu:newbot')],
  ]);
}

function statusEmoji(b) {
  if (pm.isRunning(b.id)) return '🟢';
  if (b.status === 'error') return '⚠️';
  if (b.status === 'draft') return '📝';
  if (b.status === 'stopped') return '🔴';
  return '⚪';
}

function statusLabel(b) {
  if (pm.isRunning(b.id)) return 'شغال الآن';
  return {
    draft: 'مسودة (لسا ما اكتمل إعداده)',
    stopped: 'متوقف',
    running: 'شغال (بينتظر تأكيد الحالة)',
    error: 'فيه خطأ',
  }[b.status] || b.status;
}

async function showMainMenu(ctx) {
  await ctx.reply('أهلاً 👋 شو بدك تعمل؟', mainMenu());
}

async function showMyBots(ctx) {
  const list = await db.listBots(ctx.from.id);
  if (list.length === 0) {
    return ctx.reply('ما عندك بوتات لسا. اضغط "➕ إنشاء بوت جديد" لتبلش.', mainMenu());
  }
  const buttons = list.map((b) => [
    Markup.button.callback(`${statusEmoji(b)} ${b.name}`, `bot:view:${b.id}`),
  ]);
  buttons.push([Markup.button.callback('➕ إنشاء بوت جديد', 'menu:newbot')]);
  buttons.push([Markup.button.callback('⬅️ رجوع', 'back:main')]);
  await ctx.reply('📋 بوتاتك:', Markup.inlineKeyboard(buttons));
}

// ===== شاشة تفاصيل بوت واحدة (تُستخدم أثناء الإعداد وبعده) =====
async function showBotDetails(ctx, botId) {
  const b = await getOwnedBot(ctx, botId);
  if (!b) return ctx.reply('❌ البوت مو موجود.');

  const secrets = await db.getSecrets(b.id);
  const hasFile = Boolean(b.folder_path && b.entry_file);
  const running = pm.isRunning(b.id);
  const rows = [];

  if (!hasFile) {
    // لسا بمرحلة الإعداد
    rows.push([Markup.button.callback('📁 رفع ملفات البوت', `bot:upload:${b.id}`)]);
    rows.push([Markup.button.callback(`🔐 رفع المتغيرات (${secrets.length})`, `bot:secrets:${b.id}`)]);
    rows.push([Markup.button.callback('✅ تأكيد وتشغيل البوت', `bot:confirm:${b.id}`)]);
  } else {
    rows.push([Markup.button.callback(running ? '⏹ إيقاف البوت' : '▶️ تشغيل البوت', running ? `bot:stop:${b.id}` : `bot:run:${b.id}`)]);
    rows.push([Markup.button.callback('👁 عرض السجلات', `bot:logs:${b.id}`)]);
    rows.push([Markup.button.callback('📁 تعديل الملفات', `bot:upload:${b.id}`)]);
    rows.push([Markup.button.callback(`🔐 تعديل المتغيرات (${secrets.length})`, `bot:secrets:${b.id}`)]);
  }
  rows.push([Markup.button.callback('🗑 حذف البوت', `bot:delete:${b.id}`)]);
  rows.push([Markup.button.callback('⬅️ رجوع', 'menu:mybots')]);

  let msg = `🤖 <b>${escapeHtml(b.name)}</b>\n`;
  msg += `الحالة: ${statusEmoji(b)} ${escapeHtml(statusLabel(b))}\n`;
  msg += `تاريخ الإنشاء: ${formatDate(b.created_at)}\n`;
  msg += `نوع التشغيل: ${b.runtime === 'python' ? 'Python 🐍' : 'Node.js 🟩'}\n`;
  msg += `الملف الرئيسي: ${hasFile ? '<code>' + escapeHtml(b.entry_file) + '</code>' : 'ما تم رفعه بعد ❌'}\n`;
  msg += `عدد المتغيرات المضافة: ${secrets.length}${secrets.length ? ' (' + escapeHtml(secrets.map((s) => s.key).join(', ')) + ')' : ''}\n`;

  if (b.status === 'error' && b.last_error) {
    msg += `\n⚠️ آخر خطأ:\n<pre>${escapeHtml(b.last_error.slice(0, 500))}</pre>`;
  }
  if (!hasFile) {
    msg += `\n📌 اضغط "رفع ملفات البوت" و"رفع المتغيرات" (اختياري)، وبعدين "تأكيد وتشغيل البوت".`;
  }

  await ctx.reply(msg, { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
}

// ===== إعداد أوامر البوت =====
bot.start(async (ctx) => {
  resetSession(ctx.chat.id);
  await showMainMenu(ctx);
});

bot.command('cancel', async (ctx) => {
  resetSession(ctx.chat.id);
  await ctx.reply('✅ تم إلغاء العملية الحالية.');
  await showMainMenu(ctx);
});

bot.action('back:main', async (ctx) => {
  await ctx.answerCbQuery();
  resetSession(ctx.chat.id);
  await showMainMenu(ctx);
});

bot.action('menu:mybots', async (ctx) => {
  await ctx.answerCbQuery();
  resetSession(ctx.chat.id);
  await showMyBots(ctx);
});

bot.action('menu:newbot', async (ctx) => {
  await ctx.answerCbQuery();
  const s = getSession(ctx.chat.id);
  s.state = 'awaiting_bot_name';
  s.data = {};
  await ctx.reply('📝 طيب، شو بدك تسمي البوت؟ (اكتب /cancel بأي وقت للإلغاء)');
});

bot.action(/bot:view:(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  resetSession(ctx.chat.id);
  await showBotDetails(ctx, Number(ctx.match[1]));
});

bot.action(/bot:upload:(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const botId = Number(ctx.match[1]);
  const b = await getOwnedBot(ctx, botId);
  if (!b) return ctx.reply('❌ البوت مو موجود.');
  const s = getSession(ctx.chat.id);
  s.state = 'awaiting_file';
  s.data.botId = botId;
  await ctx.reply('📤 ابعتلي ملف البوت (ملف .zip يحتوي الكود كامل، أو ملف .js/.py واحد).\n\n/cancel للإلغاء.');
});

bot.action(/bot:secrets:(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const botId = Number(ctx.match[1]);
  const b = await getOwnedBot(ctx, botId);
  if (!b) return ctx.reply('❌ البوت مو موجود.');
  const s = getSession(ctx.chat.id);
  s.state = 'secrets_menu';
  s.data.botId = botId;
  await ctx.reply(
    'كيف بدك تضيف المتغيرات؟\n1️⃣ ابعتلي ملف <code>.env</code> مباشرة\n2️⃣ اكتب متغير بصيغة <code>KEY=VALUE</code> وابعتلو، وكرر لكل متغير\n\nلما تخلص اكتب "تم" (أو /cancel للإلغاء)',
    { parse_mode: 'HTML' }
  );
});

bot.action(/bot:confirm:(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const botId = Number(ctx.match[1]);
  const b = await getOwnedBot(ctx, botId);
  if (!b) return ctx.reply('❌ البوت مو موجود.');
  if (!b.folder_path || !b.entry_file) {
    await ctx.reply('⚠️ لازم ترفع ملفات البوت الأول قبل التأكيد والتشغيل.');
    return showBotDetails(ctx, botId);
  }
  if (pm.isRunning(botId)) {
    await ctx.reply('✅ البوت شغال أصلاً.');
    return showBotDetails(ctx, botId);
  }
  await runBot(ctx, botId);
});

bot.action(/bot:run:(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const botId = Number(ctx.match[1]);
  const b = await getOwnedBot(ctx, botId);
  if (!b) return ctx.reply('❌ البوت مو موجود.');
  await runBot(ctx, botId);
});

bot.action(/bot:stop:(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const botId = Number(ctx.match[1]);
  const b = await getOwnedBot(ctx, botId);
  if (!b) return ctx.reply('❌ البوت مو موجود.');
  const ok = pm.stopBot(botId);
  await db.updateBot(botId, { status: 'stopped' });
  await ctx.reply(ok ? '⏹ تم إيقاف البوت.' : 'البوت مو شغال أصلاً.');
  await showBotDetails(ctx, botId);
});

bot.action(/bot:logs:(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const botId = Number(ctx.match[1]);
  const b = await getOwnedBot(ctx, botId);
  if (!b) return ctx.reply('❌ البوت مو موجود.');
  addWatcher(botId, ctx.chat.id);
  const recent = await db.getRecentLogs(botId, 200);
  const text = recent.length ? recent.map((r) => r.line).join('') : '(ما في سجلات بعد)';
  await ctx.reply(`👁 عم راقب سجلات "<b>${escapeHtml(b.name)}</b>" مباشرة. آخر سجلات (${recent.length} سطر):\n\n<pre>${escapeHtml(text.slice(-3500))}</pre>`, { parse_mode: 'HTML' });
  const logButtons = [
    [Markup.button.callback('📜 كل السجلات', `bot:alllogs:${botId}`)],
    [Markup.button.callback('🔕 وقف المراقبة', `bot:logstop:${botId}`)],
    [Markup.button.callback('⬅️ رجوع للبوت', `bot:view:${botId}`)],
  ];
  await ctx.reply('تحكم بالمراقبة:', Markup.inlineKeyboard(logButtons));
});

bot.action(/bot:alllogs:(\d+)/, async (ctx) => {
  await ctx.answerCbQuery('عم بجهّز كل السجلات...');
  const botId = Number(ctx.match[1]);
  const b = await getOwnedBot(ctx, botId);
  if (!b) return ctx.reply('❌ البوت مو موجود.');
  const allLogs = await db.getRecentLogs(botId, 10000);
  const fullText = allLogs.length ? allLogs.map((r) => r.line).join('') : '(ما في سجلات بعد)';
  const chunks = [];
  let remaining = fullText;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, 3500));
    remaining = remaining.slice(3500);
  }
  if (chunks.length === 0) chunks.push('(ما في سجلات بعد)');
  await ctx.reply(`📜 كل سجلات "<b>${escapeHtml(b.name)}</b>" (${allLogs.length} سطر، ${chunks.length} رسالة):`, { parse_mode: 'HTML' });
  for (let i = 0; i < Math.min(chunks.length, 10); i++) {
    try {
      await ctx.reply(`📝 الجزء ${i + 1}/${Math.min(chunks.length, 10)}:\n<pre>${escapeHtml(chunks[i])}</pre>`, { parse_mode: 'HTML' });
    } catch (e) {
      break;
    }
  }
  if (chunks.length > 10) {
    await ctx.reply(`⚠️ السجلات طويلة جداً (${chunks.length} جزء). عرضت أول 10 أجزاء فقط.`);
  }
});

bot.action(/bot:logstop:(\d+)/, async (ctx) => {
  await ctx.answerCbQuery('تم إيقاف المراقبة');
  removeWatcher(Number(ctx.match[1]), ctx.chat.id);
});

bot.action(/bot:delete:(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const botId = Number(ctx.match[1]);
  const b = await getOwnedBot(ctx, botId);
  if (!b) return ctx.reply('❌ البوت مو موجود.');
  await ctx.reply(`متأكد بدك تحذف "${escapeHtml(b.name)}"؟ هاد الإجراء ما بيترجع فيه.`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('✅ نعم احذف', `bot:delconfirm:${botId}`)],
      [Markup.button.callback('❌ إلغاء', `bot:view:${botId}`)],
    ]),
  });
});

bot.action(/bot:delconfirm:(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const botId = Number(ctx.match[1]);
  const b = await getOwnedBot(ctx, botId);
  if (!b) return ctx.reply('❌ البوت مو موجود.');
  pm.stopBot(botId);
  const dir = pm.botsDir(botId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  await db.deleteBot(botId);
  await ctx.reply('🗑 تم حذف البوت.');
  await showMyBots(ctx);
});

// ===== معالجة الرسائل النصية والملفات حسب حالة الجلسة =====
bot.on('text', async (ctx) => {
  const s = getSession(ctx.chat.id);
  const text = ctx.message.text.trim();

  if (text === '/cancel' || text === 'إلغاء') {
    resetSession(ctx.chat.id);
    await ctx.reply('✅ تم الإلغاء.');
    return showMainMenu(ctx);
  }

  if (s.state === 'awaiting_bot_name') {
    if (!text || text.length > 60) {
      return ctx.reply('اسم غير صالح، جرب اسم أقصر (حتى 60 حرف).');
    }
    const existing = await db.getBotByName(ctx.from.id, text);
    if (existing) {
      const isEmptyDraft = existing.status === 'draft' && !existing.folder_path && !existing.entry_file;
      if (isEmptyDraft) {
        // مسودة فاضية بنفس الاسم من محاولة سابقة - منكمل عليها بدل ما نمنع المستخدم
        s.state = 'idle';
        s.data = {};
        await ctx.reply(`🔁 عندك مسودة بنفس الاسم "${escapeHtml(text)}" لسا ما خلّصتها، رح نكمل عليها.`, { parse_mode: 'HTML' });
        return showBotDetails(ctx, existing.id);
      }
      await ctx.reply(`⚠️ في بوت باسم "${escapeHtml(text)}" أصلاً. اكتب اسم تاني، أو /cancel للإلغاء.`, { parse_mode: 'HTML' });
      return; // بيضل بحالة awaiting_bot_name لإعادة المحاولة
    }
    const b = await db.createBot(ctx.from.id, text);
    s.state = 'idle';
    s.data = {};
    await ctx.reply(`✅ تم إنشاء البوت "${escapeHtml(text)}". هلق رفعلو الملفات والمتغيرات:`, { parse_mode: 'HTML' });
    await showBotDetails(ctx, b.id);
    return;
  }

  if (s.state === 'secrets_menu') {
    if (text === 'تم' || text === 'تم.') {
      s.state = 'idle';
      const botId = s.data.botId;
      s.data = {};
      await ctx.reply('✅ تم حفظ المتغيرات.');
      await showBotDetails(ctx, botId);
      return;
    }
    const idx = text.indexOf('=');
    if (idx === -1) {
      return ctx.reply('الصيغة لازم تكون KEY=VALUE، أو اكتب "تم" للانتهاء.');
    }
    const key = text.slice(0, idx).trim();
    const value = text.slice(idx + 1).trim();
    if (!key) return ctx.reply('اسم المتغير فاضي، جرب كمان مرة.');
    const enc = encrypt(value);
    await db.setSecret(s.data.botId, key, enc);
    await ctx.reply(`✅ تمت إضافة المتغير "${escapeHtml(key)}". ضيف متغير تاني أو اكتب "تم".`, { parse_mode: 'HTML' });
    return;
  }

  // نص ما منتظرينه بأي حالة محددة
  if (s.state === 'idle') {
    await showMainMenu(ctx);
  }
});

bot.on('document', async (ctx) => {
  const s = getSession(ctx.chat.id);
  const doc = ctx.message.document;

  if (s.state === 'awaiting_file') {
    try {
      const link = await ctx.telegram.getFileLink(doc.file_id);
      const res = await fetch(link.href);
      const buffer = Buffer.from(await res.arrayBuffer());
      saveUploadedFile(s.data.botId, doc.file_name, buffer);
      const dir = pm.botsDir(s.data.botId);
      const entry = pm.detectEntry(dir);
      await db.updateBot(s.data.botId, {
        folder_path: dir,
        entry_file: entry,
        status: 'stopped',
        runtime: entry && entry.endsWith('.py') ? 'python' : 'node',
      });
      const botId = s.data.botId;
      s.state = 'idle';
      s.data = {};
      await ctx.reply(entry ? `✅ تم رفع الملف. الملف الرئيسي: <code>${escapeHtml(entry)}</code>\n🚀 عم أشغل البوت تلقائياً...` : '⚠️ تم الرفع بس ما لقيت ملف تشغيل رئيسي واضح، تأكد من اسم الملف.', { parse_mode: 'HTML' });
      if (entry) {
        await runBot(ctx, botId);
      } else {
        await showBotDetails(ctx, botId);
      }
    } catch (err) {
      await ctx.reply('❌ صار خطأ برفع الملف: ' + escapeHtml(err.message));
    }
    return;
  }

  if (s.state === 'secrets_menu' && doc.file_name.endsWith('.env')) {
    try {
      const link = await ctx.telegram.getFileLink(doc.file_id);
      const res = await fetch(link.href);
      const content = await res.text();
      const pairs = parseEnvFile(content);
      for (const { key, value } of pairs) {
        const enc = encrypt(value);
        await db.setSecret(s.data.botId, key, enc);
      }
      await ctx.reply(`✅ تمت إضافة ${pairs.length} متغير من ملف .env. ضيف كمان أو اكتب "تم".`);
    } catch (err) {
      await ctx.reply('❌ صار خطأ بقراءة الملف: ' + escapeHtml(err.message));
    }
    return;
  }

  await ctx.reply('ما كنت منتظر ملف هلق. اضغط "🤖 بوتاتي" أو ابدأ من /start.');
});

// ===== تشغيل بوت فعلياً مع بث السجل المباشر =====
async function runBot(ctx, botId) {
  const b = await db.getBot(botId);
  if (!b) return ctx.reply('البوت مو موجود.');
  if (pm.isRunning(botId)) return ctx.reply('البوت شغال أصلاً.');

  addWatcher(botId, ctx.chat.id);
  await ctx.reply('🚀 عم أشغل البوت...');

  const onLog = (chunk, stream) => {
    pushLog(botId, chunk);
    db.appendLog(botId, chunk, stream).catch(() => {});
  };

  const onExit = async (code, errMsg) => {
    try {
      await flushLogs(botId);
    } catch (_) {}
    if (code === 0 || code === null) {
      await db.updateBot(botId, { status: 'stopped', last_exit_code: code, last_error: null }).catch(() => {});
      for (const chatId of watchers.get(botId) || []) {
        bot.telegram.sendMessage(chatId, `⏹ البوت "${b.name}" توقف (كود الخروج: ${code}).`).catch(() => {});
      }
    } else {
      await db.updateBot(botId, { status: 'error', last_exit_code: code, last_error: errMsg || 'غير معروف' }).catch(() => {});
      for (const chatId of watchers.get(botId) || []) {
        bot.telegram.sendMessage(chatId, `❌ البوت "${b.name}" فشل (كود: ${code}).\nالسبب: ${errMsg || 'غير معروف'}`).catch(() => {});
      }
    }
  };

  try {
    await pm.startBot(b, onLog, onExit);
    await db.updateBot(botId, { status: 'running' });
    await ctx.reply(`✅ تم تشغيل "${b.name}" بنجاح. عم تشوف السجل المباشر هون تلقائياً.`);
    await showBotDetails(ctx, botId);
  } catch (err) {
    await db.updateBot(botId, { status: 'error', last_error: err.message });
    await ctx.reply(`❌ فشل التشغيل: ${err.message}`);
    await showBotDetails(ctx, botId);
  }
}

// ===== معالج أخطاء عام: أي خطأ غير متوقع ما بيوقف البوت =====
bot.catch((err, ctx) => {
  console.error('خطأ غير متوقع بمعالجة تحديث:', err);
  try {
    ctx.reply('❌ صار خطأ غير متوقع، جرب كمان مرة أو اكتب /start.').catch(() => {});
  } catch (_) {
    // تجاهل
  }
});

module.exports = { bot, runBot };
