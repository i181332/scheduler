/**
 * Smart Schedule Manager - Configuration
 */

const CONFIG = {
  // API Keys (from Script Properties)
  GEMINI_API_KEY: PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY'),
  NOTION_TOKEN: PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN'),
  NOTION_DATABASE_ID: PropertiesService.getScriptProperties().getProperty('NOTION_DATABASE_ID'),

  // Gmail Settings
  GMAIL: {
    QUERY: 'newer_than:1d -label:プロモーション',
    MAX_MESSAGES: 50,
    MARK_AS_READ: true
  },

  // Gemini AI Settings
  GEMINI: {
    MODEL: 'gemini-2.5-flash',
    API_URL: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    TEMPERATURE: 0.1,
    MAX_TOKENS: 2000,
    PARALLEL_BATCH_SIZE: 5
  },

  // Notion Settings
  NOTION: {
    API_VERSION: '2022-06-28',
    API_BASE: 'https://api.notion.com/v1',
    PROPS: {
      TITLE: 'Title',
      DATE: 'Date',
      DEADLINE: 'Deadline',
      EVENT_DATE: 'Event Date',
      NOTIFICATION_DATE: 'Notification Date',
      CATEGORY: 'Category',
      PRIORITY: 'Priority',
      STATUS: 'Status',
      SOURCE: 'Source',
      LOCATION: 'Location',
      URL: 'URL',
      DESCRIPTION: 'Description'
    }
  },

  // Category Keywords
  CATEGORIES: {
    'ES': ['ES', 'エントリーシート', '締切', '提出'],
    '説明会': ['説明会', 'セミナー', 'イベント'],
    '面接': ['面接', '選考', '採用'],
    'インターン': ['インターン', 'インターンシップ'],
    '就活': ['就活', '就職', '企業', '会社']
  },

  // Priority Keywords
  PRIORITY_KEYWORDS: {
    '最優先': ['最終面接', '内定', '明日', '本日'],
    '高': ['締切', '〆切', '期限', '面接', '選考'],
    '中': ['説明会', 'セミナー', '提出'],
    '低': ['案内', 'お知らせ']
  },

  LOG_LEVEL: 'DEBUG'
};

function validateConfig() {
  const errors = [];
  if (!CONFIG.GEMINI_API_KEY) errors.push('GEMINI_API_KEY が未設定');
  if (!CONFIG.NOTION_TOKEN) errors.push('NOTION_TOKEN が未設定');
  if (!CONFIG.NOTION_DATABASE_ID) errors.push('NOTION_DATABASE_ID が未設定');
  if (errors.length > 0) throw new Error('設定エラー:\n' + errors.join('\n'));
  return true;
}
