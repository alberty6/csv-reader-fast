// v4: single-pass charCodeAt state machine over the whole text.
// No split('\n'), no per-field indexOf for unquoted fields. Quoted-field closes
// are found with indexOf('"') (C++ memchr). Slices are taken only at field ends,
// so a field is one slice (or one slice + a replace for the rare doubled-quote /
// CR-inside-quotes cases). Stray CRs, quote junk and unterminated quotes go
// through a cold helper (readUnquoted) that rebuilds the field without the CRs.
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const len = text.length;
  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xFEFF) pos = 1;

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= len) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quotedLast = false;
    let ended = 0; // 0 comma (continue), 1 line break, 2 end of text

    while (true) {
      let value;
      if (text.charCodeAt(pos) === 34) {
        // Quoted field.
        quotedLast = true;
        const open = pos;
        let q = open + 1;
        let doubled = false;
        let close = -1;
        while (true) {
          const qq = text.indexOf('"', q);
          if (qq === -1) { close = -1; break; }
          if (text.charCodeAt(qq + 1) === 34) { doubled = true; q = qq + 2; continue; }
          close = qq; break;
        }
        if (close === -1) {
          // The quote never closes: it is a literal character, and the text
          // after it is read again as unquoted.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          const r = readUnquoted(text, open + 1, '"', recordLine, recordRow, errors, line);
          value = r.value; ended = r.ended; pos = r.pos; line = r.line;
        } else {
          let content = text.slice(open + 1, close);
          // Line breaks inside the quotes: each LF and each CR (a CRLF pair
          // counting once) is one line, and each CR/CRLF reads as LF.
          if (content.indexOf('\n') !== -1 || content.indexOf('\r') !== -1) {
            let nb = 0;
            for (let k = 0; k < content.length; k++) {
              const ch = content.charCodeAt(k);
              if (ch === 10) nb += 1;
              else if (ch === 13) { nb += 1; if (content.charCodeAt(k + 1) === 10) k += 1; }
            }
            line += nb;
            if (content.indexOf('\r') !== -1) content = content.replace(/\r\n?/g, '\n');
          }
          if (doubled) content = content.replace(/""/g, '"');
          pos = close + 1;
          if (pos >= len) { value = content; ended = 2; }
          else {
            const c = text.charCodeAt(pos);
            if (c === 44) { pos += 1; value = content; ended = 0; }
            else if (c === 10) { pos += 1; line += 1; value = content; ended = 1; }
            else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; value = content; ended = 1; }
            else {
              // What follows the closing quote is appended as it stands.
              const r = readUnquoted(text, pos, content, recordLine, recordRow, errors, line);
              if (r.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
              value = r.value; ended = r.ended; pos = r.pos; line = r.line;
            }
          }
        }
      } else {
        // Unquoted field: scan for the next comma, LF or CR.
        quotedLast = false;
        const start = pos;
        let i = pos;
        let end = -1;
        while (i < len) {
          const c = text.charCodeAt(i);
          if (c === 44) { end = i; pos = i + 1; ended = 0; break; }
          if (c === 10) { end = i; pos = i + 1; line += 1; ended = 1; break; }
          if (c === 13) {
            if (text.charCodeAt(i + 1) === 10) { end = i; pos = i + 2; line += 1; ended = 1; break; }
            // Stray CR: re-read the whole field dropping CRs.
            const r = readUnquoted(text, start, '', recordLine, recordRow, errors, line);
            value = r.value; ended = r.ended; pos = r.pos; line = r.line;
            end = -2;
            break;
          }
          i += 1;
        }
        if (end === -1) { value = text.slice(start); pos = len; ended = 2; }
        else if (end >= 0) { value = text.slice(start, end); }
      }
      fields.push(value);
      if (ended !== 0) break;
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quotedLast) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}

// Reads unquoted characters from `start` onto `prefix` up to the next comma or
// line break: a CR not followed by LF is dropped (stray_cr). Cold path only:
// stray CRs inside a field, junk after a closing quote, and unterminated quotes.
// Returns the field, how it ended (0 comma, 1 line break, 2 end of text), the
// new position and line, and how many characters were appended after `prefix`.
function readUnquoted(text, start, prefix, recordLine, recordRow, errors, line) {
  const len = text.length;
  let parts = null;
  let segStart = start;
  let pos = start;
  while (pos < len) {
    const c = text.charCodeAt(pos);
    if (c === 44) {
      const value = parts ? parts.join('') + text.slice(segStart, pos) : prefix + text.slice(segStart, pos);
      return { value, ended: 0, pos: pos + 1, line, added: value.length - prefix.length };
    }
    if (c === 10) {
      const value = parts ? parts.join('') + text.slice(segStart, pos) : prefix + text.slice(segStart, pos);
      return { value, ended: 1, pos: pos + 1, line: line + 1, added: value.length - prefix.length };
    }
    if (c === 13) {
      if (text.charCodeAt(pos + 1) === 10) {
        const value = parts ? parts.join('') + text.slice(segStart, pos) : prefix + text.slice(segStart, pos);
        return { value, ended: 1, pos: pos + 2, line: line + 1, added: value.length - prefix.length };
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      if (parts === null) parts = [prefix, text.slice(segStart, pos)];
      else parts.push(text.slice(segStart, pos));
      pos += 1;
      segStart = pos;
      continue;
    }
    pos += 1;
  }
  const value = parts ? parts.join('') + text.slice(segStart, len) : prefix + text.slice(segStart, len);
  return { value, ended: 2, pos: len, line, added: value.length - prefix.length };
}
