// Builds src/exercises.data.js, the offline exercise library, from the open "Free Exercise DB"
// (https://github.com/yuhonas/free-exercise-db, Unlicense / public domain, so it may be bundled).
//
//   curl -L -o /some/empty/folder/exercises.json https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json
//   node scripts/make-exercises.mjs /some/empty/folder/exercises.json
//
// Only names, the main muscle, the equipment and how a set is logged are kept (no images, no texts), so the file stays small.
// The app never downloads anything: this runs once, here, and the result is committed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const input = process.argv[2];
if (!input) { console.error('usage: node scripts/make-exercises.mjs path/to/exercises.json'); process.exit(1); }
const src = JSON.parse(fs.readFileSync(input, 'utf8'));

// the database's muscle names -> the ids used in src/exercises.js
const MUSCLE = {
  abdominals: 'abs', abductors: 'abductors', adductors: 'adductors', biceps: 'biceps', calves: 'calves', chest: 'chest', forearms: 'forearms',
  glutes: 'glutes', hamstrings: 'hamstrings', lats: 'lats', 'lower back': 'lowerback', 'middle back': 'upperback', neck: 'neck',
  quadriceps: 'quads', shoulders: 'shoulders', traps: 'traps', triceps: 'triceps',
};
const EQUIP = {
  barbell: 'Barbell', dumbbell: 'Dumbbell', machine: 'Machine', cable: 'Cable', 'body only': 'Bodyweight', kettlebells: 'Kettlebell',
  'e-z curl bar': 'EZ Bar', bands: 'Band', 'medicine ball': 'Other', 'exercise ball': 'Other', 'foam roll': 'Other', other: 'Other',
};
// exercises held for time rather than counted
const HOLD = /\b(plank|hold|wall sit|isometric|hang\b(?! clean| snatch| power))|bridge$/i;

const out = [];
const seen = new Set();
const add = (name, muscle, equip, kind) => {
  name = name.replace(/\s+/g, ' ').trim();
  const key = name.toLowerCase();
  if (!name || seen.has(key)) return;
  seen.add(key);
  out.push([name, muscle, equip, kind]);
};

for (const e of src) {
  if (e.category === 'stretching') continue;
  let muscle = MUSCLE[e.primaryMuscles && e.primaryMuscles[0]];
  if (e.category === 'cardio') muscle = 'cardio';
  else if (e.category === 'olympic weightlifting') muscle = 'fullbody';
  if (!muscle) continue;
  const equip = EQUIP[e.equipment] || (e.equipment ? 'Other' : 'Bodyweight');
  let kind = 'wr';
  if (e.category === 'cardio') kind = 'min';
  else if (HOLD.test(e.name)) kind = 'sec';
  else if (equip === 'Bodyweight') kind = 'bw';
  add(e.name, muscle, equip, kind);
}

// a few everyday ones the database does not list under the names people look for
[
  ['Plank', 'abs', 'Bodyweight', 'sec'], ['Side Plank', 'abs', 'Bodyweight', 'sec'], ['Dead Hang', 'forearms', 'Bodyweight', 'sec'],
  ['Wall Sit', 'quads', 'Bodyweight', 'sec'], ['Treadmill Walk', 'cardio', 'Machine', 'min'], ['Treadmill Run', 'cardio', 'Machine', 'min'],
  ['Walking (Outdoor)', 'cardio', 'Other', 'min'], ['Running (Outdoor)', 'cardio', 'Other', 'min'], ['Swimming', 'cardio', 'Other', 'min'],
  ['Battle Ropes', 'cardio', 'Other', 'min'], ['Burpees', 'fullbody', 'Bodyweight', 'bw'], ['Mountain Climber', 'abs', 'Bodyweight', 'bw'],
  ['Push-up', 'chest', 'Bodyweight', 'bw'], ['Pull-up', 'lats', 'Bodyweight', 'bw'], ['Chin-up', 'lats', 'Bodyweight', 'bw'],
  ['Triceps Dip', 'triceps', 'Bodyweight', 'bw'], ['Bodyweight Squat', 'quads', 'Bodyweight', 'bw'], ['Face Pull', 'shoulders', 'Cable', 'wr'],
  ['Triceps Pushdown (Rope)', 'triceps', 'Cable', 'wr'], ['Triceps Pushdown (Bar)', 'triceps', 'Cable', 'wr'], ['Lat Pulldown (Cable)', 'lats', 'Cable', 'wr'],
  ['Seated Cable Row', 'upperback', 'Cable', 'wr'], ['Hip Thrust', 'glutes', 'Barbell', 'wr'], ['Leg Press', 'quads', 'Machine', 'wr'],
  ['Leg Extension', 'quads', 'Machine', 'wr'], ['Seated Leg Curl', 'hamstrings', 'Machine', 'wr'], ['Pec Deck', 'chest', 'Machine', 'wr'],
  ['Lateral Raise (Dumbbell)', 'shoulders', 'Dumbbell', 'wr'], ['Overhead Press (Barbell)', 'shoulders', 'Barbell', 'wr'],
  // the thin muscles of the database
  ['Hip Abduction (Machine)', 'abductors', 'Machine', 'wr'], ['Hip Abduction (Cable)', 'abductors', 'Cable', 'wr'], ['Side-Lying Leg Raise', 'abductors', 'Bodyweight', 'bw'],
  ['Banded Lateral Walk', 'abductors', 'Band', 'bw'], ['Clamshell', 'abductors', 'Bodyweight', 'bw'],
  ['Hip Adduction (Machine)', 'adductors', 'Machine', 'wr'], ['Hip Adduction (Cable)', 'adductors', 'Cable', 'wr'], ['Copenhagen Plank', 'adductors', 'Bodyweight', 'sec'],
  ['Sumo Squat', 'adductors', 'Dumbbell', 'wr'],
  ['Neck Flexion (Plate)', 'neck', 'Other', 'wr'], ['Neck Extension (Plate)', 'neck', 'Other', 'wr'], ['Neck Side Flexion', 'neck', 'Other', 'wr'],
  ['Standing Calf Raise (Machine)', 'calves', 'Machine', 'wr'], ['Seated Calf Raise (Machine)', 'calves', 'Machine', 'wr'], ['Donkey Calf Raise', 'calves', 'Machine', 'wr'],
  ['Cable Kickback', 'glutes', 'Cable', 'wr'], ['Glute Bridge', 'glutes', 'Bodyweight', 'bw'], ['Back Extension', 'lowerback', 'Bodyweight', 'bw'],
].forEach((x) => add(...x));

out.sort((a, b) => a[0].localeCompare(b[0]));
const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, '..', 'src', 'exercises.data.js');
const lines = out.map((r) => '  ' + JSON.stringify(r)).join(',\n');
fs.writeFileSync(file, `// GENERATED by scripts/make-exercises.mjs from the Free Exercise DB (Unlicense, public domain). Do not edit by hand.\n// [name, main muscle, equipment, kind]  (kind: wr weight x reps, bw bodyweight reps, sec seconds, min minutes)\nexport default [\n${lines},\n];\n`);

const by = {};
out.forEach((r) => { by[r[1]] = (by[r[1]] || 0) + 1; });
console.log(out.length + ' exercises written to src/exercises.data.js');
console.log(by);
