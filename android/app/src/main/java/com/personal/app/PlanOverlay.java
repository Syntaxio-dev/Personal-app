package com.personal.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;

import java.util.ArrayList;
import java.util.List;

/** The nightly "Plan tomorrow" sheet drawn over other apps. Main thread only, needs the overlay permission. */
final class PlanOverlay {
    static final String TAG = "plan";
    private static final String[][] PRIORITIES = {{"high", "High"}, {"med", "Medium"}, {"low", "Low"}};

    private PlanOverlay() {}

    static boolean isShowing() {
        return OverlayHost.isShowing(TAG);
    }

    static void show(Context ctx) {
        final Context app = ctx.getApplicationContext();
        final Context ui = OverlayHost.uiContext(ctx);
        SharedPreferences sp = PlanScheduler.prefs(app);
        final String date = PlanScheduler.tomorrow();
        String name = sp.getString("name", "");
        final String[] pri = {"med"};
        final int[] added = {0};

        LinearLayout root = OverlayHost.sheet(ui);
        root.addView(OverlayHost.label(ui, "PLAN TOMORROW · " + PlanScheduler.prettyDate(date).toUpperCase()));
        root.addView(OverlayHost.title(ui, (name.isEmpty() ? "What" : name + ", what") + "'s on for tomorrow?"));

        // tasks already planned in the app, plus the ones added here
        final LinearLayout list = new LinearLayout(ui);
        list.setOrientation(LinearLayout.VERTICAL);
        List<String> existing = new ArrayList<>();
        if (date.equals(sp.getString("tomorrowDate", ""))) {
            try {
                JSONArray arr = new JSONArray(sp.getString("tomorrowTitles", "[]"));
                for (int i = 0; i < arr.length(); i++) existing.add(arr.getString(i));
            } catch (Exception ignored) {
                // nothing to show
            }
        }
        for (String t : existing) list.addView(item(ui, t, false));
        if (existing.isEmpty()) list.addView(OverlayHost.muted(ui, "Nothing planned yet. Add your first task."));
        ScrollView scroll = new ScrollView(ui);
        scroll.addView(list);
        LinearLayout.LayoutParams scrollLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        scrollLp.bottomMargin = OverlayHost.dp(ui, 12);
        root.addView(scroll, scrollLp);
        if (existing.size() > 5) scroll.getLayoutParams().height = OverlayHost.dp(ui, 180);

        final EditText input = OverlayHost.input(ui, "e.g. Wash shoes, car service, study 2 hrs", "", false);
        input.setImeOptions(EditorInfo.IME_ACTION_DONE);
        root.addView(input);

        LinearLayout chipRow = OverlayHost.row(ui);
        final List<TextView> chips = new ArrayList<>();
        for (final String[] p : PRIORITIES) {
            final TextView chip = OverlayHost.chip(ui, p[1]);
            chip.setOnClickListener(v -> {
                pri[0] = p[0];
                for (int i = 0; i < chips.size(); i++) OverlayHost.paintChip(ui, chips.get(i), PRIORITIES[i][0].equals(pri[0]));
            });
            chips.add(chip);
            chipRow.addView(chip);
        }
        for (int i = 0; i < chips.size(); i++) OverlayHost.paintChip(ui, chips.get(i), PRIORITIES[i][0].equals(pri[0]));
        LinearLayout.LayoutParams chipLp = OverlayHost.gapTop(ui, 12);
        chipLp.bottomMargin = OverlayHost.dp(ui, 16);
        root.addView(chipRow, chipLp);

        final boolean[] hadPlaceholder = {existing.isEmpty()};
        final Runnable add = () -> {
            String title = input.getText().toString().trim();
            if (title.isEmpty()) {
                input.setError("Type a task first");
                return;
            }
            PlanScheduler.addPending(app, title, date, pri[0]);
            if (hadPlaceholder[0]) {
                list.removeAllViews();
                hadPlaceholder[0] = false;
            }
            list.addView(item(ui, title, true));
            added[0]++;
            input.setText("");
        };
        input.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                add.run();
                return true;
            }
            return false;
        });

        LinearLayout buttons = OverlayHost.row(ui);
        TextView later = OverlayHost.button(ui, "Later", false);
        TextView addBtn = OverlayHost.button(ui, "Add", false);
        TextView done = OverlayHost.button(ui, "Done", true);
        buttons.addView(later, OverlayHost.weight(1f, 0));
        buttons.addView(addBtn, OverlayHost.weight(1f, OverlayHost.dp(ui, 8)));
        buttons.addView(done, OverlayHost.weight(1.3f, OverlayHost.dp(ui, 8)));
        root.addView(buttons);

        addBtn.setOnClickListener(v -> add.run());
        later.setOnClickListener(v -> {
            PlanScheduler.snooze(app, 30);
            OverlayHost.remove(TAG);
            Toast.makeText(app, "Prysm will ask again in 30 minutes", Toast.LENGTH_SHORT).show();
        });
        done.setOnClickListener(v -> {
            if (!input.getText().toString().trim().isEmpty()) add.run();
            OverlayHost.remove(TAG);
            if (added[0] > 0) Toast.makeText(app, added[0] + (added[0] == 1 ? " task" : " tasks") + " planned for tomorrow", Toast.LENGTH_SHORT).show();
        });

        OverlayHost.show(TAG, ui, root);
    }

    private static TextView item(Context ui, String text, boolean fresh) {
        TextView t = new TextView(ui);
        t.setText((fresh ? "+  " : "•  ") + text);
        t.setTextSize(15);
        t.setTextColor(fresh ? 0xFFC4B5FD : 0xCCFFFFFF);
        t.setPadding(0, OverlayHost.dp(ui, 6), 0, OverlayHost.dp(ui, 6));
        return t;
    }
}
