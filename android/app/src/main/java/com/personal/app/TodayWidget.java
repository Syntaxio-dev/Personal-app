package com.personal.app;

import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/** What is left today: tasks, attendance status and the wallet. */
public class TodayWidget extends PrysmWidget {
    @Override
    RemoteViews build(Context c, JSONObject d) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_today);
        JSONObject tasks = d.optJSONObject("tasks");
        JSONObject att = d.optJSONObject("att");
        int left = tasks == null ? 0 : tasks.optInt("left", 0);
        JSONArray items = tasks == null ? null : tasks.optJSONArray("items");

        v.setTextViewText(R.id.w_wallet, d.optString("wallet", ""));
        v.setTextViewText(R.id.w_left, tasks == null ? "Open Prysm" : left == 0 ? "Nothing left today" : left + (left == 1 ? " task left" : " tasks left"));
        int[] rows = {R.id.w_t1, R.id.w_t2, R.id.w_t3};
        for (int i = 0; i < rows.length; i++) {
            String title = items != null && i < items.length() ? "○  " + items.optString(i) : "";
            v.setTextViewText(rows[i], title);
            v.setViewVisibility(rows[i], title.isEmpty() ? View.GONE : View.VISIBLE);
        }
        v.setTextViewText(R.id.w_att, att == null ? "" : "Attendance: " + att.optString("today", "not marked"));
        v.setOnClickPendingIntent(R.id.w_root, open(c, "tab:todo"));
        return v;
    }
}
