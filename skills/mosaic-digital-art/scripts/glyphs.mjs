// Original 5x7 bitmap alphabet; no external font assets are required.
export const FONT = 'js-build-pic-01-5x7-v1';
export const MIXED_FONT = 'js-build-pic-mixed-5x7-v1';
export const CHARSETS = Object.freeze({ binary: '01', mixed: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ@#$%&*+=?' });
export const GLYPHS = Object.freeze({
  '0': Object.freeze(['01110', '10001', '10001', '10001', '10001', '10001', '01110']),
  '1': Object.freeze(['00110', '01110', '00110', '00110', '00110', '00110', '01111']),
});
const rows = {
  '2': [14,17,1,2,4,8,31], '3': [30,1,1,14,1,1,30],
  '4': [2,6,10,18,31,2,2], '5': [31,16,16,30,1,1,30],
  '6': [14,16,16,30,17,17,14], '7': [31,1,2,4,8,8,8],
  '8': [14,17,17,14,17,17,14], '9': [14,17,17,15,1,1,14],
  A: [14,17,17,31,17,17,17], B: [30,17,17,30,17,17,30],
  C: [14,17,16,16,16,17,14], D: [30,17,17,17,17,17,30],
  E: [31,16,16,30,16,16,31], F: [31,16,16,30,16,16,16],
  G: [14,17,16,23,17,17,15], H: [17,17,17,31,17,17,17],
  I: [31,4,4,4,4,4,31], J: [7,2,2,2,2,18,12],
  K: [17,18,20,24,20,18,17], L: [16,16,16,16,16,16,31],
  M: [17,27,21,21,17,17,17], N: [17,25,21,19,17,17,17],
  O: [14,17,17,17,17,17,14], P: [30,17,17,30,16,16,16],
  Q: [14,17,17,17,21,18,13], R: [30,17,17,30,20,18,17],
  S: [15,16,16,14,1,1,30], T: [31,4,4,4,4,4,4],
  U: [17,17,17,17,17,17,14], V: [17,17,17,17,17,10,4],
  W: [17,17,17,21,21,27,17], X: [17,17,10,4,10,17,17],
  Y: [17,17,10,4,4,4,4], Z: [31,1,2,4,8,16,31],
  '@': [14,17,23,21,23,16,14], '#': [10,10,31,10,31,10,10],
  '$': [4,15,20,14,5,30,4], '%': [25,25,2,4,8,19,19],
  '&': [12,18,20,8,21,18,13], '*': [0,21,14,31,14,21,0],
  '+': [0,4,4,31,4,4,0], '=': [0,0,31,0,31,0,0],
  '?': [14,17,1,2,4,0,4],
};
export const MIXED_GLYPHS = Object.freeze({ ...GLYPHS,
  ...Object.fromEntries(Object.entries(rows).map(([char, values]) => [char,
    Object.freeze(values.map(value => value.toString(2).padStart(5, '0')))])),
});
// Widen strokes one bitmap pixel rightward, keeping counters and the 5x7 bounds.
const BOLD_GLYPHS = Object.freeze(Object.fromEntries(Object.entries(MIXED_GLYPHS).map(([char, glyph]) => [char,
  Object.freeze(glyph.map(row => [...row].map((pixel, x) => pixel === '1' || (x > 0 && row[x - 1] === '1') ? '1' : '0').join('')))])));
export const glyphForCell = (scene, cell) => cell.weight === 'bold' ? BOLD_GLYPHS[cell.char]
  : (scene.charset === 'mixed' ? MIXED_GLYPHS : GLYPHS)[cell.char];
export const structureCheck = scene => scene.charset === 'mixed' ? 'strict_charset' : 'strict_01';
