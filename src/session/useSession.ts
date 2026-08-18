/**
 * React binding for SessionController.
 *
 * The controller deliberately owns state outside React, so this hook does the minimum:
 * create one controller per (device, attempt), mirror its snapshot into state, and expose
 * the intents. `attempt` is the retry mechanism — bumping it discards the old controller
 * entirely and builds a fresh one, which is far safer than trying to reset a session that
 * failed halfway through negotiation.
 *
 * The stream and the JPEG frame are held in separate state from the snapshot because they
 * change on completely different cadences: a snapshot patch happens on a state transition,
 * while a JPEG frame arrives several times a second. Merging them would re-render every
 * consumer of session state on every frame.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MediaStream } from 'react-native-webrtc';

import type { InputEvent } from '../protocol/inputEvent';
import { SessionState, type SessionSnapshot } from '../types/session';
import { SessionController, type JpegFrame } from './SessionController';

const idleSnapshot: SessionSnapshot = {
  state: SessionState.IDLE,
  control: 'view_only',
  sessionId: '',
  mode: '',
  failure: null,
  message: '',
  lockLocal: false,
  videoSize: null,
  inputChannelOpen: false,
  elapsedSeconds: 0,
};

export type UseSessionResult = {
  snapshot: SessionSnapshot;
  /** The WebRTC stream, or null on the JPEG path / before connect. */
  stream: MediaStream | null;
  /** The latest JPEG fallback frame, or null on the WebRTC path. */
  frame: JpegFrame | null;
  /** Grant or revoke remote control through the backend. */
  requestControl: (enabled: boolean, lockLocal?: boolean) => void;
  /** Write one input event to the drs-input channel. Dropped unless control is in force. */
  sendInput: (event: InputEvent) => void;
  /** Report the remote picture's pixel size (from RTCView.onDimensionsChange). */
  setVideoSize: (width: number, height: number) => void;
  /** Tear down and start over. */
  retry: () => void;
  /** End the session. */
  stop: () => void;
};

export function useSession(deviceId: string, token: string | null): UseSessionResult {
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(idleSnapshot);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [frame, setFrame] = useState<JpegFrame | null>(null);
  const [attempt, setAttempt] = useState(0);

  // The controller is held in a ref as well as being created in the effect, so the
  // callbacks below stay referentially stable — a changing `sendInput` identity would
  // re-create every gesture responder on the session screen mid-drag.
  const controllerRef = useRef<SessionController | null>(null);

  useEffect(() => {
    if (!deviceId || !token) {
      return undefined;
    }
    setStream(null);
    setFrame(null);

    const controller = new SessionController({
      deviceId,
      token,
      onStream: setStream,
      onFrame: setFrame,
    });
    controllerRef.current = controller;

    const unsubscribe = controller.subscribe(setSnapshot);
    void controller.start();

    return () => {
      unsubscribe();
      controllerRef.current = null;
      // 'unmount' suppresses the disconnect cue: navigating away is not an event that needs
      // announcing, and the sound would land after the screen is gone.
      controller.stop('unmount');
    };
  }, [deviceId, token, attempt]);

  const requestControl = useCallback((enabled: boolean, lockLocal = false) => {
    controllerRef.current?.requestControl(enabled, lockLocal);
  }, []);

  const sendInput = useCallback((event: InputEvent) => {
    controllerRef.current?.sendInput(event);
  }, []);

  const setVideoSize = useCallback((width: number, height: number) => {
    controllerRef.current?.setVideoSize(width, height);
  }, []);

  const retry = useCallback(() => {
    setAttempt(n => n + 1);
  }, []);

  const stop = useCallback(() => {
    controllerRef.current?.stop('operator');
  }, []);

  return useMemo(
    () => ({ snapshot, stream, frame, requestControl, sendInput, setVideoSize, retry, stop }),
    [snapshot, stream, frame, requestControl, sendInput, setVideoSize, retry, stop],
  );
}
