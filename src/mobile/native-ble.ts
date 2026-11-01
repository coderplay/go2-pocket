/** Native iOS / Android Bluetooth transport behind the UI's API contract.
 * No Mac, Python server or localhost WebSocket is used on either phone.
 */
import { BleClient, type ScanResult } from '@capacitor-community/bluetooth-le';
import { android } from './native-device';
import { MAGIC, encode, decode, inner, cfb, probe, gcm, decryptGcm, parseRemote } from './ble-protocol';

const FFE = { service: '0000ffe0-0000-1000-8000-00805f9b34fb',
  write: '0000ffe2-0000-1000-8000-00805f9b34fb', notify: '0000ffe1-0000-1000-8000-00805f9b34fb' };
const NUS = { service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  write: '6e400002-b5a3-f393-e0a9-e50e24dcca9e', notify: '6e400003-b5a3-f393-e0a9-e50e24dcca9e' };
type Topic = 'status' | 'adapters' | 'remote_state';
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const dataview = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

export class NativeBle {
  private initialized = false;
  private devices = new Map<string, ScanResult>();
  private listeners = new Map<Topic, Set<(data: any) => void>>();
  private robot = { connected: false, address: '', protocol: '' };
  private remote = { connected: false, address: '', name: '' };
  private transport = FFE;
  private writeWithoutResponse = false;
  private key = '';
  private keyArmed = false;
  private checkWriteError: Error | null = null;
  private version: number | null = null;
  private serial = '';
  private f1Serial = '';
  private keyBlob = '';
  private chunks = new Map<number, Map<number, Uint8Array>>();
  private replies = new Map<number, { sequence: number; raw: Uint8Array }>();
  private sequence = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private lastRemote = 0;
  private remoteState: ReturnType<typeof parseRemote> | null = null;

  constructor(private client = BleClient, monitor = true) {
    if (!monitor || typeof window === 'undefined') return;
    setInterval(() => {
      if (this.remote.connected && Date.now()-this.lastRemote > 1000) {
        this.remote.connected = false;
        this.remoteState = null;
        window.dispatchEvent(new Event('go2-remote-lost'));
        void this.client.disconnect(this.remote.address).catch(() => {});
        this.emit('status', this.status());
      }
    }, 250);
  }

