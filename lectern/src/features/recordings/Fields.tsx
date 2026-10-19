// Form pieces shared by the add, record and re-transcribe dialogs.

import { useId } from 'react';
import { LANGUAGES } from '../../core/transcribe/languages';
import { CourseSelect, LessonSelect } from '../notes/LinkPickers';
import type { NoteRefs } from '../notes/refs';
import { QUALITIES, type TranscribePrefs, useSpeechDevice } from './engine';

export interface LinkValue {
  title: string;
  courseId?: string;
  lessonId?: string;
  date?: string;
}

/** Title, course, lesson and date. Picking a lesson fills in its course, date and (untouched) title. */
export function LinkFields({ refs, value, onChange, titleTouched, onTitleTouched }: {
  refs: NoteRefs | undefined;
  value: LinkValue;
  onChange(next: LinkValue): void;
  titleTouched: boolean;
  onTitleTouched(): void;
}) {
  const id = useId();
  return (
    <div className="rc-fields">
      <label className="field rc-field-wide">
        <span className="field-label">Title</span>
        <input
          className="input"
          value={value.title}
          onChange={(e) => { onTitleTouched(); onChange({ ...value, title: e.target.value }); }}
          placeholder="What was the class about?"
        />
      </label>
      {refs && (
        <>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-course`}>Course</label>
            <CourseSelect
              id={`${id}-course`}
              refs={refs}
              value={value.courseId}
              onChange={(courseId) => {
                const lesson = value.lessonId ? refs.lesson.get(value.lessonId) : undefined;
                onChange({ ...value, courseId, lessonId: lesson && lesson.courseId === courseId ? lesson.id : undefined });
              }}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-lesson`}>Lesson</label>
            <LessonSelect
              id={`${id}-lesson`}
              refs={refs}
              courseId={value.courseId}
              value={value.lessonId}
              onChange={(lessonId) => {
                const lesson = lessonId ? refs.lesson.get(lessonId) : undefined;
                onChange({
                  ...value,
                  lessonId,
                  ...(lesson ? { courseId: lesson.courseId, ...(lesson.date ? { date: lesson.date } : {}), ...(!titleTouched ? { title: lesson.title } : {}) } : {}),
                });
              }}
            />
          </div>
        </>
      )}
      <label className="field">
        <span className="field-label">Date</span>
        <input className="input" type="date" value={value.date ?? ''} onChange={(e) => onChange({ ...value, date: e.target.value || undefined })} />
      </label>
    </div>
  );
}

/** Spoken language and the speed/accuracy trade-off. */
export function TranscribeFields({ value, onChange, compact }: { value: TranscribePrefs; onChange(next: TranscribePrefs): void; compact?: boolean }) {
  const id = useId();
  const device = useSpeechDevice();
  return (
    <div className={`rc-transcribe-fields ${compact ? 'is-compact' : ''}`}>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-lang`}>Spoken language</label>
        <select id={`${id}-lang`} className="select" value={value.language} onChange={(e) => onChange({ ...value, language: e.target.value })}>
          <option value="auto">Detect automatically</option>
          <optgroup label="Languages">
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </optgroup>
        </select>
      </div>
      <fieldset className="rc-quality">
        <legend className="field-label">Speed and accuracy</legend>
        <div className="rc-quality-options">
          {QUALITIES.map((q) => (
            <label key={q.id} className="rc-quality-option">
              <input type="radio" name={`${id}-quality`} value={q.id} checked={value.quality === q.id} onChange={() => onChange({ ...value, quality: q.id })} />
              <span className="rc-quality-body">
                <strong>{q.label}</strong>
                {!compact && <span>{q.detail}</span>}
                <span className="faint">{q.size[device]}, once</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
