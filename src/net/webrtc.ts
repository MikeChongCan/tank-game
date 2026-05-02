import type { PeerInfo, RtcGameMessage } from "../game/protocol";

type SendSignal = (to: string, signal: unknown) => void;
type MessageHandler = (from: string, message: RtcGameMessage) => void;
type PeerHandler = (peers: PeerInfo[]) => void;
type OpenHandler = (peerId: string) => void;

interface PeerConnection {
  peer: PeerInfo;
  connection: RTCPeerConnection;
  channel: RTCDataChannel | null;
  connected: boolean;
  pendingCandidates: RTCIceCandidateInit[];
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export class RtcMesh {
  private peers = new Map<string, PeerConnection>();
  private sendSignal: SendSignal;
  private onMessage: MessageHandler;
  private onPeersChanged: PeerHandler;
  private onOpen: OpenHandler;

  constructor(sendSignal: SendSignal, onMessage: MessageHandler, onPeersChanged: PeerHandler, onOpen: OpenHandler) {
    this.sendSignal = sendSignal;
    this.onMessage = onMessage;
    this.onPeersChanged = onPeersChanged;
    this.onOpen = onOpen;
  }

  connectToExisting(peers: PeerInfo[]): void {
    for (const peer of peers) {
      this.createPeer(peer, true);
    }
    this.emitPeers();
  }

  addWaitingPeer(peer: PeerInfo): void {
    if (!this.peers.has(peer.id)) {
      this.createPeer(peer, false);
      this.emitPeers();
    }
  }

  removePeer(id: string): void {
    const peer = this.peers.get(id);
    peer?.connection.close();
    this.peers.delete(id);
    this.emitPeers();
  }

  async receiveSignal(from: string, signal: unknown): Promise<void> {
    const typed = signal as RTCSessionDescriptionInit | RTCIceCandidateInit;
    const peer = this.peers.get(from);
    if (!peer) {
      return;
    }

    if ("type" in typed && (typed.type === "offer" || typed.type === "answer")) {
      if (typeof typed.sdp !== "string") {
        return;
      }
      await peer.connection.setRemoteDescription(typed);
      for (const candidate of peer.pendingCandidates.splice(0)) {
        await peer.connection.addIceCandidate(candidate);
      }
      if (typed.type === "offer") {
        const answer = await peer.connection.createAnswer();
        await peer.connection.setLocalDescription(answer);
        this.sendSignal(from, answer);
      }
      return;
    }

    const candidate = typed as RTCIceCandidateInit;
    if (candidate.candidate !== undefined && typeof candidate.candidate !== "string") {
      return;
    }
    if (!peer.connection.remoteDescription) {
      peer.pendingCandidates.push(candidate);
      return;
    }

    await peer.connection.addIceCandidate(candidate);
  }

  sendTo(peerId: string, message: RtcGameMessage): boolean {
    const peer = this.peers.get(peerId);
    if (peer?.channel?.readyState !== "open") {
      return false;
    }

    peer.channel.send(JSON.stringify(message));
    return true;
  }

  broadcast(message: RtcGameMessage): boolean {
    const payload = JSON.stringify(message);
    let allConnected = true;
    for (const peer of this.peers.values()) {
      if (peer.channel?.readyState === "open") {
        peer.channel.send(payload);
      } else {
        allConnected = false;
      }
    }
    return allConnected;
  }

  close(): void {
    for (const peer of this.peers.values()) {
      peer.connection.close();
    }
    this.peers.clear();
    this.emitPeers();
  }

  private createPeer(peerInfo: PeerInfo, initiator: boolean): PeerConnection {
    const existing = this.peers.get(peerInfo.id);
    if (existing) {
      existing.peer = peerInfo;
      return existing;
    }

    const connection = new RTCPeerConnection(RTC_CONFIG);
    const peer: PeerConnection = { peer: peerInfo, connection, channel: null, connected: false, pendingCandidates: [] };
    this.peers.set(peerInfo.id, peer);

    connection.addEventListener("icecandidate", (event) => {
      if (event.candidate) {
        this.sendSignal(peerInfo.id, event.candidate.toJSON());
      }
    });

    connection.addEventListener("connectionstatechange", () => {
      peer.connected = connection.connectionState === "connected";
      if (["failed", "disconnected", "closed"].includes(connection.connectionState)) {
        peer.connected = false;
      }
      this.emitPeers();
    });

    connection.addEventListener("datachannel", (event) => {
      this.attachChannel(peer, event.channel);
    });

    if (initiator) {
      this.attachChannel(peer, connection.createDataChannel("tank-game"));
      connection.addEventListener("negotiationneeded", () => {
        this.makeOffer(peerInfo.id).catch((error: unknown) => {
          console.warn("Failed to negotiate peer connection.", error);
        });
      });
    }

    return peer;
  }

  private attachChannel(peer: PeerConnection, channel: RTCDataChannel): void {
    peer.channel = channel;

    channel.addEventListener("open", () => {
      peer.connected = true;
      this.emitPeers();
      this.onOpen(peer.peer.id);
    });

    channel.addEventListener("message", (event) => {
      try {
        this.onMessage(peer.peer.id, JSON.parse(String(event.data)) as RtcGameMessage);
      } catch {
        // Ignore malformed peer payloads; the signaling channel still owns room membership.
      }
    });

    channel.addEventListener("close", () => {
      peer.connected = false;
      this.emitPeers();
    });
  }

  private async makeOffer(peerId: string): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer || peer.connection.signalingState !== "stable") {
      return;
    }

    const offer = await peer.connection.createOffer();
    await peer.connection.setLocalDescription(offer);
    this.sendSignal(peerId, offer);
  }

  private emitPeers(): void {
    this.onPeersChanged(
      [...this.peers.values()].map((peer) => ({
        id: peer.peer.id,
        name: `${peer.peer.name}${peer.connected ? "" : " (connecting)"}`,
      })),
    );
  }
}
