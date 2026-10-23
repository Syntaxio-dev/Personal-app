package com.personal.app;

import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.hardware.display.DisplayManager;
import android.os.Build;
import android.text.InputType;
import android.view.ContextThemeWrapper;
import android.view.Display;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.HashMap;
import java.util.Map;

/**
 * Draws Prysm's bottom sheets over other apps ("Display over other apps").
 * Uses a window context on Android 11+, which is what the system expects for overlay windows
 * (adding views through the plain application context is unreliable on newer Android and on some OEM ROMs).
 * Call everything on the main thread.
 */
final class OverlayHost {
    private static final Map<String, View> VIEWS = new HashMap<>();
    private static final Map<String, WindowManager> MANAGERS = new HashMap<>();

    private OverlayHost() {}

    static boolean isShowing(String tag) {
        return VIEWS.containsKey(tag);
    }

    static boolean anyShowing() {
        return !VIEWS.isEmpty();
    }

    static Context uiContext(Context ctx) {
        Context base = ctx.getApplicationContext();
        if (Build.VERSION.SDK_INT >= 30) {
            DisplayManager dm = (DisplayManager) base.getSystemService(Context.DISPLAY_SERVICE);
            Display display = dm != null ? dm.getDisplay(Display.DEFAULT_DISPLAY) : null;
            if (display != null) {
                base = base.createDisplayContext(display).createWindowContext(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, null);
            }
        }
        return new ContextThemeWrapper(base, android.R.style.Theme_DeviceDefault_NoActionBar);
    }

    static void show(String tag, Context ui, View root) {
        remove(tag);
        WindowManager wm = (WindowManager) ui.getSystemService(Context.WINDOW_SERVICE);
        int type = Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
                type, WindowManager.LayoutParams.FLAG_DIM_BEHIND, PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.BOTTOM;
        lp.dimAmount = 0.6f;
        lp.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE | WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN;
        wm.addView(root, lp);
        VIEWS.put(tag, root);
        MANAGERS.put(tag, wm);
    }

    static void remove(String tag) {
        View v = VIEWS.remove(tag);
        WindowManager wm = MANAGERS.remove(tag);
        if (v != null && wm != null) {
            try {
                wm.removeViewImmediate(v);
            } catch (Exception ignored) {
                // already gone
            }
        }
    }

    // ---------- small style kit (matches the app: black glass, purple accent) ----------
    static int dp(Context c, float v) {
        return Math.round(v * c.getResources().getDisplayMetrics().density);
    }

    static GradientDrawable box(Context c, int color, float radiusDp, int strokeColor) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(c, radiusDp));
        if (strokeColor != 0) g.setStroke(dp(c, 1), strokeColor);
        return g;
    }

    static LinearLayout sheet(Context c) {
        LinearLayout root = new LinearLayout(c);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(c, 20), dp(c, 20), dp(c, 20), dp(c, 24));
        float r = dp(c, 22);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xF5141414);
        bg.setCornerRadii(new float[]{r, r, r, r, 0, 0, 0, 0});
        bg.setStroke(dp(c, 1), 0x1AFFFFFF);
        root.setBackground(bg);
        return root;
    }

    static TextView label(Context c, String text) {
        TextView t = new TextView(c);
        t.setText(text);
        t.setTextSize(11);
        t.setLetterSpacing(0.12f);
        t.setTextColor(0xFFA78BFA);
        return t;
    }

    static TextView title(Context c, String text) {
        TextView t = new TextView(c);
        t.setText(text);
        t.setTextSize(20);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setTextColor(Color.WHITE);
        t.setPadding(0, dp(c, 6), 0, dp(c, 12));
        return t;
    }

    static TextView muted(Context c, String text) {
        TextView t = new TextView(c);
        t.setText(text);
        t.setTextSize(14);
        t.setTextColor(0x99FFFFFF);
        return t;
    }

    static EditText input(Context c, String hint, String value, boolean number) {
        EditText e = new EditText(c);
        e.setHint(hint);
        e.setHintTextColor(0x4DFFFFFF);
        e.setText(value);
        e.setSingleLine(true);
        e.setTextColor(Color.WHITE);
        e.setTextSize(16);
        if (number) e.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        e.setBackground(box(c, 0x0FFFFFFF, 12, 0x1AFFFFFF));
        e.setPadding(dp(c, 14), dp(c, 12), dp(c, 14), dp(c, 12));
        return e;
    }

    static TextView button(Context c, String text, boolean primary) {
        TextView t = new TextView(c);
        t.setText(text);
        t.setGravity(Gravity.CENTER);
        t.setTextSize(15);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setTextColor(primary ? Color.WHITE : 0xCCFFFFFF);
        t.setPadding(dp(c, 8), dp(c, 14), dp(c, 8), dp(c, 14));
        t.setBackground(primary ? box(c, 0xFF7C3AED, 12, 0) : box(c, 0x14FFFFFF, 12, 0x1AFFFFFF));
        return t;
    }

    static TextView chip(Context c, String text) {
        TextView t = new TextView(c);
        t.setText(text);
        t.setTextSize(14);
        t.setPadding(dp(c, 16), dp(c, 9), dp(c, 16), dp(c, 9));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.rightMargin = dp(c, 8);
        t.setLayoutParams(lp);
        return t;
    }

    static void paintChip(Context c, TextView chip, boolean on) {
        chip.setTextColor(on ? 0xFFC4B5FD : 0xB3FFFFFF);
        chip.setBackground(on ? box(c, 0x337C3AED, 20, 0x66A78BFA) : box(c, 0x0AFFFFFF, 20, 0x14FFFFFF));
    }

    static LinearLayout row(Context c) {
        LinearLayout r = new LinearLayout(c);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        return r;
    }

    static LinearLayout.LayoutParams weight(float w, int leftMarginPx) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, w);
        lp.leftMargin = leftMarginPx;
        return lp;
    }

    static LinearLayout.LayoutParams gapTop(Context c, float topDp) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(c, topDp);
        return lp;
    }
}
