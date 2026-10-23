package com.personal.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PaymentCapturePlugin.class);
        super.onCreate(savedInstanceState);
        // a cold start from a widget, an app-icon shortcut or a share carries its request in the launch intent
        handleLaunch(getIntent());
    }

    // when Prysm is already open the request arrives here
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleLaunch(intent);
    }

    /**
     * A home screen widget button or an app-icon shortcut asks to open something ("prysm_open"), and text shared from another app
     * waits to become a task. Both are parked in prefs until the web side takes them (takePlanned); the extras are removed so a
     * request is never handled twice.
     */
    private void handleLaunch(Intent intent) {
        if (intent == null) return;
        String open = intent.getStringExtra("prysm_open");
        if (open != null && !open.isEmpty()) {
            PlanScheduler.prefs(this).edit().putString("launch", open).apply();
            intent.removeExtra("prysm_open");
        }
        if (Intent.ACTION_SEND.equals(intent.getAction()) && intent.getType() != null && intent.getType().startsWith("text/")) {
            CharSequence cs = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            String text = cs == null ? "" : cs.toString().trim();
            if (text.length() > 300) text = text.substring(0, 300);
            if (!text.isEmpty()) PlanScheduler.prefs(this).edit().putString("shared", text).putString("launch", "shared").apply();
            intent.removeExtra(Intent.EXTRA_TEXT);
        }
    }
}
