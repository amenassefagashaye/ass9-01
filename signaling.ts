// RTC Signaling Controller
export interface RTCSignal {
  type: 'offer' | 'answer' | 'candidate';
  sdp?: any;
  candidate?: any;
  target: string;
  source: string;
}

export class SignalingController {
  private connections = new Map<string, WebSocket>();
  
  handleSignal(ws: WebSocket, signal: RTCSignal) {
    const targetWs = this.connections.get(signal.target);
    
    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(JSON.stringify({
        type: 'rtc_signal',
        ...signal
      }));
    }
  }
  
  registerConnection(userId: string, ws: WebSocket) {
    this.connections.set(userId, ws);
  }
  
  unregisterConnection(userId: string) {
    this.connections.delete(userId);
  }
  
  getConnectedUsers(): string[] {
    return Array.from(this.connections.keys());
  }
}