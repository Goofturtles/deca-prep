/* DECA exam parser: turns pasted/extracted exam text (questions + answer key)
   into question objects, dedupes a bank, and pulls key terms out of the
   rationales. Shared by scripts/build-bank.js, server.js and the import page. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DecaParse = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const AREAS = {
    BL: 'Business Law', CM: 'Channel Management', CO: 'Communication Skills', CR: 'Customer Relations',
    EC: 'Economics', EI: 'Emotional Intelligence', EN: 'Entrepreneurship', FI: 'Financial Analysis',
    HR: 'Human Resources Management', IM: 'Marketing-Information Management', KM: 'Knowledge Management',
    MK: 'Marketing', MP: 'Market Planning', NF: 'Information Management', OP: 'Operations',
    PD: 'Professional Development', PI: 'Pricing', PJ: 'Project Management', PM: 'Product/Service Management',
    PR: 'Promotion', QM: 'Quality Management', RM: 'Risk Management', SE: 'Selling', SM: 'Strategic Management',
    GEN: 'General'
  };

  // Page headers, footers and copyright lines that PDF extraction mixes into the text.
  const NOISE = [
    /MARKETING (CAREER )?CLUSTER( SAMPLE)? EXAM/i,
    /^Test\s+\d{3,5}\b/i,
    /Copyright\W{0,4}\d{4}\s+by\s+MBA/i,
    /^Copyright\s*[©�]/i,
    /^,?\s*Columbus,\s*Ohio\.?$/i,
    /^\d{1,3}$/,
    /^(SAMPLE|EXAM|KEY)$/i,
    /^Posted online/i
  ];
  const isNoise = (t) => NOISE.some((re) => re.test(t));

  function normalize(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n').replace(/\f/g, '\n').replace(/\t/g, '    ')
      .replace(/[   ]/g, ' ');
  }

  // Join wrapped lines into one paragraph; "self-" + "check-out" stays hyphenated.
  function joinLines(lines) {
    let out = '';
    for (const raw of lines) {
      const l = String(raw).trim();
      if (!l) continue;
      if (!out) out = l;
      else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(l)) out += l;
      else out += ' ' + l;
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  function sentences(text) {
    return String(text || '')
      .split(/(?<=[.!?]["”’)]?)\s+(?=["“(]?[A-Z0-9$])/)
      .map((s) => s.trim()).filter(Boolean);
  }

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

  function hash(s) {
    const fnv = (str) => {
      let h = 0x811c9dc5;
      for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
      return (h >>> 0).toString(16).padStart(8, '0');
    };
    return fnv(s) + fnv(s + '#').slice(0, 4);
  }

  // The rationale opens by restating the correct answer ("Contract. Contracts are...").
  function stripLead(exp, ans) {
    const a = norm(ans);
    if (!a) return exp;
    const e = exp.toLowerCase();
    let i = 0, j = 0;
    while (i < e.length && j < a.length) {
      const c = e[i];
      if (/[a-z0-9]/.test(c)) { if (c !== a[j]) return exp; j++; }
      i++;
    }
    // Only a restatement ends in punctuation; "Recruiting is the..." is a real sentence.
    if (j < a.length || !/^["'”’)\]]*[.!?:]/.test(exp.slice(i))) return exp;
    while (i < exp.length && /[\s.,;:!?"'”’)\]]/.test(exp[i])) i++;
    const rest = exp.slice(i).trim();
    return rest.length > 20 ? rest : exp;
  }

  function findKeyStart(lines) {
    const one = lines.findIndex((l) => /^1\.\s+[A-D]$/.test(l.trim()));
    if (one < 0) return -1;
    return lines.slice(one + 1).some((l) => /^2\.\s+[A-D]$/.test(l.trim())) ? one : -1;
  }

  // Two-column layout ("A. x        C. y" / "B. x        D. y"): split every line at the C/D column.
  function twoColumn(lines, startCol) {
    let col = startCol >= 0 ? startCol : -1;
    if (col < 0) for (const l of lines) { const m = l.match(/^(.*?\S {2,})[CD]\.\s/); if (m) { col = m[1].length; break; } }
    if (col < 0) return null;
    const L = { A: [], B: [], C: [], D: [] };
    let curL = null, curR = null;
    for (const l of lines) {
      if (!l.trim() || isNoise(l.trim())) continue;
      let split = col;
      const re = /[CD]\.\s/g;
      let mm;
      while ((mm = re.exec(l))) {
        const before = l.slice(0, mm.index);
        if (Math.abs(mm.index - col) <= 4 && (/ {2,}$/.test(before) || !before.trim())) { split = mm.index; break; }
      }
      const left = l.slice(0, split), right = l.slice(split);
      const ml = left.match(/^\s*([AB])\.\s+(.*)$/), mr = right.match(/^\s*([CD])\.\s+(.*)$/);
      if (ml) { curL = ml[1]; L[curL].push(ml[2]); } else if (curL && left.trim()) L[curL].push(left);
      if (mr) { curR = mr[1]; L[curR].push(mr[2]); } else if (curR && right.trim()) L[curR].push(right);
    }
    const arr = 'ABCD'.split('').map((k) => joinLines(L[k]));
    return arr.every(Boolean) ? arr : null;
  }

  // Vertical options, or pasted text where "A. x C. y" sit on one line with single spaces.
  function inlineOptions(s) {
    const re = /(^|\n|[ ]+)([A-D])\.[ ]+(?=\S)/g;
    const cands = [];
    let m;
    while ((m = re.exec(s))) {
      const pre = m[1];
      cands.push({ L: m[2], start: m.index + pre.length, end: m.index + m[0].length, strong: pre === '' || pre === '\n' || pre.length >= 2 });
    }
    const pick = [];
    for (const L of 'ABCD') {
      const c = cands.find((x) => x.L === L && x.strong) || cands.find((x) => x.L === L);
      if (!c) return null;
      pick.push(c);
    }
    const sorted = pick.slice().sort((x, y) => x.start - y.start);
    if (sorted[0].L !== 'A') return null;
    const out = {};
    sorted.forEach((c, i) => {
      const next = sorted[i + 1];
      out[c.L] = joinLines(s.slice(c.end, next ? next.start : s.length).split('\n').filter((l) => !isNoise(l.trim())));
    });
    const arr = 'ABCD'.split('').map((L) => out[L]);
    return arr.every(Boolean) ? arr : null;
  }

  function parseBlock(b) {
    const lines = b.lines;
    let ai = -1;
    for (let i = 1; i < lines.length; i++) if (/^\s*A\.\s/.test(lines[i])) { ai = i; break; }
    if (ai < 0) return { n: b.n, error: 'could not find the A-D options' };
    let stemLines = lines.slice(0, ai), region = lines.slice(ai), col = -1;
    // Option C can share a line with the end of the question ("...involves    C. investing").
    for (let i = ai - 1; i >= 0; i--) {
      const m = lines[i].match(/^(.*?\S)( {2,})(C\.\s.*)$/);
      if (m) {
        col = m[1].length + m[2].length;
        stemLines = lines.slice(0, i).concat([m[1]]);
        region = [' '.repeat(col) + m[3]].concat(lines.slice(i + 1, ai), region);
        break;
      }
    }
    const stem = joinLines(stemLines.filter((l) => !isNoise(l.trim())));
    const opts = twoColumn(region, col) || inlineOptions(region.join('\n'));
    if (!stem) return { n: b.n, error: 'question text is empty' };
    if (!opts) return { n: b.n, error: 'could not read all four options' };
    return { n: b.n, stem, opts };
  }

  function parseQuestionBlocks(lines) {
    const blocks = [];
    let cur = null, expect = 1;
    for (const raw of lines) {
      const t = raw.trim();
      if (/^(Test Number\s+\d+|CAUTION:)/i.test(t)) { cur = null; continue; } // back-cover text after Q100
      if (t && isNoise(t)) continue;
      const m = t.match(/^(\d{1,3})\.(?:\s+(.*))?$/);
      // Keep column positions on the first line by blanking the number instead of cutting it.
      if (m && +m[1] === expect) { cur = { n: expect++, lines: [raw.replace(/^(\s*)(\d{1,3}\.)/, (s, a, d) => a + ' '.repeat(d.length))] }; blocks.push(cur); continue; }
      if (cur) cur.lines.push(raw);
    }
    return blocks.map(parseBlock);
  }

  function parseKey(lines) {
    const out = {};
    let cur = null, expect = 1;
    for (const raw of lines) {
      const t = raw.trim();
      const m = t.match(/^(\d{1,3})\.\s+([A-D])$/);
      if (m && +m[1] === expect) { cur = { ans: m[2], exp: [], src: [], inSrc: false }; out[expect++] = cur; continue; }
      if (!cur || !t || isNoise(t)) continue;
      if (/^SOURCE:/i.test(t)) { cur.inSrc = true; cur.src.push(t.replace(/^SOURCE:\s*/i, '')); continue; }
      if (cur.inSrc) { cur.src[cur.src.length - 1] += ' ' + t; continue; }
      cur.exp.push(t);
    }
    return out;
  }

  // text: one exam (questions followed by its key). Returns parsed items plus readable errors.
  function parseExam(text, meta) {
    const lines = normalize(text).split('\n');
    const k = findKeyStart(lines);
    const blocks = parseQuestionBlocks(k < 0 ? lines : lines.slice(0, k));
    const key = k < 0 ? {} : parseKey(lines.slice(k));
    const items = [], errors = [];
    if (!blocks.length) errors.push('No numbered questions found (expected "1. Question text").');
    if (k < 0) errors.push('No answer key found (expected lines like "1. B" after the questions).');
    for (const b of blocks) {
      const kk = key[b.n];
      if (b.error) { errors.push(`Q${b.n}: ${b.error}`); continue; }
      if (!kk) { if (k >= 0) errors.push(`Q${b.n}: no answer in the key`); continue; }
      const a = 'ABCD'.indexOf(kk.ans);
      const first = kk.src[0] || '';
      const code = first.match(/\b([A-Z]{2}):(\d{3})\b/);
      const pi = code ? first.slice(first.indexOf(code[0]) + code[0].length).trim() : '';
      items.push({
        n: b.n, q: b.stem, o: b.opts, a,
        x: stripLead(joinLines(kk.exp), b.opts[a]),
        c: code ? code[0] : '', ar: code && AREAS[code[1]] ? code[1] : 'GEN',
        pi: pi && pi.length < 140 && !/\(\d{4}/.test(pi) ? pi : ''
      });
    }
    return { exam: meta || {}, items, errors, found: blocks.length };
  }

  const STOP_TERMS = new Set(['it', 'they', 'this', 'that', 'these', 'yes', 'no', 'true', 'false', 'businesses', 'business',
    'customers', 'customer', 'consumers', 'employees', 'managers', 'salespeople', 'people', 'individuals', 'companies',
    'competitors', 'suppliers', 'families', 'travelers', 'workers', 'leaders', 'followers', 'bullies', 'managers']);

  function extractTerms(questions) {
    const map = new Map();
    const add = (raw, def, q) => {
      const name = raw.trim().replace(/^(a|an|the)\s+/i, '').replace(/[.,;:]+$/, '');
      if (name.length < 3 || name.length > 48 || name.split(/\s+/).length > 5 || !/^[A-Za-z]/.test(name)) return;
      const k = name.toLowerCase();
      if (STOP_TERMS.has(k)) return;
      const t = map.get(k);
      if (!t) map.set(k, { t: name[0].toUpperCase() + name.slice(1), d: def, ar: q.ar, n: 1, q: [q.id] });
      else {
        t.n++;
        if (t.q.length < 6 && !t.q.includes(q.id)) t.q.push(q.id);
        if ((t.d.length < 50 && def.length > t.d.length) || (def.length > t.d.length && def.length < 300)) t.d = def;
      }
    };
    for (const q of questions) {
      const ss = sentences(q.x);
      for (const opt of q.o) {
        const name = opt.replace(/[.,;:!?]+$/, '').trim();
        if (name.split(/\s+/).length > 5 || name.length > 48 || /[$%\d/]/.test(name)) continue;
        const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const fwd = new RegExp('^(?:(?:A|An|The)\\s+)?(' + esc + '(?:\\s+[A-Za-z][\\w-]*){0,2}?)\\s+(?:is|are|refers? to|involves?|occurs? when|means|describes|consists of)\\s(?!not\\b|never\\b)', 'i');
        const rev = new RegExp('^(.{25,260}?)\\s+(?:is|are)\\s+(?:called\\s+|known as\\s+|referred to as\\s+)?(?:a|an|the)?\\s*' + esc + '\\.?$', 'i');
        for (const s of ss) {
          let m = s.match(fwd);
          if (m) { add(m[1], s, q); break; }
          m = s.match(rev);
          if (m) { add(name, m[1].replace(/^./, (c) => c.toUpperCase()) + '.', q); break; }
        }
      }
    }
    return [...map.values()].sort((a, b) => a.t.localeCompare(b.t));
  }

  // exams: [{ id, label, items }] -> deduped bank with key terms.
  function buildBank(exams) {
    const byKey = new Map(), questions = [];
    for (const ex of exams) {
      for (const it of ex.items) {
        const key = norm(it.q) + '|' + norm(it.o[it.a]);
        let q = byKey.get(key);
        if (!q) {
          q = { id: hash(key), q: it.q, o: it.o, a: it.a, x: it.x, c: it.c, ar: it.ar, pi: it.pi, src: [] };
          byKey.set(key, q); questions.push(q);
        } else if (!q.pi && it.pi) q.pi = it.pi;
        q.src.push([ex.id, it.n]);
      }
    }
    return {
      questions,
      terms: extractTerms(questions),
      exams: exams.map((e) => ({ id: e.id, label: e.label, n: e.items.length }))
    };
  }

  return { AREAS, parseExam, buildBank, extractTerms, sentences, joinLines, hash, norm };
});
