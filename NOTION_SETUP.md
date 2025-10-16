# Notion データベース設定ガイド

## 🎯 概要

Smart Schedule Manager v2.2.0 では、以下の新しいフィールドが追加されました：

### 新規追加フィールド（v2.2.0）
1. **Deadline** - 申込締切（最重要）
2. **Event Date** - 開催日
3. **Notification Date** - 通知日（メール受信日）
4. **URL** - 応募・参加URL
5. **Description** - イベント説明

---

## 📋 Notionデータベースに追加が必要なプロパティ

### 1. Deadline（申込締切） - 最重要
- **タイプ**: Date
- **名前**: `Deadline`
- **説明**: エントリー・応募の締切日時
- **用途**: 最も重要な日付。締切日でソート・フィルタ可能

### 2. Event Date（開催日）
- **タイプ**: Date
- **名前**: `Event Date`
- **説明**: イベント・説明会の実施日
- **用途**: 実際にイベントが行われる日

### 3. Notification Date（通知日）
- **タイプ**: Date
- **名前**: `Notification Date`
- **説明**: メールを受信した日
- **用途**: いつ情報を得たかを記録

### 4. URL（応募・参加URL）
- **タイプ**: URL
- **名前**: `URL`
- **説明**: エントリーページや参加申し込みのURL
- **用途**: ワンクリックで応募ページへアクセス

### 5. Description（イベント説明）
- **タイプ**: Text
- **名前**: `Description`
- **説明**: イベントの詳細、必要なアクション等
- **用途**: データベースビューで概要を確認

---

## 🔧 Notionでの設定手順

### Step 1: データベースを開く
1. Notionで就活イベント管理データベースを開く
2. 右上の「...」メニューをクリック
3. 「プロパティを編集」を選択

### Step 2: 新しいプロパティを追加

#### Deadline（申込締切）
```
プロパティ名: Deadline
タイプ: Date
```

#### Event Date（開催日）
```
プロパティ名: Event Date
タイプ: Date
```

#### Notification Date（通知日）
```
プロパティ名: Notification Date
タイプ: Date
```

#### URL（応募・参加URL）
```
プロパティ名: URL
タイプ: URL
```

#### Description（イベント説明）
```
プロパティ名: Description
タイプ: Text
```

### Step 3: 既存プロパティの確認

以下のプロパティが既に存在することを確認：

- **Title** (タイトル) - タイトル型
- **Date** (日付) - Date型 ※後方互換性のため残す
- **Category** (カテゴリ) - セレクト型
- **Priority** (優先度) - セレクト型
- **Status** (ステータス) - セレクト型
- **Source** (ソース) - セレクト型
- **Location** (場所) - テキスト型

---

## 📊 推奨ビュー設定

### ビュー1: 締切順ビュー（デフォルト）
**目的**: 申込締切が近いイベントを優先表示

- **ソート**: Deadline（昇順）
- **フィルタ**: Deadline is not empty
- **表示列**:
  - Title
  - **Deadline** ← 最重要
  - Event Date
  - Priority
  - Status
  - URL
  - Description

### ビュー2: 開催日順ビュー
**目的**: イベント実施日で管理

- **ソート**: Event Date（昇順）
- **フィルタ**: Event Date is not empty
- **表示列**:
  - Title
  - Event Date
  - Deadline
  - Category
  - Location
  - URL

### ビュー3: 新着順ビュー
**目的**: 最近受信したメールから確認

- **ソート**: Notification Date（降順）
- **表示列**:
  - Title
  - Notification Date
  - Deadline
  - Event Date
  - Description

---

## 🎨 フィルタ・ソート例

### 締切が1週間以内のイベント
```
フィルタ: Deadline is within next 7 days
ソート: Deadline（昇順）
```

### 未対応の重要イベント
```
フィルタ:
  - Status = 未対応
  - Priority = 最優先 OR Priority = 高
ソート: Deadline（昇順）
```

### 今月開催のイベント
```
フィルタ: Event Date is this month
ソート: Event Date（昇順）
```

---

## ⚙️ 優先度の自動設定ロジック

システムは以下のロジックで優先度を自動設定します：

### 締切による判定
- **最優先**: 締切まで3日以内
- **高**: 締切まで7日以内
- **中**: それ以外

### 重要度スコアによる判定
- **最優先**: Gemini AIスコア 9-10点
- **高**: Gemini AIスコア 7-8点
- **中**: Gemini AIスコア 5-6点

---

## 📝 データ例

### 企業直接メールの場合
```
Title: 【株式会社サイバーエージェント】27卒会社説明会～本選考徹底解説編～
Deadline: 2025-09-15 17:00
Event Date: 2025-09-18 18:00
Notification Date: 2025-09-12 10:30
URL: https://example.com/apply
Description: 本選考の徹底解説。早期選考予約特典付き。
              【必要なアクション】
              - エントリーフォーム記入
              - 履歴書準備
Category: 説明会
Priority: 最優先
Status: 未対応
```

### 開催日のみのイベント
```
Title: AtCoder プログラミングコンテスト
Deadline: (空白)
Event Date: 2025-09-20 21:00
Notification Date: 2025-09-18 15:00
URL: https://atcoder.jp/contests/abc424
Description: AtCoder Beginner Contest 424
Category: 就活
Priority: 中
Status: 未対応
```

---

## 🚀 設定完了後の確認

### Step 1: テスト実行
```javascript
// Google Apps Scriptエディタで実行
debugToday()
```

### Step 2: Notionで確認
以下のフィールドにデータが入っているか確認：
- ✅ Deadline（締切があるイベント）
- ✅ Event Date（全イベント）
- ✅ Notification Date（全イベント）
- ✅ URL（URLがあるイベント）
- ✅ Description（全イベント）

### Step 3: エラーがある場合
ログを確認：
```
[WARN] Notion: プロパティ設定エラー
```

→ プロパティ名が正確に一致しているか確認してください（大文字小文字、スペース含む）

---

## 🔄 後方互換性

### Date フィールド（廃止予定）
- **現在**: 締切優先、なければ開催日を設定
- **将来**: Deadline と Event Date に完全移行予定
- **移行期間**: 当面は両方に値を設定

### 既存データへの影響
- **新規追加プロパティは既存データに影響しません**
- 既存のイベントには新しいフィールドは空白のまま
- 今後追加されるイベントから新フィールドに値が入ります

---

## 📌 よくある質問

### Q1: Deadlineが空白のイベントがある
**A**: 締切情報がないイベント（説明会、セミナー等）は空白になります。Event Dateを確認してください。

### Q2: URLが長すぎて見づらい
**A**: Notionのプロパティ設定で「URL as Card」を選択すると、カード形式で表示されます。

### Q3: Descriptionが2000文字を超える場合
**A**: 自動的に1997文字 + "..." に短縮されます。詳細はページ本文に記載されます。

---

実装日: 2025-10-13
バージョン: 2.2.0
修正内容: 日付フィールドの分離、URL・Description追加
