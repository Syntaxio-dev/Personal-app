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
        KeepAliveService.setWanted(getContext().getApplicationContext(), Boolean.TRUE.equals(call.getBoolean("on", true)));
        call.resolve();
    }

    /** The app's own settings page; on iQOO/Vivo, Xiaomi and Oppo the extra pop-up permissions live here. */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        launch(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, true);
        call.resolve();
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
