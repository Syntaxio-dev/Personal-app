package com.personal.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** Base of the home screen widgets. They draw from the snapshot the web layer saves in WidgetKit. */
public abstract class PrysmWidget extends AppWidgetProvider {
    abstract RemoteViews build(Context c, JSONObject data);

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        RemoteViews views;
        try {
            views = build(context, WidgetKit.data(context));
        } catch (Exception e) {
            return;
        }
        for (int id : ids) manager.updateAppWidget(id, views);
    }

    /** Opens Prysm and asks it to do `action` (expense, income, task, tab:att ...). */
    static PendingIntent open(Context c, String action) {
        Intent i = new Intent(c, MainActivity.class)
                .setAction("prysm.open." + action)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra("prysm_open", action);
        return PendingIntent.getActivity(c, ("widget" + action).hashCode() & 0x7fffffff, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
