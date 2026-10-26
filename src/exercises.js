// The built-in exercise library for Fitness mode: about 800 exercises (src/exercises.data.js, made by
// scripts/make-exercises.mjs from the open Free Exercise DB) covering every muscle. Ids are made from the name
// (never from the position), so adding exercises later can never break a saved workout. Custom exercises live in
// state.fitness.exercises.
//
// kind: 'wr' weight x reps (default) | 'bw' bodyweight reps, extra weight optional | 'sec' seconds | 'min' minutes
import DATA from './exercises.data.js';

// every muscle an exercise can have. 'back' is only kept so workouts saved by an early build still read.
export const MUSCLES = [
  ['abs', 'Abdominals'], ['biceps', 'Biceps'], ['chest', 'Chest'], ['forearms', 'Forearms'], ['lats', 'Lats'], ['lowerback', 'Lower Back'],
  ['neck', 'Neck'], ['shoulders', 'Shoulders'], ['traps', 'Traps'], ['triceps', 'Triceps'], ['upperback', 'Upper Back'],
  ['abductors', 'Abductors'], ['adductors', 'Adductors'], ['calves', 'Calves'], ['glutes', 'Glutes'], ['hamstrings', 'Hamstrings'], ['quads', 'Quadriceps'],
  ['cardio', 'Cardio'], ['fullbody', 'Full Body'],
  ['back', 'Back'],
];

// how the muscle sheet and the pickers are laid out (like Heavy: Upper Body, Lower Body, Other)
export const MUSCLE_SECTIONS = [
  ['Upper Body', ['abs', 'biceps', 'chest', 'forearms', 'lats', 'lowerback', 'neck', 'shoulders', 'traps', 'triceps', 'upperback']],
  ['Lower Body', ['abductors', 'adductors', 'calves', 'glutes', 'hamstrings', 'quads']],
  ['Other', ['cardio', 'fullbody']],
];

// The calendar and the "last trained" list work with these groups.
export const GROUPS = [
  ['chest', 'Chest', ['chest']],
  ['back', 'Back', ['back', 'lats', 'upperback', 'lowerback']],
  ['shoulders', 'Shoulders', ['shoulders', 'traps', 'neck']], // traps are trained on shoulder day more often than on back day
  ['arms', 'Arms', ['biceps', 'triceps', 'forearms']],
  ['legs', 'Legs', ['quads', 'hamstrings', 'glutes', 'calves', 'abductors', 'adductors']],
  ['core', 'Core', ['abs']],
  ['cardio', 'Cardio', ['cardio']],
  ['full', 'Full body', ['fullbody']],
];

export const KINDS = [['wr', 'Weight x reps'], ['bw', 'Bodyweight reps'], ['sec', 'Time (seconds)'], ['min', 'Time (minutes)']];
export const EQUIPMENT = ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Bodyweight', 'Kettlebell', 'EZ Bar', 'Band', 'Other'];

// ready made routines for Explore: [name, [[exercise name from the library, sets, reps], ...]]
export const STARTERS = [
  ['Chest day', [['Barbell Bench Press - Medium Grip', 4, 8], ['Incline Dumbbell Press', 3, 10], ['Machine Bench Press', 3, 12], ['Cable Crossover', 3, 12], ['Push-up', 2, 15]]],
  ['Back day', [['Barbell Deadlift', 3, 5], ['Lat Pulldown (Cable)', 4, 10], ['Bent Over Barbell Row', 3, 8], ['Seated Cable Row', 3, 12], ['Face Pull', 3, 15]]],
  ['Shoulder day', [['Overhead Press (Barbell)', 4, 8], ['Seated Dumbbell Press', 3, 10], ['Side Lateral Raise', 4, 15], ['Reverse Flyes', 3, 15], ['Barbell Shrug', 3, 12]]],
  ['Arms day', [['Barbell Curl', 3, 10], ['Hammer Curls', 3, 12], ['Close-Grip Barbell Bench Press', 3, 8], ['Triceps Pushdown (Rope)', 3, 12], ['Standing Dumbbell Triceps Extension', 3, 12]]],
  ['Leg day', [['Barbell Squat', 4, 8], ['Leg Press', 3, 12], ['Romanian Deadlift', 3, 10], ['Leg Extension', 3, 12], ['Seated Leg Curl', 3, 12], ['Standing Calf Raises', 4, 15]]],
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const used = new Set();
export const BUILTIN = DATA.map(([name, muscle, equip, kind]) => {
  let id = 'b:' + slug(name), n = 2;
  while (used.has(id)) id = `b:${slug(name)}-${n++}`;
  used.add(id);
  return { id, name, muscle, equip, kind: kind || 'wr', custom: false };
});
export const BUILTIN_BY_ID = Object.fromEntries(BUILTIN.map((e) => [e.id, e]));
