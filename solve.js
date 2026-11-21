// v3: split by \n into lines, parse per line, multiline quoted fields merge lines
export function run(input) {
  let text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.split('\n');
  const totalLines = lines.length;
  const endsWithNL = text.endsWith('\n');
  const isLast = (idx) => idx === totalLines - 1 && !endsWithNL;
  // line numbers: lineNo is 1-based for current line index, plus extra for lone CRs inside quotes
  let extraLine = 0; // lone CRs inside quotes encountered so far
  let i = 0;
  while (i < totalLines) {
    // last element after final \n is '' - that's not a record (EOF, no trailing newline content)
    // But if text ends without \n, last line is a record. If text ends with \n, last split element is '' and should be skipped as empty.
    // Empty line skipping is handled below.
    let lineStr = lines[i];
    const lineNo = i + 1 + extraLine;
    // Empty line: '' or '\r' (CRLF empty line)
    if (lineStr === '' || (lineStr === '\r' && !isLast(i))) { i++; continue; }
    const recordLine = lineNo;
    const recordRow = (header && columns === null) ? null : rows.length;
    // Parse this record, possibly consuming multiple lines for multiline quoted fields
    const fields = [];
    let quotedLast = false;
    let consumedLines = 1; // lines consumed for this record (usually 1)
    let posInLine = 0;
    let cur = lineStr;
    let curLineIdx = i;
    let curIsCRLF = false; // whether cur line ended with \r in original (i.e. lineStr ends with \r and is not the last line, or is CRLF terminator)
    // Helper to get next line for multiline: returns string or null
    // We parse fields in a loop over the current line string, with state for quoted spanning
    let recordDone = false;
    let eof = false;
    while (!recordDone) {
      // parse one field from cur at posInLine
      let value; let quoted = false; let ended; // 0 comma, 1 line end, 2 eof
      if (posInLine < cur.length && cur.charCodeAt(posInLine) === 34) {
        quoted = true;
        const open = posInLine;
        // find closing quote in cur, skipping doubled
        let search = open + 1;
        let close = -1; let doubled = false;
        while (true) {
          const qq = cur.indexOf('"', search);
          if (qq === -1) { close = -1; break; }
          if (cur.charCodeAt(qq+1) === 34) { doubled = true; search = qq+2; continue; }
          close = qq; break;
        }
        if (close === -1) {
          // Check if this is truly unterminated in the whole text, or spans to next lines.
          // Look ahead: if there is a closing quote in later lines, it's multiline; else unterminated.
          // To decide cheaply, scan remaining lines for a '"' - but that could be expensive.
          // Instead, treat as multiline if there are more lines and the quote is not the only quote in the rest?
          // Simpler: attempt multiline merge: accumulate lines until a closing quote is found.
          // If we reach EOF without closing, then it's unterminated: re-parse as unquoted from open.
          // We need to save the original line index and pos to re-parse.
          // Build merged content by joining lines with '\n', handling trailing '\r' as CRLF->'\n'.
          let merged = cur.slice(open+1);
          let foundClose = -1;
          let mergedLines = 0;
          let j = i + 1;
          let mergedContent = null;
          // Search line by line
          let acc = merged; // content after open, up to end of current line (excluding trailing \r handling later)
          // We need to know if cur line ends with \r (CRLF inside quotes) - then that \r + \n becomes one \n, not \r+\n.
          // Our acc currently includes trailing \r if present. We'll handle when joining.
          let parts = [];
          // Start with first segment (after open, to end of line, stripping trailing \r if present, remembering it was CRLF)
          let firstSeg = cur.slice(open+1);
          let firstCRLF = false;
          if (firstSeg.charCodeAt(firstSeg.length-1) === 13) { firstSeg = firstSeg.slice(0,-1); firstCRLF = true; }
          parts.push(firstSeg);
          let closedFound = false;
          let closeLineIdx = -1; let closePosInLine = -1; let closeDoubled = false;
          // Scan subsequent lines for closing quote
          for (let jj = i+1; jj < totalLines; jj++) {
            const ln = lines[jj];
            // find closing quote in ln, skipping doubled
            let s = 0; let cl = -1; let dbl = false;
            while (true) {
              const qq = ln.indexOf('"', s);
              if (qq === -1) { cl = -1; break; }
              if (ln.charCodeAt(qq+1) === 34) { dbl = true; s = qq+2; continue; }
              cl = qq; break;
            }
            if (cl !== -1) { closedFound = true; closeLineIdx = jj; closePosInLine = cl; closeDoubled = dbl; break; }
            // no close in this line, add whole line (stripping trailing \r)
            let seg = ln;
            if (seg.charCodeAt(seg.length-1) === 13) seg = seg.slice(0,-1);
            parts.push(seg);
            mergedLines++;
          }
          if (!closedFound) {
            // Unterminated: re-read as unquoted, starting with '"', from open+1 in the current line, then continuing as a normal unquoted field across... 
            // Reference: pos resets to open+1 in the original text, line resets to openLine, then readUnquoted reads until comma / line break / EOF, where line break is the next \n (i.e. end of this line) or CRLF.
            // So unterminated field ends at end of this line (or at a comma in this line).
            errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
            // Parse unquoted from open+1 in cur
            let start = open + 1;
            let valParts = ['"'];
            let p = start;
            // find delimiter in cur
            while (true) {
              const ci = cur.indexOf(',', p); const ri = cur.indexOf('\r', p);
              let idx = -1; let kind = 0;
              if (ci !== -1) { idx = ci; kind = 0; }
              if (ri !== -1 && (idx === -1 || ri < idx)) { idx = ri; kind = 2; }
              if (idx === -1) {
                if (p < cur.length) valParts.push(cur.slice(p));
                value = valParts.join('');
                // field ends at line end
                posInLine = cur.length; ended = 1; break;
              }
              if (kind === 0) {
                if (p < idx) valParts.push(cur.slice(p, idx));
                value = valParts.join('');
                posInLine = idx + 1; ended = 0; break;
              }
              // CR: if it's trailing \r at end of line, it's CRLF terminator (since line was split by \n, a trailing \r means CRLF)
              if (idx === cur.length - 1 && !isLast(curLineIdx)) {
                if (p < idx) valParts.push(cur.slice(p, idx));
                value = valParts.join('');
                posInLine = cur.length; ended = 1; break;
              }
              // stray CR inside line
              errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
              if (p < idx) valParts.push(cur.slice(p, idx));
              p = idx + 1;
            }
            // Note: if ended is 1 (line end), record is done after this field; if 0, continue to next field in same line
          } else {
            // Multiline quoted field found
            // Add the segment up to close in the closing line
            let lastSeg = lines[closeLineIdx].slice(0, closePosInLine);
            parts.push(lastSeg);
            let content = parts.join('\n');
            if (closeDoubled || parts.some(s=>s.includes('""'))) {
              // doubled quotes could be in any part; replace globally (only if any "" present)
              if (content.includes('""')) content = content.replace(/""/g, '"');
            }
            // Lone CRs inside content: any '\r' remaining in content is a lone CR (since CRLF \r were stripped at line ends, and \r in middle of a line is lone)
            // Count them for line numbers and convert to '\n'
            if (content.indexOf('\r') !== -1) {
              // count lone CRs
              let cnt = 0; let ii=-1; while ((ii = content.indexOf('\r', ii+1)) !== -1) cnt++;
              extraLine += cnt;
              content = content.replace(/\r/g, '\n');
            }
            // Lines consumed: from i to closeLineIdx inclusive
            consumedLines = closeLineIdx - i + 1;
            // After closing quote, pos is in closing line after close
            cur = lines[closeLineIdx];
            curLineIdx = closeLineIdx;
            posInLine = closePosInLine + 1;
            // Update i to closeLineIdx for line counting? We will advance i by consumedLines at record end, and cur is now closing line
            // For after-quote handling, we need to know if cur line is the closing line and its remaining content
            // Set a flag so record end handling uses cur
            i = closeLineIdx; // move i to closing line; the outer loop will advance by 1 after record, but we need consumedLines accounting - handle below by setting a variable
            // Actually we will handle record completion and then set i = closeLineIdx + 1 in outer loop via consumedLines variable
            // To avoid confusion, store closeLineIdx in a variable and use it at record end
            // Use a closure variable: recordEndLineIdx
            // For now, set posInLine and continue to after-quote handling below, using cur
            // After-quote:
            if (posInLine >= cur.length) { value = content; ended = 1; }
            else {
              const ch = cur.charCodeAt(posInLine);
              if (ch === 44) { posInLine++; value = content; ended = 0; }
              else if (ch === 13 && posInLine === cur.length - 1 && !isLast(curLineIdx)) { value = content; ended = 1; posInLine = cur.length; }
              else {
                // junk: parse unquoted junk in cur from posInLine
                let start = posInLine; let valParts = [content]; let added = 0; let p = start;
                while (true) {
                  const ci = cur.indexOf(',', p); const ri = cur.indexOf('\r', p);
                  let idx = -1; let kind = 0;
                  if (ci !== -1) { idx = ci; kind = 0; }
                  if (ri !== -1 && (idx === -1 || ri < idx)) { idx = ri; kind = 2; }
                  if (idx === -1) {
                    if (p < cur.length) { valParts.push(cur.slice(p)); added += cur.length - p; }
                    value = valParts.join(''); posInLine = cur.length; ended = 1; break;
                  }
                  if (kind === 0) {
                    if (p < idx) { valParts.push(cur.slice(p, idx)); added += idx - p; }
                    value = valParts.join(''); posInLine = idx + 1; ended = 0; break;
                  }
                  if (idx === cur.length - 1 && !isLast(curLineIdx)) {
                    if (p < idx) { valParts.push(cur.slice(p, idx)); added += idx - p; }
                    value = valParts.join(''); posInLine = cur.length; ended = 1; break;
                  }
                  errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
                  if (p < idx) { valParts.push(cur.slice(p, idx)); added += idx - p; }
                  p = idx + 1;
                }
                if (added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
              }
            }
            // Mark that we consumed multiline lines: set a variable on the record scope
            // We use consumedLines already, and i was set to closeLineIdx, so outer advance should be i+1
            // To signal, set a flag variable multilineConsumed = true and store closeLineIdx
            // Simpler: set i to closeLineIdx now, and at record end outer loop does i++ (so next record starts after closing line)
            // But our outer while uses i as current line index; we already changed i, so we need to prevent double counting.
            // We'll set a variable recordEndIdx = closeLineIdx and use it after record parsing.
            // For now, stash in a variable defined outside: use `i` as is, and set `consumedLines = 0` to indicate i already advanced?
            consumedLines = 0; // i already points to closing line, outer loop will do i++
          }
        } else {
          // Closing quote in same line
          let content = cur.slice(open+1, close);
          if (doubled) content = content.replace(/""/g, '"');
          if (content.indexOf('\r') !== -1) {
            // lone CRs inside (not at line end, since close is before end, and \r in middle is lone; also \r could be part of... if content ends with \r? that would be before close, so lone)
            let cnt = 0; let ii=-1; while ((ii = content.indexOf('\r', ii+1)) !== -1) cnt++;
            extraLine += cnt;
            content = content.replace(/\r/g, '\n');
          }
          posInLine = close + 1;
          if (posInLine >= cur.length) { value = content; ended = 1; }
          else {
            const ch = cur.charCodeAt(posInLine);
            if (ch === 44) { posInLine++; value = content; ended = 0; }
            else if (ch === 13 && posInLine === cur.length - 1 && !isLast(curLineIdx)) { value = content; ended = 1; posInLine = cur.length; }
            else {
              let start = posInLine; let valParts = [content]; let added = 0; let p = start;
              while (true) {
                const ci = cur.indexOf(',', p); const ri = cur.indexOf('\r', p);
                let idx = -1; let kind = 0;
                if (ci !== -1) { idx = ci; kind = 0; }
                if (ri !== -1 && (idx === -1 || ri < idx)) { idx = ri; kind = 2; }
                if (idx === -1) {
                  if (p < cur.length) { valParts.push(cur.slice(p)); added += cur.length - p; }
                  value = valParts.join(''); posInLine = cur.length; ended = 1; break;
                }
                if (kind === 0) {
                  if (p < idx) { valParts.push(cur.slice(p, idx)); added += idx - p; }
                  value = valParts.join(''); posInLine = idx + 1; ended = 0; break;
                }
                if (idx === cur.length - 1 && !isLast(curLineIdx)) {
                  if (p < idx) { valParts.push(cur.slice(p, idx)); added += idx - p; }
                  value = valParts.join(''); posInLine = cur.length; ended = 1; break;
                }
                errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
                if (p < idx) { valParts.push(cur.slice(p, idx)); added += idx - p; }
                p = idx + 1;
              }
              if (added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            }
          }
        }
      } else {
        // Unquoted field in cur line: find next comma or end of line
        const ci = cur.indexOf(',', posInLine);
        const ri = cur.indexOf('\r', posInLine);
        if (ci === -1 && ri === -1) {
          value = cur.slice(posInLine); posInLine = cur.length; ended = 1;
        } else if (ri !== -1 && (ci === -1 || ri < ci)) {
          // CR before comma: if it's trailing \r (end of line), it's CRLF terminator
          if (ri === cur.length - 1 && !isLast(curLineIdx)) {
            value = cur.slice(posInLine, ri); posInLine = cur.length; ended = 1;
          } else {
            // stray CR: drop it, continue field
            let valParts = []; let p = posInLine; let start = p;
            while (true) {
              const c2 = cur.indexOf(',', p); const r2 = cur.indexOf('\r', p);
              let idx = -1; let kind = 0;
              if (c2 !== -1) { idx = c2; kind = 0; }
              if (r2 !== -1 && (idx === -1 || r2 < idx)) { idx = r2; kind = 2; }
              if (idx === -1) { if (p < cur.length) valParts.push(cur.slice(p)); value = valParts.join(''); posInLine = cur.length; ended = 1; break; }
              if (kind === 0) { if (p < idx) valParts.push(cur.slice(p, idx)); value = valParts.join(''); posInLine = idx + 1; ended = 0; break; }
              if (idx === cur.length - 1 && !isLast(curLineIdx)) { if (p < idx) valParts.push(cur.slice(p, idx)); value = valParts.join(''); posInLine = cur.length; ended = 1; break; }
              errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
              if (p < idx) valParts.push(cur.slice(p, idx));
              p = idx + 1;
            }
          }
        } else {
          value = cur.slice(posInLine, ci); posInLine = ci + 1; ended = 0;
        }
      }
      fields.push(value); quotedLast = quoted;
      if (ended === 0) continue;
      recordDone = true;
      if (i >= totalLines - 1 && ended === 1 && posInLine >= cur.length) {
        // last line, record ends at EOF (no trailing newline in original? split will have last element as record, ended=1 here means line end, which is EOF if it's last line)
        // eof flag not needed, outer loop will advance past last line
      }
      break;
    }
    if (!(fields.length === 1 && fields[0] === '' && !quotedLast)) {
      if (width < 0) width = fields.length;
      if (header && columns === null) columns = fields;
      else {
        if (fields.length < width) { errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length }); while (fields.length < width) fields.push(''); }
        else if (fields.length > width) { errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) }); }
        rows.push(fields);
      }
    }
    // Advance i: if consumedLines is 0, i already points to closing line, so i++ in next iteration will move past it.
    // If consumedLines is 1 (normal), i++.
    // If consumedLines >1, that case shouldn't happen because we set i to close line and consumedLines=0.
    i++;
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