  subscribe(topic: Topic, cb: (data: any) => void): () => void {
    const set = this.listeners.get(topic) || new Set(); this.listeners.set(topic, set); set.add(cb);
    queueMicrotask(() => {
      if (!set.has(cb)) return;
      if (topic === 'status') cb(this.status());
      if (topic === 'adapters') cb(this.adapters());
    });
    return () => { set.delete(cb); };
  }
  private emit(topic: Topic, data: unknown): void { this.listeners.get(topic)?.forEach(cb => cb(data)); }
  private status() { return { robot: { ...this.robot }, remote: { ...this.remote } }; }
  private adapters() {
    const name = android ? 'android' : 'iphone';
    return { current: name, adapters: [{ name, address: android ? 'Android Bluetooth' : 'CoreBluetooth', up: true, powered: true }] };
  }
  private async init() {
    if (this.initialized) return;
    await this.client.initialize({ androidNeverForLocation: true }); this.initialized = true;
  }
  private async scan(timeout: number) {
    await this.init(); this.devices.clear();
    await this.client.requestLEScan({}, r => {
      const name = r.localName || r.device.name || '';
      if (/^(Go2_|Unitree)/.test(name)) this.devices.set(r.device.deviceId, r);
    });
    try { await sleep(Math.min(15_000, Math.max(1000, timeout))); }
    finally { await this.client.stopLEScan(); }
    const robots: unknown[] = [], remotes: unknown[] = [];
    this.devices.forEach((r, address) => {
      const name = r.localName || r.device.name || '';
      const uuids = (r.device.uuids || []).map(v => v.toLowerCase());
      const item = { name, address, rssi: r.rssi ?? null,
        protocol: uuids.includes(NUS.service) ? 'nus' : 'ffe0' };
      (name.startsWith('Unitree') ? remotes : robots).push(item);
    });
    return { robots, remotes };
  }
  private resetRobot() {
    this.robot = { connected: false, address: '', protocol: '' };
    this.key = ''; this.version = null; this.serial = ''; this.f1Serial = ''; this.keyBlob = '';
    this.keyArmed = false; this.checkWriteError = null;
    this.chunks.clear(); this.replies.clear(); this.emit('status', this.status());
  }
  private async connectRobot(address: string) {
    await this.init();
    if (this.robot.connected) await this.client.disconnect(this.robot.address);
    this.resetRobot();
    await this.client.connect(address, () => this.resetRobot());
    try {
      // Android starts at MTU 23; encrypted V3 setup packets need more space.
      // Android 14+ requests 517 for the first MTU exchange (plugin defaults).
      if (android && await this.client.getMtu(address) < 104) {
        throw new Error('Bluetooth packet size is too small. Disconnect and reconnect Go2.');
      }
      const services = await this.client.getServices(address);
      this.transport = services.some(s => s.uuid.toLowerCase() === NUS.service) ? NUS : FFE;
      if (!services.some(s => s.uuid.toLowerCase() === this.transport.service)) throw new Error('No Unitree Bluetooth service was found.');
      const characteristic = services.find(s => s.uuid.toLowerCase() === this.transport.service)?.characteristics.find(c => c.uuid.toLowerCase() === this.transport.write);
      this.writeWithoutResponse = !characteristic?.properties.write && !!characteristic?.properties.writeWithoutResponse;
      this.robot = { connected: true, address, protocol: this.transport === NUS ? 'nus' : 'ffe0' };
      await this.client.startNotifications(address, this.transport.service, this.transport.notify,
        value => this.notify(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)));
      const seq = this.sequence;
      await this.write(cfb(inner(1, encode('unitree'), [1,1])));
      try { await this.wait(() => this.version !== null || this.hasReply(1, seq), 5000); }
      catch { await this.write(probe(0xf1)); await this.wait(() => this.version !== null, 2500); }
      this.emit('status', this.status()); return { ...this.robot };
    } catch (error) { await this.client.disconnect(address).catch(() => {}); this.resetRobot(); throw error; }
  }
  private async write(packet: Uint8Array) {
    if (!this.robot.connected) throw new Error('Connect to your robot over Bluetooth first.');
    const mtu = await this.client.getMtu(this.robot.address);
    if (packet.length > mtu-3) throw new Error(`Bluetooth packet size ${packet.length} exceeds MTU ${mtu}. Please reconnect.`);
    if (this.writeWithoutResponse) await this.client.writeWithoutResponse(this.robot.address, this.transport.service, this.transport.write, dataview(packet));
    else await this.client.write(this.robot.address, this.transport.service, this.transport.write, dataview(packet));
  }
  private hasReply(op: number, after: number) { return (this.replies.get(op)?.sequence || 0) > after; }
  private async wait(predicate: () => boolean, timeout = 5000) {
    const deadline = Date.now()+timeout;
    while (!predicate()) {
      if (!this.robot.connected) throw new Error('Bluetooth disconnected.');
      if (Date.now() >= deadline) throw new Error('The robot did not reply over Bluetooth. Please try again.');
      await sleep(20);
    }
  }
  private storeChunk(op: number, index: number, total: number, data: Uint8Array): Uint8Array | null {
    if (index < 1 || total < 1 || index > total || total > 100) return null;
    const bucket = this.chunks.get(op) || new Map(); this.chunks.set(op, bucket); bucket.set(index, data);
    if (bucket.size !== total || !Array.from({length: total}, (_,i) => bucket.has(i+1)).every(Boolean)) return null;
    const joined = Uint8Array.from(Array.from({length: total}, (_,i) => [...bucket.get(i+1)!]).flat());
    this.chunks.delete(op); return joined;
  }
  private notify(raw: Uint8Array) {
    if (raw.length >= 7 && MAGIC.every((b,i) => raw[i] === b)) {
      if (raw[5] === 0xf1) {
        this.version = raw[6];
        if (raw.length > 13) this.f1Serial = decode(raw.slice(13, Math.min(raw.length-1, 13+raw[12])));
      } else if (raw[5] === 0xf2 && raw.length >= 9) {
        const full = this.storeChunk(0xf2, raw[6], raw[7], raw.slice(8, -1));
        if (full) this.keyBlob = decode(full);
      }
      return;
    }
    const plain = this.key && this.version !== null ? decryptGcm(raw, this.key) : cfb(raw, true);
    if (!plain || plain.length < 4 || ![0x51,0x52].includes(plain[0])) return;
    if (plain[1] < 4 || plain[1] > plain.length) return;
    const op = plain[2];
    this.replies.set(op, { sequence: ++this.sequence, raw: plain });
    if (op === 0x0b && this.key && plain[1] >= 12) {
      const view = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
      const time = view.getBigUint64(3, false)+1n;
      const reply = new Uint8Array(8); new DataView(reply.buffer).setBigUint64(0, time, false);
      void this.write(gcm(inner(0x0c, reply), this.key)).catch(error => {
        this.checkWriteError = error instanceof Error ? error : new Error(String(error));
      });
    } else if (op === 2) {
      if (this.version !== null && this.key) this.serial = decode(plain.slice(3, plain[1]-1));
      else if (plain.length >= 6) {
        const full = this.storeChunk(2, plain[3], plain[4], plain.slice(5, plain[1]-1));
        if (full) this.serial = decode(full);
      }
    }
  }
  private async command(op: number, payload: Uint8Array = new Uint8Array(), chunk?: [number, number], timeout = 8000) {
    if (this.version !== null && !this.keyArmed) throw new Error('Unlock Wi-Fi setup with your linked Unitree account first.');
    const seq = this.sequence;
    const packet = inner(op, payload, chunk);
    await this.write(this.version !== null ? gcm(packet, this.key) : cfb(packet));
    await this.wait(() => this.hasReply(op, seq), timeout);
    return this.replies.get(op)!.raw;
  }
  private async info() {
    if (this.version === null || this.keyArmed) {
      this.serial = '';
      try {
        const seq = this.sequence; await this.command(2);
        await this.wait(() => !!this.serial && this.hasReply(2,seq));
      } catch { /* F1 serial remains available before a key is loaded */ }
    }
    let mac: string | null = null;
    if (this.version === null || this.keyArmed) {
      try { const reply = await this.command(7); const b = reply.slice(3, reply[1]-1);
        if (b.length === 6) mac = [...b].map(n => n.toString(16).padStart(2,'0')).join(':').toUpperCase();
      } catch { /* optional on firmware without AP MAC response */ }
    }
    return { serial_number: this.serial || this.f1Serial || null, ap_mac: mac, ...this.robot,
      f1_sn_partial: this.f1Serial, sn_gcm: this.key ? this.serial : null,
      sn_v1v2: this.version === null ? this.serial : null };
  }
  private async setKey(key: string) {
    if (!/^[a-f0-9]{32}$/i.test(key)) throw new Error('The device AES key must contain 32 hexadecimal characters.');
    await this.wait(() => this.version !== null);
    this.key = key; this.serial = ''; this.keyArmed = false; this.checkWriteError = null;
    const seq = this.sequence;
    let stage = 'sending authentication request';
    try {
      await this.write(gcm(inner(0x0b), key));
      stage = 'waiting for Go2’s timestamp';
      await this.wait(() => this.hasReply(0x0b, seq));
      stage = 'waiting for Go2 to accept authentication';
      await this.wait(() => this.hasReply(0x0c, seq) || this.checkWriteError !== null);
      if (this.checkWriteError) throw this.checkWriteError;
      this.keyArmed = this.replies.get(0x0c)!.raw[3] === 1;
      if (!this.keyArmed) throw new Error('Go2 rejected the device key.');
      return { ok: true, armed: true, key_bytes: 16 };
    } catch (error) {
      this.key = ''; this.keyArmed = false;
      throw new Error(`Bluetooth authentication failed while ${stage}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  private async wifi(body: { ssid: string; password: string; ap_mode?: boolean; country?: string }) {
    const ssid = encode(body.ssid), password = encode(body.password);
    if (ssid.length < 1 || ssid.length > 32 || password.length > 63 || /[\0\r\n]/.test(body.ssid+body.password)) throw new Error('Check the Wi-Fi name and password length.');
    if (body.ap_mode && !/^[\x20-\x7e]{8,63}$/.test(body.password)) throw new Error('Use a hotspot password with 8–63 English letters, numbers or symbols.');
    const country = (body.country || 'US').toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) throw new Error('Enter a two-letter country code.');
    const details: Record<string, boolean> = {};
    const readyAfter = this.sequence;
    for (const [label, op, payload, chunked] of [
      ['mode', 3, Uint8Array.of(body.ap_mode ? 1 : 2), false],
      ['ssid', 4, ssid, true], ['password', 5, password, true],
      ['country', 6, this.version !== null ? Uint8Array.from([...encode(country), body.ap_mode ? 2 : 1])
        : Uint8Array.from([1,...encode(country),0]), false],
    ] as [string, number, Uint8Array, boolean][]) {
      let reply: Uint8Array;
      if (chunked && this.version === null) {
        const count = Math.max(1, Math.ceil(payload.length/14));
        const seq = this.sequence;
        for (let i=0;i<count;i++) {
          await this.write(cfb(inner(op,payload.slice(i*14,(i+1)*14),[i+1,count]))); await sleep(100);
        }
        await this.wait(() => this.hasReply(op,seq), 15000); reply = this.replies.get(op)!.raw;
      } else reply = await this.command(op, payload, chunked ? [1,1] : undefined, 15000);
      details[label] = reply[3] === 1;
      if (!details[label]) return { success: false, details, error: `The robot rejected ${label}.` };
    }
    if (this.version !== null) {
      try { await this.wait(() => this.hasReply(8,readyAfter), 40000); details.ready = this.replies.get(8)!.raw[3] === 1; }
      catch { return { success: false, details, error: 'Settings were sent, but the robot did not confirm within 40 seconds. Check its connection.' }; }
    }
    return { success: Object.values(details).every(Boolean), details, error: null };
  }
  private async connectRemote(address: string) {
    await this.init(); if (this.remote.connected) await this.client.disconnect(this.remote.address);
    const name = this.devices.get(address)?.localName || this.devices.get(address)?.device.name || 'Unitree';
    const lost = () => { this.remote.connected = false; this.remoteState = null;
      this.emit('status', this.status()); window.dispatchEvent(new Event('go2-remote-lost')); };
    await this.client.connect(address, lost);
    try {
      this.remote = { connected: true, address, name }; this.lastRemote = Date.now();
      await this.client.startNotifications(address, FFE.service, FFE.notify, value => {
        try { this.remoteState = parseRemote(new Uint8Array(value.buffer,value.byteOffset,value.byteLength));
          this.lastRemote = Date.now(); this.emit('remote_state', this.remoteState);
        } catch { /* corrupt frames are never forwarded */ }
      });
      await this.client.writeWithoutResponse(address, FFE.service, FFE.write, dataview(encode('59532b32')));
      this.emit('status', this.status()); return { ...this.remote };
    } catch (error) { await this.client.disconnect(address).catch(() => {}); lost(); throw error; }
  }
  async handle(url: URL, request: Request): Promise<Response> {
    const path = url.pathname.replace('/ble-api','');
    if (path === '/adapters') return Response.json(this.adapters());
    if (path === '/status') return Response.json(this.robot);
    if (path === '/remote/status') return Response.json(this.remote);
    if (path === '/remote/state') return Response.json(this.remoteState || {});
    const action = async () => {
      const address = url.searchParams.get('address') || '';
      if (path === '/scan') return this.scan(Number(url.searchParams.get('timeout') || 8)*1000);
      if (path === '/adapter') return { current: android ? 'android' : 'iphone' };
      if (path === '/connect') return this.connectRobot(address);
      if (path === '/disconnect') { if (this.robot.address) await this.client.disconnect(this.robot.address); this.resetRobot(); return { connected: false }; }
      if (path === '/info') return this.info();
      if (path === '/v3/aes-key') return this.setKey(url.searchParams.get('key') || '');
      if (path === '/v3/version') {
        if (this.version === null) { await this.write(probe(0xf1)); try { await this.wait(() => this.version !== null,2500); } catch { /* legacy */ } }
        return { version: this.version === null ? null : String(this.version), supported: this.version !== null };
      }
      if (path === '/v3/gcm-key') {
        this.keyBlob = ''; this.chunks.delete(0xf2); await this.write(probe(0xf2));
        try { await this.wait(() => !!this.keyBlob, 4000); } catch { /* legacy */ }
        return { key: this.keyBlob || null, supported: !!this.keyBlob };
      }
      if (path === '/wifi') return this.wifi(await request.json());
      if (path === '/remote/connect') return this.connectRemote(address);
      if (path === '/remote/disconnect') { if (this.remote.address) await this.client.disconnect(this.remote.address);
        this.remote = { connected: false, address: '', name: '' }; this.remoteState = null; this.emit('status',this.status());
        window.dispatchEvent(new Event('go2-remote-lost')); return { connected: false }; }
      throw new Error(`Unsupported Bluetooth operation: ${path}`);
    };
    // Serialize robot requests: F1/F2/SN and Wi-Fi share one notification channel.
    const pending = this.queue.then(action);
    this.queue = pending.catch(() => {});
    try { return Response.json(await pending); }
    catch (error) { return Response.json({ detail: error instanceof Error ? error.message : String(error) }, { status: 400 }); }
  }
}
export const nativeBle = new NativeBle();
