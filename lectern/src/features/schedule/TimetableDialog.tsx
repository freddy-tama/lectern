import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { type FillMode, WEEKDAY_LONG, planFill, sortMeetings } from '../../core/schedule/timetable';
import type { Course, CourseMeeting, Lesson } from '../../data/db';
import { updateCourse } from '../../data/repo';
import { Dialog } from '../../ui/Dialog';
import { useToast } from '../../ui/Toast';
import { formatDate, formatTime, plural } from '../../ui/format';
import { applyFill } from './actions';

interface Row {
  weekday: number;
  time: string;
  minutes: string;
  room: string;
}

const toRows = (meetings: CourseMeeting[] = []): Row[] =>
  sortMeetings(meetings).map((m) => ({ weekday: m.weekday, time: m.time, minutes: m.durationMinutes ? String(m.durationMinutes) : '', room: m.room ?? '' }));

const toMeetings = (rows: Row[]): CourseMeeting[] =>
  sortMeetings(rows.filter((r) => /^\d{2}:\d{2}$/.test(r.time)).map((r) => ({
    weekday: r.weekday,
    time: r.time,
    ...(Number(r.minutes) > 0 ? { durationMinutes: Math.round(Number(r.minutes)) } : {}),
    ...(r.room.trim() ? { room: r.room.trim() } : {}),
  })));

/**
 * Edits when a course meets each week, then offers to date its lessons from
 * those times. Opens on the second step for "Fill dates from timetable".
 */
export function TimetableDialog({ course, lessons, open, step: startStep, onClose }: { course: Course; lessons: Lesson[]; open: boolean; step: 'edit' | 'fill'; onClose(): void }) {
  const toast = useToast();
  const [step, setStep] = useState(startStep);
  const [rows, setRows] = useState<Row[]>(() => toRows(course.meetings));
  const [mode, setMode] = useState<FillMode>('undated');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(startStep);
    setRows(toRows(course.meetings));
    setMode(lessons.some((l) => !l.date) ? 'undated' : 'all');
    // Reset each time it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, startStep]);

  const meetings = useMemo(() => toMeetings(rows), [rows]);
  const timed = { ...course, meetings };
  const plans = useMemo(() => ({ undated: planFill(timed, lessons, 'undated'), all: planFill(timed, lessons, 'all') }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meetings, lessons, course.startDate]);
  const plan = plans[mode];

  const setRow = (i: number, patch: Partial<Row>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((all) => {
    const last = all[all.length - 1];
    const usual = lessons.find((l) => l.durationMinutes)?.durationMinutes;
    return [...all, last
      ? { ...last, weekday: (last.weekday + 2) % 7 }
      : { weekday: 0, time: '09:00', minutes: usual ? String(usual) : '45', room: '' }];
  });

  const save = async () => {
    setBusy(true);
    try {
      await updateCourse(course.id, { meetings });
      if (meetings.length && lessons.length && (plans.undated.changes.length || plans.all.changes.length)) {
        setMode(plans.undated.changes.length ? 'undated' : 'all');
        setStep('fill');
      } else {
        toast.show(meetings.length ? 'Timetable saved' : 'Timetable cleared');
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  const fill = async () => {
    if (!plan.changes.length) return;
    setBusy(true);
    try {
      const undo = await applyFill(plan.changes);
      toast.show(`Dated ${plural(plan.changes.length, 'lesson')} from the timetable`, { action: { label: 'Undo', run: () => { undo(); } } });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  if (step === 'fill') {
    const shown = plan.changes.slice(0, 8);
    return (
      <Dialog
        open={open}
        onClose={onClose}
        title="Fill lesson dates from the timetable?"
        description="Each week’s lessons take that week’s class times, in order."
        footer={<>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Not now</button>
          <button type="button" className="btn btn-primary" onClick={fill} disabled={busy || !plan.changes.length}>
            {plan.changes.length ? `Date ${plural(plan.changes.length, 'lesson')}` : 'Nothing to change'}
          </button>
        </>}
      >
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="fill-options" role="radiogroup" aria-label="Which lessons">
            <label className="fill-option">
              <input type="radio" name="fill-mode" checked={mode === 'undated'} onChange={() => setMode('undated')} disabled={!plans.undated.changes.length} />
              <strong>Only lessons without a date</strong>
              <span>{plans.undated.changes.length ? `${plural(plans.undated.changes.length, 'lesson')} will get a date. Dated lessons stay put.` : 'Every lesson already has a date.'}</span>
            </label>
            <label className="fill-option">
              <input type="radio" name="fill-mode" checked={mode === 'all'} onChange={() => setMode('all')} disabled={!plans.all.changes.length} />
              <strong>Re-date every lesson</strong>
              <span>{plans.all.changes.length ? `${plans.all.changes.length} of ${plural(lessons.length, 'lesson')} will move to match the timetable.` : 'All lessons already match the timetable.'}</span>
            </label>
          </div>
          {shown.length > 0 && (
            <ul className="fill-preview" aria-label="Preview">
              {shown.map((c) => (
                <li key={c.id}>
                  <span>{c.title}</span>
                  <span>
                    {c.before.date && <s>{formatDate(c.before.date, { month: 'short', day: 'numeric' })}</s>}
                    {formatDate(c.date)} · {formatTime(c.time)}
                  </span>
                </li>
              ))}
              {plan.changes.length > shown.length && <li className="faint"><span>and {plural(plan.changes.length - shown.length, 'more lesson')}</span></li>}
            </ul>
          )}
          {plan.unplaced.length > 0 && (
            <p className="field-help">
              {plural(plan.unplaced.length, 'lesson')} {plan.unplaced.length === 1 ? 'has' : 'have'} no free class time in {plan.unplaced.length === 1 ? 'its' : 'their'} week and {plan.unplaced.length === 1 ? 'keeps its' : 'keep their'} date.
            </p>
          )}
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Weekly timetable"
      description="When this class meets. New lessons get the next free time, and the schedule shows open slots."
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>Save timetable</button>
      </>}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        {rows.length ? (
          <div className="tt-rows">
            <div className="tt-labels" aria-hidden><span>Day</span><span>Start</span><span>Minutes</span><span>Room or link</span><span /></div>
            {rows.map((r, i) => (
              <div key={i} className="tt-row">
                <select className="select" value={r.weekday} onChange={(e) => setRow(i, { weekday: Number(e.target.value) })} aria-label={`Class time ${i + 1}: day`}>
                  {WEEKDAY_LONG.map((d, n) => <option key={d} value={n}>{d}</option>)}
                </select>
                <input className="input" type="time" step={300} value={r.time} onChange={(e) => setRow(i, { time: e.target.value })} aria-label={`Class time ${i + 1}: start`} required />
                <input className="input" type="number" min={5} max={600} step={5} value={r.minutes} placeholder="45" onChange={(e) => setRow(i, { minutes: e.target.value })} aria-label={`Class time ${i + 1}: minutes`} />
                <input className="input" value={r.room} placeholder="Room 12" onChange={(e) => setRow(i, { room: e.target.value })} aria-label={`Class time ${i + 1}: room or link`} />
                <button type="button" className="icon-btn" onClick={() => setRows((all) => all.filter((_, j) => j !== i))} aria-label={`Remove class time ${i + 1}`}><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        ) : (
          <p className="tt-empty">No class times yet. Add the days and times this class meets each week.</p>
        )}
        <div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={addRow}><Plus size={15} /> Add a class time</button>
        </div>
      </div>
    </Dialog>
  );
}
