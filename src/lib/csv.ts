// One CSV cell, safe to open in a spreadsheet: a cell that a spreadsheet would read as a formula (it starts with = + - @
// or a tab or carriage return) gets a leading apostrophe, unless it is a plain number; quotes, commas and line breaks
// are quoted. Every export uses this (red team round 4: a supplier name from a PDF starting with =HYPERLINK( reached the
// invoices, journal and register exports as a live formula).

const NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) && !NUMBER.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
