/**
 * Wire-format conformance.
 *
 * The point of these tests is that this client shares a contract with a Go program it cannot import
 * from. `backend/pkg/protocol/protocol.go` is the single source of truth; these assertions pin the
 * TypeScript transcription to the exact field names and shapes that file defines, so a rename here
 * fails a test rather than producing a frame the backend silently ignores (its read loops `continue`
 * past anything malformed — there is no error to observe).
 */
import { MsgType, PROTOCOL_VERSION, SessionMode, decodeEnvelope, encode } from '../src/protocol/envelope';
import {
  isFrameMessage,
  isICECandidateMessage,
  isSDPMessage,
  isSessionErrorMessage,
  isSessionReadyMessage,
  sessionIdOf,
} from '../src/protocol/messages';
import {
  MouseButton,
  keyDown,
  mouseDown,
  mouseMove,
  serialize,
  wheel,
} from '../src/protocol/inputEvent';

describe('the envelope', () => {
  it('tracks the Go ProtocolVersion constant', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it('omits `data` entirely when there is no payload, matching omitempty', () => {
    expect(encode(MsgType.ANSWER)).toBe('{"type":"answer"}');
  });

  it('encodes type and data in the shape the hub relays', () => {
    const frame = encode(MsgType.ANSWER, { sessionId: 's1', sdpType: 'answer', sdp: 'v=0' });
    expect(JSON.parse(frame)).toEqual({
      type: 'answer',
      data: { sessionId: 's1', sdpType: 'answer', sdp: 'v=0' },
    });
  });

  it('round-trips', () => {
    const decoded = decodeEnvelope(encode(MsgType.ICE_CANDIDATE, { sessionId: 'x', candidate: 'c' }));
    expect(decoded?.type).toBe('ice_candidate');
    expect(decoded?.data).toEqual({ sessionId: 'x', candidate: 'c' });
  });

  it('returns null for a malformed frame instead of throwing', () => {
    // The backend skips a bad frame rather than dropping the connection; this client must match, or
    // one corrupt message would end a working session.
    expect(decodeEnvelope('not json')).toBeNull();
    expect(decodeEnvelope('{"data":{}}')).toBeNull();
    expect(decodeEnvelope('null')).toBeNull();
    expect(decodeEnvelope('{"type":42}')).toBeNull();
  });

  it('uses the message type strings the Go constants define', () => {
    expect(MsgType.OFFER).toBe('offer');
    expect(MsgType.ANSWER).toBe('answer');
    expect(MsgType.ICE_CANDIDATE).toBe('ice_candidate');
    expect(MsgType.SESSION_READY).toBe('session_ready');
    expect(MsgType.INPUT_CONTROL).toBe('input_control');
    expect(MsgType.SESSION_ERROR).toBe('session_error');
    expect(MsgType.FRAME).toBe('frame');
    expect(SessionMode.WEBRTC).toBe('webrtc');
    expect(SessionMode.JPEG).toBe('jpeg');
  });
});

describe('payload narrowing', () => {
  it('requires an sdp body on an offer', () => {
    expect(isSDPMessage({ sessionId: 's', sdpType: 'offer', sdp: 'v=0' })).toBe(true);
    // An offer with no sdp would reach setRemoteDescription and throw inside the native module,
    // far from the cause.
    expect(isSDPMessage({ sessionId: 's', sdpType: 'offer' })).toBe(false);
    expect(isSDPMessage(null)).toBe(false);
  });

  it('accepts an EMPTY candidate, which is the end-of-candidates marker', () => {
    expect(isICECandidateMessage({ sessionId: 's', candidate: '' })).toBe(true);
    expect(isICECandidateMessage({ sessionId: 's' })).toBe(false);
  });

  it('accepts only the two declared session modes', () => {
    expect(isSessionReadyMessage({ sessionId: 's', mode: 'webrtc' })).toBe(true);
    expect(isSessionReadyMessage({ sessionId: 's', mode: 'jpeg' })).toBe(true);
    expect(isSessionReadyMessage({ sessionId: 's', mode: 'h264' })).toBe(false);
  });

  it('requires image data and dimensions on a JPEG frame', () => {
    expect(isFrameMessage({ sessionId: 's', seq: 1, width: 8, height: 6, mimeType: 'image/jpeg', dataB64: 'AA' })).toBe(true);
    expect(isFrameMessage({ sessionId: 's', seq: 1, width: 8, height: 6, dataB64: '' })).toBe(false);
  });

  it('accepts a session error with an empty message', () => {
    expect(isSessionErrorMessage({ sessionId: 's', message: '' })).toBe(true);
    expect(isSessionErrorMessage({ sessionId: 's' })).toBe(false);
  });

  it('discovers the server-minted session id from any payload that carries one', () => {
    // There is no REST call that hands the id over — ServeSession mints it with crypto/rand when
    // the socket opens — so this is the only way the client can learn it.
    expect(sessionIdOf({ sessionId: 'abc' })).toBe('abc');
    expect(sessionIdOf({})).toBe('');
    expect(sessionIdOf(null)).toBe('');
  });
});

describe('the drs-input contract', () => {
  it('sends bare events, NOT wrapped in an envelope', () => {
    // protocol.go is explicit that InputEvent "is NOT sent as an Envelope". Wrapping it would make
    // every event unparseable to the agent.
    const wire = JSON.parse(serialize(mouseMove(0.25, 0.5)));
    expect(wire).toEqual({ t: 'm', x: 0.25, y: 0.5 });
    expect(wire).not.toHaveProperty('type');
    expect(wire).not.toHaveProperty('data');
  });

  it('uses the single-letter keys the agent decodes', () => {
    expect(JSON.parse(serialize(mouseDown(MouseButton.RIGHT, 0.1, 0.2)))).toEqual({
      t: 'md',
      b: 1,
      x: 0.1,
      y: 0.2,
    });
    expect(JSON.parse(serialize(wheel(0, -100)))).toEqual({ t: 'w', dx: 0, dy: -100 });
    expect(JSON.parse(serialize(keyDown('KeyA', 'a')))).toEqual({ t: 'kd', code: 'KeyA', key: 'a' });
  });

  it('numbers the buttons as the agent does', () => {
    expect(MouseButton.LEFT).toBe(0);
    expect(MouseButton.RIGHT).toBe(1);
    expect(MouseButton.MIDDLE).toBe(2);
  });

  it('quantizes coordinates to 4 decimals to keep move events small', () => {
    // At 1/10000 of a screen the extra digits are far below one physical pixel; they are pure
    // payload on the highest-frequency message in the app.
    expect(JSON.parse(serialize(mouseMove(1 / 3, 2 / 3)))).toEqual({ t: 'm', x: 0.3333, y: 0.6667 });
  });

  it('sends zero-valued numbers explicitly, which the Go decoder reads identically', () => {
    // JSON.stringify keeps `b: 0` and `dx: 0` where Go's `omitempty` would omit them. That
    // asymmetry is harmless in this direction: the agent unmarshals into a struct whose zero value
    // for B is 0 (the left button) and for DX is 0 (no horizontal scroll), so an explicit zero and
    // an absent field decode to the same thing. Sending it explicitly is also the less ambiguous
    // of the two, so this is asserted as the intended shape rather than trimmed to match Go's
    // encoder byte-for-byte.
    expect(JSON.parse(serialize(mouseDown(MouseButton.LEFT, 0.5, 0.5)))).toEqual({
      t: 'md',
      b: 0,
      x: 0.5,
      y: 0.5,
    });
  });
});
