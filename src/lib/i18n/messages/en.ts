/**
 * English, the default and the source for every other language (D42). A key
 * added here has to be added to each language too, or the typecheck fails.
 * `{name}` is filled in when the text is shown.
 */
export const en = {
  "common.unexpectedError": "Something went wrong on our side. Try again.",
  "common.goToConsole": "Go to the console",
  "common.tryAgain": "Try again",

  "language.label": "Language",
  "language.current": "Language: {language}",

  "env.development": "Development",
  "env.staging": "Staging",
  "env.production": "Production",

  "shell.brandSubtitle": "Business Console",
  "shell.nav": "Console",
  "shell.openMenu": "Open menu",
  "shell.menu": "Menu",
  "shell.menuDescription": "Console sections",
  "shell.account": "Account: {email}",
  "shell.signedInAs": "Signed in as",
  "shell.signOut": "Sign out",

  "nav.dashboard": "Dashboard",
  "nav.customers": "Customers",
  "nav.crm": "CRM",
  "nav.users": "Users",
  "nav.households": "Households",
  "nav.operations": "Operations",
  "nav.support": "Support",
  "nav.deletions": "Deletion requests",
  "nav.payouts": "Payouts",
  "nav.ai": "AI usage",
  "nav.billing": "Subscriptions",
  "nav.plans": "Plans",
  "nav.admin": "Admin",
  "nav.team": "Team",
  "nav.switches": "Global switches",
  "nav.audit": "Audit log",

  "root.notFoundTitle": "Page not found",
  "root.notFoundBody": "There's no page at this address in the console.",
  "root.errorTitle": "This page didn't load",
  "root.errorBody": "Something went wrong on our end. Try again, or go back to the console.",

  "refresh.loaded": "Loaded {time}",
  "refresh.refresh": "Refresh",
  "refresh.refreshing": "Refreshing",

  "list.noRows": "No rows",
  "list.showing": "Showing 1 to {shown} of {total}",
  "list.previous": "Previous",
  "list.previousPage": "Previous page",
  "list.next": "Next",
  "list.nextPage": "Next page",
  "list.page": "Page {page}",

  "states.unavailable": "Unavailable",
  "states.restricted": "Restricted",
  "states.notCovered": "Your role doesn't cover this screen.",
  "states.askAdmin": "Ask an admin if you need it.",
  "states.goToDashboard": "Go to the dashboard",

  "export.csv": "Export CSV",
  "export.notRecorded": "The export couldn't be recorded, so it didn't run. Try again.",
  "export.downloaded": "CSV downloaded",
  "export.downloadedOne": "{name}, 1 row. No names or contact details.",
  "export.downloadedMany": "{name}, {count} rows. No names or contact details.",

  "form.choose": "Choose",
  "form.working": "Working",
  "form.cancel": "Cancel",

  "hidden.hidden": "Hidden",
  "hidden.notSet": "Not set",
  "hidden.show": "Show",
  "hidden.showing": "Showing",

  "charts.chart": "Chart",
  "charts.table": "Table",

  "auth.workEmail": "Work email",
  "auth.password": "Password",
  "auth.backToSignIn": "Back to sign in",
  "auth.checking": "Checking",
  "auth.codeLabel": "Your two-step code",
  "auth.codeHint": "The 6-digit code in your authenticator app.",

  "signIn.title": "Sign in to the Business Console",
  "signIn.description": "Use your console work email. Household accounts can't sign in here.",
  "signIn.forgot": "Forgot your password?",
  "signIn.signingIn": "Signing in",
  "signIn.continue": "Continue",

  "twoStep.title": "Enter your code",
  "twoStep.description":
    "Open your authenticator app and enter the code it shows for Linara Business Console.",
  "twoStep.otherAccount": "Use a different account",
  "twoStep.signIn": "Sign in",
  "twoStep.lostPhone": "Lost your phone? Ask another admin to reset your two-step sign-in.",

  "setUp.title": "Set up two-step sign-in",
  "setUp.description":
    "Every admin signs in with a password and a code from their phone. This takes about a minute.",
  "setUp.install":
    "Install an authenticator app on your phone, such as Google Authenticator or Microsoft Authenticator.",
  "setUp.scan": "Scan this code with the app.",
  "setUp.qrAlt": "QR code for your authenticator app",
  "setUp.qrLoading": "Loading the QR code",
  "setUp.cantScan": "Can't scan it? Enter this key instead:",
  "setUp.enterCode": "Enter the code the app shows.",
  "setUp.turnOn": "Turn on two-step sign-in",

  "forgot.title": "Reset your password",
  "forgot.description": "Enter your console work email and we'll send a reset link.",
  "forgot.sent":
    "If {email} has a console account, a reset link is on its way. It works once and only on this console.",
  "forgot.sending": "Sending",
  "forgot.send": "Send reset link",

  "setPassword.inviteTitle": "Welcome to the Business Console",
  "setPassword.recoveryTitle": "Choose a new password",
  "setPassword.inviteDescription":
    "Choose a password for your console account. Next you'll set up two-step sign-in.",
  "setPassword.recoveryDescription": "Choose a new password for your console account.",
  "setPassword.mismatch": "The two passwords don't match.",
  "setPassword.changed": "Password changed. Sign in with it now.",
  "setPassword.newLink": "Ask for a new link",
  "setPassword.expired": "This link has expired or was already used. Ask for a new one.",
  "setPassword.new": "New password",
  "setPassword.minLength": "At least 12 characters.",
  "setPassword.again": "Type it again",
  "setPassword.saving": "Saving",
  "setPassword.saveContinue": "Save and continue",
  "setPassword.save": "Save password",
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
