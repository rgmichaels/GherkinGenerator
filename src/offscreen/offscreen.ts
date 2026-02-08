let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
const recordings = new Map<string, Blob>();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "record:start") {
    void startRecording(message.streamId).then(sendResponse);
    return true;
  }
  if (message?.type === "record:stop") {
    void stopRecording().then(sendResponse);
    return true;
  }
  if (message?.type === "record:upload") {
    void uploadRecording(message).then(sendResponse);
    return true;
  }
  return false;
});

async function startRecording(streamId?: string) {
  try {
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

    const preferredTypes = [
      "video/webm; codecs=vp9",
      "video/webm; codecs=vp8",
      "video/webm",
    ];
    const mimeType =
      preferredTypes.find((type) => MediaRecorder.isTypeSupported(type)) || "";

    chunks = [];
    recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

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
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
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
  const recordingId = `rec-${Date.now()}`;
  recordings.set(recordingId, blob);
  return { ok: true, recordingId };
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

async function uploadRecording(message: {
  recordingId?: string;
  baseUrl?: string;
  authHeader?: string;
  issueKey?: string;
}) {
  const { recordingId, baseUrl, authHeader, issueKey } = message;
  if (!recordingId || !baseUrl || !authHeader || !issueKey) {
    return { ok: false, error: "Missing upload parameters" };
  }
  const blob = recordings.get(recordingId);
  if (!blob) return { ok: false, error: "Recording not found" };

  const form = new FormData();
  form.append("file", blob, "recording.webm");

  const response = await fetch(`${baseUrl}/rest/api/3/issue/${issueKey}/attachments`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
      "X-Atlassian-Token": "no-check",
    },
    body: form,
  });

  if (!response.ok) {
    return { ok: false, error: `Upload failed (${response.status})` };
  }

  recordings.delete(recordingId);
  return { ok: true };
}
