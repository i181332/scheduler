# Smart Schedule Manager

Gmail → Gemini AI → Notion の自動スケジュール管理システム

## 概要

就活メールを自動で解析し、Notionデータベースに整理して保存するGoogle Apps Script (GAS) プロジェクトです。

### 主な機能

- **Gmail連携**: 就活関連メールを自動取得
- **AI解析**: Gemini AIでイベント情報を抽出（締切、開催日、優先度など）
- **Notion保存**: 抽出したイベントをNotionデータベースに自動登録
- **重複防止**: 既存イベントのチェック機能
- **自動実行**: 毎日8時に自動実行（トリガー設定可能）
- **状態管理**: 処理済みメールの追跡・管理

## アーキテクチャ

```
Gmail API
   ↓ (メール取得)
Gemini AI API
   ↓ (イベント解析・抽出)
Notion API
   ↓ (データベース保存)
Notionデータベース
```

## セットアップ

### 1. 必要な準備

- Googleアカウント
- Gemini API キー（[Google AI Studio](https://makersuite.google.com/app/apikey)）
- Notion アカウント
- Notion インテグレーション（[Notion Integrations](https://www.notion.so/my-integrations)）

### 2. claspのインストール

```bash
# Node.jsがインストールされていることを確認
node -v
npm -v

# claspをグローバルにインストール
npm install -g @google/clasp

# Googleアカウントでログイン
clasp login
```

### 3. Google Apps Script プロジェクトのセットアップ

#### 方法A: 既存プロジェクトを使う場合

1. [Google Apps Script](https://script.google.com/)で新規プロジェクトを作成
2. プロジェクトの設定から「スクリプトID」をコピー
3. `.clasp.json`を編集してスクリプトIDを設定：
   ```json
   {
     "scriptId": "YOUR_SCRIPT_ID",
     "rootDir": "."
   }
   ```
4. 本リポジトリをクローン：
   ```bash
   git clone https://github.com/i181332/scheduler.git
   cd scheduler
   ```
5. claspでプッシュ：
   ```bash
   clasp push
   ```

#### 方法B: 新規プロジェクトを作成する場合

1. 本リポジトリをクローン：
   ```bash
   git clone https://github.com/i181332/scheduler.git
   cd scheduler
   ```
2. 新規GASプロジェクトを作成：
   ```bash
   clasp create --type standalone --title "Smart Schedule Manager"
   ```
3. コードをプッシュ：
   ```bash
   clasp push
   ```

### 4. スクリプトプロパティの設定

Google Apps Scriptエディタで以下を設定：

1. `clasp open`でエディタを開く
2. 左メニューの「プロジェクトの設定」（⚙️アイコン）をクリック
3. 「スクリプト プロパティ」セクションで以下を追加：
   - `GEMINI_API_KEY`: Gemini APIキー
   - `NOTION_TOKEN`: Notionインテグレーショントークン
   - `NOTION_DATABASE_ID`: NotionデータベースID

### 5. Notionデータベースのセットアップ

詳細は[NOTION_SETUP.md](./NOTION_SETUP.md)を参照してください。

必要なプロパティ：
- Title (タイトル型)
- Deadline (Date型) - 申込締切
- Event Date (Date型) - 開催日
- Notification Date (Date型) - 通知日
- Category (セレクト型)
- Priority (セレクト型)
- Status (セレクト型)
- Source (セレクト型)
- Location (テキスト型)
- URL (URL型)
- Description (テキスト型)

### 6. 初回実行

```javascript
// セットアップ確認
checkSetup()

// テスト実行
debugToday()

// 自動トリガー設定
setupTrigger()
```

## 使い方

### 自動実行

`setupTrigger()`を実行すると、毎日8時に自動実行されます。

### 手動実行

```javascript
main()  // 通常実行
testRun()  // テスト実行
```

### デバッグ

```javascript
debugToday()  // 今日のメールのみ処理
debugRecentEmails()  // 最近7日間のメール確認
checkSetup()  // セットアップ状態確認
```

## ファイル構成

```
├── Main.gs              # メインロジック・エントリーポイント
├── Config.gs            # 設定ファイル
├── Gmail.gs             # Gmail API連携
├── Gemini.gs            # Gemini AI API連携
├── Notion.gs            # Notion API連携
├── StateManager.gs      # 状態管理（処理済みメール追跡）
├── Utils.gs             # ユーティリティ関数
├── appsscript.json      # GASマニフェストファイル
├── NOTION_SETUP.md      # Notionセットアップガイド
└── README.md            # このファイル
```

## 設定のカスタマイズ

`Config.gs`で以下の設定を変更可能：

- Gmailの検索クエリ
- Gemini AIのモデル・パラメータ
- Notionのプロパティ名
- カテゴリ・優先度のキーワード

## トラブルシューティング

### メールが取得できない

- Gmail検索クエリを確認
- プロモーション/ソーシャルラベルは除外されます

### Gemini AIでエラーが出る

- API キーが正しく設定されているか確認
- APIの利用制限を確認

### Notionに保存できない

- データベースIDが正しいか確認
- インテグレーションがデータベースに接続されているか確認
- プロパティ名が正確に一致しているか確認

## ライセンス

MIT License

## 開発者

yuta_matsuo

## バージョン

v2.2.0 (2025-10-13)

### 変更履歴

- v2.2.0: 日付フィールドの分離、URL・Description追加
- v2.0.0: Gemini AI統合、状態管理機能追加
- v1.0.0: 初回リリース
