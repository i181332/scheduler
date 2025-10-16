/**
 * Smart Schedule Manager - State Manager
 * 処理状態の永続化管理・タイムアウト対策
 */

const StateManager = {
  KEYS: {
    LAST_PROCESSED_DATE: 'LAST_PROCESSED_DATE',
    CURRENT_BATCH_DATE: 'CURRENT_BATCH_DATE',
    PROCESSED_MESSAGE_IDS: 'PROCESSED_MESSAGE_IDS_',
    INITIAL_RUN_COMPLETE: 'INITIAL_RUN_COMPLETE'
  },

  /**
   * 最後に処理完了した日付を取得
   * @returns {Date|null}
   */
  getLastProcessedDate: function() {
    const props = PropertiesService.getScriptProperties();
    const dateStr = props.getProperty(this.KEYS.LAST_PROCESSED_DATE);
    if (!dateStr) return null;

    try {
      return new Date(dateStr);
    } catch (e) {
      Logger.warn('StateManager: 無効な日付形式', dateStr);
      return null;
    }
  },

  /**
   * 最後に処理完了した日付を保存
   * @param {Date} date
   */
  setLastProcessedDate: function(date) {
    const props = PropertiesService.getScriptProperties();
    props.setProperty(this.KEYS.LAST_PROCESSED_DATE, date.toISOString());
    Logger.info('StateManager: 処理日付更新 - ' + formatDate(date));
  },

  /**
   * 現在処理中の日付を取得
   * @returns {Date|null}
   */
  getCurrentBatchDate: function() {
    const props = PropertiesService.getScriptProperties();
    const dateStr = props.getProperty(this.KEYS.CURRENT_BATCH_DATE);
    if (!dateStr) return null;

    try {
      return new Date(dateStr);
    } catch (e) {
      return null;
    }
  },

  /**
   * 現在処理中の日付を保存
   * @param {Date} date
   */
  setCurrentBatchDate: function(date) {
    const props = PropertiesService.getScriptProperties();
    props.setProperty(this.KEYS.CURRENT_BATCH_DATE, date.toISOString());
  },

  /**
   * 現在処理中の日付をクリア
   */
  clearCurrentBatchDate: function() {
    const props = PropertiesService.getScriptProperties();
    props.deleteProperty(this.KEYS.CURRENT_BATCH_DATE);
  },

  /**
   * 特定日付の処理済みメッセージIDリストを取得
   * @param {Date} date
   * @returns {string[]}
   */
  getProcessedMessageIds: function(date) {
    const props = PropertiesService.getScriptProperties();
    const key = this.KEYS.PROCESSED_MESSAGE_IDS + formatDateKey(date);
    const idsStr = props.getProperty(key);

    if (!idsStr) return [];

    try {
      return JSON.parse(idsStr);
    } catch (e) {
      Logger.warn('StateManager: 処理済みID解析エラー', e.message);
      return [];
    }
  },

  /**
   * 特定日付の処理済みメッセージIDを追加
   * @param {Date} date
   * @param {string[]} messageIds
   */
  addProcessedMessageIds: function(date, messageIds) {
    if (messageIds.length === 0) return;

    const props = PropertiesService.getScriptProperties();
    const key = this.KEYS.PROCESSED_MESSAGE_IDS + formatDateKey(date);

    const existing = this.getProcessedMessageIds(date);
    const combined = existing.concat(messageIds);
    const unique = Array.from(new Set(combined));

    // Script Properties の制限: 9KB per property
    // 安全のため最大1000件まで
    if (unique.length > 1000) {
      Logger.warn('StateManager: 処理済みID上限到達、古いIDを削除');
      unique.splice(0, unique.length - 1000);
    }

    props.setProperty(key, JSON.stringify(unique));
    Logger.debug('StateManager: 処理済みID追加 - ' + messageIds.length + '件');
  },

  /**
   * 古い処理済みIDを削除 (30日より古いもの)
   */
  cleanupOldProcessedIds: function() {
    const props = PropertiesService.getScriptProperties();
    const allProps = props.getProperties();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    let deletedCount = 0;
    for (const key in allProps) {
      if (key.startsWith(this.KEYS.PROCESSED_MESSAGE_IDS)) {
        const dateStr = key.replace(this.KEYS.PROCESSED_MESSAGE_IDS, '');
        try {
          const date = parseDateKey(dateStr);
          if (date < thirtyDaysAgo) {
            props.deleteProperty(key);
            deletedCount++;
          }
        } catch (e) {
          // 無効なキーは削除
          props.deleteProperty(key);
          deletedCount++;
        }
      }
    }

    if (deletedCount > 0) {
      Logger.info('StateManager: 古い処理済みID削除 - ' + deletedCount + '件');
    }
  },

  /**
   * 初回実行完了フラグを取得
   * @returns {boolean}
   */
  isInitialRunComplete: function() {
    const props = PropertiesService.getScriptProperties();
    return props.getProperty(this.KEYS.INITIAL_RUN_COMPLETE) === 'true';
  },

  /**
   * 初回実行完了フラグを設定
   */
  setInitialRunComplete: function() {
    const props = PropertiesService.getScriptProperties();
    props.setProperty(this.KEYS.INITIAL_RUN_COMPLETE, 'true');
    Logger.info('StateManager: 初回実行完了フラグ設定');
  },

  /**
   * 次に処理すべき日付を計算
   * @returns {Date}
   */
  getNextProcessingDate: function() {
    const currentBatch = this.getCurrentBatchDate();
    if (currentBatch) {
      // 前回の処理が中断されていた場合は続きから
      Logger.info('StateManager: 中断された処理を再開 - ' + formatDate(currentBatch));
      return currentBatch;
    }

    const lastProcessed = this.getLastProcessedDate();
    const initialComplete = this.isInitialRunComplete();

    if (!initialComplete) {
      // 初回実行: 30日前から開始
      if (!lastProcessed) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        startDate.setHours(0, 0, 0, 0);
        Logger.info('StateManager: 初回実行開始 - 30日前から処理');
        return startDate;
      } else {
        // 前回処理した日の翌日（初回実行中は順次進める）
        const nextDate = new Date(lastProcessed);
        nextDate.setDate(nextDate.getDate() + 1);
        nextDate.setHours(0, 0, 0, 0);
        return nextDate;
      }
    } else {
      // 通常運用: 最後に処理した日から今日まで（当日も再処理して漏れを防ぐ）
      if (!lastProcessed) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return today;
      }

      // 翌日ではなく当日から処理（処理済みIDで重複防止済み）
      const nextDate = new Date(lastProcessed);
      nextDate.setHours(0, 0, 0, 0);
      return nextDate;
    }
  },

  /**
   * 処理すべき日付のリストを取得
   * @param {number} maxDays - 一度に処理する最大日数
   * @returns {Date[]}
   */
  getDatesToProcess: function(maxDays) {
    maxDays = maxDays || 30;
    const dates = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let currentDate = this.getNextProcessingDate();

    while (currentDate <= today && dates.length < maxDays) {
      dates.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return dates;
  },

  /**
   * 状態をリセット（テスト用）
   */
  reset: function() {
    const props = PropertiesService.getScriptProperties();
    const allProps = props.getProperties();

    for (const key in allProps) {
      if (key.startsWith(this.KEYS.LAST_PROCESSED_DATE) ||
          key.startsWith(this.KEYS.CURRENT_BATCH_DATE) ||
          key.startsWith(this.KEYS.PROCESSED_MESSAGE_IDS) ||
          key.startsWith(this.KEYS.INITIAL_RUN_COMPLETE)) {
        props.deleteProperty(key);
      }
    }

    Logger.info('StateManager: 全ての状態をリセット');
  },

  /**
   * 現在の状態を表示
   */
  showStatus: function() {
    Logger.info('========================================');
    Logger.info('StateManager - 現在の状態');
    Logger.info('========================================');

    const lastProcessed = this.getLastProcessedDate();
    const currentBatch = this.getCurrentBatchDate();
    const initialComplete = this.isInitialRunComplete();
    const nextDate = this.getNextProcessingDate();

    Logger.info('初回実行完了: ' + (initialComplete ? 'はい' : 'いいえ'));
    Logger.info('最終処理日: ' + (lastProcessed ? formatDate(lastProcessed) : '未処理'));
    Logger.info('処理中の日付: ' + (currentBatch ? formatDate(currentBatch) : 'なし'));
    Logger.info('次の処理日: ' + formatDate(nextDate));

    const datesToProcess = this.getDatesToProcess(30);
    Logger.info('未処理日数: ' + datesToProcess.length + '日');

    if (datesToProcess.length > 0) {
      Logger.info('処理範囲: ' + formatDate(datesToProcess[0]) + ' 〜 ' + formatDate(datesToProcess[datesToProcess.length - 1]));
    }

    Logger.info('========================================');
  }
};

/**
 * ユーティリティ関数: 日付を YYYY-MM-DD 形式に変換
 */
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

/**
 * ユーティリティ関数: 日付をキー形式に変換 (YYYYMMDD)
 */
function formatDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + m + d;
}

/**
 * ユーティリティ関数: キー形式から日付に変換
 */
function parseDateKey(key) {
  const y = parseInt(key.substring(0, 4));
  const m = parseInt(key.substring(4, 6)) - 1;
  const d = parseInt(key.substring(6, 8));
  return new Date(y, m, d);
}
