# DRS Mobile

A React Native **controller / viewer** for the existing DRS control plane.

It authenticates against the Go backend, lists the managed desktops that backend authorizes, opens a
live session over the existing `/ws/session` signalling relay, renders the agent's WebRTC video, and
— only when the backend has granted it — sends mouse and keyboard input over the peer-to-peer
`drs-input` data channel.

**It captures nothing.** The managed desktop's agent is the media source and the WebRTC *offerer*;
this app is the *answerer*.

---

## What the backend audit found

Everything below was verified by reading `../drs` before any client code was written. It is recorded
here because several findings are load-bearing and non-obvious.

### There is no "start session" REST endpoint

`backend/internal/ws/session.go` — **opening the WebSocket IS starting the session.** `ServeSession`
authenticates the token, checks the device has a live agent, mints the session id itself with
`crypto/rand`, sends `start_session` to the agent with the ICE list and the operator name taken from
the JWT, and writes *"Remote session started"* to the audit log. Closing the socket is the stop: its
deferred cleanup sends `stop_session` and audits the end.

Consequences the client is built around:

- The **session id is discovered**, from the first inbound message that carries one. The client
  cannot know it in advance and must not generate one.
- **Session lifetime is socket lifetime.** There is no way to leave a session running in the
  background, and no separate stop call to make.
- The mode requested is always `webrtc` (hard-coded server-side); the agent downgrades itself to
  JPEG if it was built without the VP8 codec.

### Authentication rides the WebSocket subprotocol

`bearerFromWS` reads the JWT from `Sec-WebSocket-Protocol: bearer, <token>`. React Native *can* set
headers, but the app uses the subprotocol anyway — matching the existing server exactly, rather than
adding a second auth path to the same endpoint.

Auth failures are rejected **before** the upgrade, so a 401/403 never arrives as a close frame. It
surfaces only in the platform's error string, which `classifyFailure` parses — otherwise an expired
token looks like a network blip and gets retried forever.

### Only three message types travel upward

`ServeSession`'s read loop forwards `answer`, `ice_candidate` and `input_control`, and ignores
everything else. The client sends only those three.

### The agent's remote-input implementation is complete — and asymmetric

`agent/internal/screen/webrtc_cgo.go` creates the `drs-input` channel as offerer, and
`agent/internal/input/` injects on all three platforms. But the keyboard backends differ in a way
that dictated the whole keyboard design:

| Platform | Unmapped `code` |
|---|---|
| Windows (`input_windows.go`) | falls back to Unicode injection of `key` |
| macOS (`input_darwin.go`) | falls back to Unicode injection of `key` |
| **Linux / X11 (`input_linux.go`)** | **drops the key and logs it** — X11 has no Unicode path |

So `src/remote-control/keyboard.ts` resolves every character to a **US-layout physical key** plus a
shift flag, and sends a real `code`. Sending characters alone would type fine on Windows and macOS
and silently do nothing on every Linux desktop in the fleet. Characters on no US key (accented
letters, CJK, emoji) fall back to character-only — correct on Windows/macOS, dropped by the Linux
agent. That is an agent limitation, surfaced rather than hidden.

Also worth knowing: macOS needs Accessibility permission (and a restart after granting it), and
**Wayland is not supported** at all — XTEST does not exist there.

### Endpoints used

| Endpoint | Use |
|---|---|
| `POST /api/auth/login` | sign in (`identifier` accepts email *or* username) |
| `GET /api/auth/me` | verify a restored token against live account state |
| `PUT /api/auth/profile` | display name — becomes `StartSession.Operator` on the device's notice |
| `GET /api/devices`, `GET /api/devices/{id}` | fleet inventory, polled every 5s |
| `GET /api/session/ice` | STUN/TURN list, fetched **per attempt** (TURN credential is time-limited) |
| `WS /ws/session?deviceId=…` | signalling — and the session's entire lifecycle |

No endpoint or message type outside this list is invented.

---

## Security model

Three independent gates, none of which relies on the others:

1. **The socket** requires an admin/superadmin JWT. `ServeSession` rejects anything else with a 403
   before the upgrade.
2. **`input_control`** travels the trusted relay, not the data channel. The backend audits every
   enable/disable before forwarding it.
3. **The agent** injects nothing until that grant arrives.

