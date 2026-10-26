import type { Messages } from "./en";

export const fil = {
  "common.unexpectedError": "May nagkaproblema sa aming panig. Subukan ulit.",
  "common.goToConsole": "Pumunta sa console",
  "common.tryAgain": "Subukan ulit",

  "language.label": "Wika",
  "language.current": "Wika: {language}",

  "env.development": "Development",
  "env.staging": "Staging",
  "env.production": "Production",

  "shell.brandSubtitle": "Business Console",
  "shell.nav": "Console",
  "shell.openMenu": "Buksan ang menu",
  "shell.menu": "Menu",
  "shell.menuDescription": "Mga seksyon ng console",
  "shell.account": "Account: {email}",
  "shell.signedInAs": "Naka-sign in bilang",
  "shell.signOut": "Mag-sign out",

  "nav.dashboard": "Dashboard",
  "nav.customers": "Mga customer",
  "nav.crm": "CRM",
  "nav.users": "Mga user",
  "nav.households": "Mga household",
  "nav.operations": "Operasyon",
  "nav.support": "Suporta",
  "nav.deletions": "Mga hiling na burahin",
  "nav.payouts": "Mga payout",
  "nav.ai": "Paggamit ng AI",
  "nav.billing": "Mga subscription",
  "nav.plans": "Mga plano",
  "nav.admin": "Admin",
  "nav.team": "Team",
  "nav.switches": "Mga global switch",
  "nav.audit": "Audit log",

  "root.notFoundTitle": "Hindi makita ang pahina",
  "root.notFoundBody": "Walang pahina sa address na ito sa console.",
  "root.errorTitle": "Hindi nag-load ang pahinang ito",
  "root.errorBody": "May nagkaproblema sa aming panig. Subukan ulit, o bumalik sa console.",

  "refresh.loaded": "Na-load {time}",
  "refresh.refresh": "I-refresh",
  "refresh.refreshing": "Nire-refresh",

  "list.noRows": "Walang laman",
  "list.showing": "Ipinapakita ang 1 hanggang {shown} sa {total}",
  "list.previous": "Nakaraan",
  "list.previousPage": "Nakaraang pahina",
  "list.next": "Susunod",
  "list.nextPage": "Susunod na pahina",
  "list.page": "Pahina {page}",

  "states.unavailable": "Hindi available",
  "states.restricted": "Restricted",
  "states.notCovered": "Hindi sakop ng iyong role ang screen na ito.",
  "states.askAdmin": "Magtanong sa isang admin kung kailangan mo ito.",
  "states.goToDashboard": "Pumunta sa dashboard",

  "export.csv": "I-export ang CSV",
  "export.notRecorded": "Hindi naitala ang export, kaya hindi ito tumuloy. Subukan ulit.",
  "export.downloaded": "Na-download ang CSV",
  "export.downloadedOne": "{name}, 1 row. Walang pangalan o contact details.",
  "export.downloadedMany": "{name}, {count} rows. Walang pangalan o contact details.",

  "form.choose": "Pumili",
  "form.working": "Ginagawa",
  "form.cancel": "Kanselahin",

  "hidden.hidden": "Nakatago",
  "hidden.notSet": "Wala pang nakatakda",
  "hidden.show": "Ipakita",
  "hidden.showing": "Ipinapakita",

  "charts.chart": "Chart",
  "charts.table": "Talahanayan",

  "auth.workEmail": "Work email",
  "auth.password": "Password",
  "auth.backToSignIn": "Bumalik sa sign in",
  "auth.checking": "Sinusuri",
  "auth.codeLabel": "Ang iyong two-step code",
  "auth.codeHint": "Ang 6-digit na code sa iyong authenticator app.",

  "signIn.title": "Mag-sign in sa Business Console",
  "signIn.description":
    "Gamitin ang iyong console work email. Hindi makakapag-sign in dito ang mga household account.",
  "signIn.forgot": "Nakalimutan ang password?",
  "signIn.signingIn": "Nagsa-sign in",
  "signIn.continue": "Magpatuloy",

  "twoStep.title": "Ilagay ang iyong code",
  "twoStep.description":
    "Buksan ang iyong authenticator app at ilagay ang code na ipinapakita nito para sa Linara Business Console.",
  "twoStep.otherAccount": "Gumamit ng ibang account",
  "twoStep.signIn": "Mag-sign in",
  "twoStep.lostPhone":
    "Nawala ang iyong phone? Hilingin sa ibang admin na i-reset ang iyong two-step sign-in.",

  "setUp.title": "I-set up ang two-step sign-in",
  "setUp.description":
    "Bawat admin ay nagsa-sign in gamit ang password at code mula sa kanilang phone. Mga isang minuto lang ito.",
  "setUp.install":
    "Mag-install ng authenticator app sa iyong phone, gaya ng Google Authenticator o Microsoft Authenticator.",
  "setUp.scan": "I-scan ang code na ito gamit ang app.",
  "setUp.qrAlt": "QR code para sa iyong authenticator app",
  "setUp.qrLoading": "Nilo-load ang QR code",
  "setUp.cantScan": "Hindi ma-scan? Ilagay na lang ang key na ito:",
  "setUp.enterCode": "Ilagay ang code na ipinapakita ng app.",
  "setUp.turnOn": "I-on ang two-step sign-in",

  "forgot.title": "I-reset ang iyong password",
  "forgot.description": "Ilagay ang iyong console work email at magpapadala kami ng reset link.",
  "forgot.sent":
    "Kung may console account ang {email}, papunta na ang reset link. Isang beses lang ito gagana at sa console na ito lang.",
  "forgot.sending": "Ipinapadala",
  "forgot.send": "Ipadala ang reset link",

  "setPassword.inviteTitle": "Maligayang pagdating sa Business Console",
  "setPassword.recoveryTitle": "Pumili ng bagong password",
  "setPassword.inviteDescription":
    "Pumili ng password para sa iyong console account. Susunod mong ise-set up ang two-step sign-in.",
  "setPassword.recoveryDescription": "Pumili ng bagong password para sa iyong console account.",
  "setPassword.mismatch": "Hindi magkatugma ang dalawang password.",
  "setPassword.changed": "Napalitan na ang password. Mag-sign in gamit ito ngayon.",
  "setPassword.newLink": "Humingi ng bagong link",
  "setPassword.expired": "Expired na o nagamit na ang link na ito. Humingi ng bago.",
  "setPassword.new": "Bagong password",
  "setPassword.minLength": "Hindi bababa sa 12 character.",
  "setPassword.again": "I-type ulit",
  "setPassword.saving": "Sine-save",
  "setPassword.saveContinue": "I-save at magpatuloy",
  "setPassword.save": "I-save ang password",
} satisfies Messages;
