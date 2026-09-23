package com.smartexam.app;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // Block Screenshots and Screen Recording
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        );
    }

    // Fixed: Access level changed from protected to public
    @Override
    public void onPause() {
        super.onPause();
        // Trigger JavaScript event to log tab/app switch violation in backend
        this.bridge.getWebView().evaluateJavascript("window.onAppSwitchDetected && window.onAppSwitchDetected();", null);
    }
}