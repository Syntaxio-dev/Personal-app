package com.personal.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** Stores the latest numbers the widgets show (sent by the web layer) and redraws every widget on the home screen. */
final class WidgetKit {
    private WidgetKit() {}

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences("widget_data", Context.MODE_PRIVATE);
    }

    static JSONObject data(Context c) {
        try {
            return new JSONObject(prefs(c).getString("json", "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static void save(Context c, String json) {
        prefs(c).edit().putString("json", json).apply();
        refreshAll(c);
    }

    static void refreshAll(Context c) {
        Context app = c.getApplicationContext();
        AppWidgetManager mgr = AppWidgetManager.getInstance(app);
        JSONObject d = data(app);
        try {
            push(app, mgr, QuickWidget.class, new QuickWidget().build(app, d));
            push(app, mgr, TodayWidget.class, new TodayWidget().build(app, d));
            push(app, mgr, AttendanceWidget.class, new AttendanceWidget().build(app, d));
        } catch (Exception ignored) {
            // a widget that cannot draw keeps what it showed before
        }
    }

    private static void push(Context c, AppWidgetManager mgr, Class<?> provider, RemoteViews views) {
        int[] ids = mgr.getAppWidgetIds(new ComponentName(c, provider));
        for (int id : ids) mgr.updateAppWidget(id, views);
    }
}
