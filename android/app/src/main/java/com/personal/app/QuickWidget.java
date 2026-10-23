package com.personal.app;

import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** Four big buttons: add an expense, income or task, or mark attendance. */
public class QuickWidget extends PrysmWidget {
    @Override
    RemoteViews build(Context c, JSONObject d) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_quick);
        v.setOnClickPendingIntent(R.id.btn_expense, open(c, "expense"));
        v.setOnClickPendingIntent(R.id.btn_income, open(c, "income"));
        v.setOnClickPendingIntent(R.id.btn_task, open(c, "task"));
        v.setOnClickPendingIntent(R.id.btn_att, open(c, "attendance"));
        return v;
    }
}
