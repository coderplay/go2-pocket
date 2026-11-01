/** A muted, inline stream must be explicitly resumed after a view swap on iOS. */
export function playLiveVideo(video: HTMLVideoElement, stream: MediaStream): void {
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  if (video.srcObject !== stream) video.srcObject = stream;
  void video.play().catch(() => { /* A later view tap / track event retries playback. */ });
}

/** Release only this display element; the shared WebRTC tracks stay connected. */
export function clearLiveVideo(video: HTMLVideoElement | null): void {
  if (!video) return;
  video.pause();
  video.srcObject = null;
}
