/** Minimal WebSocket stand-in for tests. Use `MockSocket.last` to push server messages. */
export class MockSocket {
  static instances: MockSocket[] = [];
  static OPEN = 1;
  OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { MockSocket.instances.push(this); }
  static get last() { return MockSocket.instances[MockSocket.instances.length - 1]; }
  static reset() { MockSocket.instances = []; }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; this.onclose?.(); }
  // helpers used by tests
  open() { this.readyState = 1; this.onopen?.(); }
  push(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}
