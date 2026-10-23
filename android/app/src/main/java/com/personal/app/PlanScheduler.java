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

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

/**
 * The nightly "Plan tomorrow" popup. The web layer sends the time and tomorrow's tasks with setPlan();
 * an exact alarm wakes PlanReceiver, which draws PlanOverlay over whatever app is open (or posts a
 * notification when "Display over other apps" is off). Tasks typed into the popup wait in "pending"
 * until the app opens and takes them.
 */
final class PlanScheduler {
    static final String PREFS = "plan_overlay";
    static final String ACTION = "com.personal.app.PLAN_TOMORROW";
    private static final String CHANNEL = "prysm_plan";

    private PlanScheduler() {}

    static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String tomorrow() {
        Calendar cal = Calendar.getInstance();
        cal.add(Calendar.DAY_OF_YEAR, 1);
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(cal.getTime());
    }

    static void configure(Context c, boolean on, int hour, int minute, String name, String date, JSONArray titles) {
        prefs(c).edit()
                .putBoolean("on", on)
                .putInt("hour", hour)
                .putInt("minute", minute)
                .putString("name", name == null ? "" : name)
                .putString("tomorrowDate", date == null ? "" : date)
                .putString("tomorrowTitles", titles == null ? "[]" : titles.toString())
                .apply();
        schedule(c);
    }

    private static PendingIntent alarmIntent(Context c) {
        Intent i = new Intent(c, PlanReceiver.class).setAction(ACTION);
        return PendingIntent.getBroadcast(c, 4100, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** (Re)arms the alarm for the next hour:minute, or cancels it when the planner is off. */
    static void schedule(Context c) {
        SharedPreferences sp = prefs(c);
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = alarmIntent(c);
        am.cancel(pi);
        if (!sp.getBoolean("on", false)) return;
        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, sp.getInt("hour", 22));
        cal.set(Calendar.MINUTE, sp.getInt("minute", 30));
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        if (cal.getTimeInMillis() <= System.currentTimeMillis() + 1000) cal.add(Calendar.DAY_OF_YEAR, 1);
        setAt(am, cal.getTimeInMillis(), pi);
    }

    static void snooze(Context c, int minutes) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        setAt(am, System.currentTimeMillis() + minutes * 60_000L, alarmIntent(c));
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

    // ---------- tasks typed into the popup ----------
    static synchronized void addPending(Context c, String title, String date, String pri) {
        try {
            JSONArray arr = new JSONArray(prefs(c).getString("pending", "[]"));
            JSONObject o = new JSONObject();
            o.put("title", title);
            o.put("date", date);
            o.put("pri", pri);
            o.put("ts", System.currentTimeMillis());
            arr.put(o);
            prefs(c).edit().putString("pending", arr.toString()).apply();
        } catch (Exception ignored) {
            // a lost entry is better than a crash in someone else's app
        }
    }

    static synchronized JSONArray takePending(Context c) {
        JSONArray arr;
        try {
            arr = new JSONArray(prefs(c).getString("pending", "[]"));
        } catch (Exception e) {
            arr = new JSONArray();
        }
        prefs(c).edit().putString("pending", "[]").apply();
        return arr;
    }

    /** Used when the popup cannot be drawn: a notification that opens the app on the plan sheet. */
    static void notifyFallback(Context c) {
        if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Plan tomorrow", NotificationManager.IMPORTANCE_HIGH));
        }
        Intent open = new Intent(c, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra("prysm_open", "plan");
        PendingIntent pi = PendingIntent.getActivity(c, 4101, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String name = prefs(c).getString("name", "");
        Notification n = new NotificationCompat.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_prysm)
                .setLargeIcon(Brand.logo(c))
                .setColor(0xFF7C3AED)
                .setContentTitle("Plan tomorrow")
                .setContentText((name.isEmpty() ? "What" : name + ", what") + "'s on for tomorrow? Tap to plan it.")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();
        nm.notify(4102, n);
    }

    static String prettyDate(String ymd) {
        try {
            Date d = new SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(ymd);
            return new SimpleDateFormat("EEE, d MMM", Locale.ENGLISH).format(d);
        } catch (Exception e) {
            return ymd;
        }
    }
}
