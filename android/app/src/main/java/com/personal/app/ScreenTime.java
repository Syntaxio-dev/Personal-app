package com.personal.app;

import android.app.ActivityManager;
import android.app.AppOpsManager;
import android.app.admin.DevicePolicyManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Process;
import android.os.SystemClock;
import android.provider.Settings;
import android.provider.Telephony;
import android.telecom.TelecomManager;
import android.view.inputmethod.InputMethodInfo;
import android.view.inputmethod.InputMethodManager;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;

/**
 * Screen time on the phone: how long each app was in front, the promises (limits and the sleep lock) and whether an
 * app is blocked right now. The promises live here, not in the web layer, so nothing typed into the app can undo them.
 * Rules without Android classes are in ScreenRules and Families. Everything stays on the phone.
 */
final class ScreenTime {
    private static final String PREFS = "prysm_screen";
    private static final long HOUR = 3600000L;
    private static final long CLOCK_TOLERANCE = 5 * 60000L;

    interface PkgFilter {
        boolean accept(String pkg);
    }

    private ScreenTime() {}

    static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ---------- what is switched on ----------
    static boolean hasUsageAccess(Context ctx) {
        AppOpsManager ops = (AppOpsManager) ctx.getSystemService(Context.APP_OPS_SERVICE);
        if (ops == null) return false;
        int mode;
        if (Build.VERSION.SDK_INT >= 29) {
            mode = ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.getPackageName());
        } else {
            mode = ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.getPackageName());
        }
        return mode == AppOpsManager.MODE_ALLOWED;
    }

    static boolean accessibilityEnabled(Context ctx) {
        try {
            String enabled = Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            ComponentName me = new ComponentName(ctx, PrysmAccessibilityService.class);
            return enabled != null && (enabled.contains(me.flattenToString()) || enabled.contains(me.flattenToShortString()));
        } catch (Exception e) {
            return false;
        }
    }

    static boolean listenerEnabled(Context ctx) {
        try {
            return NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.getPackageName());
        } catch (Exception e) {
            return false;
        }
    }

    static boolean adminActive(Context ctx) {
        try {
            DevicePolicyManager dpm = (DevicePolicyManager) ctx.getSystemService(Context.DEVICE_POLICY_SERVICE);
            return dpm != null && dpm.isAdminActive(new ComponentName(ctx, PrysmAdminReceiver.class));
        } catch (Exception e) {
            return false;
        }
    }

    // ---------- apps that are never counted or blocked ----------
    private static Set<String> protectedCache = null;
    private static long protectedAt = 0;

    /** System screens, the dialer, messages, the launcher and keyboards: never blocked, never counted as "use". */
    static synchronized Set<String> protectedPackages(Context ctx) {
        long now = System.currentTimeMillis();
        if (protectedCache != null && now - protectedAt < 60000) return protectedCache;
        Context app = ctx.getApplicationContext();
        Set<String> s = new HashSet<>();
        String[] fixed = {
                "android", "com.android.systemui", "com.android.settings", "com.android.phone", "com.android.server.telecom",
                "com.android.incallui", "com.android.dialer", "com.google.android.dialer", "com.android.contacts",
                "com.google.android.contacts", "com.android.mms", "com.google.android.apps.messaging", "com.android.emergency",
                "com.android.packageinstaller", "com.google.android.packageinstaller", "com.android.permissioncontroller",
                "com.google.android.permissioncontroller", "com.vivo.permissionmanager", "com.iqoo.secure", "com.vivo.upslide",
                "com.vivo.settings", "com.personal.app"
        };
        for (String p : fixed) s.add(p);
        try {
            TelecomManager tm = (TelecomManager) app.getSystemService(Context.TELECOM_SERVICE);
            if (tm != null && tm.getDefaultDialerPackage() != null) s.add(tm.getDefaultDialerPackage());
        } catch (Exception ignored) {
            // not critical
        }
        try {
            String sms = Telephony.Sms.getDefaultSmsPackage(app);
            if (sms != null) s.add(sms);
        } catch (Exception ignored) {
            // not critical
        }
        try {
            Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
            List<ResolveInfo> homes = app.getPackageManager().queryIntentActivities(home, 0);
            for (ResolveInfo r : homes) if (r.activityInfo != null) s.add(r.activityInfo.packageName);
        } catch (Exception ignored) {
            // not critical
        }
        try {
            InputMethodManager imm = (InputMethodManager) app.getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) {
                List<InputMethodInfo> list = imm.getInputMethodList();
                for (InputMethodInfo i : list) s.add(i.getPackageName());
            }
        } catch (Exception ignored) {
            // not critical
        }
        protectedCache = s;
        protectedAt = now;
        return s;
    }

    /** The home screen app(s): leaving to the launcher ends a block screen. */
    static boolean isHome(Context ctx, String pkg) {
        try {
            Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
            List<ResolveInfo> homes = ctx.getPackageManager().queryIntentActivities(home, 0);
            for (ResolveInfo r : homes) if (r.activityInfo != null && pkg.equals(r.activityInfo.packageName)) return true;
        } catch (Exception ignored) {
            // not critical
        }
        return false;
    }

    // ---------- browsers (their websites are covered too) ----------
    private static final List<String> KNOWN_BROWSERS = Arrays.asList(
            "com.android.chrome", "com.chrome.beta", "com.chrome.dev", "com.brave.browser", "com.microsoft.emmx", "org.mozilla.firefox",
            "org.mozilla.fenix", "com.sec.android.app.sbrowser", "com.opera.browser", "com.opera.mini.native", "com.duckduckgo.mobile.android",
            "com.vivo.browser", "com.android.browser", "mark.via.gp", "com.kiwibrowser.browser");
    private static Set<String> browserCache = null;
    private static long browserAt = 0;

    static synchronized boolean isBrowser(Context ctx, String pkg) {
        if (pkg == null) return false;
        if (KNOWN_BROWSERS.contains(pkg)) return true;
        long now = System.currentTimeMillis();
        if (browserCache == null || now - browserAt > 300000) {
            Set<String> s = new HashSet<>();
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("http://www.example.com")).addCategory(Intent.CATEGORY_BROWSABLE);
                List<ResolveInfo> l = ctx.getApplicationContext().getPackageManager().queryIntentActivities(i, PackageManager.MATCH_ALL);
                for (ResolveInfo r : l) if (r.activityInfo != null) s.add(r.activityInfo.packageName);
            } catch (Exception ignored) {
                // keep what we have
            }
            browserCache = s;
            browserAt = now;
        }
        return browserCache.contains(pkg) && !protectedPackages(ctx).contains(pkg);
    }

    // ---------- the clock nobody can move ----------
    private static ScreenRules.Clock clock = null;
    private static long clockSavedAt = 0;

    private static ScreenRules.Clock loadClock(Context ctx) {
        if (clock == null) {
            SharedPreferences p = prefs(ctx);
            clock = new ScreenRules.Clock();
            clock.trusted = p.getLong("clk_trusted", 0);
            clock.elapsed = p.getLong("clk_elapsed", 0);
            clock.boot = p.getLong("clk_boot", -1);
            clock.offset = p.getLong("clk_offset", 0);
        }
        return clock;
    }

    private static long bootCount(Context ctx) {
        try {
            return Settings.Global.getInt(ctx.getContentResolver(), Settings.Global.BOOT_COUNT, 0);
        } catch (Exception e) {
            return 0;
        }
    }

    /**
     * The real time in epoch millis. Moving the phone's date or time does not change it, because it moves with the
     * phone's uptime counter (see ScreenRules.step). Promises, days and the sleep window all use this clock.
     */
    static synchronized long now(Context ctx) {
        ScreenRules.Clock c = loadClock(ctx);
        long beforeOffset = c.offset, beforeBoot = c.boot;
        long t = ScreenRules.step(c, System.currentTimeMillis(), SystemClock.elapsedRealtime(), bootCount(ctx), CLOCK_TOLERANCE);
        if (c.offset != beforeOffset || c.boot != beforeBoot || Math.abs(t - clockSavedAt) > 30000) {
            prefs(ctx).edit().putLong("clk_trusted", c.trusted).putLong("clk_elapsed", c.elapsed).putLong("clk_boot", c.boot).putLong("clk_offset", c.offset).apply();
            clockSavedAt = t;
        }
        return t;
    }

    /** The wall clock time that corresponds to a trusted time (what usage events are stamped with). */
    static long wallTime(Context ctx, long trusted) {
        return trusted + loadClock(ctx).offset;
    }

    /** The time zone is frozen while a promise is running, so moving to another zone cannot move midnight. */
    static long tzOffset(Context ctx) {
        SharedPreferences p = prefs(ctx);
        long saved = p.getLong("tz", Long.MIN_VALUE);
        if (saved == Long.MIN_VALUE || !guardActive(ctx)) {
            long cur = TimeZone.getDefault().getOffset(System.currentTimeMillis());
            if (cur != saved) p.edit().putLong("tz", cur).apply();
            return cur;
        }
        return saved;
    }

    // ---------- the promises ----------
    private static String cfgRaw = null;
    private static JSONObject cfgObj = null;

    /** What the phone holds. Read only: never change the returned object. */
    static synchronized JSONObject config(Context ctx) {
        String raw = prefs(ctx).getString("config", "");
        if (cfgObj == null || !raw.equals(cfgRaw)) {
            try {
                cfgObj = raw.isEmpty() ? new JSONObject() : new JSONObject(raw);
            } catch (Exception e) {
                cfgObj = new JSONObject();
            }
            cfgRaw = raw;
        }
        return cfgObj;
    }

    /** True while at least one promise is locked: the settings that could undo it are guarded then. */
    static boolean guardActive(Context ctx) {
        return ScreenRules.anyLocked(config(ctx), now(ctx));
    }

    /** Is there any website to watch for? A limit on an app that has a website, or a switched-on sleep lock. */
    static boolean domainRules(Context ctx) {
        JSONObject cfg = config(ctx);
        JSONObject sleep = cfg.optJSONObject("sleep");
        if (sleep != null && sleep.optBoolean("on", true)) return true;
        JSONArray limits = cfg.optJSONArray("limits");
        if (limits != null) for (int i = 0; i < limits.length(); i++) {
            JSONObject l = limits.optJSONObject(i);
            if (l != null && l.optBoolean("on", true) && !Families.domainsOf(strings(l.optJSONArray("pkgs"))).isEmpty()) return true;
        }
        return false;
    }

    /** When the last locked promise ends (0 when nothing is locked). */
    static long lockEnd(Context ctx) {
        JSONObject cfg = config(ctx);
        long now = now(ctx), end = 0;
        JSONArray limits = cfg.optJSONArray("limits");
        if (limits != null) for (int i = 0; i < limits.length(); i++) {
            JSONObject l = limits.optJSONObject(i);
            if (ScreenRules.isLocked(l, now)) end = Math.max(end, l.optLong("lockUntil", 0));
        }
        JSONObject sleep = cfg.optJSONObject("sleep");
        if (ScreenRules.isLocked(sleep, now)) end = Math.max(end, sleep.optLong("lockUntil", 0));
        return end;
    }

    /** Applies a change request from the web layer. Returns what the phone kept (see decorate). */
    static JSONObject apply(Context ctx, JSONObject incoming) {
        JSONObject eff;
        int refused;
        synchronized (ScreenTime.class) {
            long now = now(ctx);
            JSONObject committed = config(ctx);
            boolean wasLocked = ScreenRules.anyLocked(committed, now);
            eff = ScreenRules.merge(committed, incoming, now);
            refused = eff.optInt("refused", 0);
            eff.remove("refused");
            SharedPreferences.Editor ed = prefs(ctx).edit().putString("config", eff.toString());
            if (!wasLocked) ed.putLong("tz", TimeZone.getDefault().getOffset(System.currentTimeMillis()));
            ed.apply();
        }
        return decorate(ctx, eff, refused);
    }

    /** The config for the web layer: each item also says whether it is locked and how much time it has used today. */
    static JSONObject decorate(Context ctx, JSONObject cfg, int refused) {
        JSONObject out = new JSONObject();
        long now = now(ctx);
        try {
            JSONArray limits = new JSONArray();
            JSONArray src = cfg.optJSONArray("limits");
            if (src != null) for (int i = 0; i < src.length(); i++) {
                JSONObject l = new JSONObject(src.getJSONObject(i).toString());
                l.put("locked", ScreenRules.isLocked(l, now));
                l.put("used", Math.round(usedMs(ctx, l) / 6000.0) / 10.0);
                limits.put(l);
            }
            out.put("limits", limits);
            JSONObject sl = cfg.optJSONObject("sleep");
            if (sl != null) {
                JSONObject copy = new JSONObject(sl.toString());
                copy.put("locked", ScreenRules.isLocked(sl, now));
                out.put("sleep", copy);
            } else {
                out.put("sleep", JSONObject.NULL);
            }
            out.put("motto", cfg.optString("motto", ""));
            out.put("now", now);
            out.put("refused", refused);
        } catch (Exception ignored) {
            // the web layer falls back to what it has
        }
        return out;
    }

    // ---------- who is covered ----------
    static boolean limitHasPkg(JSONObject limit, String pkg) {
        JSONArray a = limit.optJSONArray("pkgs");
        if (a == null || pkg == null) return false;
        for (int i = 0; i < a.length(); i++) {
            String p = a.optString(i, "");
            if (p.equals(pkg) || Families.sameFamily(p, pkg)) return true;
        }
        return false;
    }

    private static List<String> strings(JSONArray a) {
        List<String> out = new ArrayList<>();
        if (a != null) for (int i = 0; i < a.length(); i++) out.add(a.optString(i, ""));
        return out;
    }

    static boolean limitHasHost(JSONObject limit, String host) {
        return Families.anyDomainMatches(Families.domainsOf(strings(limit.optJSONArray("pkgs"))), host);
    }

    private static final Map<String, String> CATEGORY_CACHE = new HashMap<>();

    static synchronized String categoryOf(Context ctx, String pkg) {
        String c = CATEGORY_CACHE.get(pkg);
        if (c != null) return c;
        int declared = -1;
        boolean game = false;
        try {
            ApplicationInfo ai = ctx.getApplicationContext().getPackageManager().getApplicationInfo(pkg, 0);
            if (Build.VERSION.SDK_INT >= 26) declared = ai.category;
            game = (ai.flags & ApplicationInfo.FLAG_IS_GAME) != 0;
        } catch (Exception ignored) {
            // unknown app
        }
        c = Families.categoryOf(pkg, declared, game);
        CATEGORY_CACHE.put(pkg, c);
        return c;
    }

    static boolean sleepHasPkg(Context ctx, JSONObject sleep, String pkg) {
        if (pkg == null || protectedPackages(ctx).contains(pkg) || isBrowser(ctx, pkg)) return false;
        List<String> cats = strings(sleep.optJSONArray("cats"));
        String c = categoryOf(ctx, pkg);
        if (!c.isEmpty() && cats.contains(c)) return true;
        for (String p : strings(sleep.optJSONArray("extra"))) if (p.equals(pkg) || Families.sameFamily(p, pkg)) return true;
        return false;
    }

    static boolean sleepHasHost(JSONObject sleep, String host) {
        Set<String> d = Families.domainsOfCategories(strings(sleep.optJSONArray("cats")));
        d.addAll(Families.domainsOf(strings(sleep.optJSONArray("extra"))));
        return Families.anyDomainMatches(d, host);
    }

    // ---------- usage ----------
    static final class Day {
        long start;
        long total = 0;
        int pickups = 0;
        long[] hours = new long[24];
        Map<String, Long> apps = new HashMap<>();
    }

    private static void add(Day d, String pkg, long from, long to, long dayStart, long dayEnd, PkgFilter only) {
        long s = Math.max(from, dayStart);
        long t = Math.min(to, dayEnd);
        if (t <= s) return;
        if (only != null && !only.accept(pkg)) return;
        Long old = d.apps.get(pkg);
        d.apps.put(pkg, (old == null ? 0L : old) + (t - s));
        d.total += t - s;
        // spread over the hours it covers
        long cur = s;
        while (cur < t) {
            int h = (int) Math.min(23, (cur - dayStart) / HOUR);
            long hourEnd = dayStart + (h + 1) * HOUR;
            long part = Math.min(t, hourEnd) - cur;
            if (h == 23) part = t - cur;
            d.hours[h] += part;
            cur += Math.max(part, 1);
        }
    }

    /**
     * Foreground time per app between start and end (wall clock). Events are read from 3 hours earlier so an app that was
     * already open at the start is counted from the start. only: when not null, only packages it accepts are counted.
     */
    static Day compute(Context ctx, long start, long end, PkgFilter only) {
        Day d = new Day();
        d.start = start;
        long dayEnd = Math.min(end, System.currentTimeMillis());
        if (dayEnd <= start) return d;
        UsageStatsManager usm = (UsageStatsManager) ctx.getSystemService(Context.USAGE_STATS_SERVICE);
        if (usm == null) return d;
        Set<String> skip = protectedPackages(ctx);
        UsageEvents events = usm.queryEvents(start - 3 * HOUR, dayEnd);
        if (events == null) return d;
        UsageEvents.Event e = new UsageEvents.Event();
        Map<String, Long> open = new HashMap<>();
        Map<String, String> owner = new HashMap<>();
        while (events.hasNextEvent()) {
            events.getNextEvent(e);
            int type = e.getEventType();
            long t = e.getTimeStamp();
            String pkg = e.getPackageName();
            if (type == 1) { // activity resumed
                if (pkg == null || skip.contains(pkg)) continue;
                String key = pkg + "/" + e.getClassName();
                if (!open.containsKey(key)) {
                    open.put(key, t);
                    owner.put(key, pkg);
                }
            } else if (type == 2 || type == 23) { // activity paused / stopped
                if (pkg == null) continue;
                String key = pkg + "/" + e.getClassName();
                Long s = open.remove(key);
                if (s != null) add(d, owner.get(key), s, t, start, dayEnd, only);
            } else if (type == 16 || type == 26) { // screen off / shutdown: nothing stays open
                for (Map.Entry<String, Long> en : open.entrySet()) add(d, owner.get(en.getKey()), en.getValue(), t, start, dayEnd, only);
                open.clear();
            } else if (type == 15 && t >= start) { // screen on = one pickup
                d.pickups++;
            }
        }
        for (Map.Entry<String, Long> en : open.entrySet()) add(d, owner.get(en.getKey()), en.getValue(), dayEnd, start, dayEnd, only);
        return d;
    }

    /** One calendar day of the user's own (wall clock) calendar, for the graphs. */
    static Day compute(Context ctx, long dayStart, PkgFilter only) {
        return compute(ctx, dayStart, dayStart + 24 * HOUR, only);
    }

    static long startOfToday() {
        Calendar c = Calendar.getInstance();
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    static String dayKey(long ms) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(ms);
        return c.get(Calendar.YEAR) + "-" + (c.get(Calendar.MONTH) + 1) + "-" + c.get(Calendar.DAY_OF_MONTH);
    }

    /** Time a limit has used today, in millis: the larger of our own count and what Android reports. */
    static long usedMs(Context ctx, JSONObject limit) {
        long now = now(ctx), tz = tzOffset(ctx);
        long dayStart = ScreenRules.dayStart(now, tz);
        long own = prefs(ctx).getLong("used_" + limit.optString("id") + "_" + ScreenRules.dayNumber(now, tz), 0);
        long usage = 0;
        if (hasUsageAccess(ctx)) {
            try {
                long wallStart = wallTime(ctx, dayStart);
                usage = compute(ctx, wallStart, wallStart + (now - dayStart), p -> limitHasPkg(limit, p)).total;
            } catch (Exception ignored) {
                // our own count still stands
            }
        }
        return Math.max(own, usage);
    }

    /** Our own count: the blocking service adds the time a limited app (or website) was in front. */
    static void addUsed(Context ctx, Collection<String> limitIds, long ms) {
        if (ms <= 0 || limitIds == null || limitIds.isEmpty()) return;
        long day = ScreenRules.dayNumber(now(ctx), tzOffset(ctx));
        SharedPreferences p = prefs(ctx);
        SharedPreferences.Editor ed = p.edit();
        for (String id : limitIds) {
            String k = "used_" + id + "_" + day;
            ed.putLong(k, p.getLong(k, 0) + ms);
        }
        ed.apply();
    }

    // ---------- is it blocked right now? ----------
    static final class Verdict {
        boolean applies = false;     // some limit or the sleep lock covers this app / website
        boolean block = false;
        String kind = "";            // limit | night | sleep | guard
        String limitId = "";
        String name = "";
        String text = "";
        long lockUntil = 0;
        long msLeft = Long.MAX_VALUE; // time left on the tightest daily limit
        List<String> countIds = new ArrayList<>(); // limits whose daily time this foreground time counts for
    }

    /** host is the website a browser is showing (null for a normal app). */
    static Verdict check(Context ctx, String pkg, String host) {
        Verdict v = new Verdict();
        if (pkg == null) return v;
        if (host == null && protectedPackages(ctx).contains(pkg)) return v;
        JSONObject cfg = config(ctx);
        long now = now(ctx), tz = tzOffset(ctx);
        int minute = ScreenRules.minuteOfDay(now, tz);

        JSONObject sleep = cfg.optJSONObject("sleep");
        if (sleep != null && sleep.optBoolean("on", true)) {
            boolean has = sleepHasPkg(ctx, sleep, pkg) || (host != null && sleepHasHost(sleep, host));
            if (has) {
                v.applies = true;
                if (ScreenRules.inWindow(minute, ScreenRules.minutesOf(sleep.optString("from")), ScreenRules.minutesOf(sleep.optString("to")))) {
                    v.block = true;
                    v.kind = "sleep";
                    v.name = host != null ? host : labelOf(ctx, pkg);
                    v.text = sleep.optString("message", ScreenRules.DEFAULT_MESSAGE);
                    v.lockUntil = sleep.optLong("lockUntil", 0);
                    return v;
                }
            }
        }

        JSONArray limits = cfg.optJSONArray("limits");
        if (limits == null) return v;
        for (int i = 0; i < limits.length(); i++) {
            JSONObject l = limits.optJSONObject(i);
            if (l == null || !l.optBoolean("on", true)) continue;
            boolean has = limitHasPkg(l, pkg) || (host != null && limitHasHost(l, host));
            if (!has) continue;
            v.applies = true;
            String id = l.optString("id"), name = l.optString("name");
            JSONObject night = l.optJSONObject("night");
            if (night != null) {
                int from = ScreenRules.minutesOf(night.optString("from")), to = ScreenRules.minutesOf(night.optString("to"));
                if (ScreenRules.inWindow(minute, from, to)) {
                    v.block = true;
                    v.kind = "night";
                    v.limitId = id;
                    v.name = host != null ? host : labelOf(ctx, pkg);
                    v.text = "Night mode. This stays off until " + night.optString("to") + ".";
                    v.lockUntil = l.optLong("lockUntil", 0);
                    return v;
                }
            }
            int min = l.optInt("min", 0);
            if (min > 0) {
                long used = usedMs(ctx, l);
                long allowed = min * 60000L;
                if (used >= allowed) {
                    v.block = true;
                    v.kind = "limit";
                    v.limitId = id;
                    v.name = host != null ? host : labelOf(ctx, pkg);
                    v.text = "You used your " + formatMinutes(min) + " for today. It opens again at midnight.";
                    v.lockUntil = l.optLong("lockUntil", 0);
                    return v;
                }
                v.countIds.add(id);
                long left = allowed - used;
                if (left < v.msLeft) {
                    v.msLeft = left;
                    v.limitId = id;
                    v.name = name;
                }
            }
        }
        return v;
    }

    static String formatMinutes(int m) {
        if (m < 60) return m + " min";
        int h = m / 60, r = m % 60;
        return r == 0 ? h + " h" : h + " h " + r + " min";
    }

    static String labelOf(Context ctx, String pkg) {
        try {
            PackageManager pm = ctx.getPackageManager();
            return String.valueOf(pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)));
        } catch (Exception e) {
            return pkg;
        }
    }

    /** True when a notification from this app should be hidden: it is blocked right now (an inline reply would be a way in). */
    static boolean hideNotificationsOf(Context ctx, String pkg) {
        try {
            return check(ctx, pkg, null).block;
        } catch (Exception e) {
            return false;
        }
    }

    /** Frees a blocked app (stops what runs in its background). Does nothing to an app that is still in front. */
    static void killBackground(Context ctx, String pkg) {
        try {
            ActivityManager am = (ActivityManager) ctx.getApplicationContext().getSystemService(Context.ACTIVITY_SERVICE);
            if (am != null) am.killBackgroundProcesses(pkg);
        } catch (Exception ignored) {
            // not critical
        }
    }

    /** Runs every minute while the keep-alive service lives: shouts when something that holds a promise up has been switched off. */
    static void watchdog(Context ctx) {
        if (!guardActive(ctx)) {
            ScreenAlerts.cancel(ctx, ScreenAlerts.ID_BLOCKING);
            ScreenAlerts.cancel(ctx, ScreenAlerts.ID_ADMIN);
            return;
        }
        if (!accessibilityEnabled(ctx)) {
            ScreenAlerts.post(ctx, ScreenAlerts.ID_BLOCKING, "Blocking is off",
                    "Your limits are locked, but the Prysm accessibility service is off, so nothing is being blocked. Tap to turn it back on.",
                    new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
        } else {
            ScreenAlerts.cancel(ctx, ScreenAlerts.ID_BLOCKING);
        }
        if (!adminActive(ctx)) {
            ScreenAlerts.post(ctx, ScreenAlerts.ID_ADMIN, "Uninstall protection is off",
                    "Your limits are locked, but Prysm can be uninstalled. Turn device admin back on in Prysm > Screen time.",
                    new Intent(ctx, MainActivity.class));
        } else {
            ScreenAlerts.cancel(ctx, ScreenAlerts.ID_ADMIN);
        }
    }

    // ---------- settings pages that could undo a promise ----------
    /** Null when the screen is harmless (or nothing is locked), otherwise a short name of what is being protected. */
    static String guardPage(Context ctx, String pkg, String title, String cls, String text) {
        if (!guardActive(ctx)) return null;
        String page = ScreenRules.guardPage(pkg, title, cls, text);
        // usage access that is already off may be switched back on; it is only shut while it could be switched off
        if ("Usage access".equals(page) && !hasUsageAccess(ctx)) return null;
        return page;
    }

    // ---------- days Android no longer remembers ----------
    static JSObject toJson(Context ctx, Day d, JSObject names) {
        JSObject day = new JSObject();
        try {
            day.put("start", d.start);
            day.put("total", d.total / 60000.0);
            day.put("pickups", d.pickups);
            JSArray hours = new JSArray();
            for (int h = 0; h < 24; h++) hours.put(d.hours[h] / 60000.0);
            day.put("hours", hours);
            JSObject apps = new JSObject();
            for (Map.Entry<String, Long> en : d.apps.entrySet()) {
                if (en.getValue() < 30000L) continue;
                apps.put(en.getKey(), en.getValue() / 60000.0);
                if (!names.has(en.getKey())) names.put(en.getKey(), labelOf(ctx, en.getKey()));
            }
            day.put("apps", apps);
        } catch (Exception ignored) {
            // an empty day is better than a crash
        }
        return day;
    }

    /**
     * The usage events Android keeps only last a few days, so the blocking service saves each finished day here
     * (see snapshot). A day Android no longer remembers is answered from that copy.
     */
    static JSObject dayWithFallback(Context ctx, long start, JSObject names) {
        Day d = compute(ctx, start, null);
        if (d.total > 0) return toJson(ctx, d, names);
        String saved = prefs(ctx).getString("snap_" + start, "");
        if (!saved.isEmpty()) {
            try {
                JSObject day = new JSObject(saved);
                JSObject apps = day.getJSObject("apps");
                if (apps != null) {
                    java.util.Iterator<String> it = apps.keys();
                    while (it.hasNext()) {
                        String pkg = it.next();
                        if (!names.has(pkg)) names.put(pkg, labelOf(ctx, pkg));
                    }
                }
                return day;
            } catch (Exception ignored) {
                // fall through to the empty day
            }
        }
        return toJson(ctx, d, names);
    }

    /** Saves yesterday's numbers the first time something happens on a new day, and tidies old counters. */
    static void snapshot(Context ctx) {
        try {
            SharedPreferences p = prefs(ctx);
            String key = dayKey(System.currentTimeMillis());
            if (key.equals(p.getString("snapDay", ""))) return;
            if (!hasUsageAccess(ctx)) return;
            long yesterday = startOfToday() - 24 * HOUR;
            Day d = compute(ctx, yesterday, null);
            SharedPreferences.Editor ed = p.edit();
            if (d.total > 0) ed.putString("snap_" + yesterday, toJson(ctx, d, new JSObject()).toString());
            long today = ScreenRules.dayNumber(now(ctx), tzOffset(ctx));
            for (String k : p.getAll().keySet()) {
                try {
                    if (k.startsWith("snap_")) {
                        if (Long.parseLong(k.substring(5)) < yesterday - 30 * 24 * HOUR) ed.remove(k);
                    } else if (k.startsWith("used_")) {
                        long day = Long.parseLong(k.substring(k.lastIndexOf('_') + 1));
                        if (day < today - 3) ed.remove(k);
                    }
                } catch (Exception bad) {
                    ed.remove(k);
                }
            }
            ed.putString("snapDay", key).apply();
        } catch (Exception ignored) {
            // try again on the next event
        }
    }
}
