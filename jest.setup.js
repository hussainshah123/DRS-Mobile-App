/**
 * Jest setup: stand-ins for the native modules this app talks to.
 *
 * These are not "make the tests pass" stubs — each one replaces a module that has no JavaScript
 * implementation at all outside a real app process, and would throw on import:
 *
 *   • react-native-webrtc throws from its own index if `NativeModules.WebRTCModule` is absent.
 *   • react-native-keychain and react-native-sound are TurboModules with no JS fallback.
 *
 * The mocks are deliberately minimal and behavioural where it matters (the keychain is an in-memory
 * store, so a save/load round-trip is actually exercised) rather than blanket `jest.fn()`s that
 * would let a broken call sequence pass.
 */

jest.mock('react-native-webrtc', () => {
  class FakeEventTarget {
    constructor() {
      this._listeners = {};
    }
    addEventListener(type, listener) {
      (this._listeners[type] ||= []).push(listener);
    }
    removeEventListener(type, listener) {
      this._listeners[type] = (this._listeners[type] || []).filter(l => l !== listener);
    }
    /** Test helper: drive an event as the native layer would. */
    emit(type, event) {
      (this._listeners[type] || []).forEach(listener => listener(event));
    }
  }

  class RTCPeerConnection extends FakeEventTarget {
    constructor(configuration) {
      super();
      this.configuration = configuration;
      this.connectionState = 'new';
      this.localDescription = null;
      this.remoteDescription = null;
    }
    async setRemoteDescription(description) {
      this.remoteDescription = description;
    }
    async createAnswer() {
      return { type: 'answer', sdp: 'v=0\r\n' };
    }
    async setLocalDescription(description) {
      this.localDescription = description;
    }
    async addIceCandidate() {}
    close() {
      this.connectionState = 'closed';
    }
  }

  return {
    RTCPeerConnection,
    RTCIceCandidate: class {
      constructor(init) {
        Object.assign(this, init);
      }
    },
    RTCSessionDescription: class {
      constructor(init) {
        Object.assign(this, init);
      }
    },
    RTCView: 'RTCView',
    MediaStream: class {
      toURL() {
        return 'stream://test';
      }
    },
    MediaStreamTrack: FakeEventTarget,
    mediaDevices: {},
    permissions: {},
    registerGlobals: () => {},
  };
});

jest.mock('react-native-keychain', () => {
  let stored = null;
  return {
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WhenUnlockedThisDeviceOnly' },
    setGenericPassword: async (username, password) => {
      stored = { username, password };
      return true;
    },
    getGenericPassword: async () => stored,
    resetGenericPassword: async () => {
      stored = null;
      return true;
    },
  };
});

jest.mock('react-native-sound', () => {
  class Sound {
    constructor(_file, _bundle, onLoad) {
      // Report success asynchronously, matching the real module — a synchronous callback would let
      // a load-order bug pass that fails on a device.
      if (onLoad) {
        setImmediate(() => onLoad(null));
      }
    }
    static setCategory() {}
    static MAIN_BUNDLE = 'MAIN_BUNDLE';
    setVolume() {}
    play(onEnd) {
      onEnd?.(true);
    }
    stop(onStop) {
      onStop?.();
    }
    release() {}
  }
  return Sound;
});
