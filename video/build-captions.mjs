// Builds src/captions.json (for on-screen captions) and subtitles.srt (deliverable) from the
// narration clips' own timings, offset to where each clip starts in the film.
import { readFileSync, writeFileSync } from 'node:fs';
export const OFFSETS = { s1: 3.0, s2: 12.6, s3: 35.6, s4: 56.0, s5: 90.6, s6: 104.3 };
const t = (x) => { const [h, m, r] = x.split(':'); const [sec, ms] = r.split(','); return +h * 3600 + +m * 60 + +sec + +ms / 1000; };
const cues = [];
for (const [id, off] of Object.entries(OFFSETS)) {
  const blocks = readFileSync(`public/audio/${id}.srt`, 'utf8').replace(/\r/g, '').trim().split(/\n\n+/);
  for (const b of blocks) {
    const [, time, ...text] = b.split('\n');
    const [a, z] = time.split(' --> ');
    cues.push({ start: +(off + t(a)).toFixed(3), end: +(off + t(z)).toFixed(3), text: text.join(' ') });
  }
}
writeFileSync('src/captions.json', JSON.stringify({ offsets: OFFSETS, cues }, null, 1));
const fmt = (x) => { const ms = Math.round(x * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
writeFileSync('subtitles.srt', cues.map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}\n`).join('\n'));
console.log(cues.length, 'cues; last ends at', cues.at(-1).end);