On top of those, this client refuses to write to the data channel until it has been explicitly armed
by a grant — an open channel is never treated as authorization. `__tests__/inputAuthorization.test.ts`
pins that invariant.

Other deliberate choices:

- The JWT lives in the platform keystore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, excluded from iCloud sync
  and backups), never `AsyncStorage`.
- **Backgrounding the app revokes control.** An operator who switches apps is not watching the remote
  screen. The request is remembered and re-issued — audited again — on return.
- Releasing control first releases every modifier and any held mouse button. Once the grant is gone
  the app can no longer send the key-up that would clear a stranded `Ctrl`.
- Below `warn`, all logging is compiled out of release builds.
- The device name and control state are on screen at all times; control is the only state rendered in
  coral.

---

## Architecture

```
src/
  api/            REST: client (token + revocation), auth, devices, sessions (+ what does NOT exist)
  protocol/       envelope, messages, inputEvent — transcribed from backend/pkg/protocol/protocol.go
  websocket/      drsSocket (subprotocol auth, failure classification), signaling (routing)
  webrtc/         peerConnection (answerer), ice, dataChannel (the authorization gate), media
  remote-control/ inputMapper (touch/trackpad), keyboard (US-layout resolution), touch (gestures)
  session/        SessionController (the state machine), useSession (React binding)
  screens/        Login, Devices, DeviceDetails, RemoteSession
  components/     DeviceCard, RemoteDesktopView, SessionToolbar, KeyboardOverlay, ConnectionStatus, …
  navigation/     AppNavigation — two stacks, swapped on auth state
  theme/          Fort Dice palette, typography, motion
  types/          device, session (states + failure copy), user
  utils/          coordinates, logger, sound, storage
```

Session state lives in `SessionController`, **outside React**. An ICE candidate arriving mid-render
must be applied immediately, not on the next commit.

### Session flow

```
1. GET /api/session/ice                                  us
2. open /ws/session?deviceId=…   ← starts the session     us
3. mints session id, sends start_session, audits          backend
4. captures screen, builds peer, creates offer            agent (the offerer)
5. session_ready → offer                                  agent, relayed verbatim
6. setRemoteDescription → createAnswer → send answer      us
7. trickle ICE both ways                                  both
8. connected; video track renders                         us
```

ICE candidates routinely arrive **before** the offer they belong to (the backend relays them the
moment it has them). `addIceCandidate` before `setRemoteDescription` throws, and a discarded candidate
is often the one that would have completed the connection — which looks like "works on LAN, fails
across NAT". Hence the buffer in `peerConnection.ts`.

---

## Touch → desktop mapping

The remote video is drawn `objectFit: 'contain'`, so it is letterboxed. Dividing a touch by the
container size is wrong by exactly the bar offset — an error that is invisible mid-screen and grows
toward the edges, so it survives casual testing and then misses every window close button.
`src/utils/coordinates.ts` computes the real displayed rectangle first;
`__tests__/coordinates.test.ts` pins it against hand-computed geometries.

Two pointer modes, because neither covers every task:

- **Direct** — the finger is the cursor. Obvious, and the default. A fingertip covers ~40px, so small
  targets are unreachable.
- **Trackpad** — drag anywhere to move the cursor relatively; nothing is occluded. This is how a
  12px close button actually gets hit.

Gestures: tap = left click · long-press = right click · two fingers = scroll · hold-then-drag =
press-and-drag.

---

## Feedback: sound, not haptics

There are no haptics anywhere in this app. Every confirmation, state change and error is a short
synthesized WAV in `assets/sounds/`, so feedback survives a tablet in a dock, and so control
transitions are audible to a bystander — which is the point.

Regenerate or add cues, then re-link:

```bash
npm run link-assets   # fonts + sounds → iOS bundle & Android res/raw
```

---

## Setup

```bash
npm install
cd ios && pod install && cd ..   # iOS only
npm run android                  # or: npm run ios
```

### Backend

The app ships pointing at the deployed server:

```
https://2.25.103.207.nip.io      REST + WSS
wss://2.25.103.207.nip.io/ws/session
```

Verified reachable: `/healthz` → `{"status":"ok"}`, `/api/*` and `/ws/session` → 401 without a token,
Let's Encrypt certificate valid to 2026-11-10, TURN answering on 3478/udp.

