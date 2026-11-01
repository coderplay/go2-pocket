package com.mzhou.go2pocket;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Build;
import android.os.SystemClock;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "RobotDiscovery", permissions = {
    @Permission(alias = "localNetwork", strings = {"android.permission.ACCESS_LOCAL_NETWORK"})
})
public class RobotDiscoveryPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean scanning = new AtomicBoolean(false);
    private volatile Network boundNetwork;
    private ConnectivityManager.NetworkCallback networkCallback;

    private ConnectivityManager manager() {
        return (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
    }

    private boolean permissionNeeded(PluginCall call, String callback) {
        if (Build.VERSION.SDK_INT >= 37 && getContext().getApplicationInfo().targetSdkVersion >= 37
                && getPermissionState("localNetwork") != PermissionState.GRANTED) {
            requestPermissionForAlias("localNetwork", call, callback);
            return true;
        }
        return false;
    }

    @PermissionCallback
    private void scanPermission(PluginCall call) {
        if (getPermissionState("localNetwork") == PermissionState.GRANTED) scan(call);
        else call.reject("Allow local network access in Settings to find Go2.");
    }

    @PermissionCallback
    private void preparePermission(PluginCall call) {
        if (getPermissionState("localNetwork") == PermissionState.GRANTED) prepare(call);
        else call.reject("Allow local network access in Settings to connect to Go2.");
    }

    private static final class Wifi {
        final Network network;
        final Inet4Address address;
        final int prefix;
        Wifi(Network network, Inet4Address address, int prefix) {
            this.network = network; this.address = address; this.prefix = prefix;
        }
    }

    private Wifi wifi() throws Exception {
        ConnectivityManager cm = manager();
        for (Network network : cm.getAllNetworks()) {
            NetworkCapabilities caps = cm.getNetworkCapabilities(network);
            if (caps == null || !caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) continue;
            LinkProperties links = cm.getLinkProperties(network);
            if (links == null) continue;
            for (LinkAddress link : links.getLinkAddresses()) {
                if (link.getAddress() instanceof Inet4Address && !link.getAddress().isLoopbackAddress()) {
                    return new Wifi(network, (Inet4Address) link.getAddress(), link.getPrefixLength());
                }
            }
        }
        throw new Exception("Join your home Wi-Fi or the Go2 hotspot in Settings, then try again.");
    }

    @PluginMethod
    public void prepare(PluginCall call) {
        if (permissionNeeded(call, "preparePermission")) return;
        worker.execute(() -> {
            try {
                Wifi wifi = wifi();
                if (!manager().bindProcessToNetwork(wifi.network)) throw new Exception("Could not select Wi-Fi for Go2.");
                boundNetwork = wifi.network;
                if (networkCallback == null) {
                    networkCallback = new ConnectivityManager.NetworkCallback() {
                        @Override public void onLost(Network network) {
                            if (network.equals(boundNetwork)) {
                                manager().bindProcessToNetwork(null);
                                boundNetwork = null;
                                bridge.triggerWindowJSEvent("go2-remote-lost");
                            }
                        }
                    };
                    manager().registerNetworkCallback(new NetworkRequest.Builder()
                            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build(), networkCallback);
                }
                call.resolve(new JSObject().put("ip", wifi.address.getHostAddress()));
            } catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }

    @PluginMethod
    public void release(PluginCall call) {
        worker.execute(() -> { unbind(); call.resolve(); });
    }

    private void unbind() {
        if (boundNetwork != null) manager().bindProcessToNetwork(null);
        boundNetwork = null;
        if (networkCallback != null) {
            try { manager().unregisterNetworkCallback(networkCallback); } catch (IllegalArgumentException ignored) {}
            networkCallback = null;
        }
    }

    @PluginMethod
    public void setDriving(PluginCall call) {
        boolean active = Boolean.TRUE.equals(call.getBoolean("active", false));
        getActivity().runOnUiThread(() -> {
            ((MainActivity) getActivity()).setDriving(active);
            call.resolve();
        });
    }

    @PluginMethod
    public void scan(PluginCall call) {
        if (permissionNeeded(call, "scanPermission")) return;
        if (!scanning.compareAndSet(false, true)) { call.reject("A Go2 search is already running."); return; }
        String serial = call.getString("sn", "");
        int timeout = Math.min(8000, Math.max(1000, call.getInt("timeout", 4000)));
        worker.execute(() -> {
            try { call.resolve(new JSObject().put("robots", discover(serial, timeout))); }
            catch (Exception error) { call.reject(error.getMessage(), error); }
            finally { scanning.set(false); }
        });
    }

    private JSArray discover(String serial, int timeout) throws Exception {
        Wifi wifi = wifi();
        List<String> hosts = DiscoverySubnet.hosts(wifi.address, wifi.prefix);
        Set<String> allowed = new HashSet<>(hosts);
        Map<String, JSObject> found = new LinkedHashMap<>();
        JSONObject query = new JSONObject().put("name", "unitree_dapengche");
        if (!serial.isEmpty()) query.put("sn", serial);
        byte[] payload = query.toString().getBytes(StandardCharsets.UTF_8);
        try (DatagramSocket socket = new DatagramSocket(null)) {
            socket.setReuseAddress(true);
            socket.bind(new InetSocketAddress(wifi.address, 10134));
            wifi.network.bindSocket(socket);
            socket.setSoTimeout(100);
            byte[] buffer = new byte[8192];
            long start = SystemClock.elapsedRealtime();
            int round = 0;
            while (SystemClock.elapsedRealtime() - start < timeout) {
                if (round < 3 && SystemClock.elapsedRealtime() - start >= round * 300L) {
                    for (String host : hosts) socket.send(new DatagramPacket(payload, payload.length, InetAddress.getByName(host), 10131));
                    round++;
                }
                DatagramPacket reply = new DatagramPacket(buffer, buffer.length);
                try { socket.receive(reply); } catch (SocketTimeoutException ignored) { continue; }
                try {
                    JSONObject data = new JSONObject(new String(reply.getData(), reply.getOffset(), reply.getLength(), StandardCharsets.UTF_8));
                    String sn = data.optString("sn"), ip = data.optString("ip");
                    if (sn.isEmpty() || sn.startsWith("E") || !allowed.contains(ip)
                            || !ip.equals(reply.getAddress().getHostAddress()) || (!serial.isEmpty() && !serial.equals(sn))) continue;
                    found.put(sn, new JSObject().put("sn", sn).put("ip", ip));
                } catch (Exception ignored) { /* unrelated UDP packet */ }
            }
        }
        JSArray result = new JSArray();
        for (JSObject robot : found.values()) result.put(robot);
        return result;
    }

    @Override protected void handleOnDestroy() {
        unbind(); worker.shutdownNow(); super.handleOnDestroy();
    }
}
