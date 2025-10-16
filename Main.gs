/**
 * Smart Schedule Manager - Main Entry Point
 * Gmail → Gemini AI → Notion パイプライン
 */

function main() {
  Logger.info('========================================');
  Logger.info('Smart Schedule Manager v2 - 実行開始');
  Logger.info('========================================');

  const startTime = Date.now();
  const MAX_EXECUTION_TIME = 4.5 * 60 * 1000; // 4.5分 (6分制限に対する安全マージン)

  try {
    validateConfig();
    Logger.info('✓ 設定検証完了');

    // 古い処理済みIDのクリーンアップ
    StateManager.cleanupOldProcessedIds();

    // 状態確認
    StateManager.showStatus();

    // 処理すべき日付リストを取得
    const datesToProcess = StateManager.getDatesToProcess(30);

    if (datesToProcess.length === 0) {
      Logger.info('処理すべき日付がありません。');
      logSummary(0, 0, 0, 0, 0, startTime);
      return;
    }

    Logger.info('\n処理予定: ' + datesToProcess.length + '日分');
    Logger.info('範囲: ' + formatDate(datesToProcess[0]) + ' 〜 ' + formatDate(datesToProcess[datesToProcess.length - 1]));

    let totalMessages = 0;
    let totalEvents = 0;
    let totalAdded = 0;
    let totalSkipped = 0;
    let processedDays = 0;

    // 日付ごとに処理
    for (let i = 0; i < datesToProcess.length; i++) {
      const currentDate = datesToProcess[i];

      // タイムアウトチェック
      if (Date.now() - startTime > MAX_EXECUTION_TIME) {
        Logger.warn('⚠ タイムアウト接近: 処理を中断します');
        Logger.info('次回実行時に ' + formatDate(currentDate) + ' から再開します');
        break;
      }

      // 現在処理中の日付を記録
      StateManager.setCurrentBatchDate(currentDate);

      Logger.info('\n========================================');
      Logger.info('📅 処理日: ' + formatDate(currentDate) + ' (' + (i + 1) + '/' + datesToProcess.length + ')');
      Logger.info('========================================');

      try {
        // この日付のメールを取得
        Logger.info('[1/3] Gmail からメール取得中...');
        const messages = Gmail.getMessagesByDate(currentDate);

        if (messages.length === 0) {
          Logger.info('この日のメールはありません');
          StateManager.setLastProcessedDate(currentDate);
          StateManager.clearCurrentBatchDate();
          processedDays++;
          continue;
        }

        Logger.info('取得: ' + messages.length + '件');
        totalMessages += messages.length;

        // Gemini AIでイベント解析
        Logger.info('[2/3] Gemini AIでイベント解析中...');
        const events = Gemini.parseMessages(messages);

        if (events.length === 0) {
          Logger.info('イベント情報なし');
          Gmail.markAsRead(messages);
          StateManager.setLastProcessedDate(currentDate);
          StateManager.clearCurrentBatchDate();
          processedDays++;
          continue;
        }

        Logger.info('抽出: ' + events.length + '件');
        totalEvents += events.length;

        // Notion に保存
        Logger.info('[3/3] Notion にイベント保存中...');
        const result = Notion.saveEvents(events);

        totalAdded += result.added;
        totalSkipped += result.skipped;

        // 処理済みとしてマーク
        Gmail.markAsRead(messages);
        if (result.added > 0) {
          Gmail.addLabel(messages, '処理済み/就活');
        }

        // 処理済みメッセージIDを記録
        const messageIds = [];
        for (let j = 0; j < messages.length; j++) {
          messageIds.push(messages[j].id);
        }
        StateManager.addProcessedMessageIds(currentDate, messageIds);

        // この日付の処理完了
        StateManager.setLastProcessedDate(currentDate);
        StateManager.clearCurrentBatchDate();
        processedDays++;

        Logger.info('✓ ' + formatDate(currentDate) + ' 完了');

      } catch (error) {
        Logger.error('日付処理エラー: ' + formatDate(currentDate), error.message);
        // この日付はスキップして次へ
        StateManager.clearCurrentBatchDate();
        continue;
      }
    }

    // 初回実行完了チェック
    if (!StateManager.isInitialRunComplete()) {
      const remainingDates = StateManager.getDatesToProcess(30);
      if (remainingDates.length === 0) {
        StateManager.setInitialRunComplete();
        Logger.info('🎉 初回実行完了！以降は通常運用モードになります');
      }
    }

    logSummary(processedDays, totalMessages, totalEvents, totalAdded, totalSkipped, startTime);

    Logger.info('✓ 全処理完了');

  } catch (error) {
    Logger.error('致命的エラー発生', error.message);
    Logger.error('スタックトレース', error.stack);
    throw error;
  }

  Logger.info('========================================');
}