It must be the **`.nip.io` name, not the bare IP** — the certificate's only SAN is
`2.25.103.207.nip.io`, so `https://2.25.103.207` fails the hostname check and React Native provides
no way to bypass that. Caddy also 308-redirects plain HTTP to HTTPS, so `http://` would not survive
either.

Switch backends from the login screen's server field — it offers **Deployed** and **Local** presets —
or change `DEPLOYED_BACKEND` in `src/config/env.ts`. `Local` is `10.0.2.2:8080` on Android (the
emulator's host alias) and `localhost:8080` on iOS.

Production **must** be `https://`. The spec requires TLS/WSS for signalling and API traffic, and
Android's release manifest disables cleartext, so an `http://` value fails closed rather than sending
a JWT in the clear.

```bash
npm run typecheck   # tsc --noEmit
npm run lint
npm test
```

---

## Android permissions — and one that is not optional

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
```

`ACCESS_NETWORK_STATE` is **required by WebRTC and `react-native-webrtc` does not declare it for
you.** Its absence is not a graceful failure:

libwebrtc starts its `AndroidNetworkMonitor` when the port allocator begins gathering ICE candidates
— which happens on `setLocalDescription`, not at construction. That monitor calls `ConnectivityManager`
over JNI; without the permission the call throws `SecurityException`, and the uncleared JNI exception
aborts the process with `SIGABRT` on libwebrtc's `network_thread`.

So the symptom is a **hard native crash partway through a working negotiation** — offer applied,
candidates buffered and flushed, answer created — with nothing at all in the JS logs. It looks like a
WebRTC bug, not a manifest problem. The tombstone is the only evidence:

```
F libc : Fatal signal 6 (SIGABRT) in tid NNNNN (network_thread), pid NNNNN (com.drsmobile)
F DEBUG:   #01 pc ... libjingle_peerconnection_so.so
```

**`CAMERA`, `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS` are deliberately absent.** Those are what
`react-native-webrtc` needs to *capture*. This app only ever receives — the agent is the media source
and the offerer, and `getUserMedia` is never called.

---

## Navigation and the drawer

A hand-built drawer (`src/components/Drawer.tsx`) on React Native's own `Animated` + `PanResponder`,
not `@react-navigation/drawer`. Two concrete reasons:

1. **Version.** `@react-navigation/drawer` requires `react-native-reanimated`, whose current peer
   range tops out at React Native 0.83–0.86. This app is on 0.87.
2. **Gesture conflict — the one that actually matters.** It also requires
   `react-native-gesture-handler`, which installs a second gesture system at the root of the tree.
   The remote-desktop viewport is driven by a `PanResponder` that must win every touch it receives,
   because a drag there is moving someone's mouse. A rival recogniser above it risks an edge-swipe
   stealing a drag mid-gesture and stranding a held mouse button on a live desktop.

For the same reason **edge-swipe is disabled on the session screen**, and that screen has no menu
button — leaving it goes through its own confirm, which releases control before closing the socket.

The drawer holds what previously had nowhere to live: the operator's identity (the name the device
displays on its consent notice), the fleet count, the audit trail, which backend is in use and whether
it is TLS, the sound mute, the theme, and sign-out. It reads the fleet counts from the Devices screen
rather than polling `/api/devices` a second time.

## Known limitations

- **Remote control needs the WebRTC transport.** The JPEG fallback has no data channel, so those
  sessions are view-only. The UI says so rather than offering a button that does nothing.
- **Linux agents cannot type characters absent from a US layout** (see the audit above). Wayland is
  unsupported entirely.
- **macOS agents need Accessibility permission**, granted before the agent starts.
- **Landscape is not forced.** The layout works in both orientations and hints at rotating when the
  desktop is much wider than the viewport; a hard lock would need another native module and would
  fight a docked device.
- **`react-native-webrtc` ships a broken type declaration** — its classes import a
  `vendor/event-target-shim` declaration the package does not contain, so `addEventListener` is
  invisible to TypeScript despite working at runtime. `src/webrtc/nativeEvents.ts` declares that
  surface once; delete it if upstream fixes the build.
- **No keep-awake.** The screen may dim during a long view-only session.
- **`nip.io` is a third-party wildcard DNS service.** It resolves `<ip>.nip.io` to `<ip>`, which is
  what makes a Let's Encrypt certificate possible without owning a domain — but the app cannot
  resolve the backend if nip.io is down. Set a real `DRS_DOMAIN` before this carries real traffic.
