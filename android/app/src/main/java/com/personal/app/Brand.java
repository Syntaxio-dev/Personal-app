package com.personal.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

/**
 * The Prysm logo as a bitmap. Every notification carries it as its large icon, so the card shows Prysm's own logo even
 * when the phone keeps showing an old app icon it saved earlier (phones cache the app icon of a notification).
 */
final class Brand {
    private static Bitmap logo = null;

    private Brand() {}

    static synchronized Bitmap logo(Context c) {
        if (logo == null) {
            try {
                logo = BitmapFactory.decodeResource(c.getApplicationContext().getResources(), R.drawable.prysm_notif);
            } catch (Exception ignored) {
                logo = null;
            }
        }
        return logo;
    }
}
