package com.mzhou.go2pocket;

import org.junit.Test;
import java.util.ArrayList;
import java.util.List;
import static org.junit.Assert.*;

public class DrivePresentationTest {
    private static final class Window implements DrivePresentation.Window {
        boolean focused = true, ready, awake;
        final List<Boolean> orientations = new ArrayList<>(), hidden = new ArrayList<>();
        final List<Runnable> frames = new ArrayList<>();
        public void requestOrientation(boolean driving) { orientations.add(driving); }
        public void keepAwake(boolean active) { awake = active; }
        public boolean hasFocus() { return focused; }
        public boolean readyForFullscreen() { return ready; }
        public void postFrame(Runnable action) { frames.add(action); }
        public void cancelFrame(Runnable action) { frames.removeIf(frame -> frame == action); }
        public void hideSystemBars(boolean value) { hidden.add(value); }
        void frame() {
            List<Runnable> actions = new ArrayList<>(frames);
            frames.clear();
            actions.forEach(Runnable::run);
        }
    }

    @Test public void compactPortraitDoesNotHideBarsUntilRotatedLayoutIsReady() {
        Window window = new Window();
        DrivePresentation mode = new DrivePresentation(window);
        mode.setDriving(true);
        assertEquals(List.of(true), window.orientations);
        assertTrue(window.awake);
        window.frame();
        assertTrue("orientation request ack is not a completed layout", window.hidden.isEmpty());
        window.ready = true;
        mode.refresh();
        window.frame();
        assertEquals(List.of(true), window.hidden);
    }

    @Test public void leavingBeforeRotationCompletesCannotRehideHome() {
        Window window = new Window();
        DrivePresentation mode = new DrivePresentation(window);
        mode.setDriving(true);
        Runnable staleFrame = window.frames.get(0);
        mode.setDriving(false);
        window.ready = true;
        // Even a callback already dispatched before cancellation uses the
        // latest intent instead of a captured, obsolete Drive value.
        staleFrame.run();
        window.frame();
        assertFalse(window.awake);
        assertEquals(List.of(true, false), window.orientations);
        assertTrue(window.hidden.stream().allMatch(value -> !value));
    }

    @Test public void rapidReentryAppliesOnlyLatestRequestedMode() {
        Window window = new Window(); window.ready = true;
        DrivePresentation mode = new DrivePresentation(window);
        mode.setDriving(true); mode.setDriving(false); mode.setDriving(true);
        assertEquals(1, window.frames.size());
        window.frame();
        assertEquals(List.of(true), window.hidden);
        assertTrue(window.awake);
    }

    @Test public void largeFoldableDoesNotWaitForAnIgnoredOrientationRequest() {
        Window window = new Window();
        // MainActivity considers a measured large inner display ready even
        // when Android ignores the landscape request and keeps it portrait.
        window.ready = true;
        DrivePresentation mode = new DrivePresentation(window);
        mode.setDriving(true);
        window.frame();
        assertEquals(List.of(true), window.hidden);
    }

    @Test public void focusReturnUsesLatestModeWithoutRequestingAnotherRotation() {
        Window window = new Window(); window.ready = true; window.focused = false;
        DrivePresentation mode = new DrivePresentation(window);
        mode.setDriving(true); window.frame();
        assertTrue(window.hidden.isEmpty());
        window.focused = true;
        mode.refresh(); window.frame();
        assertEquals(List.of(true), window.hidden);
        assertEquals(List.of(true), window.orientations);
    }

    @Test public void repeatedLayoutCallbacksAreCoalescedAndDoNotRelockOrientation() {
        Window window = new Window(); window.ready = true;
        DrivePresentation mode = new DrivePresentation(window);
        mode.setDriving(true);
        mode.refresh(); mode.refresh(); mode.refresh();
        assertEquals(1, window.frames.size());
        window.frame();
        assertEquals(List.of(true), window.hidden);
        assertEquals(List.of(true), window.orientations);
    }

    @Test public void destroyedWindowRejectsQueuedOrLateCallbacks() {
        Window window = new Window(); window.ready = true;
        DrivePresentation mode = new DrivePresentation(window);
        mode.setDriving(true);
        Runnable staleFrame = window.frames.get(0);
        mode.close();
        mode.setDriving(false); mode.refresh(); staleFrame.run(); window.frame();
        assertTrue(window.frames.isEmpty());
        assertTrue(window.hidden.isEmpty());
        assertEquals(List.of(true), window.orientations);
    }
}
