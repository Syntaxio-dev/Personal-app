package com.personal.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PaymentCapture")
public class PaymentCapturePlugin extends Plugin {

    private JSObject flag(boolean on) {
        JSObject r = new JSObject();
        r.put("enabled", on);
        return r;
    }

    private void launch(String action, boolean withPackage) {
        Intent i = withPackage
                ? new Intent(action, Uri.parse("package:" + getContext().getPackageName()))
                : new Intent(action);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
    }

    @PluginMethod
    public void isEnabled(PluginCall call) {
        Context ctx = getContext();
        boolean on = NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.getPackageName());
        if (on && Build.VERSION.SDK_INT >= 24) {
            try {
                // nudges Android to reconnect the listener if the system dropped it
                NotificationListenerService.requestRebind(new ComponentName(ctx, PaymentListenerService.class));
            } catch (Exception ignored) {
                // not critical
            }
        }
        call.resolve(flag(on));
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        launch(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS, false);
        call.resolve();
    }

    @PluginMethod
    public void hasOverlay(PluginCall call) {
        call.resolve(flag(Settings.canDrawOverlays(getContext())));
    }

    @PluginMethod
    public void openOverlaySettings(PluginCall call) {
        launch(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, true);
        call.resolve();
    }

    @PluginMethod
    public void isIgnoringBattery(PluginCall call) {
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        call.resolve(flag(pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName())));
    }

    @PluginMethod
    public void requestIgnoreBattery(PluginCall call) {
        launch(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, true);
        call.resolve();
    }

    /** Shows the expense sheet after an optional delay so the user can switch to another app first. */
    @PluginMethod
    public void testOverlay(PluginCall call) {
        final Context app = getContext().getApplicationContext();
        if (!Settings.canDrawOverlays(app)) {
            call.reject("Display over other apps is off");
            return;
        }
        int delay = call.getInt("delayMs", 0);
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            try {
                if (!PaymentOverlay.isShowing()) {
                    PaymentOverlay.show(app, 1, "Test payment", System.currentTimeMillis(), true);
                }
                PaymentListenerService.log(app, "prysm", null, "test popup shown");
            } catch (Exception e) {
                PaymentListenerService.log(app, "prysm", null, "test popup failed: " + e);
            }
        }, delay);
        call.resolve();
    }

    /** Returns payments seen since the last call and clears them, so each is handed over once. */
    @PluginMethod
    public void takePending(PluginCall call) {
        try {
            JSArray items = new JSArray(PaymentListenerService.readPending(getContext()).toString());
            PaymentListenerService.clearPending(getContext());
            JSObject r = new JSObject();
            r.put("items", items);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Could not read payments", e);
        }
    }

    // ---------- nightly "Plan tomorrow" popup ----------
    @PluginMethod
    public void setPlan(PluginCall call) {
        try {
            JSArray titles = call.getArray("titles", new JSArray());
            PlanScheduler.configure(getContext(), Boolean.TRUE.equals(call.getBoolean("on", false)),
                    call.getInt("hour", 22), call.getInt("minute", 30), call.getString("name", ""),
                    call.getString("date", ""), titles);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not schedule the plan popup", e);
        }
    }

    /** Tasks typed into the plan popup since the last call, and whether the user tapped the plan notification. */
    @PluginMethod
    public void takePlanned(PluginCall call) {
        try {
            JSObject r = new JSObject();
            r.put("items", new JSArray(PlanScheduler.takePending(getContext()).toString()));
            String launch = PlanScheduler.prefs(getContext()).getString("launch", "");
            if (!launch.isEmpty()) PlanScheduler.prefs(getContext()).edit().putString("launch", "").apply();
            r.put("launch", launch);
            String shared = PlanScheduler.prefs(getContext()).getString("shared", "");
            if (!shared.isEmpty()) PlanScheduler.prefs(getContext()).edit().putString("shared", "").apply();
            r.put("shared", shared);
            r.put("openPlan", "plan".equals(launch));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Could not read planned tasks", e);
        }
    }

    @PluginMethod
    public void testPlanOverlay(PluginCall call) {
        final Context app = getContext().getApplicationContext();
        if (!Settings.canDrawOverlays(app)) {
            call.reject("Display over other apps is off");
            return;
        }
        int delay = call.getInt("delayMs", 0);
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            try {
                if (!PlanOverlay.isShowing()) PlanOverlay.show(app);
                PaymentListenerService.log(app, "prysm", null, "test plan popup shown");
            } catch (Exception e) {
                PaymentListenerService.log(app, "prysm", null, "test plan popup failed: " + e);
            }
        }, delay);
        call.resolve();
    }

    // ---------- "did you pay it?" popups for SIPs and bills ----------
    @PluginMethod
    public void setConfirms(PluginCall call) {
        try {
            ConfirmScheduler.configure(getContext(), call.getArray("items", new JSArray()));
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not schedule the reminders", e);
        }
    }

    @PluginMethod
    public void takeConfirms(PluginCall call) {
        try {
            JSObject r = new JSObject();
            r.put("items", new JSArray(ConfirmScheduler.takeResults(getContext()).toString()));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Could not read the answers", e);
        }
    }

    // ---------- home screen widgets ----------
    @PluginMethod
    public void setWidgetData(PluginCall call) {
        String json = call.getString("json", "{}");
        WidgetKit.save(getContext(), json);
        call.resolve();
    }

    // ---------- keep the process alive on aggressive phones ----------
    @PluginMethod
    public void setKeepAlive(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        if (!on && ScreenTime.guardActive(getContext())) {
            call.reject("Locked while your limits are locked");
            return;
        }
        KeepAliveService.setWanted(getContext().getApplicationContext(), on);
        call.resolve();
    }

    /** The app's own settings page; on iQOO/Vivo, Xiaomi and Oppo the extra pop-up permissions live here. */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        launch(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, true);
        call.resolve();
    }

    // ---------- a small buzz ----------
    /** A short haptic tick through the phone's own engine (no permission; the phone's touch-feedback setting is respected). */
    @PluginMethod
    public void haptic(PluginCall call) {
        final String kind = call.getString("kind", "tick");
        try {
            final android.webkit.WebView view = getBridge().getWebView();
            view.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        int type = android.view.HapticFeedbackConstants.VIRTUAL_KEY;
                        if ("ok".equals(kind)) type = Build.VERSION.SDK_INT >= 30 ? android.view.HapticFeedbackConstants.CONFIRM : android.view.HapticFeedbackConstants.LONG_PRESS;
                        else if ("warn".equals(kind)) type = Build.VERSION.SDK_INT >= 30 ? android.view.HapticFeedbackConstants.REJECT : android.view.HapticFeedbackConstants.LONG_PRESS;
                        view.performHapticFeedback(type);
                    } catch (Exception ignored) {
                        // no buzz is not a problem
                    }
                }
            });
        } catch (Exception ignored) {
            // no buzz is not a problem
        }
        call.resolve();
    }

    // ---------- the logo in notifications ----------
    /**
     * A notification that was posted by an older version keeps the app info it was posted with, and phones also remember the
     * app icon they saw first. Clearing what is still showing once per version makes every notification a fresh one.
     */
    @PluginMethod
    public void clearStale(PluginCall call) {
        try {
            Context ctx = getContext();
            String tag = call.getString("tag", "");
            android.content.SharedPreferences p = ctx.getSharedPreferences("prysm_misc", Context.MODE_PRIVATE);
            boolean done = tag.isEmpty() || tag.equals(p.getString("notifPurged", ""));
            if (!done) {
                android.app.NotificationManager nm = (android.app.NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) nm.cancelAll();
                p.edit().putString("notifPurged", tag).apply();
            }
            JSObject r = new JSObject();
            r.put("cleared", !done);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Could not clear old notifications", e);
        }
    }

    /** A brand new notification (new channel, new id) with Prysm's own small and large icon, to see what the phone shows. */
    @PluginMethod
    public void testNotification(PluginCall call) {
        try {
            Context ctx = getContext();
            android.app.NotificationManager nm = (android.app.NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) {
                call.reject("Notifications are not available");
                return;
            }
            if (Build.VERSION.SDK_INT >= 26) {
                nm.createNotificationChannel(new android.app.NotificationChannel("prysm_logo_test", "Logo test", android.app.NotificationManager.IMPORTANCE_DEFAULT));
            }
            Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            android.app.PendingIntent pi = android.app.PendingIntent.getActivity(ctx, 4999, open, android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_UPDATE_CURRENT);
            String text = "This is a brand new notification. The Prysm hexagon should show here and in the status bar.";
            android.app.Notification n = new androidx.core.app.NotificationCompat.Builder(ctx, "prysm_logo_test")
                    .setSmallIcon(R.drawable.ic_stat_prysm)
                    .setLargeIcon(Brand.logo(ctx))
                    .setColor(0xFF7C3AED)
                    .setContentTitle("Prysm logo test")
                    .setContentText(text)
                    .setStyle(new androidx.core.app.NotificationCompat.BigTextStyle().bigText(text))
                    .setPriority(androidx.core.app.NotificationCompat.PRIORITY_DEFAULT)
                    .setAutoCancel(true)
                    .setContentIntent(pi)
                    .build();
            nm.notify(4999, n);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not show the test notification", e);
        }
    }

    /** The phone's own notification settings page for Prysm. */
    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open the notification settings", e);
        }
    }

    // ---------- screen time ----------
    @PluginMethod
    public void screenStatus(PluginCall call) {
        Context ctx = getContext();
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        JSObject r = new JSObject();
        r.put("usage", ScreenTime.hasUsageAccess(ctx));
        r.put("accessibility", ScreenTime.accessibilityEnabled(ctx));
        r.put("admin", ScreenTime.adminActive(ctx));
        r.put("listener", ScreenTime.listenerEnabled(ctx));
        r.put("battery", pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName()));
        r.put("locked", ScreenTime.guardActive(ctx));
        r.put("secure", ScreenTime.secureGranted(ctx));
        r.put("running", PrysmAccessibilityService.instance != null);
        call.resolve(r);
    }

    /** The last things the blocking service did (started, stopped, caught a retry), newest last. */
    @PluginMethod
    public void getDiag(PluginCall call) {
        JSObject r = new JSObject();
        r.put("lines", ScreenTime.diagLines(getContext()));
        call.resolve(r);
    }

    /** Device admin is only asked for so that Android refuses to uninstall Prysm while a limit is locked. */
    @PluginMethod
    public void requestAdmin(PluginCall call) {
        try {
            Context ctx = getContext();
            Intent i = new Intent(android.app.admin.DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN);
            i.putExtra(android.app.admin.DevicePolicyManager.EXTRA_DEVICE_ADMIN, new ComponentName(ctx, PrysmAdminReceiver.class));
            i.putExtra(android.app.admin.DevicePolicyManager.EXTRA_ADD_EXPLANATION, "While this is on, Android will not let Prysm be uninstalled, so a limit you locked cannot be removed by deleting the app. Prysm uses no other admin power.");
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open the device admin screen", e);
        }
    }

    /** What the phone holds (limits, sleep lock) with lock state and time used today. */
    @PluginMethod
    public void getScreenConfig(PluginCall call) {
        try {
            call.resolve(new JSObject(ScreenTime.decorate(getContext(), ScreenTime.config(getContext()), 0).toString()));
        } catch (Exception e) {
            call.reject("Could not read the limits", e);
        }
    }

    /** Shows the block screen once so it can be seen without waiting for a limit (it can be closed). */
    @PluginMethod
    public void previewBlock(PluginCall call) {
        if (!PrysmAccessibilityService.preview(call.getString("kind", "limit"))) {
            call.reject("Turn on the Prysm accessibility service first");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void openUsageSettings(PluginCall call) {
        try {
            launch(Settings.ACTION_USAGE_ACCESS_SETTINGS, true);
        } catch (Exception e) {
            launch(Settings.ACTION_USAGE_ACCESS_SETTINGS, false);
        }
        call.resolve();
    }

    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        launch(Settings.ACTION_ACCESSIBILITY_SETTINGS, false);
        call.resolve();
    }

    /** Foreground time for each day start (ms) the page asks for: total, pickups, 24 hours and per app (minutes). */
    @PluginMethod
    public void getUsage(PluginCall call) {
        try {
            Context ctx = getContext();
            if (!ScreenTime.hasUsageAccess(ctx)) {
                call.reject("Usage access is off");
                return;
            }
            JSArray starts = call.getArray("starts", new JSArray());
            JSArray days = new JSArray();
            JSObject names = new JSObject();
            for (int i = 0; i < starts.length(); i++) {
                days.put(ScreenTime.dayWithFallback(ctx, starts.getLong(i), names));
            }
            JSObject r = new JSObject();
            r.put("days", days);
            r.put("names", names);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Could not read screen time", e);
        }
    }

    /** Apps that can be limited: everything with a launcher icon except phone, messages, settings, the launcher and Prysm. */
    @PluginMethod
    public void getApps(PluginCall call) {
        try {
            Context ctx = getContext();
            android.content.pm.PackageManager pm = ctx.getPackageManager();
            Intent main = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
            java.util.List<android.content.pm.ResolveInfo> found = pm.queryIntentActivities(main, 0);
            java.util.Set<String> skip = ScreenTime.protectedPackages(ctx);
            java.util.Map<String, String> byPkg = new java.util.LinkedHashMap<>();
            for (android.content.pm.ResolveInfo ri : found) {
                String pkg = ri.activityInfo.packageName;
                if (skip.contains(pkg) || byPkg.containsKey(pkg)) continue;
                byPkg.put(pkg, String.valueOf(ri.loadLabel(pm)));
            }
            java.util.List<java.util.Map.Entry<String, String>> list = new java.util.ArrayList<>(byPkg.entrySet());
            java.util.Collections.sort(list, (a, b) -> a.getValue().compareToIgnoreCase(b.getValue()));
            JSArray out = new JSArray();
            for (java.util.Map.Entry<String, String> en : list) {
                JSObject o = new JSObject();
                o.put("pkg", en.getKey());
                o.put("name", en.getValue());
                o.put("cat", ScreenTime.categoryOf(ctx, en.getKey()));
                Families.Fam fam = Families.of(en.getKey());
                o.put("fam", fam == null ? "" : fam.name);
                out.put(o);
            }
            JSObject r = new JSObject();
            r.put("apps", out);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Could not list apps", e);
        }
    }

    /** Small PNG icons (data URLs) for the packages asked for. */
    @PluginMethod
    public void getIcons(PluginCall call) {
        try {
            Context ctx = getContext();
            android.content.pm.PackageManager pm = ctx.getPackageManager();
            JSArray pkgs = call.getArray("pkgs", new JSArray());
            JSObject icons = new JSObject();
            int size = 96;
            for (int i = 0; i < pkgs.length(); i++) {
                String pkg = pkgs.getString(i);
                try {
                    android.graphics.drawable.Drawable dr = pm.getApplicationIcon(pkg);
                    android.graphics.Bitmap bmp = android.graphics.Bitmap.createBitmap(size, size, android.graphics.Bitmap.Config.ARGB_8888);
                    android.graphics.Canvas canvas = new android.graphics.Canvas(bmp);
                    dr.setBounds(0, 0, size, size);
                    dr.draw(canvas);
                    java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
                    bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, bos);
                    icons.put(pkg, "data:image/png;base64," + android.util.Base64.encodeToString(bos.toByteArray(), android.util.Base64.NO_WRAP));
                } catch (Exception ignored) {
                    // no icon for this one
                }
            }
            JSObject r = new JSObject();
            r.put("icons", icons);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Could not read icons", e);
        }
    }

    /**
     * Asks the phone to change the limits. The phone decides: a locked limit can only be made stricter, so whatever is
     * refused is simply not applied. Resolves with what the phone kept (see ScreenTime.decorate).
     */
    @PluginMethod
    public void setScreenConfig(PluginCall call) {
        try {
            JSObject kept = new JSObject(ScreenTime.apply(getContext(), new org.json.JSONObject(call.getString("json", "{}"))).toString());
            call.resolve(kept);
        } catch (Exception e) {
            call.reject("Could not save the limits", e);
        }
    }

    @PluginMethod
    public void getLog(PluginCall call) {
        try {
            JSObject r = new JSObject();
            r.put("items", new JSArray(PaymentListenerService.readLog(getContext()).toString()));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Could not read the log", e);
        }
    }

    @PluginMethod
    public void clearLog(PluginCall call) {
        PaymentListenerService.clearLog(getContext());
        call.resolve();
    }
}
