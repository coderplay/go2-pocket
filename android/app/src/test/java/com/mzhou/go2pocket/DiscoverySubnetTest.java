package com.mzhou.go2pocket;

import org.junit.Test;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.util.List;
import static org.junit.Assert.*;

public class DiscoverySubnetTest {
    private Inet4Address address(String ip) throws Exception { return (Inet4Address) InetAddress.getByName(ip); }

    @Test public void homeWifiExcludesOwnNetworkAndBroadcast() throws Exception {
        List<String> hosts = DiscoverySubnet.hosts(address("192.168.1.50"), 24);
        assertEquals(253, hosts.size());
        assertTrue(hosts.contains("192.168.1.97"));
        assertFalse(hosts.contains("192.168.1.50"));
        assertFalse(hosts.contains("192.168.1.0"));
        assertFalse(hosts.contains("192.168.1.255"));
    }
    @Test public void go2ApIsInSearchSubnet() throws Exception {
        assertTrue(DiscoverySubnet.hosts(address("192.168.12.2"), 24).contains("192.168.12.1"));
    }
    @Test public void largeWifiStaysBounded() throws Exception {
        List<String> hosts = DiscoverySubnet.hosts(address("10.5.7.20"), 8);
        assertEquals(1021, hosts.size());
        assertTrue(hosts.contains("10.5.4.1"));
        assertFalse(hosts.contains("10.5.8.1"));
    }
    @Test public void pointToPointAndSingleHostAreEmpty() throws Exception {
        assertTrue(DiscoverySubnet.hosts(address("192.168.1.20"), 31).isEmpty());
        assertTrue(DiscoverySubnet.hosts(address("192.168.1.20"), 32).isEmpty());
    }
}
