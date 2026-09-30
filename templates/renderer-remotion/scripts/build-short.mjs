import {readFile, writeFile, mkdir, mkdtemp, copyFile, rename, rm, stat} from 'node:fs/promises';
import {resolve, join, sep, extname, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import yaml from 'js-yaml';

// One entry point for rendering and collecting a finished Short. Temporary
// renders are published only after all requested Remotion commands succeed.
const root = fileURLToPath(new URL('../', import.meta.url));
const exportsRoot = resolve(process.env.YT_EXPORTS_ROOT ?? (()=>{throw new Error('YT_EXPORTS_ROOT is required')})());
const projects = JSON.parse(await readFile(resolve(root, 'projects.json'), 'utf8'));
const [selector, mode = '--all', ...extra] = process.argv.slice(2);
const usage = 'Usage: npm run build -- <YYYY-MM-DD_001 | "프로젝트 폴더명"> [--all|--video|--thumbnail|--audio|--collect]\n       npm run build -- --list';
if (selector === '--help' && mode === '--all' && !extra.length) {
  console.log(usage);
  process.exit(0);
}
if (selector === '--list' && mode === '--all' && !extra.length) {
  for (const [id, project] of Object.entries(projects)) console.log(`${id}  ${project.folder}`);
  process.exit(0);
}
const entry = Object.entries(projects).find(([id, project]) => id === selector || project.folder === selector);
if (!entry || !['--all', '--video', '--thumbnail', '--audio', '--collect'].includes(mode) || extra.length) {
  console.error(usage);
  process.exit(1);
}
const [id, project] = entry;
const slots = new Set();
for (const [projectId, project] of Object.entries(projects)) {
  const match = /^(\d{4}-\d{2}-\d{2})_(\d{3})_([^/\\]+)$/.exec(project.folder);
  if (!match || match[2] === '000') throw new Error(`Invalid project folder: ${project.folder}`);
  const slot = `${match[1]}_${match[2]}`;
  if (projectId !== slot) throw new Error(`Project ID must match the folder date/sequence: ${projectId}`);
  if (slots.has(slot)) throw new Error(`Duplicate project date/sequence: ${slot}`);
  slots.add(slot);
}
const destination = resolve(exportsRoot, project.folder);
if (!destination.startsWith(exportsRoot + sep)) throw new Error('Output must remain inside videos/exports.');
const metadataPath = join(destination, 'metadata.yaml');
const before = await readFile(metadataPath, 'utf8');
const metadata = yaml.load(before);
if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
  || typeof metadata.title !== 'string' || !metadata.title.trim()
  || typeof metadata.description !== 'string'
  || !Array.isArray(metadata.tags) || metadata.tags.some((tag) => typeof tag !== 'string' || !tag.trim())) {
  throw new Error('metadata.yaml requires title, description and a list of tags.');
}
const cues = (await import(pathToFileURL(resolve(root, project.script)).href))[project.cuesExport];
const timing = JSON.parse(await readFile(resolve(root, project.timing), 'utf8'));
if (!Array.isArray(cues) || cues.length !== timing.cues.length || cues.some((cue, i) => cue.text !== timing.cues[i].text)) {
  throw new Error('Script differs from rendered caption timing. Regenerate narration before packaging.');
}
const transcript = cues.map(({text}) => text.replace(/\s+/g, ' ').trim()).join('\n');
if (mode !== '--all' && mode !== '--collect' && typeof metadata.script === 'string'
  && metadata.script.replace(/\s/g, '') !== transcript.replace(/\s/g, '')) {
  throw new Error('The script changed: build both video and thumbnail together to refresh the package.');
}
const video = ['--all', '--video', '--collect'].includes(mode);
const thumbnail = ['--all', '--thumbnail', '--collect'].includes(mode);
const publicRoot = resolve(root, 'public');
if (typeof timing.audioFile !== 'string') throw new Error('Narration audioFile is required.');
const narrationSource = resolve(publicRoot, timing.audioFile);
if (!narrationSource.startsWith(publicRoot + sep)) throw new Error('Narration must remain inside public.');
const audioExtension = extname(narrationSource).toLowerCase();
if (!['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'].includes(audioExtension)) throw new Error('Unsupported narration audio format.');
const narrationRelativePath = `narration/narration${audioExtension}`;
if ((await stat(narrationSource)).size === 0) throw new Error('Narration audio is empty.');
// A partial build must still leave video, thumbnail, narration and metadata.
if (!video) await stat(join(destination, 'video.mp4'));
if (!thumbnail) await stat(join(destination, 'thumbnail.png'));
await mkdir(resolve(root, 'out'), {recursive: true});
const staging = await mkdtemp(resolve(root, 'out', `package-${id}-`));
const outputs = [];
try {
  // Copy the exact render input without a second lossy encode.
  await mkdir(dirname(join(staging, narrationRelativePath)), {recursive: true});
  await copyFile(narrationSource, join(staging, narrationRelativePath));
  outputs.push(narrationRelativePath);
  for (const [enabled, filename, composition, input] of [
    [video, 'video.mp4', project.composition, project.renderedVideo],
    [thumbnail, 'thumbnail.png', project.cover, project.renderedThumbnail],
  ]) {
    if (!enabled) continue;
    const target = join(staging, filename);
    if (mode === '--collect') {
      // Migration/import only: do not regenerate existing completed media.
      await copyFile(resolve(root, input), target);
    } else {
      const args = filename.endsWith('.mp4')
        ? ['render', 'src/index.ts', composition, target, '--codec=h264', '--crf=18', '--concurrency=4']
        : ['still', 'src/index.ts', composition, target];
      const result = spawnSync(resolve(root, 'node_modules/.bin/remotion'), args, {cwd: root, stdio: 'inherit'});
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`Remotion ${args[0]} failed (${result.signal ?? result.status}); delivery files were not updated.`);
    }
    if ((await stat(target)).size === 0) throw new Error(`Empty output: ${filename}`);
    outputs.push(filename);
  }
  // Preserve edits made by the user while a render is in progress.
  if (await readFile(metadataPath, 'utf8') !== before) throw new Error('metadata.yaml changed during rendering. Delivery files were not updated; rerun with the latest metadata.');
  const updated = {...metadata, script: transcript, video: 'video.mp4', thumbnail: 'thumbnail.png', audio: narrationRelativePath};
  await writeFile(join(staging, 'metadata.yaml'), yaml.dump(updated, {lineWidth: -1, noRefs: true, quotingType: '"'}));
  // Stage on the destination filesystem, then replace each file atomically.
  const delivery = await mkdtemp(join(destination, '.delivery-'));
  try {
    for (const filename of [...outputs, 'metadata.yaml']) {
      await mkdir(dirname(join(delivery, filename)), {recursive: true});
      await copyFile(join(staging, filename), join(delivery, filename));
    }
    for (const filename of [...outputs, 'metadata.yaml']) {
      await mkdir(dirname(join(destination, filename)), {recursive: true});
      await rename(join(delivery, filename), join(destination, filename));
    }
  } finally {
    await rm(delivery, {recursive: true, force: true});
  }
  console.log(`\nPackaged: ${destination}\n  ${[...outputs, 'metadata.yaml'].join('\n  ')}`);
} finally {
  await rm(staging, {recursive: true, force: true});
}
