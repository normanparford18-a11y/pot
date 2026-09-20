require('dotenv').config();
const db = require('./src/db');
const pm = require('./src/processManager');
const { bot, runBot } = require('./src/telegramBot');

async function main() {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN مفقود بمتغيرات البيئة.');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL مفقود بمتغيرات البيئة.');
    process.exit(1);
  }
  if (!process.env.MASTER_KEY) {
    console.error('❌ MASTER_KEY مفقود. ولده مرة وحدة بالأمر:');
    console.error('   node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    console.error('   وحطو بمتغيرات البيئة على Railway باسم MASTER_KEY ولا تغيره بعدين.');
    process.exit(1);
  }

  await db.init();
  console.log('✅ قاعدة البيانات جاهزة.');

  await bot.launch();
  console.log('✅ البوت شغال.');

  // إعادة تشغيل أي بوت كان شغال قبل آخر إعادة نشر/تشغيل للمنصة
  const toRestart = await db.getBotsToAutoRestart();
  for (const b of toRestart) {
    console.log(`🔄 إعادة تشغيل تلقائي: ${b.name}`);
    try {
      await pm.startBot(
        b,
        (chunk, stream) => db.appendLog(b.id, chunk, stream).catch(() => {}),
        async (code, errMsg) => {
          if (code === 0 || code === null) {
            await db.updateBot(b.id, { status: 'stopped', last_exit_code: code }).catch(() => {});
          } else {
            await db.updateBot(b.id, { status: 'error', last_exit_code: code, last_error: errMsg }).catch(() => {});
          }
        }
      );
    } catch (err) {
      await db.updateBot(b.id, { status: 'error', last_error: err.message });
      console.error(`فشلت إعادة تشغيل ${b.name}:`, err.message);
    }
  }

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch((err) => {
  console.error('فشل تشغيل المنصة:', err);
  process.exit(1);
});
