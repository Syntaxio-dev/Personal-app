package com.personal.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;

/** Woken by the nightly alarm: shows the Plan tomorrow popup over any app, or a notification if it cannot. */
public class PlanReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !PlanScheduler.ACTION.equals(intent.getAction())) return;
        Context app = context.getApplicationContext();
        // arm tomorrow's alarm first, so nothing below can break the next reminder
        PlanScheduler.schedule(app);
        if (!PlanScheduler.prefs(app).getBoolean("on", false)) return;
        boolean shown = false;
        if (Settings.canDrawOverlays(app)) {
            try {
                if (!PlanOverlay.isShowing()) PlanOverlay.show(app);
                shown = true;
                PaymentListenerService.log(app, "prysm", null, "plan popup shown");
            } catch (Exception e) {
                PaymentListenerService.log(app, "prysm", null, "plan popup failed: " + e);
            }
        }
        if (!shown) PlanScheduler.notifyFallback(app);
    }
}
