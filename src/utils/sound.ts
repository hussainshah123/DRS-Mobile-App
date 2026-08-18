/**
 * The app's feedback channel. DRS Mobile deliberately uses NO haptics — every
 * confirmation, state change and error is audible instead, so feedback survives a
 * tablet in a dock or a phone in a case, and so a session's control transitions are
 * announced in a way a bystander can also hear (which is the point: control being
 * granted should not be silent).
 *
 * Files are synthesized WAVs bundled natively (assets/sounds → iOS bundle
 * resources + Android res/raw). react-native-sound resolves them differently per
 * platform: Android looks up `res/raw/<name>` by resource identifier, which means
 * NO extension; iOS looks up a bundle resource, which means the extension is
 * required. `resolve()` is that one difference, in one place.
 *
 * Playback is fire-and-forget and never awaited: a cue that fails to load must not
 * block a session transition, so every failure path is a silent no-op (logged in dev
 * only). Sounds are preloaded once at startup so the first tap is not late.
 */
import Sound from 'react-native-sound';
import { Platform } from 'react-native';

import { createLogger } from './logger';

const log = createLogger('sound');

/** The cue vocabulary. Adding one means adding a WAV and re-running `npm run link-assets`. */
export type Cue =
  /** Any button press — the universal "you touched it" cue that stands in for haptics. */
  | 'tap'
  /** Media is flowing: the remote desktop is live. */
  | 'connect'
  /** The session ended cleanly. */
  | 'disconnect'
  /** The backend authorized control; input is now reaching the device. */
  | 'controlOn'
  /** Control was released or revoked. */
  | 'controlOff'
  /** A failure the operator needs to notice. */
  | 'error';

const files: Record<Cue, string> = {
  tap: 'drs_tap',
  connect: 'drs_connect',
  disconnect: 'drs_disconnect',
  controlOn: 'drs_control_on',
  controlOff: 'drs_control_off',
  error: 'drs_error',
};

/** Per-cue level. The tap is the quietest by a wide margin — it fires constantly. */
const volumes: Record<Cue, number> = {
  tap: 0.32,
  connect: 0.7,
  disconnect: 0.6,
  controlOn: 0.75,
  controlOff: 0.55,
  error: 0.8,
};

function resolve(name: string): string {
  return Platform.OS === 'android' ? name : `${name}.wav`;
}

const loaded = new Map<Cue, Sound>();
let muted = false;
let initialized = false;

/**
 * init preloads every cue. Called once from the app root.
 *
 * `setCategory('Ambient')` is the important line on iOS: it declares the app's audio
 * as non-primary, so a cue mixes with whatever the operator is already listening to
 * instead of pausing it, and it respects the hardware mute switch — an operator tool
 * has no business interrupting a call to play a click.
 */
export function initSound(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  if (Platform.OS === 'ios') {
    Sound.setCategory('Ambient', true);
  }

  (Object.keys(files) as Cue[]).forEach(cue => {
    const sound = new Sound(resolve(files[cue]), Sound.MAIN_BUNDLE, error => {
      if (error) {
        log.warn(`could not load cue "${cue}"`, error);
        return;
      }
      sound.setVolume(volumes[cue]);
      loaded.set(cue, sound);
    });
  });
}

/**
 * play triggers a cue. Safe to call before init finishes (drops the cue) and safe to
 * call in rapid succession: `stop()` before `play()` rewinds an already-playing
 * instance so repeated taps retrigger rather than being swallowed, which is what
 * makes fast list scrolling feel responsive instead of choppy.
 */
export function play(cue: Cue): void {
  if (muted) {
    return;
  }
  const sound = loaded.get(cue);
  if (!sound) {
    return;
  }
  sound.stop(() => {
    sound.play(success => {
      if (!success) {
        log.debug(`cue "${cue}" failed to play`);
      }
    });
  });
}

/** Mutes every cue — surfaced in Settings for operators in quiet environments. */
export function setMuted(next: boolean): void {
  muted = next;
}

export function isMuted(): boolean {
  return muted;
}

/** Releases native players. Only needed if the JS context is torn down. */
export function releaseSound(): void {
  loaded.forEach(sound => sound.release());
  loaded.clear();
  initialized = false;
}
