package com.personal.app;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * The "Add expense" sheet drawn over other apps after a UPI payment. Must be called on the main thread
 * and only when "Display over other apps" is granted.
 */
final class PaymentOverlay {
    static final String TAG = "payment";

    private PaymentOverlay() {}

    static boolean isShowing() {
        return OverlayHost.isShowing(TAG);
    }

    static void dismiss(Context c) {
        OverlayHost.remove(TAG);
    }

    static void show(Context ctx, double amount, final String payee, final long ts, final boolean test) {
        final Context app = ctx.getApplicationContext();
        final Context ui = OverlayHost.uiContext(ctx);
        final String[] chosen = {PaymentListenerService.guessCategory(app, payee)};

        LinearLayout root = OverlayHost.sheet(ui);
        root.addView(OverlayHost.label(ui, test ? "TEST · ADD EXPENSE" : "PAYMENT DETECTED · ADD EXPENSE"));

        final EditText amountEt = new EditText(ui);
        amountEt.setText(amount == Math.floor(amount) ? String.valueOf((long) amount) : String.valueOf(amount));
        amountEt.setInputType(android.text.InputType.TYPE_CLASS_NUMBER | android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL);
        amountEt.setTextSize(34);
        amountEt.setTypeface(Typeface.DEFAULT_BOLD);
        amountEt.setTextColor(Color.WHITE);
        amountEt.setBackground(null);
        amountEt.setPadding(0, OverlayHost.dp(ui, 6), 0, OverlayHost.dp(ui, 6));
        root.addView(amountEt);

        final EditText noteEt = OverlayHost.input(ui, "Note (optional)", payee, false);
        root.addView(noteEt);

        LinearLayout chipRow = OverlayHost.row(ui);
        final List<TextView> chips = new ArrayList<>();
        for (final String cat : PaymentListenerService.CATEGORIES) {
            final TextView chip = OverlayHost.chip(ui, cat);
            chip.setOnClickListener(v -> {
                chosen[0] = cat;
                for (TextView c : chips) OverlayHost.paintChip(ui, c, c.getText().toString().equals(chosen[0]));
            });
            chips.add(chip);
            chipRow.addView(chip);
        }
        for (TextView c : chips) OverlayHost.paintChip(ui, c, c.getText().toString().equals(chosen[0]));
        HorizontalScrollView scroll = new HorizontalScrollView(ui);
        scroll.setHorizontalScrollBarEnabled(false);
        scroll.addView(chipRow);
        LinearLayout.LayoutParams slp = OverlayHost.gapTop(ui, 14);
        slp.bottomMargin = OverlayHost.dp(ui, 18);
        root.addView(scroll, slp);

        LinearLayout buttons = OverlayHost.row(ui);
        TextView skip = OverlayHost.button(ui, "Skip", false);
        TextView save = OverlayHost.button(ui, "Save expense", true);
        buttons.addView(skip, OverlayHost.weight(1f, 0));
        buttons.addView(save, OverlayHost.weight(2f, OverlayHost.dp(ui, 10)));
        root.addView(buttons);

        skip.setOnClickListener(v -> dismiss(app));
        save.setOnClickListener(v -> {
            double value;
            try {
                value = Double.parseDouble(amountEt.getText().toString().trim());
            } catch (Exception e) {
                value = 0;
            }
            if (value <= 0) {
                amountEt.setError("Enter an amount");
                return;
            }
            if (!test) {
                try {
                    JSONObject item = PaymentListenerService.baseItem(value, payee, ts);
                    item.put("category", chosen[0]);
                    item.put("note", noteEt.getText().toString().trim());
                    item.put("status", "saved");
                    PaymentListenerService.addPending(app, item);
                    PaymentListenerService.rememberCategory(app, payee, chosen[0]);
                } catch (Exception ignored) {
                    // the sheet closes either way; worst case the user re-adds it in the app
                }
            }
            dismiss(app);
        });

        OverlayHost.show(TAG, ui, root);
    }
}
