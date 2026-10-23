package com.personal.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/** The attendance percentage and a bar graph of the last 14 days (green present, yellow half-day, grey absent). */
public class AttendanceWidget extends PrysmWidget {
    @Override
    RemoteViews build(Context c, JSONObject d) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_attendance);
        JSONObject att = d.optJSONObject("att");
        v.setTextViewText(R.id.a_pct, att == null ? "—" : att.optString("pct", "—"));
        v.setTextViewText(R.id.a_sub, att == null ? "Open Prysm to start" : att.optString("sub", ""));
        v.setImageViewBitmap(R.id.a_chart, chart(att == null ? null : att.optJSONArray("days")));
        v.setOnClickPendingIntent(R.id.a_root, open(c, "tab:att"));
        return v;
    }

    // one bar per day; the kind letters are the same ones the app uses (P, H, L, O, A, W, F, T, N)
    private static Bitmap chart(JSONArray days) {
        int w = 560, h = 190;
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(bmp);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        int n = days == null || days.length() == 0 ? 14 : days.length();
        float gap = 8f;
        float bw = (w - gap * (n - 1)) / n;
        for (int i = 0; i < n; i++) {
            String k = days == null ? "N" : days.optString(i, "N");
            float frac;
            int color;
            switch (k) {
                case "P": frac = 1f; color = 0xFF4ADE80; break;
                case "H": frac = 0.55f; color = 0xFFFBBF24; break;
                case "L": frac = 0.3f; color = 0xFF818CF8; break;
                case "O": frac = 0.3f; color = 0xFFA78BFA; break;
                case "A": frac = 0.14f; color = 0xFF8B8B95; break;
                case "T": frac = 0.14f; color = 0x99A78BFA; break;
                default: frac = 0.06f; color = 0x26FFFFFF; break;
            }
            float bh = Math.max(8f, h * frac);
            float x = i * (bw + gap);
            p.setColor(color);
            cv.drawRoundRect(new RectF(x, h - bh, x + bw, h), bw / 3f, bw / 3f, p);
        }
        return bmp;
    }
}
