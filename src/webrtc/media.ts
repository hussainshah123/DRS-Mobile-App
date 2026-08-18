/**
 * Media helpers — the small amount of glue between a WebRTC stream and the renderer.
 *
 * `RTCView` takes a `streamURL`, not a stream object. In react-native-webrtc that "URL" is
 * the stream's native react tag (`MediaStream.toURL()`), which is how the native renderer
 * finds the frame source. Keeping that detail behind one function means the session screen
 * never handles a native handle directly, and swapping renderers later touches one file.
 */
import type { MediaStream } from 'react-native-webrtc';

import type { FrameMessage } from '../protocol/messages';

/** streamUrl resolves a stream to the handle RTCView renders. */
export function streamUrl(stream: MediaStream | null): string | undefined {
  if (!stream) {
    return undefined;
  }
  const url = stream.toURL();
  return url || undefined;
}

/**
 * frameDataUri converts a JPEG fallback frame into a data URI for `<Image>`.
 *
 * The agent already base64-encodes the image so the whole protocol stays one JSON path, so
 * there is nothing to decode here — only to prefix. `mimeType` is defaulted rather than
 * trusted blindly, since an agent that omits it would otherwise produce `data:;base64,…`,
 * which renders as nothing at all.
 */
export function frameDataUri(frame: FrameMessage): string {
  return `data:${frame.mimeType || 'image/jpeg'};base64,${frame.dataB64}`;
}

/**
 * shouldRenderFrame guards against out-of-order JPEG frames.
 *
 * The hub drops the OLDEST queued frame when a viewer is slow (forwardToViewer's
 * non-blocking send), so sequence numbers can arrive with gaps — but never usefully out of
 * order. Rendering a frame older than the one on screen would make the picture jump
 * backwards, so a stale seq is discarded. `seq <= 0` is treated as "unsequenced" and always
 * rendered, so a future agent that omits it still works.
 */
export function shouldRenderFrame(incomingSeq: number, currentSeq: number): boolean {
  if (incomingSeq <= 0) {
    return true;
  }
  return incomingSeq > currentSeq;
}
