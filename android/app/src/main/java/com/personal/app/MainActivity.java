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
        if (intent != null && "plan".equals(intent.getStringExtra("prysm_open"))) {
            PlanScheduler.prefs(this).edit().putBoolean("openPlan", true).apply();
            intent.removeExtra("prysm_open");
        }
    }
}
