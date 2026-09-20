const crypto = require('crypto');

// MASTER_KEY لازم يكون 32 بايت (64 حرف hex). لو مش موجود منولده مرة وحدة ونطبعه بالسجل
// تحذير: لازم تحطه بمتغيرات البيئة بعد أول تشغيل وإلا الأسرار المشفرة ما رح تنفك تشفيرها بعد إعادة تشغيل
function getKey() {
  const raw = process.env.MASTER_KEY;
  if (!raw) {
    throw new Error('MASTER_KEY غير موجود بمتغيرات البيئة. أضفه قبل التشغيل (32 بايت / 64 حرف hex).');
  }
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) {
    throw new Error('MASTER_KEY يجب أن يكون 64 حرف hex (32 بايت). استخدم: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  return key;
}

function encrypt(text) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    value: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  };
}

function decrypt(row) {
  const key = getKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(row.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(row.auth_tag, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(row.value_encrypted, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

module.exports = { encrypt, decrypt };
