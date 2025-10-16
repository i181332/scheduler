/**
 * Smart Schedule Manager - Gmail Module
 */

const Gmail = {
  /**
   * 指定日付のメールを取得
   * @param {Date} date - 取得対象の日付
   * @returns {Array} 構造化されたメッセージ配列
   */
  getMessagesByDate: function(date) {
    Logger.info('Gmail: メール取得開始 - ' + formatDate(date));
    const startTime = Date.now();

    // 日付範囲を作成
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // 次の日の00:00:00
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(0, 0, 0, 0);

    // 前の日の23:59:59
    const prevDay = new Date(date);
    prevDay.setDate(prevDay.getDate() - 1);
    prevDay.setHours(23, 59, 59, 999);

    // Gmail検索クエリ: after:(前日) before:(次の日) で指定日を検索
    const afterDate = this._formatGmailDate(prevDay);
    const beforeDate = this._formatGmailDate(nextDay);

    // プロモーションラベルを除外し、指定日付のメールを取得
    const query = 'after:' + afterDate + ' before:' + beforeDate + ' -in:spam -in:trash';

    Logger.info('Gmail: 検索クエリ - ' + query);

    const threads = GmailApp.search(query, 0, 500); // 1日あたり最大500件

    if (threads.length === 0) {
      Logger.info('Gmail: この日のメールなし');
      return [];
    }

    Logger.info('Gmail: ' + threads.length + '件のスレッド検出');

    // 処理済みIDを取得
    const processedIds = StateManager.getProcessedMessageIds(date);
    const processedSet = new Set(processedIds);

    const allMessages = [];
    for (let i = 0; i < threads.length; i++) {
      const messages = threads[i].getMessages();
      for (let j = 0; j < messages.length; j++) {
        const messageDate = messages[j].getDate();

        // この日付のメッセージか確認
        if (messageDate >= startOfDay && messageDate <= endOfDay) {
          const messageId = messages[j].getId();

          // 未処理のメッセージのみ追加
          if (!processedSet.has(messageId)) {
            allMessages.push(messages[j]);
          }
        }
      }
    }

    if (allMessages.length === 0) {
      Logger.info('Gmail: 新規メールなし (全て処理済み)');
      return [];
    }

    Logger.info('Gmail: 未処理メッセージ ' + allMessages.length + '件');

    const structuredMessages = [];
    for (let i = 0; i < allMessages.length; i++) {
      const msg = this._parseMessage(allMessages[i], i);
      const importance = this._isImportant(msg);

      if (importance) {
        structuredMessages.push(msg);
      } else {
        // 除外されたメールをログ出力
        Logger.debug('Gmail: 除外 - ' + msg.subject + ' (From: ' + msg.senderEmail + ')');
      }
    }

    Logger.info('Gmail: 重要メール ' + structuredMessages.length + '件');
    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
    Logger.info('Gmail: 処理完了 (' + elapsedTime + '秒)');

    return structuredMessages;
  },

  /**
   * Gmail検索用の日付フォーマット (YYYY/MM/DD)
   */
  _formatGmailDate: function(date) {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    return y + '/' + m + '/' + d;
  },

  /**
   * 後方互換性のため残す (非推奨)
   */
  getUnreadMessages: function() {
    Logger.warn('Gmail: getUnreadMessages() は非推奨です。getMessagesByDate() を使用してください');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return this.getMessagesByDate(today);
  },

  _parseMessage: function(message, index) {
    const subject = message.getSubject();
    const from = message.getFrom();
    const senderInfo = this._parseSender(from);
    const body = message.getPlainBody();

    return {
      id: message.getId(),
      index: index,
      subject: subject,
      from: from,
      senderName: senderInfo.name,
      senderEmail: senderInfo.email,
      date: message.getDate(),
      body: extractImportantInfo(body),
      rawMessage: message
    };
  },

  _parseSender: function(from) {
    const match = from.match(/^(.+?)\s*<(.+?)>$/);
    if (match) {
      return { name: match[1].trim(), email: match[2].trim() };
    }
    return { name: from, email: from };
  },

  /**
   * メールの重要度を判定（多面的評価）
   * @param {Object} message - 解析済みメッセージ
   * @returns {boolean} - true: 重要, false: 不要
   */
  _isImportant: function(message) {
    // 1. 最小限の除外キーワード（完全に無関係なもののみ）
    const excludeKeywords = [
      'youtube', 'メルカリ', 'クーポン', 'セール', 'sale', 'discount', 'ポイント'
    ];

    const lowerText = (message.subject + ' ' + message.senderName).toLowerCase();

    for (let i = 0; i < excludeKeywords.length; i++) {
      if (lowerText.includes(excludeKeywords[i])) {
        Logger.debug('Gmail: 除外 - ' + message.subject + ' (理由: ' + excludeKeywords[i] + ')');
        return false;
      }
    }

    // 2. 送信者の権威性評価
    const senderScore = this._evaluateSender(message.senderEmail, message.senderName);

    // 3. コンテンツの重要度評価
    const contentScore = this._evaluateContent(message.subject, message.body);

    // 4. 総合判定
    const totalScore = (senderScore * 0.6) + (contentScore * 0.4);

    // スコアが0.4以上なら重要 (0.5から緩和)
    const isImportant = totalScore >= 0.4;

    Logger.info('Gmail: [' + (isImportant ? '✓' : '✗') + '] スコア:' + totalScore.toFixed(2) + ' (送信者:' + senderScore.toFixed(2) + ' 内容:' + contentScore.toFixed(2) + ') - ' + message.subject.substring(0, 50));

    return isImportant;
  },

  /**
   * 送信者の権威性を評価
   */
  _evaluateSender: function(email, name) {
    const domain = email.split('@')[1] || '';
    const lowerEmail = email.toLowerCase();
    const lowerDomain = domain.toLowerCase();

    // 信頼できる就活サービス (最高評価)
    const trustedDomains = [
      'mynavi.jp', 'mynavimn.com', 'rikunabi', 'recruitmnc.com',
      'onecareer.jp', 'wantedly.com', 'offersaijiki.com',
      'en-japan.com', 'doda.jp', 'bizreach.jp'
    ];

    for (let i = 0; i < trustedDomains.length; i++) {
      if (lowerDomain.includes(trustedDomains[i]) || lowerEmail.includes(trustedDomains[i])) {
        return 0.9; // 高評価（就活サービス）
      }
    }

    // 企業の公式ドメイン (.co.jp, .inc.jp等)
    if (lowerDomain.endsWith('.co.jp') ||
        lowerDomain.endsWith('.inc.jp') ||
        lowerDomain.endsWith('.or.jp') ||
        lowerDomain.endsWith('.ac.jp')) {
      return 0.9; // 高評価
    }

    // 企業系ドメイン (.com で企業名を含む)
    if (lowerDomain.endsWith('.com') &&
        (name.includes('株式会社') ||
         name.includes('Corporation') ||
         lowerDomain.includes('corp') ||
         lowerDomain.includes('recruit'))) {
      return 0.8;
    }

    // noreply, info等の自動送信アドレス
    if (lowerEmail.startsWith('noreply') ||
        lowerEmail.startsWith('no-reply') ||
        lowerEmail.startsWith('info@') ||
        lowerEmail.startsWith('contact@') ||
        lowerEmail.startsWith('support@')) {
      return 0.7;
    }

    // その他
    return 0.5;
  },

  /**
   * コンテンツの重要度を評価
   */
  _evaluateContent: function(subject, body) {
    const text = (subject + ' ' + body).toLowerCase();

    let score = 0.0;

    // 就活関連の重要キーワード
    const highPriorityKeywords = [
      '最終面接', '内定', '選考結果', '採用', '締切', '〆切', '期限',
      '面接日程', '面接のご案内', '選考通過'
    ];

    for (let i = 0; i < highPriorityKeywords.length; i++) {
      if (text.includes(highPriorityKeywords[i])) {
        score += 0.5;
        break;
      }
    }

    // 就活一般キーワード（スコアを上げる）
    const jobHuntingKeywords = [
      '就活', '就職', '採用', '選考', 'インターン', '説明会', '面接',
      'エントリー', 'es', '企業説明', '会社説明', 'オファー', 'スカウト',
      'リクルート', 'キャリア', '新卒', 'セミナー', '仕事体験',
      'オープン', '1day', 'プログラム', 'エンジニア'
    ];

    for (let i = 0; i < jobHuntingKeywords.length; i++) {
      if (text.includes(jobHuntingKeywords[i])) {
        score += 0.4;
        break;
      }
    }

    // 企業名が含まれる
    if (/株式会社|Corporation|Inc\.|Ltd\./.test(subject + ' ' + body)) {
      score += 0.2;
    }

    // 日程・期限関連
    if (/\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}\/\d{1,2}|締切|期限|まで/.test(text)) {
      score += 0.2;
    }

    // URL含む（応募リンク等の可能性）
    if (/https?:\/\/[^\s]+/.test(body)) {
      score += 0.1;
    }

    return Math.min(score, 1.0);
  },

  markAsRead: function(messages) {
    if (!CONFIG.GMAIL.MARK_AS_READ) return;
    Logger.info('Gmail: ' + messages.length + '件のメッセージを既読化');
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].rawMessage) {
        messages[i].rawMessage.markRead();
      }
    }
  },

  addLabel: function(messages, labelName) {
    let label = GmailApp.getUserLabelByName(labelName);
    if (!label) {
      label = GmailApp.createLabel(labelName);
    }
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].rawMessage) {
        messages[i].rawMessage.getThread().addLabel(label);
      }
    }
    Logger.info('Gmail: ' + messages.length + '件にラベル追加 - ' + labelName);
  }
};
