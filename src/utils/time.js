'use strict';
// Seluruh waktu dihitung eksplisit di zona waktu konfigurasi (default Asia/Jakarta),
// tidak bergantung pada zona waktu sistem operasi.

function nowInZone(timeZone, date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offsetMin = Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const off = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return {
    iso: `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${off}`,
    minutes: +p.hour * 60 + +p.minute,
    label: `${p.hour}:${p.minute}`,
  };
}

function parseHM(value, name) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) throw new Error(`${name} harus berformat HH:MM (diterima: "${value}")`);
  const total = +m[1] * 60 + +m[2];
  if (+m[2] > 59 || total > 1440) throw new Error(`${name} di luar rentang 00:00-24:00`);
  return total;
}

// start inklusif, end eksklusif. Jika start > end, rentang melewati tengah malam.
function isWithinWindow(minutes, startMin, endMin) {
  if (startMin === endMin) return false;
  if (startMin < endMin) return minutes >= startMin && minutes < endMin;
  return minutes >= startMin || minutes < endMin;
}

module.exports = { nowInZone, parseHM, isWithinWindow };
