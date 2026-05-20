const GROQ_TRANSCRIPTION_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
const DEFAULT_GROQ_TRANSCRIPTION_MODEL = "whisper-large-v3-turbo";

export function isGroqTranscriptionConfigured() {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

export async function transcribeVoiceWithGroq(params: {
  buffer: Buffer;
  fileName: string;
  mimeType?: string;
}) {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not configured");
  }

  const formData = new FormData();
  const audioBytes = new Uint8Array(params.buffer);
  const audioBuffer = new ArrayBuffer(audioBytes.byteLength);
  new Uint8Array(audioBuffer).set(audioBytes);
  const blob = new Blob([audioBuffer], {
    type: params.mimeType || "audio/webm",
  });

  formData.append("file", blob, params.fileName || "recording.webm");
  formData.append("model", process.env.GROQ_TRANSCRIPTION_MODEL || DEFAULT_GROQ_TRANSCRIPTION_MODEL);
  formData.append("language", "vi");
  formData.append("response_format", "json");

  const response = await fetch(GROQ_TRANSCRIPTION_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Groq transcription failed with status ${response.status}: ${await response.text()}`);
  }

  const payload = (await response.json()) as { text?: unknown };
  const transcript = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!transcript) {
    throw new Error("Groq transcription returned no transcript");
  }

  return transcript;
}
