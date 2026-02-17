import { SarvamAIClient } from 'sarvamai';
import * as fs from 'fs';

const apiKey = process.env.SARVAM_API_KEY;
const audioPath = process.env.SARVAM_AUDIO_PATH;

if (!apiKey) {
  console.error('Missing SARVAM_API_KEY');
  process.exit(1);
}

if (!audioPath) {
  console.error('Missing SARVAM_AUDIO_PATH');
  process.exit(1);
}


function audioFileToBase64(filePath:string) {
  return fs.readFileSync(filePath).toString("base64");
}


async function basicTranscription(filepath:String) {
  const audioData = audioFileToBase64(filepath);
  const client = new SarvamAIClient({
    apiSubscriptionKey: apiKey
  });
  console.log("1. audio file read. connecting to streaming service")
  const socket = await client.speechToTextStreaming.connect({
    model: "saaras:v3",
    mode: "transcribe",
    "language-code": "en-IN",
    high_vad_sensitivity: "true"
  });
  socket.on("open", () => {
    console.log("2. connection opened. sending audio data")
    socket.transcribe({
      audio: audioData,
      sample_rate: 48000,
      encoding: "audio/wav",
    });
  });
  socket.on("message", (response) => {
    console.log("3. received message")
    console.log("Result:", response);
  });
  await socket.waitForOpen();
  await new Promise(resolve => setTimeout(resolve, 100000));
  socket.close();
}
basicTranscription(audioPath);