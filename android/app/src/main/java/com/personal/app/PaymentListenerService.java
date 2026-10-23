package com.personal.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Parcelable;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Watches notifications from UPI apps and from SMS apps (bank debit alerts). When one looks like an
 * outgoing payment it shows an "Add expense" sheet over whatever app is open (needs "Display over
 * other apps"). Without that permission it falls back to a notification that opens the app.
 * Everything stays on the phone. Every decision is written to a small log the user can read in Settings.
 *
 * Items handed to the web layer: {amount, payee, category, note, date, ts, status}
 *   status "saved"  - confirmed in the overlay, JS just stores it
 *   status "review" - not confirmed yet, JS asks the user
 */
public class PaymentListenerService extends NotificationListenerService {
    static final String PREFS = "payment_capture";
    static final String KEY_PENDING = "pending";
    static final String KEY_LOG = "log";
    static final String KEY_PAYEE_CATS = "payee_cats";
    static final String CHANNEL = "payment_expense";

    static final String[] CATEGORIES = {"Food", "Groceries", "Petrol", "Vehicle", "Travel", "Bills", "Rent", "Shopping", "Health", "Fun", "Family", "Friends", "Loan EMI", "Repayment", "Other"};

    private static final Set<String> UPI_APPS = new HashSet<>(Arrays.asList(
            "com.phonepe.app",
            "com.google.android.apps.nbu.paisa.user",
            "net.one97.paytm",
            "in.org.npci.upiapp",
            "com.dreamplug.androidapp",
            "in.amazon.mShop.android.shopping",
            "com.mobikwik_new",
            "com.freecharge.android",
            "com.sbi.upi",
            "com.csam.icici.bank.imobile",
            "com.snapwork.hdfc",
            "com.axis.mobile"
    ));

    private static final Set<String> SMS_APPS = new HashSet<>(Arrays.asList(
            "com.google.android.apps.messaging",
            "com.android.mms",
            "com.android.messaging",
            "com.samsung.android.messaging",
            "com.oneplus.mms",
            "com.coloros.mms",
            "com.miui.mms"
    ));

    private static final int CI = Pattern.CASE_INSENSITIVE;
    private static final Pattern AMOUNT = Pattern.compile("(?:\u20B9|Rs\\.?|INR)\\s?([0-9][0-9,]*(?:\\.[0-9]{1,2})?)", CI);
    private static final Pattern AMOUNT_BARE = Pattern.compile("\\b(?:paid|sent|debited|payment of|paying)\\s+(?:of\\s+)?([0-9][0-9,]*(?:\\.[0-9]{1,2})?)", CI);
    private static final Pattern STRONG = Pattern.compile("\\b(paid|debited|sent|successful|transferred)\\b", CI);
    private static final Pattern SMS_DEBIT = Pattern.compile("\\b(debited|spent|paid|sent|withdrawn|purchase|transferred)\\b", CI);
    private static final Pattern SMS_CTX = Pattern.compile("\\b(upi|vpa|a/c|acct|account|card|txn|imps|neft)\\b", CI);
    private static final Pattern SKIP = Pattern.compile("\\b(failed|declined|reversed|refund(?:ed)?|requested|collect request|otp|pending)\\b", CI);
    private static final Pattern INCOMING = Pattern.compile("\\b(received|credited to your|credited in your|has sent you|sent you|deposited)\\b", CI);
    private static final Pattern PAYEE = Pattern.compile("\\bto\\s+(?:vpa\\s+)?([^\\n.,]+?)(?:\\s+(?:via|using|from|on|successful|is|ref|upi|txn)\\b|[.,\\n]|$)", CI);

    private static final String[][] GUESS = {
            {"Food", "zomato", "swiggy", "restaurant", "cafe", "pizza", "burger", "kitchen", "bakery", "dominos", "mcdonald", "kfc", "chai", "juice", "sweets"},
            {"Groceries", "bigbasket", "blinkit", "zepto", "dmart", "grocery", "kirana", "supermarket", "instamart", "jiomart"},
            {"Petrol", "petrol", "fuel", "hpcl", "bpcl", "indian oil", "iocl", "shell", "nayara", "fastag"},
            {"Travel", "uber", "ola", "rapido", "irctc", "redbus", "metro", "makemytrip"},
            {"Bills", "jio", "airtel", "vodafone", "electricity", "bijli", "recharge", "broadband", "gas", "water", "insurance", "dth"},
            {"Shopping", "amazon", "flipkart", "myntra", "meesho", "mart", "store", "mall"},
            {"Health", "pharmacy", "medical", "hospital", "clinic", "apollo", "medplus", "labs"},
            {"Fun", "netflix", "spotify", "bookmyshow", "hotstar", "prime", "cinema", "game"}
    };

    static final class Verdict {
        final boolean ok;
        final double amount;
        final String payee;
        final String reason;

        Verdict(boolean ok, double amount, String payee, String reason) {
            this.ok = ok;
            this.amount = amount;
            this.payee = payee;
            this.reason = reason;
        }

        static Verdict no(String reason) {
            return new Verdict(false, 0, "", reason);
        }
    }

    // ---------- listener ----------
    @Override
    public void onListenerConnected() {
        log(this, "prysm", null, "listener connected");
    }

    @Override
    public void onListenerDisconnected() {
        log(this, "prysm", null, "listener disconnected, asking Android to reconnect");
        try {
            if (Build.VERSION.SDK_INT >= 24) {
                NotificationListenerService.requestRebind(new ComponentName(this, PaymentListenerService.class));
            }
        } catch (Exception ignored) {
            // nothing else we can do
        }
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            if (sbn == null) return;
            final String pkg = sbn.getPackageName();
            final boolean sms = SMS_APPS.contains(pkg);
            // an app that is blocked right now must not be usable through its notifications either (inline replies);
            // payment and bank messages are never touched
            if (!sms && !UPI_APPS.contains(pkg) && ScreenTime.hideNotificationsOf(this, pkg)) {
                cancelNotification(sbn.getKey());
                return;
            }
            if (!sms && !UPI_APPS.contains(pkg)) return;
            Notification n = sbn.getNotification();
            if (n == null || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;

            String all = collectText(n);
            if (all.isEmpty()) return;

            Verdict v = classify(all, sms);
            final long ts = System.currentTimeMillis();
            // SMS text can hold OTPs, so only a captured debit is described in the log
            String shown = sms ? (v.ok ? "Debit SMS \u20B9" + v.amount : "(SMS text not stored)") : all;

            if (v.ok && isDuplicate(this, v.amount, v.payee, ts)) {
                log(this, pkg, shown, "skipped: same payment already captured a moment ago");
                return;
            }
            log(this, pkg, shown, v.reason);
            if (!v.ok) return;

            final double amt = v.amount;
            final String who = v.payee;
            final Context app = getApplicationContext();
            new Handler(Looper.getMainLooper()).post(() -> handleCaptured(app, amt, who, ts));
        } catch (Exception e) {
            log(this, "prysm", null, "error: " + e);
        }
    }

    static Verdict classify(String all, boolean sms) {
        if (SKIP.matcher(all).find()) return Verdict.no("skipped: failed, refund, request, pending or OTP wording");
        if (INCOMING.matcher(all).find()) return Verdict.no("skipped: money received, not paid");
        double amount = 0;
        Matcher am = AMOUNT.matcher(all);
        if (am.find()) {
            amount = parseAmount(am.group(1));
        } else {
            Matcher bare = AMOUNT_BARE.matcher(all);
            if (bare.find()) amount = parseAmount(bare.group(1));
        }
        if (amount <= 0) return Verdict.no("skipped: no amount found");
        boolean debit = sms ? (SMS_DEBIT.matcher(all).find() && SMS_CTX.matcher(all).find()) : STRONG.matcher(all).find();
        if (!debit) return Verdict.no(sms ? "skipped: SMS is not a debit alert" : "skipped: no paid/sent/successful wording");
        String payee = "";
        Matcher pm = PAYEE.matcher(all);
        if (pm.find()) payee = pm.group(1).trim();
        return new Verdict(true, amount, payee, "captured");
    }

    private static double parseAmount(String s) {
        try {
            return Double.parseDouble(s.replace(",", ""));
        } catch (Exception e) {
            return 0;
        }
    }

    private static String collectText(Notification n) {
        Bundle e = n.extras;
        if (e == null) return "";
        StringBuilder sb = new StringBuilder();
        append(sb, e.getCharSequence(Notification.EXTRA_TITLE));
        append(sb, e.getCharSequence(Notification.EXTRA_TEXT));
        append(sb, e.getCharSequence(Notification.EXTRA_BIG_TEXT));
        append(sb, e.getCharSequence(Notification.EXTRA_SUB_TEXT));
        CharSequence[] lines = e.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
        if (lines != null) for (CharSequence l : lines) append(sb, l);
        Parcelable[] msgs = e.getParcelableArray(Notification.EXTRA_MESSAGES);
        if (msgs != null) {
            for (Parcelable p : msgs) {
                if (p instanceof Bundle) append(sb, ((Bundle) p).getCharSequence("text"));
            }
        }
        return sb.toString().trim();
    }

    private static void append(StringBuilder sb, CharSequence cs) {
        if (cs == null) return;
        String s = cs.toString().trim();
        if (s.isEmpty() || sb.indexOf(s) >= 0) return;
        if (sb.length() > 0) sb.append('\n');
        sb.append(s);
    }

    private static boolean isDuplicate(Context c, double amount, String payee, long ts) {
        SharedPreferences sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String amt = String.valueOf(amount);
        String lastPayee = sp.getString("dup_payee", "");
        boolean samePayee = payee.isEmpty() || lastPayee.isEmpty() || payee.equalsIgnoreCase(lastPayee);
        boolean dup = amt.equals(sp.getString("dup_amt", "")) && samePayee && ts - sp.getLong("dup_ts", 0) < 180_000;
        if (!dup) sp.edit().putString("dup_amt", amt).putString("dup_payee", payee).putLong("dup_ts", ts).apply();
        return dup;
    }

    // ---------- what to do with a captured payment ----------
    static void handleCaptured(Context ctx, double amount, String payee, long ts) {
        try {
            if (Settings.canDrawOverlays(ctx) && !PaymentOverlay.isShowing()) {
                PaymentOverlay.show(ctx, amount, payee, ts, false);
                log(ctx, "prysm", null, "expense sheet shown over the current app");
            } else {
                log(ctx, "prysm", null, "overlay not available, sent a notification instead");
                saveForReview(ctx, amount, payee, ts);
            }
        } catch (Exception e) {
            log(ctx, "prysm", null, "overlay failed (" + e + "), sent a notification instead");
            saveForReview(ctx, amount, payee, ts);
        }
    }

    static JSONObject baseItem(double amount, String payee, long ts) throws Exception {
        JSONObject item = new JSONObject();
        item.put("amount", amount);
        item.put("payee", payee);
        item.put("ts", ts);
        item.put("date", new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date(ts)));
        return item;
    }

    static String guessCategory(Context c, String payee) {
        String key = payee == null ? "" : payee.toLowerCase(Locale.ROOT);
        if (key.isEmpty()) return "Other";
        try {
            JSONObject mem = new JSONObject(c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_PAYEE_CATS, "{}"));
            if (mem.has(key)) return mem.getString(key);
        } catch (Exception ignored) {
            // fall through to keywords
        }
        for (String[] g : GUESS) {
            for (int i = 1; i < g.length; i++) if (key.contains(g[i])) return g[0];
        }
        return "Other";
    }

    static void rememberCategory(Context c, String payee, String category) {
        if (payee == null || payee.isEmpty()) return;
        try {
            SharedPreferences sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONObject mem = new JSONObject(sp.getString(KEY_PAYEE_CATS, "{}"));
            mem.put(payee.toLowerCase(Locale.ROOT), category);
            sp.edit().putString(KEY_PAYEE_CATS, mem.toString()).apply();
        } catch (Exception ignored) {
            // memory is a convenience only
        }
    }

    static void saveForReview(Context ctx, double amount, String payee, long ts) {
        try {
            JSONObject item = baseItem(amount, payee, ts);
            item.put("category", guessCategory(ctx, payee));
            item.put("note", payee);
            item.put("status", "review");
            addPending(ctx, item);
            postPrompt(ctx, amount, payee, ts);
        } catch (Exception ignored) {
            // nothing more we can do from a background service
        }
    }

    static void postPrompt(Context ctx, double amount, String payee, long ts) {
        if (Build.VERSION.SDK_INT >= 33
                && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Payment expense prompts", NotificationManager.IMPORTANCE_HIGH));
        }
        Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int id = (int) (ts % Integer.MAX_VALUE);
        PendingIntent pi = PendingIntent.getActivity(ctx, id, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String amt = (amount == Math.floor(amount)) ? String.valueOf((long) amount) : String.valueOf(amount);
        Notification out = new NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_prysm)
                .setLargeIcon(Brand.logo(ctx))
                .setColor(0xFF7C3AED)
                .setContentTitle("Add expense? \u20B9" + amt)
                .setContentText(payee.isEmpty() ? "Tap to categorise this payment" : "Paid to " + payee + " \u2013 tap to categorise")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();
        nm.notify(id, out);
    }

    // ---------- storage shared with the plugin and overlay ----------
    static synchronized void addPending(Context c, JSONObject item) throws Exception {
        JSONArray arr = readPending(c);
        arr.put(item);
        if (arr.length() > 50) {
            JSONArray trimmed = new JSONArray();
            for (int i = arr.length() - 50; i < arr.length(); i++) trimmed.put(arr.get(i));
            arr = trimmed;
        }
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_PENDING, arr.toString()).apply();
    }

    static synchronized JSONArray readPending(Context c) {
        try {
            return new JSONArray(c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_PENDING, "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    static synchronized void clearPending(Context c) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_PENDING, "[]").apply();
    }

    static synchronized void log(Context c, String app, String text, String result) {
        try {
            SharedPreferences sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONArray arr = new JSONArray(sp.getString(KEY_LOG, "[]"));
            JSONObject o = new JSONObject();
            o.put("ts", System.currentTimeMillis());
            o.put("app", app);
            o.put("text", text == null ? "" : (text.length() > 160 ? text.substring(0, 160) : text));
            o.put("result", result);
            JSONArray out = new JSONArray();
            for (int i = Math.max(0, arr.length() - 39); i < arr.length(); i++) out.put(arr.get(i));
            out.put(o);
            sp.edit().putString(KEY_LOG, out.toString()).apply();
        } catch (Exception ignored) {
            // logging must never break capture
        }
    }

    static synchronized JSONArray readLog(Context c) {
        try {
            return new JSONArray(c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_LOG, "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    static synchronized void clearLog(Context c) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_LOG, "[]").apply();
    }
}
