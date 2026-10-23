package com.personal.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * "Did you pay it?" popups for SIP days and bills. The web layer sends the upcoming items
 * ({key, title, body, yes, skip, at}); an exact alarm per item wakes ConfirmReceiver, which draws
 * ConfirmOverlay over any app. The answers wait in prefs until the app opens and takes them.
 */
final class ConfirmScheduler {
    static final String ACTION = "com.personal.app.CONFIRM";
    private static final String CHANNEL = "prysm_confirm";

    private ConfirmScheduler() {}

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences("confirm_overlay", Context.MODE_PRIVATE);
    }

    private static PendingIntent pending(Context c, String key) {
        Intent i = new Intent(c, ConfirmReceiver.class).setAction(ACTION).putExtra("key", key);
        return PendingIntent.getBroadcast(c, key.hashCode() & 0x7fffffff, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static JSONArray items(Context c) {
        try {
            return new JSONArray(prefs(c).getString("items", "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    static synchronized void configure(Context c, JSONArray fresh) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        JSONArray old = items(c);
        if (am != null) {
            for (int i = 0; i < old.length(); i++) {
                try {
                    am.cancel(pending(c, old.getJSONObject(i).getString("key")));
                } catch (Exception ignored) {
                    // an unreadable old entry has no alarm worth cancelling
                }
            }
        }
        prefs(c).edit().putString("items", fresh.toString()).apply();
        schedule(c);
    }

    /** Arms an alarm for every item that is still in the future (also called after a reboot). */
    static synchronized void schedule(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        JSONArray arr = items(c);
        long now = System.currentTimeMillis();
        for (int i = 0; i < arr.length(); i++) {
            try {
                JSONObject o = arr.getJSONObject(i);
                long at = o.optLong("at", 0);
                if (at > now) setAt(am, at, pending(c, o.getString("key")));
            } catch (Exception ignored) {
                // skip a broken item, keep the rest
            }
        }
    }

    private static void setAt(AlarmManager am, long when, PendingIntent pi) {
        try {
            boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pi);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pi);
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pi);
        }
    }

    static JSONObject find(Context c, String key) {
        JSONArray arr = items(c);
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o != null && key.equals(o.optString("key"))) return o;
        }
        return null;
    }

    static void later(Context c, String key, int minutes) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am != null) setAt(am, System.currentTimeMillis() + minutes * 60_000L, pending(c, key));
    }

    /** Records the answer and forgets the item, so it is not asked again. */
    static synchronized void answer(Context c, String key, String answer) {
        try {
            SharedPreferences sp = prefs(c);
            JSONArray results = new JSONArray(sp.getString("results", "[]"));
            JSONObject r = new JSONObject();
            r.put("key", key);
            r.put("answer", answer);
            r.put("ts", System.currentTimeMillis());
            results.put(r);
            JSONArray kept = new JSONArray();
            JSONArray arr = items(c);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o != null && !key.equals(o.optString("key"))) kept.put(o);
            }
            sp.edit().putString("results", results.toString()).putString("items", kept.toString()).apply();
        } catch (Exception ignored) {
            // the in-app prompt will ask again
        }
    }

    static synchronized JSONArray takeResults(Context c) {
        JSONArray out;
        try {
            out = new JSONArray(prefs(c).getString("results", "[]"));
        } catch (Exception e) {
            out = new JSONArray();
        }
        prefs(c).edit().putString("results", "[]").apply();
        return out;
    }

    static void notifyFallback(Context c, JSONObject item) {
        if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Payment confirmations", NotificationManager.IMPORTANCE_HIGH));
        }
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 4301, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_prysm)
                .setLargeIcon(Brand.logo(c))
                .setColor(0xFF7C3AED)
                .setContentTitle(item.optString("title", "Reminder"))
                .setContentText(item.optString("body", ""))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();
        nm.notify(item.optString("key").hashCode(), n);
    }
}
