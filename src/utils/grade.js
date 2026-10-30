'use strict';
const SCALE = [
  [85, 'A', 4.0], [80, 'AB', 3.5], [70, 'B', 3.0],
  [65, 'BC', 2.5], [55, 'C', 2.0], [40, 'D', 1.0], [0, 'E', 0.0],
];

function nilaiToHuruf(n) {
  for (const [min, huruf] of SCALE) if (n >= min) return huruf;
  return 'E';
}
function hurufToBobot(h) {
  const row = SCALE.find((r) => r[1] === h);
  return row ? row[2] : 0;
}
module.exports = { nilaiToHuruf, hurufToBobot };