function logSummary(processedDays, messageCount, eventCount, added, skipped, startTime) {
  const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

  Logger.info('\n========================================');
  Logger.info('実行サマリー');
  Logger.info('========================================');
  Logger.info('処理時間: ' + elapsedTime + '秒');
  Logger.info('処理日数: ' + processedDays + '日');
  Logger.info('取得メール数: ' + messageCount + '件');
  Logger.info('抽出イベント数: ' + eventCount + '件');
  Logger.info('Notion追加: ' + added + '件');
  Logger.info('重複スキップ: ' + skipped + '件');
  Logger.info('========================================');
}

function setupTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'main') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger('main')
    .timeBased()
    .atHour(8)
    .everyDays(1)
    .create();

  Logger.info('✓ トリガー設定完了: 毎日8時に実行');
}

function deleteTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let count = 0;

  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'main') {
      ScriptApp.deleteTrigger(triggers[i]);
      count++;
    }
  }

  Logger.info('✓ トリガー削除完了: ' + count + '件');
}

function testRun() {
  Logger.info('=== 手動テスト実行 ===\n');
  main();
}

function checkSetup() {
  Logger.info('========================================');
  Logger.info('セットアップ状態確認');
  Logger.info('========================================\n');

  Logger.info('[設定]');
  Logger.info('GEMINI_API_KEY: ' + (CONFIG.GEMINI_API_KEY ? '✓' : '✗ 未設定'));
  Logger.info('NOTION_TOKEN: ' + (CONFIG.NOTION_TOKEN ? '✓' : '✗ 未設定'));
  Logger.info('NOTION_DATABASE_ID: ' + (CONFIG.NOTION_DATABASE_ID ? '✓' : '✗ 未設定') + '\n');

  Logger.info('[トリガー]');
  const triggers = ScriptApp.getProjectTriggers();
  const mainTriggers = [];
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'main') {
      mainTriggers.push(triggers[i]);
    }
  }

  if (mainTriggers.length > 0) {
    Logger.info('✓ 設定済み: main');
  } else {
    Logger.info('✗ トリガー未設定');
    Logger.info('  setupTrigger() を実行してトリガーを設定してください');
  }

  Logger.info('\n========================================');
}

/**
 * デバッグ: 最近7日間のメールをテスト
 */
function debugRecentEmails() {
  Logger.info('========================================');
  Logger.info('デバッグ: 最近7日間のメール確認');
  Logger.info('========================================\n');

  validateConfig();

  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);

    Logger.info('\n--- ' + formatDate(date) + ' ---');

    try {
      const messages = Gmail.getMessagesByDate(date);
      Logger.info('検出: ' + messages.length + '件');

      if (messages.length > 0) {
        for (let j = 0; j < Math.min(messages.length, 3); j++) {
          Logger.info('  [' + (j + 1) + '] ' + messages[j].subject);
          Logger.info('      From: ' + messages[j].senderEmail);
        }
      }
    } catch (error) {
      Logger.error('エラー: ' + error.message);
    }
  }

  Logger.info('\n========================================');
}

/**
 * デバッグ: 今日のメールのみ処理
 */
