package com.mzhou.go2pocket;

import java.net.Inet4Address;
import java.util.ArrayList;
import java.util.List;

/** Bounded IPv4 unicast discovery, matching the existing iOS implementation. */
final class DiscoverySubnet {
    static List<String> hosts(Inet4Address ownAddress, int prefix) {
        if (prefix < 0 || prefix > 32) throw new IllegalArgumentException("Invalid Wi-Fi subnet");
        int boundedPrefix = Math.max(22, prefix);
        long own = 0;
        for (byte b : ownAddress.getAddress()) own = (own << 8) | (b & 255);
        long mask = (0xffffffffL << (32 - boundedPrefix)) & 0xffffffffL;
        long first = own & mask, last = first | (~mask & 0xffffffffL);
        List<String> result = new ArrayList<>();
        for (long ip = first + 1; ip < last; ip++) {
            if (ip != own) result.add(((ip >> 24) & 255) + "." + ((ip >> 16) & 255) + "."
                    + ((ip >> 8) & 255) + "." + (ip & 255));
        }
        return result;
    }
}
