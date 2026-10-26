package com.personal.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/**
 * A quiet foreground service that keeps Prysm's process alive. Phones like iQOO/Vivo, Xiaomi and Oppo
 * freeze or kill background apps within seconds, which silently stops the payment popup, the test popup
 * and the nightly plan popup. A visible (minimised) notification is the price Android asks for that.
 */
public class KeepAliveService extends Service {
    private static final String CHANNEL = "prysm_running";
    private static final int ID = 4200;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private int ticks = 0;
    private final Runnable watch = new Runnable() {
        @Override
        public void run() {
            try {
                ScreenTime.watchdog(KeepAliveService.this);
            } catch (Exception ignored) {
                // the watchdog must never take the service down
            }
            try {
                // Fitness mode: a step reading now and then (every ten minutes), so each day's total stays right
                if (ticks++ % 10 == 0) StepCounter.sample(KeepAliveService.this, null);
            } catch (Exception ignored) {
                // steps are a bonus; they must never take the service down
            }
            handler.postDelayed(this, 60000);
        }
    };

    static boolean wanted(Context c) {
        return PlanScheduler.prefs(c).getBoolean("keepAlive", false);
    }

    static void setWanted(Context c, boolean on) {
        // the service carries the watchdog of the locked limits, so it stays on while one is locked
        if (!on && ScreenTime.guardActive(c)) on = true;
        PlanScheduler.prefs(c).edit().putBoolean("keepAlive", on).apply();
        if (on) start(c); else stop(c);
    }

    static void start(Context c) {
        try {
            ContextCompat.startForegroundService(c, new Intent(c, KeepAliveService.class));
        } catch (Exception e) {
            PaymentListenerService.log(c, "prysm", null, "could not start keep-alive: " + e);
        }
    }

    static void stop(Context c) {
        c.stopService(new Intent(c, KeepAliveService.class));
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Prysm running in background", NotificationManager.IMPORTANCE_MIN);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 4201, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_prysm)
                .setLargeIcon(Brand.logo(this))
                .setColor(0xFF7C3AED)
                .setContentTitle("Prysm is ready")
                .setContentText("Keeps payment and planning popups working")
                .setOngoing(true)
                .setShowWhen(false)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setContentIntent(pi)
                .build();
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            else startForeground(ID, n);
        } catch (Exception e) {
            PaymentListenerService.log(this, "prysm", null, "keep-alive refused by Android: " + e);
            stopSelf();
            return START_NOT_STICKY;
        }
        handler.removeCallbacks(watch);
        handler.postDelayed(watch, 5000);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(watch);
        super.onDestroy();
    }
}