function debugToday() {
  Logger.info('========================================');
  Logger.info('デバッグ: 今日のメール処理');
  Logger.info('========================================\n');

  validateConfig();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  Logger.info('処理日: ' + formatDate(today));

  const messages = Gmail.getMessagesByDate(today);
  Logger.info('検出メール: ' + messages.length + '件\n');

  if (messages.length === 0) {
    Logger.info('メールが見つかりません');
    Logger.info('\n[ヒント]');
    Logger.info('- Gmailの検索クエリを確認してください');
    Logger.info('- プロモーション/ソーシャルラベルのメールは除外されます');
    Logger.info('- 最近届いたメールを確認してください');
    return;
  }

  // メール詳細表示
  for (let i = 0; i < Math.min(messages.length, 5); i++) {
    const msg = messages[i];
    Logger.info('[メール ' + (i + 1) + ']');
    Logger.info('  件名: ' + msg.subject);
    Logger.info('  送信者: ' + msg.senderName + ' <' + msg.senderEmail + '>');
    Logger.info('  本文 (先頭200文字): ' + msg.body.substring(0, 200) + '...\n');
  }

  // Gemini解析テスト
  Logger.info('Gemini解析開始...');
  const events = Gemini.parseMessages(messages);
  Logger.info('抽出イベント: ' + events.length + '件\n');

  if (events.length === 0) {
    Logger.info('イベントが抽出できませんでした');
    return;
  }

  // イベント詳細表示
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    Logger.info('[イベント ' + (i + 1) + ']');
    Logger.info('  タイトル: ' + event.title);
    Logger.info('  日付: ' + event.date);
    Logger.info('  カテゴリー: ' + event.category);
    Logger.info('  優先度: ' + event.priority);
    Logger.info('  説明: ' + (event.description ? event.description.substring(0, 100) + '...' : 'なし') + '\n');
  }

  // Notion保存テスト
  Logger.info('Notion保存テスト...');
  const result = Notion.saveEvents(events);

  Logger.info('\n========================================');
  Logger.info('結果サマリー');
  Logger.info('========================================');
  Logger.info('追加: ' + result.added + '件');
  Logger.info('スキップ: ' + result.skipped + '件');
  Logger.info('エラー: ' + result.errors.length + '件');

  if (result.errors.length > 0) {
    Logger.info('\nエラー詳細:');
    for (let i = 0; i < result.errors.length; i++) {
      Logger.error('  - ' + result.errors[i].title + ': ' + result.errors[i].error);
    }
  }

  Logger.info('========================================');
}

/**
 * Notionデータベースを自動作成
 *
 * 使い方:
 * 1. Notionで新しいページを作成（このページ内にデータベースが作成されます）
 * 2. ページのURLからPage IDをコピー
 *    例: https://www.notion.so/My-Page-abc123def456... → abc123def456...
 * 3. この関数を実行: setupNotionDatabase('abc123def456...')
 * 4. 表示されたDatabase IDをスクリプトプロパティ NOTION_DATABASE_ID に設定
 */
function setupNotionDatabase(parentPageId) {
  Logger.info('========================================');
  Logger.info('Notion データベース自動セットアップ');
  Logger.info('========================================\n');

  if (!parentPageId) {
    Logger.error('エラー: 親ページIDが指定されていません');
    Logger.info('\n使い方:');
    Logger.info('1. Notionで新しいページを作成');
    Logger.info('2. ページのURLからPage IDをコピー');
    Logger.info('   例: https://www.notion.so/My-Page-abc123... → abc123...');
    Logger.info('3. setupNotionDatabase("abc123...") を実行');
    return;
  }

  // APIキーの確認
  if (!CONFIG.NOTION_TOKEN) {
    Logger.error('エラー: NOTION_TOKEN が設定されていません');
    Logger.info('スクリプトプロパティで NOTION_TOKEN を設定してください');
    return;
  }

  try {
    // ページIDの正規化（ハイフンを削除）
    const pageId = parentPageId.replace(/-/g, '');

    Logger.info('親ページID: ' + pageId);
    Logger.info('データベースを作成中...\n');

    const result = Notion.createDatabase(pageId, '就活イベント管理');

    Logger.info('\n========================================');
    Logger.info('✓ データベース作成成功！');
    Logger.info('========================================\n');
    Logger.info('Database ID: ' + result.id);
    Logger.info('Database URL: ' + result.url);
    Logger.info('\n次のステップ:');
    Logger.info('1. 上記のDatabase IDをコピー');
    Logger.info('2. スクリプトプロパティで NOTION_DATABASE_ID に設定');
    Logger.info('3. Notionでデータベースにインテグレーションを接続');
    Logger.info('   （データベースの右上 ... → 接続を追加 → インテグレーション選択）');
    Logger.info('4. checkSetup() を実行して設定を確認');
    Logger.info('5. debugToday() を実行してテスト');
    Logger.info('\n========================================');

  } catch (error) {
    Logger.error('エラー: データベース作成失敗');
    Logger.error(error.message);
    Logger.info('\nトラブルシューティング:');
    Logger.info('- 親ページIDが正しいか確認');
    Logger.info('- NotionインテグレーションがページにアクセスできるAか確認');
    Logger.info('- NOTION_TOKEN が正しく設定されているか確認');
  }
}
