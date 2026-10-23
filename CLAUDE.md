# Prysm: personal offline life-tracker (Android APK)

Owner uses this on their own phone (6.7" screen, Android). No server, no Play Store. The phone is the database.
Money (salary, budgets, expenses), office attendance, daily tasks, reports, and auto-capture of UPI payments.

## Stack
- Vite + vanilla JS (no framework) in `src/`, wrapped by Capacitor 8 into an Android APK.
- Data: SQLite on the phone via `@capacitor-community/sqlite` (one JSON blob in table `kv`). Desktop browser falls back to localStorage (dev only). See `src/db.js`.
- Native Android code (Java) in `android/app/src/main/java/com/personal/app/`: `PaymentListenerService` (reads UPI notifications, shows the Add-expense overlay), `PaymentCapturePlugin` (bridge), `MainActivity`.
- Build: GitHub Actions (`.github/workflows/build-apk.yml`) produces `app-debug.apk`. This PC has no JDK/Android SDK.

## Commands
- `npm run dev` : preview at http://localhost:5173 (use browser mobile view, Ctrl+Shift+M)
- `npm run build` : web build into `dist/`
- `npx cap sync android` : copy web build and plugins into the Android project
- Desktop test of payment popup: console `__simulatePayment(250, 'Zomato')`

## Hard rules (do not break)
1. **Never push until the user says so.** Batch changes, commit/push only on request.
2. **Never change `appId` `com.personal.app`** (capacitor.config.json, build.gradle). A new id = a new app and all data is lost on update.
3. **Never change the signing key or its GitHub secrets** (`KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`). The key file lives outside the repo at `C:\Users\DELL\personal-app-keystore\`. A different key blocks in-place updates.
4. **Never rename the SQLite database `personalapp`** or the `kv`/`state` keys; only add fields to state. New state fields must get defaults in `normalize()` in `src/db.js`, so old data still loads.
5. Backup files from the old name (`app: "personal-app"`) must keep importing.
6. All UI text in English. Mobile first, then tablet/desktop via CSS breakpoints.
7. Never use native `alert/confirm/prompt`; use `ui.alert/ui.confirm/ui.prompt` (themed). OS permission prompts get a themed explainer first (`ensureNotifPermission`).
8. Make as few mistakes as possible: build (`npx vite build`) before saying done, and say plainly what was NOT tested (the Java side only compiles in CI).
9. Keep it Android-only and offline. No network calls, no analytics. Payment data stays on the phone.

## Design system: Pure Black AMOLED + Glass + Vibrant Purple
Tokens live in `src/style.css` (`:root`).

| Role | Value |
|---|---|
| Background | `#000000` |
| Glass card | `rgba(255,255,255,0.04)`, `backdrop-filter: blur(10px)`, border `1px rgba(255,255,255,0.06)`, radius 16px |
| Hero card | `linear-gradient(135deg,#7c3aed,#6d28d9)`, border `rgba(124,58,237,0.2)`, radius 20px, labels `#c4b5fd`, values `#fff` |
| Primary button | same purple gradient, white text, radius 12px |
| Secondary button | `rgba(255,255,255,0.06)` bg, `1px rgba(255,255,255,0.08)` border |
| Text | `#fff` headings/values, `rgba(255,255,255,0.7)` secondary, `rgba(255,255,255,0.35)` muted |
| Accent | `#a78bfa` (active tab, links), `#c4b5fd` (hero labels), tint `rgba(124,58,237,0.1)` |
| Semantic | Green `#4ade80` income/present, Red `#f87171` expense/absent, Yellow `#fbbf24` warning/half-day/pending, Indigo `#818cf8` leave |
| Status dots | 8px circle, `box-shadow: 0 0 8px` at 50% of its own colour |
| Ambient glow | top-right `rgba(124,58,237,0.25)` 200px, bottom-left `rgba(139,92,246,0.15)` 180px, fixed, `pointer-events:none` |
| Tab bar | `rgba(0,0,0,0.8)` + `blur(20px)`, 22px stroke icons, 10px labels, active `#a78bfa` |
| Sheets/dialogs | `rgba(20,20,20,0.95)` + `blur(20px)`, overlay `rgba(0,0,0,0.5)` with soft `blur(6px)` on the page behind |

Type: **Manrope** (800/700/600) for headings, big numbers, buttons and tab labels. **DM Sans** (400-700) for body text and labels. Bundled via `@fontsource`, so it works offline.
Labels: 11-12px uppercase, letter-spacing 1-1.5px. Headings 28px/800, hero numbers 38px/800 with negative tracking.

## Motion rules
- Easing `--ease: cubic-bezier(0.22,1,0.36,1)`; page content fade-up about 560ms, 70ms stagger per block (not too fast, not too slow).
- Tab change slides in the direction of travel (`fx-next`/`fx-prev`); month change is a quick fade; ticking a task does not re-animate the page.
- Budget bars grow from 0, hero amounts count up, sheets slide up (400ms), dialogs pop, all with closing animations.
- Everything respects `prefers-reduced-motion`.

## Tasks and reminders rules
- A ticked task leaves the pending list at once and shows under Completed (hidden by default) for 7 days.
- Task times are chosen with the time capsule (quick presets + steppers), never by typing.
- Notification ids are deterministic; never schedule notifications outside `syncNotifications()` so the schedule always matches the data.
- New state fields need defaults in `normalize()` (`src/db.js`).

## Attendance rules
- Statuses the user sets: Present, Half-day, Leave, Holiday. Absent is never chosen; it is the default for an unmarked, finished, tracked, non-off day (legacy "A" marks behave the same).
- Colours: Present green, Half-day yellow, Leave indigo, Holiday purple, Absent grey (grey = inactivity, deliberately not red).
- Counted days = Present + Half-day + Absent. Leave, Holiday, off-days, today and future days are neutral.
- `settings.attStart` must always be saved (see `ensureAttStart`), otherwise nothing would ever count as absent.

## Money rules
- Wallet = opening balance + income - expenses - money added to investments - money lent + investment withdrawals + money got back. Nothing is added automatically; `settings.salary` is legacy and only pre-fills `salaryAmount`.
- Records marked "already invested" / "given earlier" (`w === false`) do not touch the wallet when created.
- Paying a bill creates an expense (or an investment entry for a SIP) linked through `commitment.paid[YYYY-MM]`; deleting that entry un-pays the bill.
- Safe to spend = wallet minus unpaid bills due before the next salary date. Per-day limit is hidden while salary is overdue.
- All money notifications are built in `syncNotifications()` (`src/notify.js`).

## Dashboard rules
- Keep it minimal and breathable; never put export/import, long forms or charts on the dashboard.
- A widget is an id in `DASH_IDS` (`src/db.js`) with a renderer in `dashWidget()` (`src/main.js`); users hide/reorder them through `settings.dashOrder` and `settings.dashHidden`. Add new widgets in both places and in `DASH_WIDGETS`.
- Bottom tabs: Dashboard, Money, Attendance, Tasks, Goals (internal key for the dashboard is still `home`).

## Goals rules
- A goal is DUE from 20:00 on the last day of its period. Due goals (and bucket items past their deadline) open a **locked** sheet (`openModal(html, { locked: true })`, closable only with `closeModal(true)`); nothing else may replace it. It is checked on start, on resume and once a minute (the minute check never interrupts an open form).
- A missed or partly achieved goal needs a reason of at least 10 characters and a next step (retry / adjust / drop). Achieved goals with `repeat` start the next period automatically. Late reviews never create goals in the past (`upcomingPeriod`).
- Reviews live inside the goal (`goal.review`); `review.early` marks a goal dropped from the "Still relevant?" card and is excluded from hit-rate numbers.
- Goal-review notifications are always on; Settings only controls the weekly check-ins and the dream reminders.
- Bucket items must have a future deadline; moving a date needs a reason (`item.moves`).

## Navigation
Bottom tab bar (Home, Money, Attendance, Tasks, Reports) plus horizontal swipe between tabs (left = next). Swipe is ignored over inputs/charts, while a popup is open, and in the 28px screen edges (system back gesture).

## Payment capture (Android)
`PaymentListenerService` listens to notifications of PhonePe, GPay, Paytm, BHIM, CRED, Amazon, MobiKwik, Freecharge only. Outgoing-payment text becomes {amount, payee}. With "Display over other apps" it shows the Add-expense sheet over the current app; the confirmed item is stored natively and imported by JS on the next app open/resume (`syncPayments`). Without the overlay permission it posts a notification and the item waits in `inbox` for review. Needs: notification access, display over other apps, POST_NOTIFICATIONS. Android 13+ sideload: user must "Allow restricted settings". Play Protect may block install of this APK; user turns scan off temporarily.

## Release / update flow
Change code, commit, push (only when told) -> Actions "Build APK" -> download artifact `personal-app-apk` -> install over the old app (never uninstall). `versionCode` = GitHub run number.

## Versions and APK name
- **Single source of truth: `version` in `package.json`** (e.g. `1.2.0`). The app shows it as `v1.2` (Settings > About), Android `versionName` is `1.2`, and CI names the file **`Prysm-v1.2.apk`** (artifact `Prysm-v1.2`). To release the next version, bump only that one field (1.2.0 -> 1.3.0), then tag `v1.3` when pushing. `versionCode` is the GitHub run number.
- **v1.1**: Dashboard, Money (wallet, bills, investments, lent), Tasks (planner, overdue alerts, reports), Attendance (auto-absent, score), Goals & Bucket list with mandatory reviews, themed UI, payment capture hardening.
- **v1.3**: bills of two kinds (monthly installments, and one-time "I owe someone" debts with a fixed date), investments with return % and a monthly SIP that asks "did you pay?", online/cash on expenses and in the payment popup, white-hexagon notification icon, "did you pay it?" popups for SIPs and bills, home screen widgets (Quick add, Today, Attendance graph), 2 second test popups.
- **v1.2**: Prysm logo (launcher icon, splash, favicon, About), fit-to-screen fix, "App developed by Ayush", versioned APK name.

## Logo
- Source: `assets/prysm-logo.jpeg` (purple hexagon on black). All derived images (Android launcher icons, adaptive foreground, splash screens, Android 12 splash icon, `public/favicon.png`, `src/assets/logo.png`) are generated by `node scripts/make-icons.mjs` after `npm i --no-save sharp`. Do not hand-edit the generated PNGs.
- The adaptive-icon background is black (`values/ic_launcher_background.xml`); the launch theme sets a black splash background in `values/styles.xml`.

## Popups over other apps (native)
- `OverlayHost.java` draws every sheet over other apps through a **window context** (Android 11+); never add overlay views with the plain application context again.
- Payment sheet: `PaymentListenerService` -> `PaymentOverlay`. Plan tomorrow sheet: JS `pushPlan()` (via the `setSyncHook` hook in `notify.js`) calls `setPlan` -> `PlanScheduler` arms an exact alarm -> `PlanReceiver` -> `PlanOverlay` (or a notification when the overlay permission is off). Tasks typed there wait in prefs until JS calls `takePlanned`. On the phone the JS plan notification is switched off (`setNativePlan(true)`).
- `KeepAliveService` (foreground service, type specialUse, minimised notification) keeps the process alive; iQOO/Vivo, Xiaomi and Oppo freeze background apps and the popups silently stop without it. `BootReceiver` re-arms the plan alarm and the service after reboot and app updates.
- Settings has "Expense now" (overlay test while Prysm is open), "Over another app" (5 s delay) and "Plan tomorrow popup" tests. If only the first works, the phone is freezing the app: guide the user to App settings (pop-up windows, background pop-ups, autostart, battery no restrictions).

## Security
- CI builds a **release** APK (not debuggable) signed with the same key; WebView debugging is off (`capacitor.config.json`). Never go back to shipping debug builds.
- Backups are untrusted input: `importJson` runs `sanitize()` (drops malformed records, forces numbers and dates). Keep every user string going into HTML through `esc()`.
- No network calls; payment/SMS text only from whitelisted apps, OTP SMS text is never stored.

## Bills, SIPs and widgets
- Two bill kinds share `commitments`: monthly (`dueDay`, repeats) and one-time `kind: 'owed'` (`dueDate`, `person`; paid under key `once`, never in the monthly totals, see `owedFor`/`payKey` in `money.js`). Paying always goes through `settleBill()` in `moneyui.js`.
- A SIP lives on the investment (`investment.sip = { amount, day, start, on, done }`). Months before the current one are settled when the SIP is created (counted as already invested, `w: false`, or skipped). A due month is never added automatically: `askSips()` asks, and the native `ConfirmScheduler` popup asks at 09:00 on the day; answers are applied by `applyConfirm()` the next time the app opens.
- Installments: a loan commitment stores `total` (all installments) and `paidBefore` (paid before it was added); `endMonth = startMonth + total - paidBefore - 1`. Progress ("2 of 3 paid · 1 left") comes from `emiStats()`, which counts paid months inside the app plus `paidBefore`.
- Payment record: nothing about payments is ever deleted. `commitment.paidOn[key]` remembers the payment date. The main Bills page only shows settled items for 7 days (`isRecent`) and finished plans for 7 days ("Just completed"); everything else lives in "View all payments" (`paymentHistory()`, `completedEmis()`). The month summary card still counts every bill of the month.
- Transactions carry `mode: 'online' | 'cash'`; the payment popup can save an online part and a cash part in one go.
- Widgets (`QuickWidget`, `TodayWidget`, `AttendanceWidget`) only draw a snapshot: `widgetData()` in `main.js` is pushed with `setWidgetData` after every change (`queueWidgets`) and on each sync. A widget button sets `prysm_open` on the launch intent; `takePlanned()` returns it as `launch` and `runLaunch()` acts on it.
- Status-bar icons must be a white silhouette: `ic_stat_prysm` is generated by `scripts/make-icons.mjs`. Never use the coloured logo or a system icon for notifications.

## Layout safety
- Phones zoom the whole page out if anything is wider than the screen, even for an instant. The viewport has `minimum-scale=1` and `#view` has `overflow-x: clip` so slide animations can never widen the page. Do not remove either. After touching animations or tab bar, run the width check in the scratchpad tests (`smoke_fit.mjs`).

## Project log
- Scaffolded Capacitor + Vite, SQLite kv store, backup export/import.
- Screens: Home, Money (salary, entries, category budgets), Attendance (calendar), Tasks (priority, reminders), Reports (Chart.js).
- Redesign to black/glass/purple, responsive layouts (phone, tablet, desktop sidebar).
- UPI payment capture with over-other-apps expense sheet; stable signing key + incrementing versionCode in CI.
- Attendance: in/out time removed.
- Renamed app to **Prysm**; logo to be supplied by the owner and added later (replace launcher icons in `android/app/src/main/res/mipmap-*`).
- Motion pass, Manrope + DM Sans, swipe tab navigation, themed dialogs with blurred backdrop, date label made readable.
- Tasks page rebuilt: pending list grouped by day with separators, Completed filter (day-wise, auto-deleted after 7 days; counts kept in `taskHistory` so Reports stay correct), time capsule + quick-time picker, Plan tomorrow sheet.
- Night planner: daily notification at sleep time minus lead (Settings). Tap opens the Plan tomorrow sheet.
- Overdue rule: 1 day late = "missed" badge only; 2+ days late = urgent, 4 alerts a day (09:00, 13:00, 17:00, 21:00) until done. All notifications are rebuilt from saved data by `syncNotifications()` in `src/notify.js`.
- Settings page (gear icon in header): name, sleep time, planner lead, notification switches, payment-capture status/test/log, backup.
- Attendance rebuilt on `src/attendance.js`: unmarked past days = absent (grey), weekly-off days (Settings, default Sunday) and days before "Tracking since" are neutral, today stays open until midnight. Summary has Month/Overall switch, attendance %, streaks; Score (Habits-style smoothed) and History charts with a Day/Week/Month dropdown.
- Money rebuilt (`src/money.js` rules, `src/moneyui.js` UI): sub-tabs Overview | Bills | Invest | Lent. Running wallet that only changes when the user logs something (no automatic salary), Safe-to-spend, manual salary with a reminder from the day after salary day, monthly bills (loan EMI, family, fixed, SIP) with due reminders, investments, money lent, people tags on expenses, Zomato/other income sources, weekly summary and backup reminders. Not yet verified on a real phone.
- Home became the **Dashboard**: calm, spacious widgets (Wallet, Shortcuts, Tasks for today, Attendance, Bills due) that the user can hide and reorder (Customize sheet / Settings > Dashboard). The payment-capture card shows "N of 4 on" and disappears once all four permissions are granted. Backup export/import lives only in Settings.
- The Reports tab was removed. Charts live with their data: Money > Report (spending by category, income vs expenses), Tasks > Report (completion %, last 7 days), Attendance (Score and History).
- v1.2 (cont.): real popups over other apps for payments and the nightly planner (window-context overlays, exact alarm, keep-alive service, boot receiver), popup tests in Settings, release build, hostile-backup sanitising, bill-start fix, iQOO Z10x layout fixes.
- v1.2: logo everywhere, fit-to-screen fix (page used to widen during tab slide animations), developer credit, APK named `Prysm-vX.Y.apk` from `package.json`.
- Goals tab added (`src/goals.js` rules, `src/goalsui.js` UI): weekly/monthly/yearly/long-term goals (yes/no, count, number start->target), a **mandatory hard-block review** when a period ends (verdict, result, required reason + tags, required next step), a bucket list with deadlines and a monthly dream pick, a Journal (hit-rate chart, streak, top miss reasons), steps that become tasks (+1 on tick), and "Still relevant?" checks. Dashboard widgets `goals` and `bucket`. Not yet verified on a real phone (notifications).
- Payment capture hardened: also reads bank debit SMS notifications, logs every decision (Settings > View capture log), Test popup button, battery-exemption step, listener rebind. Not yet verified on a real phone.

## Next (owner will specify page by page)
Home, Money, Attendance, Tasks and Reports features are to be defined with the owner one page at a time.
