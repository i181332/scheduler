/**
 * Smart Schedule Manager - Utilities
 */

const Logger = {
  log: function(level, message, data) {
    const levels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
    if (levels[level] >= levels[CONFIG.LOG_LEVEL]) {
      console.log('[' + new Date().toISOString() + '] [' + level + '] ' + message);
      if (data) console.log(JSON.stringify(data, null, 2));
    }
  },
  debug: function(msg, data) { this.log('DEBUG', msg, data); },
  info: function(msg, data) { this.log('INFO', msg, data); },
  warn: function(msg, data) { this.log('WARN', msg, data); },
  error: function(msg, data) { this.log('ERROR', msg, data); }
};

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

function parseDate(dateString) {
  try {
    return new Date(dateString);
  } catch (e) {
    return null;
  }
}

function detectCategory(text) {
  for (const category in CONFIG.CATEGORIES) {
    const keywords = CONFIG.CATEGORIES[category];
    for (let i = 0; i < keywords.length; i++) {
      if (text.includes(keywords[i])) return category;
    }
  }
  return '就活';
}

function detectPriority(text) {
  for (const priority in CONFIG.PRIORITY_KEYWORDS) {
    const keywords = CONFIG.PRIORITY_KEYWORDS[priority];
    for (let i = 0; i < keywords.length; i++) {
      if (text.includes(keywords[i])) return priority;
    }
  }
  return '中';
}

function calculateSimilarity(str1, str2) {
  const normalize = function(s) {
    return s.toLowerCase().replace(/\s+/g, '');
  };
  const a = normalize(str1);
  const b = normalize(str2);
  if (a === b) return 1.0;
  if (a.includes(b) || b.includes(a)) return 0.8;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  let matches = 0;
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] === b[i]) matches++;
  }
  return matches / maxLen;
}

/**
 * メール本文から重要情報を抽出（全文解析版）
 * @param {string} body - メール本文
 * @returns {string} - クリーニングされた本文（制限なし）
 */
function extractImportantInfo(body) {
  // HTMLタグを削除
  let plainText = body.replace(/<[^>]*>/g, ' ');

  // 過度な空白を整理
  plainText = plainText.replace(/\s+/g, ' ').trim();

  // 以前は1000文字制限があったが撤廃
  // Gemini 2.5 Flashは大量のトークンを処理可能

  // ただし、極端に長いメール(50KB以上)は要約
  const MAX_LENGTH = 50000;
  if (plainText.length > MAX_LENGTH) {
    Logger.warn('Utils: 本文が長すぎるため切り詰めます (' + plainText.length + ' → ' + MAX_LENGTH + ' 文字)');

    // 重要な部分を優先的に保持
    const firstPart = plainText.substring(0, MAX_LENGTH * 0.7); // 最初の70%
    const lastPart = plainText.substring(plainText.length - MAX_LENGTH * 0.3); // 最後の30%

    return firstPart + '\n\n[...中略...]\n\n' + lastPart;
  }

  return plainText;
}

/**
 * メール本文から構造化情報を抽出
 * @param {string} body - メール本文
 * @returns {Object} - 抽出された情報
 */
function extractStructuredInfo(body) {
  const info = {
    urls: [],
    dates: [],
    companyNames: [],
    hasDeadline: false,
    hasAction: false
  };

  // URL抽出
  const urlRegex = /https?:\/\/[^\s<>"]+/g;
  const urls = body.match(urlRegex);
  if (urls) {
    info.urls = urls.slice(0, 10); // 最大10個まで
  }

  // 日付抽出
  const datePatterns = [
    /\d{4}年\d{1,2}月\d{1,2}日/g,
    /\d{1,2}月\d{1,2}日/g,
    /\d{1,2}\/\d{1,2}/g
  ];

  for (let i = 0; i < datePatterns.length; i++) {
    const matches = body.match(datePatterns[i]);
    if (matches) {
      info.dates = info.dates.concat(matches);
    }
  }

  // 企業名抽出
  const companyRegex = /(株式会社|有限会社|合同会社|Corporation|Inc\.|Ltd\.)\s*[\w\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+/g;
  const companies = body.match(companyRegex);
  if (companies) {
    info.companyNames = Array.from(new Set(companies)).slice(0, 5);
  }

  // 締切・期限キーワード
  info.hasDeadline = /締切|〆切|期限|まで|deadline|due/i.test(body);

  // アクション要求キーワード
  info.hasAction = /応募|エントリー|登録|申込|回答|返信|submit|apply|register/i.test(body);

  return info;
}
