package com.personal.app;

import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.provider.Settings;

import org.json.JSONArray;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Payment-safe pause. Some payment and loan apps refuse to pay ("declined due to security reasons") while any
 * accessibility service that is not from the Play Store is switched on, and Prysm's blocking service is one.
 * While one of the chosen payment apps is in front, Prysm switches its own accessibility service OFF, and switches it
 * back ON the moment the user leaves that app. Needs the one-time WRITE_SECURE_SETTINGS grant (see ScreenTime.secureGranted).
 *
 * It must never become a way round a promise, so:
 *  - an app that any limit, sleep lock or focus session covers is never paused for (checked every time, not when it was added),
 *  - the pause ends the moment anything else than a payment app (or a system dialog) is in front, and after 20 minutes at most,
 *  - the pause ends when the screen goes off, and a stale pause (reboot, killed process) is ended by the watchdog,
 *  - system apps, the launcher, browsers and Settings can never be on the list.
 * It cannot cover the first moment: the service is still on until the window event has been handled (about a second).
 */
final class PaySafe {
    private static final String K_ON = "paysafe_on";
    private static final String K_PKGS = "paysafe_pkgs";
    private static final String K_AT = "paysafe_at";
    private static final String K_PKG = "paysafe_pkg";
    private static final long MAX_MS = 20 * 60000L;
    private static final long TICK_MS = 1200L;
    private static final int MAX_CUSTOM = 40;

    /** UPI and bank apps that are always covered when the feature is on. */
    static final String[] BUILT_IN = {
            "com.phonepe.app", "com.google.android.apps.nbu.paisa.user", "net.one97.paytm", "in.org.npci.upiapp",
            "com.dreamplug.androidapp", "com.mobikwik_new", "com.freecharge.android", "com.sbi.upi",
            "com.csam.icici.bank.imobile", "com.snapwork.hdfc", "com.axis.mobile"
    };

    /** System screens that show up in the middle of a payment (permission or chooser dialogs): they do not end the pause. */
    private static final Set<String> NEUTRAL = new HashSet<>(Arrays.asList(
            "android", "com.android.systemui", "com.google.android.permissioncontroller", "com.android.permissioncontroller",
            "com.android.intentresolver", "com.google.android.gms"
    ));

    private static final Handler H = new Handler(Looper.getMainLooper());
    private static Context appCtx = null;
    private static final Runnable WATCH = new Runnable() {
        @Override
        public void run() {
            Context c = appCtx;
            if (c == null) return;
            try {
                tick(c);
            } catch (Exception e) {
                try {
                    end(c, "error");
                } catch (Exception ignored) {
                    // the watchdog tries again
                }
            }
        }
    };

    private PaySafe() {}

    private static SharedPreferences prefs(Context c) {
        return ScreenTime.prefs(c);
    }

    // ---------- the setting ----------
    static boolean on(Context ctx) {
        return prefs(ctx).getBoolean(K_ON, false);
    }

