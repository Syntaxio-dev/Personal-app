package com.personal.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;

import org.json.JSONObject;

/** Woken at the due time of a SIP or bill: asks "did you pay it?" over whatever app is open. */
public class ConfirmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ConfirmScheduler.ACTION.equals(intent.getAction())) return;
        Context app = context.getApplicationContext();
        String key = intent.getStringExtra("key");
        if (key == null) return;
        JSONObject item = ConfirmScheduler.find(app, key);
        if (item == null) return;
        // one sheet at a time: if another popup is up, try again in a minute
        if (OverlayHost.anyShowing()) {
            ConfirmScheduler.later(app, key, 1);
            return;
        }
        boolean shown = false;
        if (Settings.canDrawOverlays(app)) {
            try {
                ConfirmOverlay.show(app, item);
                shown = true;
                PaymentListenerService.log(app, "prysm", null, "confirm popup shown: " + item.optString("title"));
            } catch (Exception e) {
                PaymentListenerService.log(app, "prysm", null, "confirm popup failed: " + e);
            }
        }
        if (!shown) ConfirmScheduler.notifyFallback(app, item);
    }
}
