package com.personal.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Watches notifications from UPI apps only. When one looks like an outgoing payment it shows an
 * "Add expense" sheet over whatever app is open (needs "Display over other apps"). Without that
 * permission it falls back to a notification that opens the app. Everything stays on the phone.
 *
 * Items handed to the web layer: {amount, payee, category, note, date, ts, status}
 *   status "saved"  - confirmed in the overlay, JS just stores it
 *   status "review" - not confirmed yet, JS asks the user
 */
public class PaymentListenerService extends NotificationListenerService {
    static final String PREFS = "payment_capture";
    static final String KEY_PENDING = "pending";
    static final String KEY_LAST = "last";
    static final String KEY_PAYEE_CATS = "payee_cats";
    static final String CHANNEL = "payment_expense";

    static final String[] CATEGORIES = {"Food", "Travel", "Bills", "Rent", "Shopping", "Health", "Fun", "Other"};

    private static final Set<String> APPS = new HashSet<>(Arrays.asList(
            "com.phonepe.app",
            "com.google.android.apps.nbu.paisa.user",
            "net.one97.paytm",
            "in.org.npci.upiapp",
            "com.dreamplug.androidapp",
            "in.amazon.mShop.android.shopping",
            "com.mobikwik_new",
            "com.freecharge.android"
    ));

    private static final Pattern AMOUNT = Pattern.compile("(?:₹|Rs\\.?|INR)\\s?([0-9][0-9,]*(?:\\.[0-9]{1,2})?)", Pattern.CASE_INSENSITIVE);
    private static final Pattern PAID = Pattern.compile("\\b(paid|sent|payment (?:of|successful)|debited)\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern SKIP = Pattern.compile("\\b(received|credited|request(?:ed)?|failed|declined|refund(?:ed)?|reversed)\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern PAYEE = Pattern.compile("\\bto\\s+([^\\n.,]+?)(?:\\s+(?:via|using|from|on|successful|is)\\b|[.,\\n]|$)", Pattern.CASE_INSENSITIVE);

    private static final String[][] GUESS = {
            {"Food", "zomato", "swiggy", "restaurant", "cafe", "pizza", "burger", "kitchen", "bakery", "dominos", "mcdonald", "kfc", "chai", "juice", "sweets"},
            {"Travel", "uber", "ola", "rapido", "irctc", "redbus", "metro", "fuel", "petrol", "hpcl", "bpcl", "indian oil", "fastag", "makemytrip"},
            {"Bills", "jio", "airtel", "vodafone", "electricity", "bijli", "recharge", "broadband", "gas", "water", "insurance", "dth"},
            {"Shopping", "amazon", "flipkart", "myntra", "meesho", "mart", "store", "mall", "bigbasket", "blinkit", "zepto", "dmart"},
            {"Health", "pharmacy", "medical", "hospital", "clinic", "apollo", "medplus", "labs"},
            {"Fun", "netflix", "spotify", "bookmyshow", "hotstar", "prime", "cinema", "game"}
    };

    private static View overlay;

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            if (sbn == null || !APPS.contains(sbn.getPackageName())) return;
            Notification n = sbn.getNotification();
            if (n == null || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;

            CharSequence title = n.extras.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence text = n.extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
            if (text == null) text = n.extras.getCharSequence(Notification.EXTRA_TEXT);
            String all = ((title == null ? "" : title) + "\n" + (text == null ? "" : text)).trim();
            if (all.isEmpty() || !PAID.matcher(all).find() || SKIP.matcher(all).find()) return;

            Matcher am = AMOUNT.matcher(all);
            if (!am.find()) return;
            double amount = Double.parseDouble(am.group(1).replace(",", ""));
            if (amount <= 0) return;

            String payee = "";
            Matcher pm = PAYEE.matcher(all);
            if (pm.find()) payee = pm.group(1).trim();

            long ts = System.currentTimeMillis();
            if (isDuplicate(sbn.getPackageName() + "|" + amount + "|" + payee, ts)) return;

            final double amt = amount;
            final String who = payee;
            new Handler(Looper.getMainLooper()).post(() -> {
                try {
                    if (Settings.canDrawOverlays(this) && overlay == null) showOverlay(amt, who, ts);
                    else saveForReview(amt, who, ts);
                } catch (Exception e) {
                    saveForReview(amt, who, ts);
                }
            });
        } catch (Exception ignored) {
            // never crash the listener over a notification we cannot parse
        }
    }