    static List<String> custom(Context ctx) {
        List<String> out = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(prefs(ctx).getString(K_PKGS, "[]"));
            for (int i = 0; i < a.length(); i++) {
                String p = a.optString(i, "");
                if (!p.isEmpty()) out.add(p);
            }
        } catch (Exception ignored) {
            // empty list
        }
        return out;
    }

    static boolean covers(Context ctx, String pkg) {
        if (pkg == null) return false;
        for (String p : BUILT_IN) if (p.equals(pkg)) return true;
        return custom(ctx).contains(pkg);
    }

    /** Why an app cannot be on the list; null when it can. */
    static String refusal(Context ctx, String pkg) {
        if (ScreenTime.protectedPackages(ctx).contains(pkg) || ScreenTime.isBrowser(ctx, pkg) || ScreenTime.isHome(ctx, pkg)) return "System apps, browsers and the launcher cannot be added.";
        if (ScreenTime.check(ctx, pkg, null).applies) return "A limit, the sleep lock or a focus session covers this app, so blocking must stay on for it.";
        return null;
    }

    /** Saves the switch and the extra apps; returns the packages that were refused. */
    static List<String> save(Context ctx, boolean on, JSONArray pkgs) {
        List<String> refused = new ArrayList<>();
        JSONArray keep = new JSONArray();
        Set<String> seen = new HashSet<>();
        if (pkgs != null) {
            for (int i = 0; i < pkgs.length() && keep.length() < MAX_CUSTOM; i++) {
                String p = pkgs.optString(i, "").trim();
                if (p.isEmpty() || p.length() > 200 || !seen.add(p)) continue;
                boolean builtIn = false;
                for (String b : BUILT_IN) if (b.equals(p)) builtIn = true;
                if (builtIn) continue;
                // an app that is already on the list may stay even if a rule covers it now: begin() never pauses for it
                if (!custom(ctx).contains(p) && refusal(ctx, p) != null) {
                    refused.add(p);
                    continue;
                }
                keep.put(p);
            }
        }
        prefs(ctx).edit().putBoolean(K_ON, on).putString(K_PKGS, keep.toString()).apply();
        if (!on && paused(ctx)) end(ctx, "switched off");
        return refused;
    }

    // ---------- the pause ----------
    static boolean paused(Context ctx) {
        return prefs(ctx).getLong(K_AT, 0) != 0;
    }

    /**
     * Called by the blocking service whenever an app comes to the front. Returns true when it switched the service
     * off (the service is about to stop, nothing else should be done with this app).
     */
    static boolean begin(Context ctx, String pkg) {
        if (pkg == null) return false;
        if (paused(ctx)) {
            long age = SystemClock.elapsedRealtime() - prefs(ctx).getLong(K_AT, 0);
            if (age >= 0 && age < 4000) return true; // the service is on its way out
            // the service is still running although a pause was recorded: the switch did not work, forget it
            prefs(ctx).edit().remove(K_AT).remove(K_PKG).apply();
        }
        if (!on(ctx) || !covers(ctx, pkg)) return false;
        if (!ScreenTime.secureGranted(ctx) || !ScreenTime.hasUsageAccess(ctx)) return false;
        if (refusal(ctx, pkg) != null) return false; // a rule covers it: never pause
        if (!switchOff(ctx)) return false;
        prefs(ctx).edit().putLong(K_AT, SystemClock.elapsedRealtime()).putString(K_PKG, pkg).apply();
        ScreenTime.diag(ctx, "Payment-safe pause started for " + ScreenTime.labelOf(ctx, pkg) + " (blocking is off until you leave it)");
        schedule(ctx);
        return true;
    }

    private static void schedule(Context ctx) {
        appCtx = ctx.getApplicationContext();
        H.removeCallbacks(WATCH);
        H.postDelayed(WATCH, TICK_MS);
    }

    /** Looks at what is in front and ends the pause when it should end. Safe to call any time (the watchdog does). */
    static void tick(Context ctx) {
        long at = prefs(ctx).getLong(K_AT, 0);
        if (at == 0) return;
        long age = SystemClock.elapsedRealtime() - at;
        if (age < 0) { end(ctx, "phone restarted"); return; }
        if (age > MAX_MS) { end(ctx, "20 minutes passed"); return; }
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        if (pm != null && !pm.isInteractive()) { end(ctx, "screen off"); return; }
        if (!ScreenTime.hasUsageAccess(ctx)) { end(ctx, "usage access is off"); return; }
        String top = ScreenTime.topPackageByUsage(ctx, MAX_MS + 60000L);
        if (top != null && !covers(ctx, top) && !NEUTRAL.contains(top) && !top.equals(ctx.getPackageName())) {
            end(ctx, "you left the payment app");
            return;
        }
        if (top != null && top.equals(ctx.getPackageName())) { end(ctx, "back in Prysm"); return; }
        if (!on(ctx)) { end(ctx, "switched off"); return; }
        schedule(ctx);
    }

    static void end(Context ctx, String why) {
        prefs(ctx).edit().remove(K_AT).remove(K_PKG).apply();
        H.removeCallbacks(WATCH);
        boolean ok = ScreenTime.turnOnAccessibility(ctx, false);
        ScreenTime.diag(ctx, "Payment-safe pause ended (" + why + ")" + (ok ? "" : ": could not switch blocking back on"));
    }

    // ---------- switching our own accessibility service off ----------
    private static boolean switchOff(Context ctx) {
        try {
            ContentResolver cr = ctx.getContentResolver();
            String cur = Settings.Secure.getString(cr, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            StringBuilder others = new StringBuilder();
            if (cur != null) {
                for (String part : cur.split(":")) {
                    if (part.isEmpty() || ScreenTime.sameService(ctx, part)) continue;
                    if (others.length() > 0) others.append(':');
                    others.append(part);
                }
            }
            Settings.Secure.putString(cr, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, others.toString());
            if (others.length() == 0) Settings.Secure.putInt(cr, Settings.Secure.ACCESSIBILITY_ENABLED, 0);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
