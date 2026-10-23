package com.personal.app;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.view.ContextThemeWrapper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Enforces the promises made in Prysm's Screen time page (daily limits, night windows and the sleep lock).
 *
 * What it looks at, and nothing else:
 *  - which app came to the front (the package name of a window change),
 *  - the address bar of web browsers, so a blocked service cannot simply be opened on its website,
 *  - the title and text of a few system screens (Settings, the installer) while a promise is locked, because those
 *    are the screens where the promise could be undone (accessibility, device admin, usage access, date and time,
 *    force stop, clear data, uninstall).
 * It never reads other apps, never stores what it sees and nothing leaves the phone.
 *
 * When something is blocked a full-screen "time is up" screen is drawn over it. It has no button that lets you in:
 * the only way off it is the home screen.
 */
public class PrysmAccessibilityService extends AccessibilityService {
    static PrysmAccessibilityService instance = null;

    private static final long TICK_MAX = 30000L;
    private static final long BROWSER_TICK = 3000L;
    private static final long SCAN_GAP = 400L;
    private static final int HOME_AFTER = 9;
    private static final int GUARD_HOME_AFTER = 4;
    private static final long BLOCK_MAX = 25000L;
    private static final String[] URL_IDS = {"url_bar", "url_field", "location_bar_edit_text", "mozac_browser_toolbar_url_view", "omnibarTextInput", "url", "search_box_text", "address_bar"};

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WindowManager wm;
    private View blockView = null;
    private String blockPkg = "";
    private long blockSince = 0;
    private String fgPkg = "";
    private boolean fgBrowser = false;
    private long accrueAt = 0;
    private List<String> counting = new ArrayList<>();
    private long lastEval = 0;
    private long lastScan = 0;
    private boolean screenOn = true;
    private boolean contentOn = false;
    private final Set<String> warned = new HashSet<>();
    private Runnable countdown = null;
    private String lastHost = null;      // the website last used for a decision
    private String lastRaw = null;       // what the address bar showed the last time it was read
    private String stickyHost = null;
    private long stickyAt = 0;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (fgPkg.isEmpty() || blockView != null) return;
            accrue();
            evaluate();
        }
    };

    // a block screen that has lost track of its app must not stay over the phone
    private final Runnable overlayWatch = new Runnable() {
        @Override
        public void run() {
            if (blockView == null) return;
            try {
                long age = SystemClock.uptimeMillis() - blockSince;
                if (age > BLOCK_MAX) {
                    goHome(null);
                    return;
                }
                AccessibilityNodeInfo root = getRootInActiveWindow();
                if (root != null) {
                    CharSequence p = root.getPackageName();
                    recycle(root);
                    if (p != null && age > 1500) {
                        String name = p.toString();
                        boolean left = !name.equals(blockPkg) && !name.equals(getPackageName())
                                && (ScreenTime.isHome(PrysmAccessibilityService.this, name) || !ScreenTime.protectedPackages(PrysmAccessibilityService.this).contains(name));
                        if (left) {
                            removeBlock();
                            return;
                        }
                    }
                }
            } catch (Exception ignored) {
                // keep watching
            }
            handler.postDelayed(this, 1500);
        }
    };

    // the phone woke up or was unlocked: find out which app is really in front and look at it
    private final Runnable syncForeground = new Runnable() {
        @Override
        public void run() {
            AccessibilityNodeInfo root = null;
            try {
                if (blockView != null) return;
                root = getRootInActiveWindow();
                if (root == null || root.getPackageName() == null) return;
                String pkg = root.getPackageName().toString();
                if (pkg.equals(getPackageName())) return;
                if (ScreenTime.isHome(PrysmAccessibilityService.this, pkg)) {
                    leaveForeground();
                    return;
                }
                if (ScreenTime.protectedPackages(PrysmAccessibilityService.this).contains(pkg)) return;
                lastEval = 0;
                onForeground(pkg, ScreenTime.isBrowser(PrysmAccessibilityService.this, pkg));
            } catch (Exception ignored) {
                // never disturb the phone
            } finally {
                recycle(root);
            }
        }
    };

    private final BroadcastReceiver screenReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            String a = i == null ? null : i.getAction();
            if (a == null) return;
            try {
                if (Intent.ACTION_SCREEN_OFF.equals(a)) {
                    accrue();
                    screenOn = false;
                    handler.removeCallbacks(tick);
                    removeBlock();
                } else if (Intent.ACTION_SCREEN_ON.equals(a) || Intent.ACTION_USER_PRESENT.equals(a)) {
                    screenOn = true;
                    accrueAt = SystemClock.elapsedRealtime();
                    handler.removeCallbacks(syncForeground);
                    handler.postDelayed(syncForeground, 500);
                } else {
                    // the date, the time or the time zone was changed: let the clock notice it right away
                    ScreenTime.now(c);
                    if (!fgPkg.isEmpty()) evaluate();
                }
            } catch (Exception ignored) {
                // never disturb the phone
            }
        }
    };

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
        wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        try {
            IntentFilter f = new IntentFilter();
            f.addAction(Intent.ACTION_SCREEN_OFF);
            f.addAction(Intent.ACTION_SCREEN_ON);
            f.addAction(Intent.ACTION_USER_PRESENT);
            f.addAction(Intent.ACTION_TIME_CHANGED);
            f.addAction(Intent.ACTION_TIMEZONE_CHANGED);
            f.addAction(Intent.ACTION_DATE_CHANGED);
            registerReceiver(screenReceiver, f);
        } catch (Exception ignored) {
            // the events still work without it
        }
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        screenOn = pm == null || pm.isInteractive();
        ScreenTime.snapshot(this);
        if (KeepAliveService.wanted(this)) KeepAliveService.start(this);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null) return;
        int type = event.getEventType();
        CharSequence cs = event.getPackageName();
        if (cs == null) return;
        String pkg = cs.toString();
        if (pkg.equals(getPackageName())) return;
        try {
            if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
                ScreenTime.snapshot(this);
                if (ScreenTime.isHome(this, pkg)) {
                    leaveForeground();
                    setContentEvents(false);
                    removeBlock();
                    return;
                }
                boolean guardPkg = ScreenRules.isGuardPackage(pkg);
                if (guardPkg) {
                    setContentEvents(ScreenTime.guardActive(this));
                    if (guardCheck(pkg, event)) return;
                }
                if (ScreenTime.protectedPackages(this).contains(pkg)) return;
                boolean browser = ScreenTime.isBrowser(this, pkg);
                setContentEvents(browser && ScreenTime.domainRules(this));
                onForeground(pkg, browser);
            } else if (type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
                long t = SystemClock.uptimeMillis();
                if (t - lastScan < SCAN_GAP) return;
                if (ScreenRules.isGuardPackage(pkg)) {
                    lastScan = t;
                    guardCheck(pkg, event);
                } else if (fgBrowser && pkg.equals(fgPkg) && blockView == null) {
                    lastScan = t;
                    // a new address in the bar: look again (the tick re-checks the time used every few seconds)
                    String raw = readHost();
                    if (raw == null ? lastRaw != null : !raw.equals(lastRaw)) evaluate();
                }
            }
        } catch (Exception ignored) {
            // never let a bug here disturb the phone
        }
    }

    @Override
    public void onInterrupt() {
        handler.removeCallbacks(tick);
        removeBlock();
    }

    @Override
    public boolean onUnbind(Intent intent) {
        cleanUp();
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        cleanUp();
        super.onDestroy();
    }

    private void cleanUp() {
        if (instance == this) instance = null;
        handler.removeCallbacksAndMessages(null);
        removeBlock();
        try {
            unregisterReceiver(screenReceiver);
        } catch (Exception ignored) {
            // not registered
        }
    }

    // ---------- what is in front ----------
    private void setContentEvents(boolean on) {
        if (on == contentOn) return;
        try {
            AccessibilityServiceInfo info = getServiceInfo();
            if (info == null) return;
            info.eventTypes = on ? (AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED | AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) : AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED;
            setServiceInfo(info);
            contentOn = on;
        } catch (Exception ignored) {
            // keep the old setting
        }
    }

    private void onForeground(String pkg, boolean browser) {
        accrue();
        if (blockView != null && !pkg.equals(blockPkg)) removeBlock();
        boolean changed = !pkg.equals(fgPkg);
        fgPkg = pkg;
        fgBrowser = browser;
        if (changed) {
            accrueAt = SystemClock.elapsedRealtime();
            stickyHost = null;
            lastRaw = null;
        }
        if (!changed && SystemClock.uptimeMillis() - lastEval < 2500) return;
        evaluate();
    }

    private void leaveForeground() {
        accrue();
        fgPkg = "";
        fgBrowser = false;
        stickyHost = null;
        lastRaw = null;
        counting = new ArrayList<>();
        handler.removeCallbacks(tick);
    }

    /** Adds the time since the last call to the limits the foreground app counts for. */
    private void accrue() {
        long now = SystemClock.elapsedRealtime();
        if (accrueAt > 0 && screenOn && blockView == null && !counting.isEmpty()) {
            long d = now - accrueAt;
            if (d > 0 && d < 10 * 60000L) ScreenTime.addUsed(this, counting, d);
        }
        accrueAt = now;
    }

    private void evaluate() {
        handler.removeCallbacks(tick);
        lastEval = SystemClock.uptimeMillis();
        if (fgPkg.isEmpty() || !screenOn || blockView != null) return;
        String host = null;
        if (fgBrowser) {
            String raw = readHost();
            lastRaw = raw;
            long t = SystemClock.uptimeMillis();
            if (raw != null) {
                stickyHost = raw;
                stickyAt = t;
                host = raw;
            } else if (stickyHost != null && t - stickyAt < 60000) {
                host = stickyHost;
            }
        }
        lastHost = host;
        ScreenTime.Verdict v = ScreenTime.check(this, fgPkg, host);
        counting = v.countIds;
        if (v.block) {
            String title = v.name.isEmpty() ? ScreenTime.labelOf(this, fgPkg) : v.name;
            showBlock(v.kind, fgPkg, title, v.text, v.lockUntil, HOME_AFTER, false, host == null);
            return;
        }
        long delay = -1;
        if (v.msLeft != Long.MAX_VALUE) {
            String key = v.limitId + "_" + ScreenRules.dayNumber(ScreenTime.now(this), ScreenTime.tzOffset(this));
            if (v.msLeft <= 5 * 60000L && !warned.contains(key)) {
                warned.add(key);
                int mins = (int) Math.max(1, Math.round(v.msLeft / 60000.0));
                Toast.makeText(getApplicationContext(), "Prysm: about " + mins + " min left today on " + (v.name.isEmpty() ? ScreenTime.labelOf(this, fgPkg) : v.name), Toast.LENGTH_LONG).show();
            }
            delay = Math.max(1000L, Math.min(TICK_MAX, v.msLeft + 300));
        } else if (v.applies) {
            delay = TICK_MAX; // a night or sleep window may start while the app is open
        }
        if (fgBrowser && ScreenTime.domainRules(this)) delay = delay < 0 ? BROWSER_TICK : Math.min(delay, BROWSER_TICK);
        if (delay > 0) handler.postDelayed(tick, delay);
    }

    // ---------- websites ----------
    private String readHost() {
        AccessibilityNodeInfo root = null;
        try {
            root = getRootInActiveWindow();
            if (root == null) return null;
            CharSequence p = root.getPackageName();
            if (p == null || !fgPkg.equals(p.toString())) return null;
            String text = findUrlText(root, fgPkg);
            String host = ScreenRules.hostOf(text);
            return host.isEmpty() ? null : host;
        } catch (Exception e) {
            return null;
        } finally {
            recycle(root);
        }
    }

    private String findUrlText(AccessibilityNodeInfo root, String pkg) {
        for (String id : URL_IDS) {
            List<AccessibilityNodeInfo> found = root.findAccessibilityNodeInfosByViewId(pkg + ":id/" + id);
            if (found == null) continue;
            String text = null;
            for (AccessibilityNodeInfo n : found) {
                if (text == null && n.getText() != null && n.getText().length() > 0) text = n.getText().toString();
                recycle(n);
            }
            if (text != null && !ScreenRules.hostOf(text).isEmpty()) return text;
        }
        return scanForUrl(root, 0, new int[]{300});
    }

    // a browser we do not know: the first text field (or a view named like a url bar) that holds an address
    private String scanForUrl(AccessibilityNodeInfo n, int depth, int[] budget) {
        if (n == null || budget[0] <= 0 || depth > 12) return null;
        budget[0]--;
        CharSequence t = n.getText();
        if (t != null && t.length() > 0) {
            String cls = n.getClassName() == null ? "" : n.getClassName().toString();
            String id = n.getViewIdResourceName() == null ? "" : n.getViewIdResourceName().toLowerCase(Locale.ROOT);
            if ((cls.contains("EditText") || id.contains("url") || id.contains("address")) && !ScreenRules.hostOf(t.toString()).isEmpty()) return t.toString();
        }
        for (int i = 0; i < n.getChildCount(); i++) {
            AccessibilityNodeInfo c = n.getChild(i);
            if (c == null) continue;
            String r = scanForUrl(c, depth + 1, budget);
            recycle(c);
            if (r != null) return r;
        }
        return null;
    }

    // ---------- settings pages that could undo a promise ----------
    private boolean guardCheck(String pkg, AccessibilityEvent event) {
        if (blockView != null || !ScreenTime.guardActive(this)) return false;
        AccessibilityNodeInfo root = null;
        try {
            StringBuilder title = new StringBuilder();
            if (event.getText() != null) for (CharSequence c : event.getText()) if (c != null) title.append(c).append(' ');
            root = getRootInActiveWindow();
            StringBuilder body = new StringBuilder();
            if (root != null) {
                CharSequence p = root.getPackageName();
                if (p != null && pkg.equals(p.toString())) {
                    if (title.length() == 0) title.append(windowTitle(root));
                    collectText(root, body, 0, new int[]{260});
                }
            }
            String cls = event.getClassName() == null ? "" : event.getClassName().toString();
            String page = ScreenTime.guardPage(this, pkg, title.toString(), cls, body.toString());
            if (page == null) return false;
            long until = ScreenTime.lockEnd(this);
            showBlock("guard", pkg, page, "This screen is locked until your promise ends" + (until > 0 ? " on " + formatDate(until) : "") + ". It is the way to undo your limits, so Prysm keeps it shut.", 0, GUARD_HOME_AFTER, false, false);
            return true;
        } catch (Exception e) {
            return false;
        } finally {
            recycle(root);
        }
    }

    private String windowTitle(AccessibilityNodeInfo root) {
        try {
            if (Build.VERSION.SDK_INT >= 24 && root.getWindow() != null && root.getWindow().getTitle() != null) return root.getWindow().getTitle().toString();
        } catch (Exception ignored) {
            // no title
        }
        return "";
    }

    private void collectText(AccessibilityNodeInfo n, StringBuilder sb, int depth, int[] budget) {
        if (n == null || budget[0] <= 0 || depth > 14) return;
        budget[0]--;
        CharSequence t = n.getText();
        if (t != null && t.length() > 0 && t.length() < 200) sb.append(t).append(' ');
        CharSequence d = n.getContentDescription();
        if (d != null && d.length() > 0 && d.length() < 200) sb.append(d).append(' ');
        for (int i = 0; i < n.getChildCount(); i++) {
            AccessibilityNodeInfo c = n.getChild(i);
            if (c == null) continue;
            collectText(c, sb, depth + 1, budget);
            recycle(c);
        }
    }

    @SuppressWarnings("deprecation")
    private static void recycle(AccessibilityNodeInfo n) {
        if (n == null) return;
        try {
            n.recycle();
        } catch (Exception ignored) {
            // already recycled
        }
    }

    // ---------- the block screen ----------
    private String formatDate(long trusted) {
        return new SimpleDateFormat("EEE, d MMM yyyy", Locale.ENGLISH).format(new Date(ScreenTime.wallTime(this, trusted)));
    }

    /** A preview of the block screen (it can be closed). Returns false when the service is not running. */
    static boolean preview(final String kind) {
        final PrysmAccessibilityService s = instance;
        if (s == null) return false;
        s.handler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    s.removeBlock();
                    if ("sleep".equals(kind)) {
                        s.showBlock("sleep", "preview", "Instagram", ScreenTime.config(s).optJSONObject("sleep") == null ? ScreenRules.DEFAULT_MESSAGE : ScreenTime.config(s).optJSONObject("sleep").optString("message", ScreenRules.DEFAULT_MESSAGE), 0, 0, true, false);
                    } else {
                        s.showBlock("limit", "preview", "Instagram", "You used your 30 min for today. It opens again at midnight.", 0, 0, true, false);
                    }
                } catch (Exception ignored) {
                    // nothing to show
                }
            }
        });
        return true;
    }

    private void showBlock(String kind, final String pkg, String title, String body, long lockUntil, int homeAfter, final boolean preview, boolean killApp) {
        if (blockView != null) return;
        if (wm == null) wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        final Context ui = new ContextThemeWrapper(this, android.R.style.Theme_DeviceDefault_NoActionBar);
        final boolean sleep = "sleep".equals(kind);

        LinearLayout root = new LinearLayout(ui);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.BLACK);
        int pad = OverlayHost.dp(ui, 28);
        root.setPadding(pad, pad, pad, pad);

        String tagText = "limit".equals(kind) ? "TIME IS UP" : "night".equals(kind) ? "NIGHT MODE" : sleep ? "SLEEP TIME" : "LOCKED";
        TextView tag = OverlayHost.label(ui, tagText);
        tag.setGravity(Gravity.CENTER);
        root.addView(tag);

        TextView name = OverlayHost.title(ui, title);
        name.setTextSize(28);
        name.setGravity(Gravity.CENTER);
        root.addView(name);

        TextView text = sleep ? OverlayHost.title(ui, body) : OverlayHost.muted(ui, body);
        if (sleep) text.setTextSize(26);
        else text.setTextSize(16);
        text.setGravity(Gravity.CENTER);
        root.addView(text);

        TextView quote = OverlayHost.muted(ui, "“" + (sleep ? Quotes.sleep() : Quotes.random()) + "”");
        quote.setTextColor(0xFFC4B5FD);
        quote.setTextSize(17);
        quote.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.ITALIC));
        quote.setGravity(Gravity.CENTER);
        root.addView(quote, OverlayHost.gapTop(ui, 28));

        String motto = ScreenTime.config(this).optString("motto", "");
        if (!motto.isEmpty()) {
            TextView why = OverlayHost.muted(ui, "Your why: " + motto);
            why.setTextSize(14);
            why.setGravity(Gravity.CENTER);
            root.addView(why, OverlayHost.gapTop(ui, 16));
        }

        if (lockUntil > 0) {
            TextView lock = OverlayHost.muted(ui, "Your promise holds until " + formatDate(lockUntil));
            lock.setTextSize(13);
            lock.setGravity(Gravity.CENTER);
            root.addView(lock, OverlayHost.gapTop(ui, 16));
        }

        TextView home = OverlayHost.button(ui, preview ? "Close preview" : "Go home", true);
        root.addView(home, OverlayHost.gapTop(ui, 30));
        final TextView auto = OverlayHost.muted(ui, "");
        auto.setGravity(Gravity.CENTER);
        auto.setTextSize(13);
        root.addView(auto, OverlayHost.gapTop(ui, 16));

        final boolean kill = killApp && !preview;
        home.setOnClickListener(x -> {
            if (preview) removeBlock();
            else goHome(kill ? pkg : null);
        });

        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.OPAQUE);
        lp.gravity = Gravity.TOP | Gravity.START;
        if (Build.VERSION.SDK_INT >= 28) lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        try {
            wm.addView(root, lp);
        } catch (Exception e) {
            // could not draw over the app: at least send the user home
            if (!preview) goHome(kill ? pkg : null);
            return;
        }
        blockView = root;
        blockPkg = pkg;
        blockSince = SystemClock.uptimeMillis();
        handler.postDelayed(overlayWatch, 1500);
        // the app is no longer "the app in front": if the user comes back to it (Recents, the same icon again) the
        // window change is looked at in full, never skipped as "just checked"
        leaveForeground();

        if (!preview && homeAfter > 0) {
            final int[] left = {homeAfter};
            auto.setText("Taking you home in " + left[0] + " s");
            countdown = new Runnable() {
                @Override
                public void run() {
                    if (blockView == null) return;
                    left[0]--;
                    if (left[0] <= 0) {
                        goHome(kill ? pkg : null);
                        return;
                    }
                    auto.setText("Taking you home in " + left[0] + " s");
                    handler.postDelayed(this, 1000);
                }
            };
            handler.postDelayed(countdown, 1000);
        }
    }

    private void goHome(final String killPkg) {
        removeBlock();
        leaveForeground();
        setContentEvents(false);
        performGlobalAction(GLOBAL_ACTION_HOME);
        if (killPkg != null) {
            handler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    ScreenTime.killBackground(PrysmAccessibilityService.this, killPkg);
                }
            }, 800);
        }
    }

    private void removeBlock() {
        handler.removeCallbacks(overlayWatch);
        if (countdown != null) handler.removeCallbacks(countdown);
        countdown = null;
        if (blockView != null && wm != null) {
            try {
                wm.removeViewImmediate(blockView);
            } catch (Exception ignored) {
                // already gone
            }
        }
        blockView = null;
        blockPkg = "";
    }
}
