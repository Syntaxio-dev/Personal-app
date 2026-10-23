package com.personal.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Alarms and services do not survive a reboot or an app update; this puts them back. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                && !"android.intent.action.QUICKBOOT_POWERON".equals(action)) return;
        Context app = context.getApplicationContext();
        PlanScheduler.schedule(app);
        ConfirmScheduler.schedule(app);
        if (KeepAliveService.wanted(app)) KeepAliveService.start(app);
    }
}
