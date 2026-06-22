// Convert a timezone-less `<input type="datetime-local">` value (browser
// wall-clock, "YYYY-MM-DDTHH:MM") into a true UTC ISO instant, given the
// browser's timezone offset for that moment (`Date.prototype.getTimezoneOffset`,
// minutes; positive = behind UTC, negative = ahead).
//
// This MUST run in the browser, where the timezone is known. Parsing the
// tz-less string on the edge/UTC server (`new Date(value)`) stored the wrong
// instant — a share would expire hours early/late and the edit view re-shifted
// it. Pure and offset-explicit so it's deterministically unit-testable
// regardless of the test runner's own timezone.
export function localInputToIso(value: string, offsetMinutes: number): string {
  if (!value) return '';
  // Pin the tz-less wall-clock to UTC, then shift by the local offset:
  // 09:00 in IST (offset -330) -> 09:00Z + (-330m) = 03:30Z.
  const asUtcMs = Date.parse(`${value}Z`);
  if (Number.isNaN(asUtcMs)) return '';
  return new Date(asUtcMs + offsetMinutes * 60_000).toISOString();
}
