let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "record:start") {
    void startRecording(message.streamId).then(sendResponse);
    return true;
  }
  if (message?.type === "record:stop") {
    void stopRecording().then(sendResponse);
    return true;
  }
  return false;
});

async function startRecording(streamId?: string) {
  if (!streamId) return { ok: false, error: "Missing streamId" };
  if (recorder) return { ok: false, error: "Already recording" };

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    } as MediaTrackConstraints,
  });

  chunks = [];
  recorder = new MediaRecorder(stream, {
    mimeType: "video/webm; codecs=vp9",
  });

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  recorder.onstop = () => {
    stream.getTracks().forEach((track) => track.stop());
  };

  recorder.start();
  return { ok: true };
}

async function stopRecording() {
  if (!recorder) return { ok: false, error: "Not recording" };

  const stopped = new Promise<Blob>((resolve) => {
    const current = recorder;
    if (!current) {
      resolve(new Blob());
      return;
    }
    current.onstop = () => {
      resolve(new Blob(chunks, { type: "video/webm" }));
      current.stream.getTracks().forEach((track) => track.stop());
    };
  });

  recorder.stop();
  recorder = null;

  const blob = await stopped;
  const dataUrl = await blobToDataUrl(blob);
  return { ok: true, dataUrl };
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return `data:${blob.type};base64,${btoa(binary)}`;
}
