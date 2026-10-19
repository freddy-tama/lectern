// Draws a note's light Markdown as React elements. Nothing is injected as HTML.

import { Fragment, type ReactNode, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { type Inline, type ListItem, parseBlocks, parseInline } from './markdown';

export function InlineText({ text }: { text: string }) {
  const parts = useMemo(() => parseInline(text), [text]);
  return <>{renderInline(parts)}</>;
}

function renderInline(parts: Inline[]): ReactNode[] {
  return parts.map((p, i) => {
    switch (p.t) {
      case 'text': return <Fragment key={i}>{p.v}</Fragment>;
      case 'bold': return <strong key={i}>{renderInline(p.c)}</strong>;
      case 'italic': return <em key={i}>{renderInline(p.c)}</em>;
      case 'code': return <code key={i}>{p.v}</code>;
      case 'link':
        return p.href.startsWith('/')
          ? <Link key={i} to={p.href}>{renderInline(p.c)}</Link>
          : <a key={i} href={p.href} target="_blank" rel="noreferrer noopener">{renderInline(p.c)}</a>;
      default: return null;
    }
  });
}

interface NoteBodyProps {
  body: string;
  /** Called with the body line of a task when its box is clicked. Without it, boxes are read-only. */
  onToggle?(line: number): void;
  className?: string;
  /** Shown when the body is empty. */
  empty?: ReactNode;
}

export function NoteBody({ body, onToggle, className, empty }: NoteBodyProps) {
  const blocks = useMemo(() => parseBlocks(body), [body]);
  if (!blocks.length) return empty ? <div className={`nt-md ${className ?? ''}`}>{empty}</div> : null;
  return (
    <div className={`nt-md ${className ?? ''}`}>
      {blocks.map((b) => {
        switch (b.type) {
          case 'heading': {
            const Tag = (['h3', 'h3', 'h4', 'h5'] as const)[b.level];
            return <Tag key={b.line}><InlineText text={b.text} /></Tag>;
          }
          case 'paragraph':
            return <p key={b.line}>{b.lines.map((l, i) => <Fragment key={i}>{i > 0 && <br />}<InlineText text={l} /></Fragment>)}</p>;
          case 'quote':
            return <blockquote key={b.line}>{b.lines.map((l, i) => <Fragment key={i}>{i > 0 && <br />}<InlineText text={l} /></Fragment>)}</blockquote>;
          case 'rule':
            return <hr key={b.line} />;
          case 'list': {
            const items = b.items.map((item) => <Item key={item.line} item={item} onToggle={onToggle} />);
            return b.ordered
              ? <ol key={b.line} start={b.start}>{items}</ol>
              : <ul key={b.line} className={b.items.every((i) => i.task) ? 'is-tasks' : undefined}>{items}</ul>;
          }
          default:
            return null;
        }
      })}
    </div>
  );
}

function Item({ item, onToggle }: { item: ListItem; onToggle?(line: number): void }) {
  const style = item.depth ? { marginLeft: `${item.depth * 1.25}em` } : undefined;
  if (!item.task) return <li style={style}><InlineText text={item.text} /></li>;
  const done = item.task.done;
  return (
    <li className={`nt-task ${done ? 'is-done' : ''}`} style={style}>
      <label className="nt-check">
        <input type="checkbox" checked={done} disabled={!onToggle} onChange={() => onToggle?.(item.line)} />
        <span><InlineText text={item.text} /></span>
      </label>
    </li>
  );
}