    private boolean isDuplicate(String sig, long ts) {
        SharedPreferences sp = getSharedPreferences(PREFS, MODE_PRIVATE);
        boolean dup = sig.equals(sp.getString(KEY_LAST + "_sig", "")) && ts - sp.getLong(KEY_LAST + "_ts", 0) < 120_000;
        if (!dup) sp.edit().putString(KEY_LAST + "_sig", sig).putLong(KEY_LAST + "_ts", ts).apply();
        return dup;
    }

    // ---------- overlay ----------
    private int dp(float v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private GradientDrawable box(int color, float radiusDp, int strokeColor) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(radiusDp));
        if (strokeColor != 0) g.setStroke(dp(1), strokeColor);
        return g;
    }

    private TextView label(String s) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(11);
        t.setLetterSpacing(0.12f);
        t.setTextColor(0x66FFFFFF);
        return t;
    }

    private void showOverlay(double amount, String payee, long ts) {
        final WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        final String[] chosen = {guessCategory(payee)};

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(20), dp(20), dp(28));
        float r = dp(20);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xF2141414);
        bg.setCornerRadii(new float[]{r, r, r, r, 0, 0, 0, 0});
        bg.setStroke(dp(1), 0x14FFFFFF);
        root.setBackground(bg);

        root.addView(label("PAYMENT DETECTED · ADD EXPENSE"));

        EditText amountEt = new EditText(this);
        amountEt.setText(amount == Math.floor(amount) ? String.valueOf((long) amount) : String.valueOf(amount));
        amountEt.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        amountEt.setTextSize(34);
        amountEt.setTypeface(Typeface.DEFAULT_BOLD);
        amountEt.setTextColor(Color.WHITE);
        amountEt.setBackground(null);
        amountEt.setPadding(0, dp(6), 0, dp(6));
        root.addView(amountEt);

        EditText noteEt = new EditText(this);
        noteEt.setHint("Note (optional)");
        noteEt.setHintTextColor(0x4DFFFFFF);
        noteEt.setText(payee);
        noteEt.setSingleLine(true);
        noteEt.setTextColor(Color.WHITE);
        noteEt.setTextSize(16);
        noteEt.setBackground(box(0x0AFFFFFF, 12, 0x14FFFFFF));
        noteEt.setPadding(dp(14), dp(12), dp(14), dp(12));
        root.addView(noteEt);

        LinearLayout chipRow = new LinearLayout(this);
        chipRow.setOrientation(LinearLayout.HORIZONTAL);
        final List<TextView> chips = new ArrayList<>();
        for (final String c : CATEGORIES) {
            TextView chip = new TextView(this);
            chip.setText(c);
            chip.setTextSize(14);
            chip.setPadding(dp(16), dp(9), dp(16), dp(9));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.rightMargin = dp(8);
            chip.setLayoutParams(lp);
            chip.setOnClickListener(v -> {
                chosen[0] = c;
                paintChips(chips, chosen[0]);
            });
            chips.add(chip);
            chipRow.addView(chip);
        }
        paintChips(chips, chosen[0]);
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        scroll.addView(chipRow);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        sp.topMargin = dp(14);
        sp.bottomMargin = dp(18);
        root.addView(scroll, sp);

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        TextView skip = button("Skip", 0x0FFFFFFF, 0xB3FFFFFF);
        TextView save = button("Save expense", 0xFF7C3AED, Color.WHITE);
        buttons.addView(skip, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        LinearLayout.LayoutParams saveLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 2f);
        saveLp.leftMargin = dp(10);
        buttons.addView(save, saveLp);
        root.addView(buttons);

        skip.setOnClickListener(v -> dismissOverlay(wm));
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
            String note = noteEt.getText().toString().trim();
            try {
                JSONObject item = baseItem(value, payee, ts);
                item.put("category", chosen[0]);
                item.put("note", note);
                item.put("status", "saved");
                addPending(this, item);
                rememberCategory(payee, chosen[0]);
            } catch (Exception ignored) {
                // overlay closes either way; worst case the user re-adds it in the app
            }
            dismissOverlay(wm);
        });

        int type = Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
                type, WindowManager.LayoutParams.FLAG_DIM_BEHIND, PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.BOTTOM;
        lp.dimAmount = 0.6f;
        lp.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE;
        overlay = root;
        wm.addView(root, lp);
    }

    private TextView button(String text, int bgColor, int textColor) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setGravity(Gravity.CENTER);
        t.setTextSize(15);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setTextColor(textColor);
        t.setPadding(0, dp(14), 0, dp(14));
        t.setBackground(box(bgColor, 12, 0));
        return t;
    }

    private void paintChips(List<TextView> chips, String selected) {
        for (TextView c : chips) {
            boolean on = c.getText().toString().equals(selected);
            c.setTextColor(on ? 0xFFC4B5FD : 0xB3FFFFFF);
            c.setBackground(on ? box(0x337C3AED, 20, 0x66A78BFA) : box(0x0AFFFFFF, 20, 0x14FFFFFF));
        }
    }

    private void dismissOverlay(WindowManager wm) {
        try {
            if (overlay != null) wm.removeView(overlay);
        } catch (Exception ignored) {
            // already gone
        }
        overlay = null;
    }

    // ---------- data ----------
    private JSONObject baseItem(double amount, String payee, long ts) throws Exception {
        JSONObject item = new JSONObject();
        item.put("amount", amount);
        item.put("payee", payee);
        item.put("ts", ts);
        item.put("date", new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date(ts)));
        return item;
    }

    private String guessCategory(String payee) {
        String key = payee == null ? "" : payee.toLowerCase(Locale.ROOT);
        if (key.isEmpty()) return "Other";
        try {
            JSONObject mem = new JSONObject(getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_PAYEE_CATS, "{}"));
            if (mem.has(key)) return mem.getString(key);
        } catch (Exception ignored) {
            // fall through to keywords
        }
        for (String[] g : GUESS) {
            for (int i = 1; i < g.length; i++) if (key.contains(g[i])) return g[0];
        }
        return "Other";
    }

    private void rememberCategory(String payee, String category) {
        if (payee == null || payee.isEmpty()) return;
        try {
            SharedPreferences sp = getSharedPreferences(PREFS, MODE_PRIVATE);
            JSONObject mem = new JSONObject(sp.getString(KEY_PAYEE_CATS, "{}"));
            mem.put(payee.toLowerCase(Locale.ROOT), category);
            sp.edit().putString(KEY_PAYEE_CATS, mem.toString()).apply();
        } catch (Exception ignored) {
            // memory is a convenience only
        }
    }

    private void saveForReview(double amount, String payee, long ts) {
        try {
            JSONObject item = baseItem(amount, payee, ts);
            item.put("category", guessCategory(payee));
            item.put("note", payee);
            item.put("status", "review");
            addPending(this, item);
            postPrompt(amount, payee, ts);
        } catch (Exception ignored) {
            // nothing more we can do from a background service
        }
    }

    private void postPrompt(double amount, String payee, long ts) {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Payment expense prompts", NotificationManager.IMPORTANCE_HIGH));
        }
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int id = (int) (ts % Integer.MAX_VALUE);
        PendingIntent pi = PendingIntent.getActivity(this, id, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String amt = (amount == Math.floor(amount)) ? String.valueOf((long) amount) : String.valueOf(amount);
        Notification out = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_menu_add)
                .setContentTitle("Add expense? ₹" + amt)
                .setContentText(payee.isEmpty() ? "Tap to categorise this payment" : "Paid to " + payee + " – tap to categorise")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();
        nm.notify(id, out);
    }

    static synchronized void addPending(Context c, JSONObject item) throws Exception {
        JSONArray arr = readPending(c);
        arr.put(item);
        if (arr.length() > 50) {
            JSONArray trimmed = new JSONArray();
            for (int i = arr.length() - 50; i < arr.length(); i++) trimmed.put(arr.get(i));
            arr = trimmed;
        }
        c.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_PENDING, arr.toString()).apply();
    }

    static synchronized JSONArray readPending(Context c) {
        try {
            return new JSONArray(c.getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_PENDING, "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    static synchronized void clearPending(Context c) {
        c.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_PENDING, "[]").apply();
    }
}
