/**
 * ICE configuration.
 *
 * The STUN/TURN list is NOT configured in the app. The backend generates it per session
 * (turn/provider.go) and hands the identical list to both peers — to the agent inside
 * `start_session` and to this client via `GET /api/session/ice`. That symmetry is load-
 * bearing: two peers with different candidate sets can gather forever and never find a
 * pair, and the TURN credential is a time-limited HMAC that only the backend can mint.
 *
 * So this module only translates the wire shape into the native one, and applies the
 * connection policy.
 */
import type { ICEServerMessage } from '../protocol/messages';
import { createLogger } from '../utils/logger';

const log = createLogger('ice');

/** RTCIceServer as react-native-webrtc accepts it. */
export type NativeIceServer = {
  urls?: string | string[];
  username?: string;
  credential?: string;
};

export type PeerConfiguration = {
  iceServers: NativeIceServer[];
  bundlePolicy: 'max-bundle';
  rtcpMuxPolicy: 'require';
  iceCandidatePoolSize: number;
};

/**
 * toNativeIceServers converts protocol.ICEServer entries.
 *
 * Servers with no URLs are dropped: the native WebRTC layer throws on an empty `urls`,
 * which would abort a session that could otherwise have succeeded on host candidates.
 * `username`/`credential` are only attached when both are present, because a TURN URL
 * with a partial credential fails authentication rather than falling back to STUN.
 */
export function toNativeIceServers(servers: ICEServerMessage[]): NativeIceServer[] {
  const out: NativeIceServer[] = [];
  for (const server of servers) {
    const urls = (server.urls ?? []).filter(u => typeof u === 'string' && u.length > 0);
    if (urls.length === 0) {
      continue;
    }
    if (server.username && server.credential) {
      out.push({ urls, username: server.username, credential: server.credential });
    } else {
      out.push({ urls });
    }
  }
  return out;
}

/**
 * buildConfiguration produces the RTCConfiguration for the viewer's peer connection.
 *
 * • `max-bundle` + `require` match what the agent's Pion peer negotiates and keep the
 *   whole session — video plus the drs-input data channel — on a single transport, so
 *   only one candidate pair has to survive NAT rather than several.
 *
 * • `iceCandidatePoolSize: 0` because pre-gathering is pointless here: the agent is the
 *   offerer and we do not exist as a peer until its offer arrives, so there is nothing
 *   to warm up.
 *
 * • `iceTransportPolicy` is deliberately left at the default 'all'. Forcing 'relay'
 *   would make TURN mandatory and break the LAN case, which is the common one for a
 *   deployment whose agent and operator are on the same network.
 */
export function buildConfiguration(servers: ICEServerMessage[]): PeerConfiguration {
  const iceServers = toNativeIceServers(servers);
  const relayCount = iceServers.filter(s =>
    (Array.isArray(s.urls) ? s.urls : [s.urls ?? '']).some(u => u.startsWith('turn')),
  ).length;
  log.info(`ICE configured with ${iceServers.length} server(s), ${relayCount} relay`);
  return {
    iceServers,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    iceCandidatePoolSize: 0,
  };
}

/** hasRelay reports whether TURN is available — surfaced so an ICE failure can say why. */
export function hasRelay(servers: ICEServerMessage[]): boolean {
  return servers.some(s => (s.urls ?? []).some(u => u.toLowerCase().startsWith('turn')));
}
