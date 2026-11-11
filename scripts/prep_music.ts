// Prepares a recorded night-music track for the app (needs ffmpeg with libmp3lame).
// Trims the silence at both ends, drops cover art and tags, sets the loudness to the level of the
// built-in synthesized night music (-20 LUFS, the same as the judge's voice before the music volume
// and ducking apply) with one linear gain, and encodes a VBR MP3 that every phone browser decodes.
//
//   node scripts/prep_music.ts <input audio> [output = client/public/music/night.mp3]
//
// client/public/music/ is git-ignored (the track you generate is yours, not part of the repository);
// deploy/deploy.sh copies it to the server, and the owner's phone plays it instead of the synth.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [input, output = 'client/public/music/night.mp3'] = process.argv.slice(2);
if (!input || !fs.existsSync(input)) {
  console.error('usage: node scripts/prep_music.ts <input audio> [output = client/public/music/night.mp3]');
  process.exit(2);
}
const TARGET = -20; // LUFS
const PEAK = -2; // dBTP ceiling
// silence below -50 dB at the start, then (reversed) at the end
const TRIM =
  'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,' +
  'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse';

/** runs a tool and returns what it printed (ffmpeg reports on stderr) */
function run(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} failed:\n${(r.stderr ?? '').slice(-1500)}`);
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}

// pass 1: measure the trimmed track
const report = run('ffmpeg', ['-hide_banner', '-nostats', '-i', input, '-vn', '-af', `${TRIM},loudnorm=I=${TARGET}:TP=${PEAK}:LRA=20:print_format=json`, '-f', 'null', '-']);
const m = JSON.parse(report.slice(report.lastIndexOf('{'), report.lastIndexOf('}') + 1)) as Record<string, string>;
console.log(`input: ${m.input_i} LUFS, true peak ${m.input_tp} dBTP, loudness range ${m.input_lra} LU`);

// pass 2: one linear gain to the target, then MP3 (VBR ~190 kbps), without cover art or tags
fs.mkdirSync(path.dirname(output), { recursive: true });
const norm =
  `loudnorm=I=${TARGET}:TP=${PEAK}:LRA=20:measured_I=${m.input_i}:measured_TP=${m.input_tp}:` +
  `measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=json`;
const done = run('ffmpeg', ['-hide_banner', '-nostats', '-y', '-i', input, '-vn', '-map_metadata', '-1', '-af', `${TRIM},${norm}`, '-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-q:a', '2', output]);
const mode = JSON.parse(done.slice(done.lastIndexOf('{'), done.lastIndexOf('}') + 1)).normalization_type as string;
if (mode !== 'linear') console.warn(`warning: loudnorm used ${mode} normalization instead of one linear gain`);

// check the result
const check = run('ffmpeg', ['-hide_banner', '-nostats', '-i', output, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
const summary = check.slice(check.lastIndexOf('Summary:'));
const loud = /I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1];
const peak = /Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1];
const dur = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', output]).trim());
console.log(`wrote ${output}: ${dur.toFixed(1)} s, ${(fs.statSync(output).size / 1048576).toFixed(1)} MB, ${loud} LUFS, true peak ${peak} dBFS`);
