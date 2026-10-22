package com.personal.app;

import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
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
    private static View overlay;

    private PaymentOverlay() {}

    static boolean isShowing() {
        return overlay != null;
    }

    private static int dp(Context c, float v) {
        return Math.round(v * c.getResources().getDisplayMetrics().density);
    }

    private static GradientDrawable box(Context c, int color, float radiusDp, int strokeColor) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(c, radiusDp));
        if (strokeColor != 0) g.setStroke(dp(c, 1), strokeColor);
        return g;
    }

    private static TextView button(Context c, String text, int bgColor, int textColor) {
        TextView t = new TextView(c);
        t.setText(text);
        t.setGravity(Gravity.CENTER);
        t.setTextSize(15);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setTextColor(textColor);
        t.setPadding(0, dp(c, 14), 0, dp(c, 14));
        t.setBackground(box(c, bgColor, 12, 0));
        return t;
    }

    private static void paintChips(Context c, List<TextView> chips, String selected) {
        for (TextView chip : chips) {
            boolean on = chip.getText().toString().equals(selected);
            chip.setTextColor(on ? 0xFFC4B5FD : 0xB3FFFFFF);
            chip.setBackground(on ? box(c, 0x337C3AED, 20, 0x66A78BFA) : box(c, 0x0AFFFFFF, 20, 0x14FFFFFF));
        }
    }

    static void dismiss(Context c) {
        try {
            if (overlay != null) {
                WindowManager wm = (WindowManager) c.getSystemService(Context.WINDOW_SERVICE);
                wm.removeView(overlay);
            }
        } catch (Exception ignored) {
            // already gone
        }
        overlay = null;
    }

    static void show(final Context ctx, double amount, final String payee, final long ts, final boolean test) {
        final WindowManager wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
        final String[] chosen = {PaymentListenerService.guessCategory(ctx, payee)};

        LinearLayout root = new LinearLayout(ctx);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(ctx, 20), dp(ctx, 20), dp(ctx, 20), dp(ctx, 28));
        float r = dp(ctx, 20);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xF2141414);
        bg.setCornerRadii(new float[]{r, r, r, r, 0, 0, 0, 0});
        bg.setStroke(dp(ctx, 1), 0x14FFFFFF);
        root.setBackground(bg);

        TextView head = new TextView(ctx);
        head.setText(test ? "TEST · ADD EXPENSE" : "PAYMENT DETECTED · ADD EXPENSE");
        head.setTextSize(11);
        head.setLetterSpacing(0.12f);
        head.setTextColor(0x66FFFFFF);
        root.addView(head);

        final EditText amountEt = new EditText(ctx);
        amountEt.setText(amount == Math.floor(amount) ? String.valueOf((long) amount) : String.valueOf(amount));
        amountEt.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        amountEt.setTextSize(34);
        amountEt.setTypeface(Typeface.DEFAULT_BOLD);
        amountEt.setTextColor(Color.WHITE);
        amountEt.setBackground(null);
        amountEt.setPadding(0, dp(ctx, 6), 0, dp(ctx, 6));
        root.addView(amountEt);

        final EditText noteEt = new EditText(ctx);
        noteEt.setHint("Note (optional)");
        noteEt.setHintTextColor(0x4DFFFFFF);
        noteEt.setText(payee);
        noteEt.setSingleLine(true);
        noteEt.setTextColor(Color.WHITE);
        noteEt.setTextSize(16);
        noteEt.setBackground(box(ctx, 0x0AFFFFFF, 12, 0x14FFFFFF));
        noteEt.setPadding(dp(ctx, 14), dp(ctx, 12), dp(ctx, 14), dp(ctx, 12));
        root.addView(noteEt);

        LinearLayout chipRow = new LinearLayout(ctx);
        chipRow.setOrientation(LinearLayout.HORIZONTAL);
        final List<TextView> chips = new ArrayList<>();
        for (final String cat : PaymentListenerService.CATEGORIES) {
            TextView chip = new TextView(ctx);
            chip.setText(cat);
            chip.setTextSize(14);
            chip.setPadding(dp(ctx, 16), dp(ctx, 9), dp(ctx, 16), dp(ctx, 9));
            LinearLayout.LayoutParams clp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            clp.rightMargin = dp(ctx, 8);
            chip.setLayoutParams(clp);
            chip.setOnClickListener(v -> {
                chosen[0] = cat;
                paintChips(ctx, chips, chosen[0]);
            });
            chips.add(chip);
            chipRow.addView(chip);
        }
        paintChips(ctx, chips, chosen[0]);
        HorizontalScrollView scroll = new HorizontalScrollView(ctx);
        scroll.setHorizontalScrollBarEnabled(false);
        scroll.addView(chipRow);
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        slp.topMargin = dp(ctx, 14);
        slp.bottomMargin = dp(ctx, 18);
        root.addView(scroll, slp);

        LinearLayout buttons = new LinearLayout(ctx);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        TextView skip = button(ctx, "Skip", 0x0FFFFFFF, 0xB3FFFFFF);
        TextView save = button(ctx, "Save expense", 0xFF7C3AED, Color.WHITE);
        buttons.addView(skip, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        LinearLayout.LayoutParams saveLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 2f);
        saveLp.leftMargin = dp(ctx, 10);
        buttons.addView(save, saveLp);
        root.addView(buttons);

        skip.setOnClickListener(v -> dismiss(ctx));
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
                    PaymentListenerService.addPending(ctx, item);
                    PaymentListenerService.rememberCategory(ctx, payee, chosen[0]);
                } catch (Exception ignored) {
                    // the sheet closes either way; worst case the user re-adds it in the app
                }
            }
            dismiss(ctx);
        });

        int type = Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
                type, WindowManager.LayoutParams.FLAG_DIM_BEHIND, PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.BOTTOM;
        lp.dimAmount = 0.6f;
        lp.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE;
        wm.addView(root, lp);
        overlay = root;
    }
}
