/**
 * Smart Schedule Manager - Gemini Module
 */

const Gemini = {
  parseMessages: function(messages) {
    Logger.info('Gemini: ' + messages.length + '件のメッセージ解析開始');
    const startTime = Date.now();

    if (messages.length === 0) return [];

    const batches = chunk(messages, CONFIG.GEMINI.PARALLEL_BATCH_SIZE);
    Logger.info('Gemini: ' + batches.length + 'バッチで並列処理');

    const allEvents = [];
    let totalErrors = 0;

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      Logger.info('Gemini: バッチ ' + (batchIndex + 1) + '/' + batches.length + ' 処理中');

      const requests = [];
      for (let i = 0; i < batch.length; i++) {
        requests.push(this._buildRequest(batch[i]));
      }

      let responses;
      let retryCount = 0;
      const maxRetries = 3;

      // リトライロジック
      while (retryCount < maxRetries) {
        try {
          responses = UrlFetchApp.fetchAll(requests);
          break; // 成功したらループを抜ける
        } catch (error) {
          retryCount++;
          Logger.warn('Gemini: バッチ処理エラー (試行 ' + retryCount + '/' + maxRetries + '): ' + error.message);

          if (retryCount < maxRetries) {
            // Exponential backoff
            const delay = Math.pow(2, retryCount) * 1000;
            Logger.info('Gemini: ' + (delay / 1000) + '秒後にリトライします...');
            Utilities.sleep(delay);
          } else {
            Logger.error('Gemini: バッチ処理失敗 - スキップします');
            totalErrors += batch.length;
            responses = null;
            break;
          }
        }
      }

      if (!responses) continue;

      // レスポンス解析
      for (let i = 0; i < responses.length; i++) {
        try {
          const result = this._parseResponseWithRetry(responses[i], batch[i]);
          if (result) {
            // 単一イベントまたは複数イベント配列に対応
            if (Array.isArray(result)) {
              allEvents = allEvents.concat(result);
              Logger.debug('Gemini: 複数イベント抽出 - ' + result.length + '件');
            } else {
              allEvents.push(result);
              Logger.debug('Gemini: イベント抽出成功 - ' + result.title);
            }
          }
        } catch (error) {
          Logger.error('Gemini: レスポンス解析エラー - ' + batch[i].subject + ': ' + error.message);
          totalErrors++;
        }
      }

      // Rate limit対策: バッチ間で少し待機
      if (batchIndex < batches.length - 1) {
        Utilities.sleep(500);
      }
    }

    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
    Logger.info('Gemini: 解析完了 - ' + allEvents.length + '件抽出 (' + elapsedTime + '秒)');

    if (totalErrors > 0) {
      Logger.warn('Gemini: エラー件数 - ' + totalErrors + '件');
    }

    return allEvents;
  },

  /**
   * リトライ機能付きレスポンス解析
   */
  _parseResponseWithRetry: function(response, message) {
    const statusCode = response.getResponseCode();

    // Rate limit エラーの場合はリトライ
    if (statusCode === 429) {
      Logger.warn('Gemini: Rate limit到達 - ' + message.subject);
      Utilities.sleep(2000); // 2秒待機
      // TODO: 個別リトライは複雑になるため、バッチレベルでのリトライに依存
      return null;
    }

    // 通常のレスポンス解析
    return this._parseResponse(response, message);
  },

  _buildRequest: function(message) {
    // 構造化情報を事前抽出
    const structuredInfo = extractStructuredInfo(message.body);

    // メール送信元タイプを判定
    const senderType = this._detectSenderType(message.senderEmail, message.senderName);

    // 強化版プロンプト（企業直接メールを最優先）
    const prompt = `あなたは就職活動支援AIアシスタントです。以下のメールを詳細に分析し、重要な情報を抽出してください。

## 最優先事項
**企業から直接送信されたメール**（インターン受付開始、本選考エントリー開始など）を最優先してください。
就活エージェント・プラットフォーム経由のイベント案内（説明会、セミナー等）は優先度を下げてください。

## メール情報
**件名:** ${message.subject}
**送信者:** ${message.senderName} <${message.senderEmail}>
**送信元タイプ:** ${senderType}
**受信日時:** ${message.date}

**本文:**
${message.body}

## 事前抽出情報
- 検出URL: ${structuredInfo.urls.length}件
- 検出日付: ${structuredInfo.dates.length}件
- 企業名: ${structuredInfo.companyNames.join(', ') || 'なし'}
- 締切あり: ${structuredInfo.hasDeadline ? 'はい' : 'いいえ'}
- アクション要求: ${structuredInfo.hasAction ? 'はい' : 'いいえ'}

## タスク

### 1. メール分類（最重要）
まず、このメールがどちらに該当するか判定してください:

**【企業直接メール】** - 最優先で抽出
- 企業の採用担当者から直接送信
- 企業ドメイン（@company.co.jp等）から送信
- 内容: インターン応募受付開始、本選考エントリー開始、選考結果、面接日程など
- 例: 「【株式会社◯◯】インターンシップ応募受付を開始しました」

**【プラットフォーム経由メール】** - 優先度低
- リクナビ、マイナビ、ワンキャリア等の就活サービスから送信
- 内容: スカウト、イベント案内、説明会、セミナー等の集団向け情報
- 例: 「リクナビスカウト」「ワンキャリア運営事務局」からの案内

### 2. 重要度評価（メール分類を反映）
このメールの重要度を0-10のスコアで評価してください:

**【企業直接メール】の場合:**
- 9-10: インターン応募開始、本選考エントリー開始、締切、面接、選考結果
- 7-8: 企業からの個別案内、説明会案内
- 5-6: 企業からの定期情報

**【プラットフォーム経由メール】の場合:**
- 最大6点まで（企業直接より必ず低く評価）
- 5-6: 締切のあるイベント案内
- 3-4: 一般的なイベント案内、スカウト
- 0-2: 広告・宣伝

### 3. イベント情報抽出
以下の情報を可能な限り詳細に抽出してください:
- イベントタイトル（具体的に、企業名を必ず含める）
- メール種別（「企業直接」または「プラットフォーム経由」）
- 開催日時（複数ある場合は全て）
- 場所・形式（オンライン/オフライン、URL）
- 企業名（正式名称）
- イベント種別（インターン受付/本選考受付/説明会/面接/ES締切/選考結果 等）
- 締切日時
- 応募・参加URL
- 必要なアクション

### 4. 抽出基準
**【企業直接メール】の場合:**
- 応募受付開始、締切、面接案内など**全て抽出**してください

**【プラットフォーム経由メール】の場合:**
- 明確な締切があり、アクションが必要な場合のみ抽出
- 単なるイベント紹介・企業紹介は抽出しない

## 出力形式
以下のJSON形式で出力してください。

\`\`\`json
{
  "importance_score": 9,
  "importance_reason": "企業から直接のインターン応募受付開始通知",
  "email_type": "企業直接",
  "has_events": true,
  "events": [{
    "title": "【株式会社◯◯】サマーインターンシップ応募受付開始",
    "email_type": "企業直接",
    "date": "2025-10-20 14:00:00",
    "type": "インターン受付",
    "company": "株式会社◯◯",
    "location": "オンライン (Zoom)",
    "deadline": "2025-10-15 17:00:00",
    "url": "https://...",
    "description": "...",
    "required_actions": ["エントリーシート提出", "履歴書準備"]
  }],
  "summary": "インターンシップ応募受付が開始。10月15日締切で要エントリー"
}
\`\`\`

プラットフォーム経由の場合（スコアは最大6点）:
\`\`\`json
{
  "importance_score": 4,
  "importance_reason": "リクナビ経由のイベント案内（プラットフォーム経由のため優先度低）",
  "email_type": "プラットフォーム経由",
  "has_events": false,
  "events": [],
  "summary": "複数企業のセミナー紹介メール"
}
\`\`\``;

    const payload = {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: CONFIG.GEMINI.TEMPERATURE,
        maxOutputTokens: 4096, // 詳細な出力のため増量
        responseMimeType: 'application/json' // JSON出力を強制
      }
    };

    return {
      url: CONFIG.GEMINI.API_URL + '?key=' + CONFIG.GEMINI_API_KEY,
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
  },

  /**
   * 送信元タイプを判定
   */
  _detectSenderType: function(email, name) {
    const lowerEmail = email.toLowerCase();
    const lowerName = name.toLowerCase();

    // プラットフォーム判定
    const platforms = [
      'rikunabi', 'mynavi', 'onecareer', 'wantedly', 'offers',
      'en-japan', 'doda', 'bizreach', 'recruit'
    ];

    for (let i = 0; i < platforms.length; i++) {
      if (lowerEmail.includes(platforms[i]) || lowerName.includes(platforms[i])) {
        return 'プラットフォーム経由（' + platforms[i] + '）';
      }
    }

    // 企業ドメイン判定
    const domain = email.split('@')[1] || '';
    if (domain.endsWith('.co.jp') || domain.endsWith('.inc.jp') ||
        domain.endsWith('.or.jp') || domain.endsWith('.ac.jp')) {
      return '企業直接（企業ドメイン）';
    }

    return '不明';
  },

  _parseResponse: function(response, message) {
    try {
      const statusCode = response.getResponseCode();
      if (statusCode !== 200) {
        Logger.warn('Gemini: APIエラー ' + statusCode + ' - ' + message.subject);
        Logger.debug('Gemini: レスポンス内容 - ' + response.getContentText().substring(0, 500));
        return null;
      }

      const data = JSON.parse(response.getContentText());
      if (!data.candidates || data.candidates.length === 0) {
        Logger.warn('Gemini: 候補なし - ' + message.subject);
        return null;
      }

      if (!data.candidates[0].content || !data.candidates[0].content.parts || data.candidates[0].content.parts.length === 0) {
        Logger.warn('Gemini: コンテンツ不正 - ' + message.subject);
        return null;
      }

      const content = data.candidates[0].content.parts[0].text.trim();

      // JSONコードブロックから抽出
      let jsonText = content;
      const codeBlockMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1];
      } else {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonText = jsonMatch[0];
        }
      }

      const analysis = JSON.parse(jsonText);

      // メールタイプに応じた閾値判定
      const emailType = analysis.email_type || '';
      const minScore = emailType.includes('企業直接') ? 5 : 7; // プラットフォーム経由は7点以上必要

      // 重要度が低い場合はスキップ
      if (analysis.importance_score < minScore) {
        Logger.debug('Gemini: 重要度低 [' + analysis.importance_score + '/10, 閾値:' + minScore + ', タイプ:' + emailType + '] - ' + message.subject);
        return null;
      }

      // イベントがない場合
      if (!analysis.has_events || !analysis.events || analysis.events.length === 0) {
        Logger.debug('Gemini: イベントなし [タイプ:' + emailType + '] - ' + message.subject);
        return null;
      }

      // 複数イベントがある場合は全て返す
      const events = [];
      for (let i = 0; i < analysis.events.length; i++) {
        const eventData = analysis.events[i];
        const event = this._buildEvent(eventData, message, analysis);
        if (event) {
          events.push(event);
        }
      }

      Logger.info('Gemini: 抽出成功 [' + analysis.importance_score + '/10, ' + emailType + '] - ' + events.length + '件 - ' + message.subject);

      // 複数イベントの場合は配列で返す、単一の場合は最初の要素のみ
      return events.length > 0 ? (events.length === 1 ? events[0] : events) : null;

    } catch (error) {
      Logger.warn('Gemini: 解析エラー - ' + message.subject + ': ' + error.message);
      Logger.debug('Gemini: レスポンス内容 - ' + response.getContentText().substring(0, 1000));
      return null;
    }
  },

  _buildEvent: function(eventData, message, analysis) {
    // 日付解析
    let eventDate = null;
    let deadline = null;

    // 締切日時の解析（最優先）
    if (eventData.deadline && eventData.deadline !== 'null' && eventData.deadline !== 'TBD') {
      deadline = parseDate(eventData.deadline);
    }

    // 開催日時の解析
    if (eventData.date && eventData.date !== 'null' && eventData.date !== 'TBD') {
      eventDate = parseDate(eventData.date);
    }

    // フォールバック: 締切がある場合は開催日に設定
    if (!eventDate && deadline) {
      eventDate = new Date(deadline);
    }

    // フォールバック: どちらもない場合は7日後
    if (!eventDate) {
      eventDate = new Date();
      eventDate.setDate(eventDate.getDate() + 7);
    }

    // 通知日（メール受信日）
    const notificationDate = message.date;

    // カテゴリー判定（新しいtype情報を優先）
    let category = '就活';
    if (eventData.type) {
      const typeMap = {
        '面接': '面接',
        '説明会': '説明会',
        '選考': '面接',
        'ES': 'ES',
        'エントリーシート': 'ES',
        'インターン': 'インターン',
        'インターンシップ': 'インターン',
        'インターン受付': 'インターン',
        '本選考受付': '面接'
      };
      category = typeMap[eventData.type] || detectCategory(eventData.title);
    } else {
      category = detectCategory(eventData.title);
    }

    // 優先度判定（締切の有無も考慮）
    let priority = '中';
    if (deadline) {
      const daysUntilDeadline = Math.ceil((deadline - new Date()) / (1000 * 60 * 60 * 24));
      if (daysUntilDeadline <= 3) {
        priority = '最優先';
      } else if (daysUntilDeadline <= 7) {
        priority = '高';
      }
    }

    // 重要度スコアでも判定
    if (analysis && analysis.importance_score >= 9) {
      priority = '最優先';
    } else if (analysis && analysis.importance_score >= 7 && priority === '中') {
      priority = '高';
    }

    // 説明文を充実させる
    let description = eventData.description || '';
    if (analysis && analysis.summary) {
      description = analysis.summary + '\n\n' + description;
    }
    if (eventData.required_actions && eventData.required_actions.length > 0) {
      description += '\n\n【必要なアクション】\n- ' + eventData.required_actions.join('\n- ');
    }

    // メールタイプを判定
    const emailType = (analysis && analysis.email_type) || eventData.email_type || '';

    return {
      title: eventData.title,
      date: eventDate,              // 開催日
      deadline: deadline,           // 申込締切（最重要）
      notificationDate: notificationDate, // 通知日（メール受信日）
      category: category,
      priority: priority,
      status: '未対応',
      source: 'Gmail (' + message.senderName + ')',
      emailType: emailType,
      description: description.trim(),
      location: eventData.location || '',
      url: eventData.url || '',
      company: eventData.company || '',
      originalMessageId: message.id,
      originalSubject: message.subject,
      importanceScore: analysis ? analysis.importance_score : null
    };
  }
};
