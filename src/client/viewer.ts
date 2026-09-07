export class Viewer {
  private stream: MediaStream | null = null;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly empty: HTMLElement,
    private readonly playButton: HTMLButtonElement,
    local = false,
  ) {
    video.muted = local;
    video.controls = !local;
    playButton.addEventListener('click', () => void this.play());
  }

  setStream(stream: MediaStream | null) {
    if (this.stream === stream) return;
    this.stream = stream;
    this.video.pause();
    this.video.srcObject = stream;
    this.empty.hidden = Boolean(stream);
    this.playButton.hidden = true;
    if (stream) void this.play();
  }

  private async play() {
    try {
      await this.video.play();
      this.playButton.hidden = true;
    } catch {
      if (this.stream) this.playButton.hidden = false;
    }
  }

  dispose() {
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
  }
}
