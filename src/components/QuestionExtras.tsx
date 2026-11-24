import { useState } from 'react';
import { reportQuestion } from '../lib/data';
import { QL, type Lang } from '../lib/lang';
import type { Domain, QuestionStat, ReportReason } from '../lib/types';

/** Minimum first-time answers before a question's success rate is shown: fewer is noise. */
export const MIN_STAT = 5;

/** Official documentation links for the question's domain, under the explanation. */
export function DocLinks({ domain, lang }: { domain?: Domain; lang: Lang }) {
  const docs = domain?.docs || [];
  if (!docs.length) return null;
  return (
    <div className="doclinks">
      <span className="eyebrow">{QL[lang].learnMore} · {domain!.code} {domain!.name}</span>
      <ul>
        {docs.map((d) => (
          <li key={d.url}><a href={d.url} target="_blank" rel="noopener noreferrer">{d.title}</a></li>
        ))}
      </ul>
    </div>
  );
}

/** "62% get it right first time (34 answers)", from anonymous aggregates. */
export function StatLine({ stat, lang }: { stat?: QuestionStat; lang: Lang }) {
  if (!stat || stat.first_answered < MIN_STAT) return null;
  const p = Math.round((stat.first_correct / stat.first_answered) * 100);
  const cls = p >= 70 ? 'ok' : p >= 40 ? 'mid' : 'low';
  return <span className={`statline ${cls}`}>{QL[lang].stat(p, stat.first_answered)}</span>;
}

/** Share of answers that chose each original option, for the review lists. */
export function pickShare(stat: QuestionStat | undefined, optionIndex: number): number | null {
  if (!stat || stat.answered < MIN_STAT) return null;
  return Math.round(((stat.picks[optionIndex] || 0) / stat.answered) * 100);
}

const REASONS: ReportReason[] = ['ambigua', 'respuesta', 'traduccion', 'errata', 'otro'];

/** Small "Report question" control that opens an inline form. */
export function ReportButton({ questionId, lang, reported, onReported }: {
  questionId: string; lang: Lang; reported: boolean; onReported: () => void;
}) {
  const L = QL[lang];
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>('ambigua');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (reported) return <span className="reported">{L.reported}</span>;
  if (!open) {
    return (
      <button type="button" className="linkbtn" onClick={() => setOpen(true)}>
        <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M5 17V3.5M5 4h9l-2 3.5 2 3.5H5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" /></svg>
        {L.report}
      </button>
    );
  }
  const send = async () => {
    setBusy(true); setErr('');
    try { await reportQuestion(questionId, reason, comment, lang); onReported(); setOpen(false); }
    catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === '23505') { onReported(); setOpen(false); } else setErr(L.reportFail);
    } finally { setBusy(false); }
  };
  return (
    <fieldset className="reportbox">
      <legend>{L.reportTitle}</legend>
      {REASONS.map((r) => (
        <label key={r} className="okline"><input type="radio" name={`rr-${questionId}`} checked={reason === r} onChange={() => setReason(r)} /> {L.reasons[r]}</label>
      ))}
      <label className="fl" htmlFor={`rc-${questionId}`}>{L.reportComment}</label>
      <textarea id={`rc-${questionId}`} rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
      <p className="note">{L.reportNote}</p>
      {err && <div className="msg err">{err}</div>}
      <div className="row">
        <button type="button" className="btn small solid" disabled={busy || (reason === 'otro' && !comment.trim())} onClick={send}>{L.reportSend}</button>
        <button type="button" className="btn small" onClick={() => setOpen(false)}>{L.reportCancel}</button>
      </div>
    </fieldset>
  );
}
