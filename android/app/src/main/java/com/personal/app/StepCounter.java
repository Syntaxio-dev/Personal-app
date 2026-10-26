package com.personal.app;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.Map;

/**
 * Steps from the phone's own step counter (Fitness mode). The sensor keeps counting in hardware even when Prysm is
 * closed, so a reading only has to be taken now and then: when the app opens, and every ten minutes from
 * {@link KeepAliveService}. Each reading adds the steps taken since the previous one to that day's total.
 * The sensor value is "steps since the phone started", so after a reboot it is lower than the last reading.
 * Nothing leaves the phone.
 */
public final class StepCounter {
    private static final String PREFS = "prysm_steps";
    private static final String DAY = "d_";
    private static final int KEEP_DAYS = 400;
    private static final long WAIT_MS = 4000;

    private StepCounter() {
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean supported(Context c) {
        SensorManager sm = (SensorManager) c.getSystemService(Context.SENSOR_SERVICE);
        return sm != null && sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null;
    }

    /** Android 10 and up ask for "Physical activity"; older versions need nothing. */
    static boolean granted(Context c) {
        if (Build.VERSION.SDK_INT < 29) return true;
        return ContextCompat.checkSelfPermission(c, Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * Steps since the previous reading. The very first reading has nothing to compare with, so it adds nothing.
     * A value lower than the last one means the phone restarted: the counter began again at 0, so it IS the steps since boot.
     */
    static long delta(long lastRaw, long raw) {
        if (lastRaw < 0 || raw < 0) return 0;
        return raw >= lastRaw ? raw - lastRaw : raw;
    }

    static String dayOf(long ms) {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date(ms));
    }

    static synchronized void record(Context c, long raw, long nowMs) {
        SharedPreferences p = prefs(c);
        long add = delta(p.getLong("lastRaw", -1), raw);
        String key = DAY + dayOf(nowMs);
        SharedPreferences.Editor e = p.edit();
        e.putLong("lastRaw", raw);
        e.putLong("lastAt", nowMs);
        if (add > 0) e.putLong(key, p.getLong(key, 0) + add);
        // keep about a year of days
        String cutoff = DAY + dayOf(nowMs - KEEP_DAYS * 86400000L);
        for (String k : p.getAll().keySet()) {
            if (k.startsWith(DAY) && k.compareTo(cutoff) < 0) e.remove(k);
        }
        e.apply();
    }

    /** One reading of the sensor, then {@code done} (on the main thread), whether or not a value came. */
    static void sample(final Context c, final Runnable done) {
        final Context app = c.getApplicationContext();
        final Handler h = new Handler(Looper.getMainLooper());
        final SensorManager sm = (SensorManager) app.getSystemService(Context.SENSOR_SERVICE);
        final Sensor sensor = sm == null ? null : sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
        if (sensor == null || !granted(app)) {
            if (done != null) h.post(done);
            return;
        }
        final boolean[] finished = {false};
        final SensorEventListener listener = new SensorEventListener() {
            @Override
            public void onSensorChanged(SensorEvent event) {
                if (finished[0]) return;
                finished[0] = true;
                sm.unregisterListener(this);
                try {
                    record(app, (long) event.values[0], System.currentTimeMillis());
                } catch (Exception ignored) {
                    // a failed write only means this reading is skipped
                }
                if (done != null) done.run();
            }

            @Override
            public void onAccuracyChanged(Sensor s, int accuracy) {
            }
        };
        boolean ok = false;
        try {
            ok = sm.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL, h);
        } catch (Exception ignored) {
            // treated as "no reading" below
        }
        if (!ok) {
            if (done != null) h.post(done);
            return;
        }
        // the sensor normally answers at once; do not wait for it forever
        h.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (finished[0]) return;
                finished[0] = true;
                sm.unregisterListener(listener);
                if (done != null) done.run();
            }
        }, WAIT_MS);
    }

    /** { "2026-10-26": 7421, ... } */
    static JSONObject days(Context c) {
        JSONObject o = new JSONObject();
        for (Map.Entry<String, ?> e : prefs(c).getAll().entrySet()) {
            if (e.getKey().startsWith(DAY) && e.getValue() instanceof Long) {
                try {
                    o.put(e.getKey().substring(DAY.length()), ((Long) e.getValue()).longValue());
                } catch (Exception ignored) {
                    // skip a bad entry
                }
            }
        }
        return o;
    }
}
