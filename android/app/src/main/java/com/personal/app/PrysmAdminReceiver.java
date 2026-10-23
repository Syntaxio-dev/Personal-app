package com.personal.app;

import android.app.admin.DeviceAdminReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Prysm is a device admin only for one reason: while it is active Android refuses to uninstall the app, so a locked
 * limit cannot be removed by uninstalling Prysm. It asks for no policy beyond that and never locks or wipes anything.
 */
public class PrysmAdminReceiver extends DeviceAdminReceiver {
    @Override
    public CharSequence onDisableRequested(Context context, Intent intent) {
        if (ScreenTime.guardActive(context)) {
            return "Your limits are locked. Switching this off lets Prysm be uninstalled and ends the promise you made to yourself.";
        }
        return "Prysm will no longer be protected from being uninstalled.";
    }

    @Override
    public void onDisabled(Context context, Intent intent) {
        if (ScreenTime.guardActive(context)) {
            ScreenAlerts.post(context, ScreenAlerts.ID_ADMIN, "Uninstall protection is off",
                    "Your limits are still locked, but Prysm can now be removed. Turn device admin back on in Prysm > Screen time.",
                    new Intent(context, MainActivity.class));
        }
    }

    @Override
    public void onEnabled(Context context, Intent intent) {
        ScreenAlerts.cancel(context, ScreenAlerts.ID_ADMIN);
    }
}
