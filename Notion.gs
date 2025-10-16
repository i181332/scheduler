/**
 * Smart Schedule Manager - Notion Module
 * 重複検知・選択的更新機能
 */

const Notion = {
  saveEvents: function(events) {
    Logger.info('Notion: ' + events.length + '件のイベント保存開始');
    const startTime = Date.now();

    if (events.length === 0) {
      return { added: 0, updated: 0, skipped: 0, errors: [] };
    }

    const result = { added: 0, updated: 0, skipped: 0, errors: [] };

    const existingEvents = this._getRecentEvents();
    Logger.info('Notion: 既存イベント ' + existingEvents.length + '件取得');

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      try {
        const duplicate = this._findDuplicate(event, existingEvents);

        if (duplicate) {
          // 重複が見つかった場合は更新を試みる
          Logger.debug('Notion: 重複検出 - 更新チェック中: ' + event.title);
          const updateResult = this._updatePage(duplicate.id, duplicate, event);

          if (updateResult !== null) {
            Logger.info('Notion: 更新成功 - ' + event.title);
            result.updated++;
          } else {
            Logger.debug('Notion: 更新不要（変更なし） - ' + event.title);
            result.skipped++;
          }
        } else {
          // 新規イベントとして作成
          this._createPage(event);
          Logger.info('Notion: 登録成功 - ' + event.title);
          result.added++;
        }
      } catch (error) {
        Logger.error('Notion: エラー - ' + event.title + ': ' + error.message);
        result.errors.push({ title: event.title, error: error.message });
      }
    }

    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
    Logger.info('Notion: 保存完了 - 追加:' + result.added + ' 更新:' + result.updated + ' スキップ:' + result.skipped + ' エラー:' + result.errors.length + ' (' + elapsedTime + '秒)');

    return result;
  },

  _getRecentEvents: function() {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const url = CONFIG.NOTION.API_BASE + '/databases/' + CONFIG.NOTION_DATABASE_ID + '/query';
      const payload = {
        filter: {
          property: CONFIG.NOTION.PROPS.DATE,
          date: { on_or_after: sevenDaysAgo.toISOString() }
        },
        page_size: 100
      };

      const response = UrlFetchApp.fetch(url, {
        method: 'post',
        headers: {
          'Authorization': 'Bearer ' + CONFIG.NOTION_TOKEN,
          'Notion-Version': CONFIG.NOTION.API_VERSION,
          'Content-Type': 'application/json'
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });

      if (response.getResponseCode() !== 200) return [];

      const data = JSON.parse(response.getContentText());
      const results = [];
      for (let i = 0; i < data.results.length; i++) {
        const page = data.results[i];
        results.push({
          id: page.id,
          title: this._extractTitle(page),
          date: this._extractDate(page),
          deadline: this._extractDeadline(page),
          eventDate: this._extractEventDate(page),
          url: this._extractURL(page),
          description: this._extractDescription(page),
          location: this._extractLocation(page),
          properties: page.properties  // 全プロパティを保持
        });
      }
      return results;

    } catch (error) {
      Logger.warn('Notion: 既存イベント取得エラー', error.message);
      return [];
    }
  },

  _extractTitle: function(page) {
    try {
      const titleProp = page.properties[CONFIG.NOTION.PROPS.TITLE];
      if (titleProp && titleProp.title && titleProp.title.length > 0) {
        return titleProp.title[0].plain_text;
      }
    } catch (e) {}
    return '';
  },

  _extractDate: function(page) {
    try {
      const dateProp = page.properties[CONFIG.NOTION.PROPS.DATE];
      if (dateProp && dateProp.date && dateProp.date.start) {
        return new Date(dateProp.date.start);
      }
    } catch (e) {}
    return null;
  },

  _extractDeadline: function(page) {
    try {
      const prop = page.properties[CONFIG.NOTION.PROPS.DEADLINE];
      if (prop && prop.date && prop.date.start) {
        return new Date(prop.date.start);
      }
    } catch (e) {}
    return null;
  },

  _extractEventDate: function(page) {
    try {
      const prop = page.properties[CONFIG.NOTION.PROPS.EVENT_DATE];
      if (prop && prop.date && prop.date.start) {
        return new Date(prop.date.start);
      }
    } catch (e) {}
    return null;
  },

  _extractURL: function(page) {
    try {
      const prop = page.properties[CONFIG.NOTION.PROPS.URL];
      if (prop && prop.url) {
        return prop.url;
      }
    } catch (e) {}
    return '';
  },

  _extractDescription: function(page) {
    try {
      const prop = page.properties[CONFIG.NOTION.PROPS.DESCRIPTION];
      if (prop && prop.rich_text && prop.rich_text.length > 0) {
        return prop.rich_text[0].plain_text;
      }
    } catch (e) {}
    return '';
  },

  _extractLocation: function(page) {
    try {
      const prop = page.properties[CONFIG.NOTION.PROPS.LOCATION];
      if (prop && prop.rich_text && prop.rich_text.length > 0) {
        return prop.rich_text[0].plain_text;
      }
    } catch (e) {}
    return '';
  },

  _findDuplicate: function(newEvent, existingEvents) {
    const threshold = 0.8;

    for (let i = 0; i < existingEvents.length; i++) {
      const existing = existingEvents[i];
      const similarity = calculateSimilarity(newEvent.title, existing.title);

      if (similarity >= threshold) {
        if (existing.date) {
          const daysDiff = Math.abs(newEvent.date - existing.date) / (1000 * 60 * 60 * 24);
          if (daysDiff < 1) return existing;
        }
        if (!existing.date && similarity >= 0.9) return existing;
      }
    }

    return null;
  },

  _createPage: function(event) {
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return this._createPageAttempt(event);
      } catch (error) {
        lastError = error;
        Logger.warn('Notion: 保存試行 ' + attempt + '/' + maxRetries + ' 失敗 - ' + event.title + ': ' + error.message);

        if (attempt < maxRetries) {
          // Exponential backoff
          const delay = Math.pow(2, attempt) * 500;
          Utilities.sleep(delay);
        }
      }
    }

    // 全ての試行が失敗
    throw lastError;
  },

  /**
   * 既存ページを選択的に更新
   * @param {string} pageId - NotionページID
   * @param {Object} existingEvent - 既存イベント情報
   * @param {Object} newEvent - 新しイベント情報
   */
  _updatePage: function(pageId, existingEvent, newEvent) {
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return this._updatePageAttempt(pageId, existingEvent, newEvent);
      } catch (error) {
        lastError = error;
        Logger.warn('Notion: 更新試行 ' + attempt + '/' + maxRetries + ' 失敗 - ' + newEvent.title + ': ' + error.message);

        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 500;
          Utilities.sleep(delay);
        }
      }
    }

    throw lastError;
  },

  _updatePageAttempt: function(pageId, existingEvent, newEvent) {
    const url = CONFIG.NOTION.API_BASE + '/pages/' + pageId;
    const properties = {};
    let hasUpdates = false;

    // 更新対象フィールド（選択的更新）

    // 1. Deadline（申込締切）- 新しい締切がある場合、または既存が空の場合
    if (newEvent.deadline) {
      const shouldUpdate = !existingEvent.deadline ||
                          newEvent.deadline.getTime() !== existingEvent.deadline.getTime();
      if (shouldUpdate) {
        properties[CONFIG.NOTION.PROPS.DEADLINE] = {
          date: { start: newEvent.deadline.toISOString() }
        };
        hasUpdates = true;
        Logger.debug('Notion: 更新 - Deadline: ' + newEvent.deadline.toISOString());
      }
    }

    // 2. Event Date（開催日）- 新しい開催日がある場合、または既存が空の場合
    if (newEvent.date) {
      const shouldUpdate = !existingEvent.eventDate ||
                          newEvent.date.getTime() !== existingEvent.eventDate.getTime();
      if (shouldUpdate) {
        properties[CONFIG.NOTION.PROPS.EVENT_DATE] = {
          date: { start: newEvent.date.toISOString() }
        };
        hasUpdates = true;
        Logger.debug('Notion: 更新 - Event Date: ' + newEvent.date.toISOString());
      }
    }

    // 3. URL - 既存が空、または新しいURLが異なる場合
    if (newEvent.url && newEvent.url !== existingEvent.url) {
      const urlText = newEvent.url.length > 2000 ? newEvent.url.substring(0, 1997) + '...' : newEvent.url;
      properties[CONFIG.NOTION.PROPS.URL] = { url: urlText };
      hasUpdates = true;
      Logger.debug('Notion: 更新 - URL: ' + urlText.substring(0, 50) + '...');
    }

    // 4. Location - 既存が空、または新しい場所が異なる場合
    if (newEvent.location && newEvent.location !== existingEvent.location) {
      const location = newEvent.location.length > 2000 ? newEvent.location.substring(0, 1997) + '...' : newEvent.location;
      properties[CONFIG.NOTION.PROPS.LOCATION] = {
        rich_text: [{ text: { content: location } }]
      };
      hasUpdates = true;
      Logger.debug('Notion: 更新 - Location: ' + location);
    }

    // 5. Description - 新情報を追記（既存と異なる場合）
    if (newEvent.description) {
      let newDescription = newEvent.description.length > 2000 ?
                          newEvent.description.substring(0, 1997) + '...' :
                          newEvent.description;

      // 既存のDescriptionと異なる場合のみ更新
      if (newDescription !== existingEvent.description) {
        // 既存の説明がある場合は追記、ない場合は新規設定
        if (existingEvent.description) {
          const mergedDescription = existingEvent.description + '\n\n【更新情報 ' + formatDate(new Date()) + '】\n' + newDescription;
          const finalDescription = mergedDescription.length > 2000 ?
                                  mergedDescription.substring(0, 1997) + '...' :
                                  mergedDescription;
          properties[CONFIG.NOTION.PROPS.DESCRIPTION] = {
            rich_text: [{ text: { content: finalDescription } }]
          };
        } else {
          properties[CONFIG.NOTION.PROPS.DESCRIPTION] = {
            rich_text: [{ text: { content: newDescription } }]
          };
        }
        hasUpdates = true;
        Logger.debug('Notion: 更新 - Description追記');
      }
    }

    // 6. Notification Date（通知日）- 常に最新のメール受信日を記録
    if (newEvent.notificationDate) {
      properties[CONFIG.NOTION.PROPS.NOTIFICATION_DATE] = {
        date: { start: newEvent.notificationDate.toISOString() }
      };
      hasUpdates = true;
    }

    // 7. 後方互換性のためDATEフィールドも更新
    const legacyDate = newEvent.deadline || newEvent.date;
    if (legacyDate) {
      properties[CONFIG.NOTION.PROPS.DATE] = {
        date: { start: legacyDate.toISOString() }
      };
    }

    // 更新がない場合はスキップ
    if (!hasUpdates) {
      Logger.debug('Notion: 更新不要 - ' + newEvent.title);
      return null;
    }

    const payload = { properties: properties };

    Logger.debug('Notion: 更新API呼び出し - ' + newEvent.title);

    const response = UrlFetchApp.fetch(url, {
      method: 'PATCH',  // 更新はPATCH
      headers: {
        'Authorization': 'Bearer ' + CONFIG.NOTION_TOKEN,
        'Notion-Version': CONFIG.NOTION.API_VERSION,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (statusCode !== 200) {
      Logger.error('Notion: 更新APIエラー ' + statusCode);
      Logger.error('Notion: レスポンス - ' + responseText);
      throw new Error('Notion API error ' + statusCode + ': ' + responseText);
    }

    return JSON.parse(responseText);
  },

  _createPageAttempt: function(event) {
    const url = CONFIG.NOTION.API_BASE + '/pages';

    // タイトルの長さ制限 (Notionは2000文字まで)
    const title = event.title.length > 2000 ? event.title.substring(0, 1997) + '...' : event.title;

    // 説明文の長さ制限 (1つのテキストブロックは2000文字まで)
    let description = event.description || '';
    if (description.length > 2000) {
      description = description.substring(0, 1997) + '...';
    }

    const properties = {};
    properties[CONFIG.NOTION.PROPS.TITLE] = { title: [{ text: { content: title } }] };

    // 新しい日付フィールド
    // 1. 申込締切（最重要）
    if (event.deadline) {
      properties[CONFIG.NOTION.PROPS.DEADLINE] = { date: { start: event.deadline.toISOString() } };
    }

    // 2. 開催日
    if (event.date) {
      properties[CONFIG.NOTION.PROPS.EVENT_DATE] = { date: { start: event.date.toISOString() } };
    }

    // 3. 通知日（メール受信日）
    if (event.notificationDate) {
      properties[CONFIG.NOTION.PROPS.NOTIFICATION_DATE] = { date: { start: event.notificationDate.toISOString() } };
    }

    // 後方互換性のため、従来のDATEフィールドも保持（締切優先、なければ開催日）
    const legacyDate = event.deadline || event.date;
    if (legacyDate) {
      properties[CONFIG.NOTION.PROPS.DATE] = { date: { start: legacyDate.toISOString() } };
    }

    // URL（応募・参加URL）
    if (event.url) {
      const urlText = event.url.length > 2000 ? event.url.substring(0, 1997) + '...' : event.url;
      properties[CONFIG.NOTION.PROPS.URL] = { url: urlText };
    }

    // Selectプロパティは存在する選択肢のみ設定可能
    // 存在しない場合はエラーになるので、try-catchで保護
    if (event.category) {
      try {
        properties[CONFIG.NOTION.PROPS.CATEGORY] = { select: { name: event.category } };
      } catch (e) {
        Logger.warn('Notion: カテゴリー設定エラー - ' + event.category);
      }
    }

    if (event.priority) {
      try {
        properties[CONFIG.NOTION.PROPS.PRIORITY] = { select: { name: event.priority } };
      } catch (e) {
        Logger.warn('Notion: 優先度設定エラー - ' + event.priority);
      }
    }

    if (event.status) {
      try {
        properties[CONFIG.NOTION.PROPS.STATUS] = { select: { name: event.status } };
      } catch (e) {
        Logger.warn('Notion: ステータス設定エラー - ' + event.status);
      }
    }

    if (event.source) {
      // Sourceは長すぎる可能性があるので制限
      const source = event.source.length > 100 ? event.source.substring(0, 97) + '...' : event.source;
      try {
        properties[CONFIG.NOTION.PROPS.SOURCE] = { select: { name: source } };
      } catch (e) {
        Logger.warn('Notion: ソース設定エラー - ' + source);
      }
    }

    if (event.location) {
      const location = event.location.length > 2000 ? event.location.substring(0, 1997) + '...' : event.location;
      properties[CONFIG.NOTION.PROPS.LOCATION] = { rich_text: [{ text: { content: location } }] };
    }

    // Description（イベント説明）をプロパティとして追加
    if (description) {
      properties[CONFIG.NOTION.PROPS.DESCRIPTION] = { rich_text: [{ text: { content: description } }] };
    }

    const payload = {
      parent: { database_id: CONFIG.NOTION_DATABASE_ID },
      properties: properties
    };

    // ページ本文にも説明を追加（詳細表示用）
    if (description) {
      payload.children = [{
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ text: { content: description } }]
        }
      }];
    }

    Logger.debug('Notion: API呼び出し - ' + title);

    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + CONFIG.NOTION_TOKEN,
        'Notion-Version': CONFIG.NOTION.API_VERSION,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (statusCode !== 200) {
      Logger.error('Notion: API エラー ' + statusCode);
      Logger.error('Notion: レスポンス - ' + responseText);
      throw new Error('Notion API error ' + statusCode + ': ' + responseText);
    }

    return JSON.parse(responseText);
  },

  /**
   * Notionデータベースを自動作成
   * @param {string} parentPageId - データベースを作成する親ページのID
   * @param {string} databaseTitle - データベースのタイトル（デフォルト: "就活イベント管理"）
   * @returns {Object} 作成されたデータベースの情報（database_id を含む）
   */
  createDatabase: function(parentPageId, databaseTitle) {
    const title = databaseTitle || '就活イベント管理';

    Logger.info('Notion: データベース作成開始 - ' + title);

    const url = CONFIG.NOTION.API_BASE + '/databases';

    const payload = {
      parent: {
        type: 'page_id',
        page_id: parentPageId
      },
      title: [
        {
          type: 'text',
          text: { content: title }
        }
      ],
      properties: {
        'Title': {
          title: {}
        },
        'Deadline': {
          date: {}
        },
        'Event Date': {
          date: {}
        },
        'Notification Date': {
          date: {}
        },
        'Date': {
          date: {}
        },
        'Category': {
          select: {
            options: [
              { name: 'ES', color: 'red' },
              { name: '説明会', color: 'blue' },
              { name: '面接', color: 'green' },
              { name: 'インターン', color: 'yellow' },
              { name: '就活', color: 'purple' }
            ]
          }
        },
        'Priority': {
          select: {
            options: [
              { name: '最優先', color: 'red' },
              { name: '高', color: 'orange' },
              { name: '中', color: 'yellow' },
              { name: '低', color: 'gray' }
            ]
          }
        },
        'Status': {
          select: {
            options: [
              { name: '未対応', color: 'red' },
              { name: '対応中', color: 'yellow' },
              { name: '完了', color: 'green' }
            ]
          }
        },
        'Source': {
          select: {
            options: []
          }
        },
        'Location': {
          rich_text: {}
        },
        'URL': {
          url: {}
        },
        'Description': {
          rich_text: {}
        }
      }
    };

    Logger.debug('Notion: データベース作成API呼び出し');

    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + CONFIG.NOTION_TOKEN,
        'Notion-Version': CONFIG.NOTION.API_VERSION,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (statusCode !== 200) {
      Logger.error('Notion: データベース作成エラー ' + statusCode);
      Logger.error('Notion: レスポンス - ' + responseText);
      throw new Error('Notion API error ' + statusCode + ': ' + responseText);
    }

    const result = JSON.parse(responseText);
    Logger.info('Notion: データベース作成成功');
    Logger.info('Database ID: ' + result.id);
    Logger.info('このIDをスクリプトプロパティ NOTION_DATABASE_ID に設定してください');

    return result;
  }
};
