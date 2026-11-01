package com.mzhou.go2pocket;

import android.content.res.Configuration;
import android.content.pm.ActivityInfo;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private DrivePresentation presentation;
    private final View.OnLayoutChangeListener layoutListener = (view, l, t, r, b, ol, ot, or, ob) -> {
        if (presentation != null && (r - l != or - ol || b - t != ob - ot)) presentation.refresh();
    };

    @Override public void onCreate(Bundle state) {
        registerPlugin(RobotDiscoveryPlugin.class);
        super.onCreate(state);
        View decor = getWindow().getDecorView();
        presentation = new DrivePresentation(new DrivePresentation.Window() {
            @Override public void requestOrientation(boolean active) {
                setRequestedOrientation(active ? ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                        : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            }
            @Override public void keepAwake(boolean active) {
                if (active) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
            @Override public boolean hasFocus() { return hasWindowFocus(); }
            @Override public boolean readyForFullscreen() {
                Configuration config = getResources().getConfiguration();
                return decor.getWidth() > 0 && decor.getHeight() > 0
                        && (config.smallestScreenWidthDp >= 600
                        || (config.orientation == Configuration.ORIENTATION_LANDSCAPE
                        && decor.getWidth() >= decor.getHeight()));
            }
            @Override public void postFrame(Runnable action) { decor.postOnAnimation(action); }
            @Override public void cancelFrame(Runnable action) { decor.removeCallbacks(action); }
            @Override public void hideSystemBars(boolean hidden) {
                WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), decor);
                controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                if (hidden) controller.hide(WindowInsetsCompat.Type.systemBars());
                else controller.show(WindowInsetsCompat.Type.systemBars());
                ViewCompat.requestApplyInsets(decor);
            }
        });
        decor.addOnLayoutChangeListener(layoutListener);
    }

    public void setDriving(boolean active) {
        presentation.setDriving(active);
    }

    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        if (bridge != null) bridge.triggerWindowJSEvent("go2-suspend");
        if (presentation != null) presentation.refresh();
    }

    @Override public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (focused && presentation != null) presentation.refresh();
    }

    @Override public void onDestroy() {
        if (presentation != null) presentation.close();
        getWindow().getDecorView().removeOnLayoutChangeListener(layoutListener);
        super.onDestroy();
    }
}
