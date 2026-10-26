import type { Messages } from "./en";

export const ja = {
  "common.unexpectedError": "こちらで問題が発生しました。もう一度お試しください。",
  "common.goToConsole": "コンソールへ移動",
  "common.tryAgain": "再試行",

  "language.label": "言語",
  "language.current": "言語：{language}",

  "env.development": "開発環境",
  "env.staging": "ステージング",
  "env.production": "本番環境",

  "shell.brandSubtitle": "Business Console",
  "shell.nav": "コンソール",
  "shell.openMenu": "メニューを開く",
  "shell.menu": "メニュー",
  "shell.menuDescription": "コンソールのセクション",
  "shell.account": "アカウント：{email}",
  "shell.signedInAs": "ログイン中のアカウント",
  "shell.signOut": "ログアウト",

  "nav.dashboard": "ダッシュボード",
  "nav.customers": "顧客",
  "nav.crm": "CRM",
  "nav.users": "ユーザー",
  "nav.households": "世帯",
  "nav.operations": "運用",
  "nav.support": "サポート",
  "nav.deletions": "削除リクエスト",
  "nav.payouts": "支払い",
  "nav.ai": "AI 使用状況",
  "nav.billing": "サブスクリプション",
  "nav.plans": "プラン",
  "nav.admin": "管理",
  "nav.team": "チーム",
  "nav.switches": "全体スイッチ",
  "nav.audit": "監査ログ",

  "root.notFoundTitle": "ページが見つかりません",
  "root.notFoundBody": "このアドレスのページはコンソールにありません。",
  "root.errorTitle": "このページを読み込めませんでした",
  "root.errorBody":
    "こちらで問題が発生しました。もう一度お試しいただくか、コンソールに戻ってください。",

  "refresh.loaded": "{time} に読み込み",
  "refresh.refresh": "更新",
  "refresh.refreshing": "更新中",

  "list.noRows": "データがありません",
  "list.showing": "{total} 件中 1〜{shown} 件を表示",
  "list.previous": "前へ",
  "list.previousPage": "前のページ",
  "list.next": "次へ",
  "list.nextPage": "次のページ",
  "list.page": "{page} ページ",

  "states.unavailable": "取得できません",
  "states.restricted": "アクセス制限",
  "states.notCovered": "あなたのロールではこの画面を利用できません。",
  "states.askAdmin": "必要な場合は管理者にお問い合わせください。",
  "states.goToDashboard": "ダッシュボードへ移動",

  "export.csv": "CSV をエクスポート",
  "export.notRecorded":
    "エクスポートを記録できなかったため、実行されませんでした。もう一度お試しください。",
  "export.downloaded": "CSV をダウンロードしました",
  "export.downloadedOne": "{name}、1 行。氏名や連絡先は含まれません。",
  "export.downloadedMany": "{name}、{count} 行。氏名や連絡先は含まれません。",

  "form.choose": "選択",
  "form.working": "処理中",
  "form.cancel": "キャンセル",

  "hidden.hidden": "非表示",
  "hidden.notSet": "未設定",
  "hidden.show": "表示",
  "hidden.showing": "表示中",

  "charts.chart": "グラフ",
  "charts.table": "表",

  "auth.workEmail": "業務用メールアドレス",
  "auth.password": "パスワード",
  "auth.backToSignIn": "ログインに戻る",
  "auth.checking": "確認中",
  "auth.codeLabel": "2 段階認証コード",
  "auth.codeHint": "認証アプリに表示される 6 桁のコード。",

  "signIn.title": "Business Console にログイン",
  "signIn.description":
    "コンソール用の業務用メールアドレスを使用してください。世帯アカウントではログインできません。",
  "signIn.forgot": "パスワードをお忘れですか？",
  "signIn.signingIn": "ログイン中",
  "signIn.continue": "続行",

  "twoStep.title": "コードを入力",
  "twoStep.description":
    "認証アプリを開き、Linara Business Console に表示されているコードを入力してください。",
  "twoStep.otherAccount": "別のアカウントを使用",
  "twoStep.signIn": "ログイン",
  "twoStep.lostPhone":
    "スマートフォンを紛失しましたか？ 他の管理者に 2 段階認証のリセットを依頼してください。",

  "setUp.title": "2 段階認証を設定",
  "setUp.description":
    "すべての管理者はパスワードとスマートフォンのコードでログインします。1 分ほどで完了します。",
  "setUp.install":
    "Google Authenticator や Microsoft Authenticator などの認証アプリをスマートフォンにインストールしてください。",
  "setUp.scan": "アプリでこのコードをスキャンしてください。",
  "setUp.qrAlt": "認証アプリ用の QR コード",
  "setUp.qrLoading": "QR コードを読み込み中",
  "setUp.cantScan": "スキャンできない場合は、こちらのキーを入力してください：",
  "setUp.enterCode": "アプリに表示されたコードを入力してください。",
  "setUp.turnOn": "2 段階認証をオンにする",

  "forgot.title": "パスワードをリセット",
  "forgot.description":
    "コンソール用の業務用メールアドレスを入力すると、リセット用のリンクをお送りします。",
  "forgot.sent":
    "{email} のコンソールアカウントがある場合、リセット用のリンクを送信しました。リンクは 1 回のみ、このコンソールでのみ使用できます。",
  "forgot.sending": "送信中",
  "forgot.send": "リセット用リンクを送信",

  "setPassword.inviteTitle": "Business Console へようこそ",
  "setPassword.recoveryTitle": "新しいパスワードを設定",
  "setPassword.inviteDescription":
    "コンソールアカウントのパスワードを設定してください。次に 2 段階認証を設定します。",
  "setPassword.recoveryDescription": "コンソールアカウントの新しいパスワードを設定してください。",
  "setPassword.mismatch": "2 つのパスワードが一致しません。",
  "setPassword.changed": "パスワードを変更しました。新しいパスワードでログインしてください。",
  "setPassword.newLink": "新しいリンクをリクエスト",
  "setPassword.expired":
    "このリンクは有効期限切れか、すでに使用されています。新しいリンクをリクエストしてください。",
  "setPassword.new": "新しいパスワード",
  "setPassword.minLength": "12 文字以上。",
  "setPassword.again": "もう一度入力",
  "setPassword.saving": "保存中",
  "setPassword.saveContinue": "保存して続行",
  "setPassword.save": "パスワードを保存",
} satisfies Messages;
