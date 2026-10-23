package com.personal.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PaymentCapturePlugin.class);
        super.onCreate(savedInstanceState);
    }

    // BridgeActivity also routes the launch intent through here, so this covers cold starts too
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String open = intent == null ? null : intent.getStringExtra("prysm_open");
        if (open != null && !open.isEmpty()) {
            PlanScheduler.prefs(this).edit().putString("launch", open).apply();
            intent.removeExtra("prysm_open");
        }
    }
}
