import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {alignCaptionWords} from '../src/caption-alignment.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const projects = JSON.parse(await readFile(resolve(root, 'projects.json'), 'utf8'));
const [id, ...extra] = process.argv.slice(2);
const project = projects[id];
if (!project?.narration || extra.length) throw new Error('Usage: node scripts/typecast-short.mjs YYYY-MM-DD_001 (requires narration configuration)');
const config = project.narration;
const script = await import(pathToFileURL(resolve(root, project.script)).href);
const cues = script[project.cuesExport];
const spoken = script[config.spokenExport];
const texts = cues.map(({text}) => spoken(text));
const spokenWords = cues.map(({text}) => text.trim().split(/\s+/u).map((word) => spoken(word)));
const request = {
  model: 'ssfm-v30', voice_id: 'tc_632293f759d649937b97f323', language: 'kor',
  text: texts.join(' '), prompt: {emotion_preset: 'normal', emotion_intensity: 1},
  output: {audio_format: 'wav'},
};
const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
const metadataPath = resolve(root, config.voice);
const audioPath = resolve(root, 'public', config.audioFile);
let metadata;
try {metadata = JSON.parse(await readFile(metadataPath, 'utf8'));} catch {}
if (metadata?.requestHash === requestHash) {
  await readFile(audioPath);
  console.log('Using cached Jinwoo WAV narration; no API call.');
} else {
  if (process.env.YT_TTS_CACHE_ONLY === '1') throw new Error('Cache-only verification: no matching cached narration');
  if (!process.env.TYPECAST_API_KEY) throw new Error('TYPECAST_API_KEY is required.');
  console.log(`Generating Jinwoo WAV narration (${request.text.length} characters).`);
  const response = await fetch('https://api.typecast.ai/v1/text-to-speech/with-timestamps', {
    method: 'POST', headers: {'X-API-KEY': process.env.TYPECAST_API_KEY, 'Content-Type': 'application/json'},
    body: JSON.stringify(request), signal: AbortSignal.timeout(240_000),
  });
  if (!response.ok) throw new Error(`Typecast HTTP ${response.status}; request was not retried.`);
  const {audio, ...alignment} = await response.json();
  if (!audio || !alignment.characters?.length || !(alignment.audio_duration > 0)) throw new Error('Incomplete Typecast response.');
  await mkdir(dirname(audioPath), {recursive: true});
  await writeFile(audioPath, Buffer.from(audio, 'base64'));
  metadata = {provider: 'Typecast', voiceName: '진우', generatedAt: new Date().toISOString(), requestHash, request, ...alignment};
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
}
const normalize = (text) => text.replace(/[^\p{L}\p{N}]/gu, '');
const letters = metadata.characters.flatMap(segment => [...normalize(segment.text)].map(letter => ({letter, start: segment.start, end: segment.end})));
if (letters.map(({letter}) => letter).join('') !== normalize(request.text)) throw new Error('Alignment differs from narration text.');
let offset = 0;
const starts = texts.map((text, i) => {
  const start = i === 0 ? 0 : letters[offset].start;
  offset += normalize(text).length;
  return start;
});
const fps = 30;
const wordTimings = alignCaptionWords(cues.map((cue, i) => ({text: cue.text, spoken: texts[i], spokenWords: spokenWords[i]})), metadata.characters);
const durationInFrames = Math.ceil((metadata.audio_duration + 0.65) * fps);
const aligned = cues.map((cue, i) => ({...cue, words: wordTimings[i], start: Math.round(starts[i] * fps) / fps,
  end: i + 1 < starts.length ? Math.round(starts[i + 1] * fps) / fps : durationInFrames / fps}));
if (aligned.some(cue => cue.end <= cue.start)) throw new Error('Invalid cue timing.');
await writeFile(resolve(root, project.timing), JSON.stringify({fps, durationInFrames, audioFile: config.audioFile, audioDuration: metadata.audio_duration, cues: aligned}, null, 2) + '\n');
console.log(JSON.stringify({audioSeconds: metadata.audio_duration, videoSeconds: durationInFrames / fps, captions: aligned.length}));
