const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { botsDir } = require('./processManager');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * يحفظ الملف المرفوع (buffer) بمجلد البوت، ولو كان zip بيفكه.
 * بيرجع اسم الملف الرئيسي المتوقع (أو null إذا zip، بيتحدد لاحقاً تلقائياً).
 */
function saveUploadedFile(botId, fileName, buffer) {
  const dir = botsDir(botId);
  ensureDir(dir);

  if (fileName.toLowerCase().endsWith('.zip')) {
    const tmpZip = path.join(dir, '__upload.zip');
    fs.writeFileSync(tmpZip, buffer);
    const zip = new AdmZip(tmpZip);
    zip.extractAllTo(dir, true);
    fs.unlinkSync(tmpZip);
    return null; // منخليه يتحدد تلقائياً (detectEntry)
  }

  fs.writeFileSync(path.join(dir, fileName), buffer);
  return fileName;
}

/**
 * يبارس ملف .env نصي -> [{key, value}]
 */
function parseEnvFile(content) {
  const lines = content.split('\n');
  const result = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    // إزالة علامات اقتباس محيطة إذا موجودة
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) result.push({ key, value });
  }
  return result;
}

module.exports = { saveUploadedFile, parseEnvFile, ensureDir };
