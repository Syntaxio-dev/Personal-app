package com.personal.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;

/** Loud notifications for the moments a promise is being weakened (blocking switched off, uninstall protection removed). */
final class ScreenAlerts {
    static final String CHANNEL = "prysm_guard";
    static final int ID_BLOCKING = 4400;
    static final int ID_ADMIN = 4401;

    private ScreenAlerts() {}

    static void post(Context ctx, int id, String title, String text, Intent target) {
        try {
            Context c = ctx.getApplicationContext();
            if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (Build.VERSION.SDK_INT >= 26) {
                nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Limit protection", NotificationManager.IMPORTANCE_HIGH));
            }
            target.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            PendingIntent pi = PendingIntent.getActivity(c, id, target, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification n = new NotificationCompat.Builder(c, CHANNEL)
                    .setSmallIcon(R.drawable.ic_stat_prysm)
                    .setLargeIcon(Brand.logo(c))
                    .setColor(0xFF7C3AED)
                    .setContentTitle(title)
                    .setContentText(text)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setOngoing(true)
                    .setContentIntent(pi)
                    .build();
            nm.notify(id, n);
        } catch (Exception ignored) {
            // an alert that cannot be shown is not worth a crash
        }
    }

    static void cancel(Context ctx, int id) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getApplicationContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(id);
        } catch (Exception ignored) {
            // nothing to cancel
        }
    }
}
