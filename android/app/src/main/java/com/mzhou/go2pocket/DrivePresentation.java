package com.mzhou.go2pocket;

/** Serializes requested Drive mode with the actual window layout, not a JS ack. */
final class DrivePresentation {
    interface Window {
        void requestOrientation(boolean driving);
        void keepAwake(boolean active);
        boolean hasFocus();
        boolean readyForFullscreen();
        void postFrame(Runnable action);
        void cancelFrame(Runnable action);
        void hideSystemBars(boolean hidden);
    }

    private final Window window;
    private boolean driving, initialized, closed;
    private final Runnable apply = this::applyAfterLayout;

    DrivePresentation(Window window) { this.window = window; }

    void setDriving(boolean active) {
        if (closed) return;
        boolean changed = !initialized || driving != active;
        initialized = true;
        driving = active;
        // Store the latest intent before requesting a configuration change.
        if (changed) window.requestOrientation(active);
        window.keepAwake(active);
        refresh();
    }

    void refresh() {
        if (closed || !initialized) return;
        window.cancelFrame(apply);
        window.postFrame(apply);
    }

    private void applyAfterLayout() {
        if (closed || !window.hasFocus()) return;
        // A compact portrait window is still rotating. Layout/configuration
        // callbacks retry; large foldable screens may ignore orientation locks.
        if (driving && !window.readyForFullscreen()) return;
        window.hideSystemBars(driving);
    }

    void close() {
        closed = true;
        window.cancelFrame(apply);
    }
}
