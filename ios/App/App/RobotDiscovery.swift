import Foundation
import Capacitor
import Darwin

/// Unitree discovery query, sent to individual Wi-Fi subnet addresses.
/// Unicast avoids an Apple multicast entitlement. No Mac scanner is involved.
@objc(RobotDiscoveryPlugin)
public class RobotDiscoveryPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RobotDiscoveryPlugin"
    public let jsName = "RobotDiscovery"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise)]
    private let work = DispatchQueue(label: "com.mzhou.go2pocket.discovery", qos: .userInitiated)

    @objc func scan(_ call: CAPPluginCall) {
        let sn = call.getString("sn") ?? ""
        let family = call.getString("family") ?? "Go2"
        let timeout = min(8000, max(1000, call.getInt("timeout") ?? 4000))
        work.async {
            do {
                let robots = try self.discover(sn: sn, family: family, timeout: timeout)
                DispatchQueue.main.async { call.resolve(["robots": robots]) }
            } catch {
                DispatchQueue.main.async { call.reject(error.localizedDescription) }
            }
        }
    }

    private func hosts() throws -> [String] {
        var interfaces: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&interfaces) == 0 else { throw failure("Cannot inspect Wi-Fi interface") }
        defer { freeifaddrs(interfaces) }
        var cursor = interfaces
        while let entry = cursor {
            defer { cursor = entry.pointee.ifa_next }
            guard String(cString: entry.pointee.ifa_name) == "en0",
                  let address = entry.pointee.ifa_addr,
                  let maskPointer = entry.pointee.ifa_netmask,
                  address.pointee.sa_family == UInt8(AF_INET) else { continue }
            let addr = UnsafeRawPointer(address).assumingMemoryBound(to: sockaddr_in.self).pointee
            let mask = UnsafeRawPointer(maskPointer).assumingMemoryBound(to: sockaddr_in.self).pointee
            let ownIP = UInt32(bigEndian: addr.sin_addr.s_addr)
            var netmask = UInt32(bigEndian: mask.sin_addr.s_addr)
            // Bound discovery to at most 1022 hosts; large networks retain manual-IP entry.
            if ~netmask > 1023 { netmask = 0xffffff00 }
            let network = ownIP & netmask
            let broadcast = network | ~netmask
            guard broadcast > network + 1 else { return [] }
            return ((network+1)..<broadcast).filter { $0 != ownIP }.map { ip in
                "\((ip >> 24) & 255).\((ip >> 16) & 255).\((ip >> 8) & 255).\(ip & 255)"
            }
        }
        throw failure("Connect iPhone to the same Wi-Fi as Go2, or enter the robot IP address manually.")
    }

    private func failure(_ message: String) -> NSError {
        NSError(domain: "Go2Discovery", code: Int(errno), userInfo: [NSLocalizedDescriptionKey: message])
    }

    private func discover(sn: String, family: String, timeout: Int) throws -> [[String: String]] {
        let targets = try hosts()
        let socketFD = Darwin.socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
        guard socketFD >= 0 else { throw failure("Unable to start local network discovery.") }
        defer { Darwin.close(socketFD) }
        var reuse: Int32 = 1
        setsockopt(socketFD, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))
        var interval = timeval(tv_sec: 0, tv_usec: 100000)
        setsockopt(socketFD, SOL_SOCKET, SO_RCVTIMEO, &interval, socklen_t(MemoryLayout<timeval>.size))
        var listener = sockaddr_in()
        listener.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        listener.sin_family = sa_family_t(AF_INET)
        listener.sin_port = UInt16(10134).bigEndian
        listener.sin_addr.s_addr = INADDR_ANY
        let bound = withUnsafePointer(to: &listener) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(socketFD, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bound == 0 else { throw failure("Discovery port 10134 is busy. Try again or enter an IP address.") }
        var query = ["name": "unitree_dapengche"]
        if !sn.isEmpty { query["sn"] = sn }
        let payload = try JSONSerialization.data(withJSONObject: query)
        var results: [String: [String: String]] = [:]
        var buffer = [UInt8](repeating: 0, count: 8192)
        let start = Date()
        var round = 0
        while Date().timeIntervalSince(start) * 1000 < Double(timeout) {
            if round < 3 && Date().timeIntervalSince(start) >= Double(round) * 0.3 {
                for ip in targets {
                    var destination = sockaddr_in()
                    destination.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
                    destination.sin_family = sa_family_t(AF_INET)
                    destination.sin_port = UInt16(10131).bigEndian
                    destination.sin_addr.s_addr = inet_addr(ip)
                    _ = payload.withUnsafeBytes { bytes in
                        withUnsafePointer(to: &destination) { pointer in
                            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                                Darwin.sendto(socketFD, bytes.baseAddress, bytes.count, 0, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
                            }
                        }
                    }
                }
                round += 1
            }
            let count = buffer.withUnsafeMutableBytes { Darwin.recvfrom(socketFD, $0.baseAddress, $0.count, 0, nil, nil) }
            if count < 1 { continue }
            let data = Data(buffer.prefix(count))
            guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let robotSN = object["sn"] as? String,
                  let ip = object["ip"] as? String,
                  targets.contains(ip), sn.isEmpty || sn == robotSN else { continue }
            if family == "Go2" && robotSN.hasPrefix("E") { continue }
            if family != "Go2" && robotSN.hasPrefix("B") { continue }
            results[robotSN] = ["sn": robotSN, "ip": ip]
        }
        return results.values.sorted { ($0["ip"] ?? "") < ($1["ip"] ?? "") }
    }
}

class PocketViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(RobotDiscoveryPlugin())
        webView?.allowsBackForwardNavigationGestures = false
        webView?.scrollView.bounces = false
    }
}
