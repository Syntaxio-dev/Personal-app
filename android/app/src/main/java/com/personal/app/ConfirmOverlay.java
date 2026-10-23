package com.personal.app;

import android.content.Context;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

/** A small "did you pay it?" sheet drawn over other apps. Main thread only, needs the overlay permission. */
final class ConfirmOverlay {
    static final String TAG = "confirm";

    private ConfirmOverlay() {}

    static void show(Context ctx, JSONObject item) {
        final Context app = ctx.getApplicationContext();
        final Context ui = OverlayHost.uiContext(ctx);
        final String key = item.optString("key");

        LinearLayout root = OverlayHost.sheet(ui);
        root.addView(OverlayHost.label(ui, "REMINDER"));
        root.addView(OverlayHost.title(ui, item.optString("title", "Did you pay it?")));
        String body = item.optString("body", "");
        if (!body.isEmpty()) {
            TextView t = OverlayHost.muted(ui, body);
            LinearLayout.LayoutParams lp = OverlayHost.gapTop(ui, 0);
            lp.bottomMargin = OverlayHost.dp(ui, 18);
            root.addView(t, lp);
        }

        LinearLayout buttons = OverlayHost.row(ui);
        TextView later = OverlayHost.button(ui, "Later", false);
        TextView yes = OverlayHost.button(ui, item.optString("yes", "Yes, paid"), true);
        buttons.addView(later, OverlayHost.weight(1f, 0));
        if (item.optBoolean("skip", false)) {
            TextView skip = OverlayHost.button(ui, "Skip", false);
            buttons.addView(skip, OverlayHost.weight(1f, OverlayHost.dp(ui, 8)));
            skip.setOnClickListener(v -> {
                ConfirmScheduler.answer(app, key, "skip");
                OverlayHost.remove(TAG);
            });
        }
        buttons.addView(yes, OverlayHost.weight(1.6f, OverlayHost.dp(ui, 8)));
        root.addView(buttons);

        later.setOnClickListener(v -> {
            ConfirmScheduler.later(app, key, 180);
            OverlayHost.remove(TAG);
            Toast.makeText(app, "Prysm will ask again in 3 hours", Toast.LENGTH_SHORT).show();
        });
        yes.setOnClickListener(v -> {
            ConfirmScheduler.answer(app, key, "yes");
            OverlayHost.remove(TAG);
            Toast.makeText(app, "Marked as paid", Toast.LENGTH_SHORT).show();
        });

        OverlayHost.show(TAG, ui, root);
    }
}
