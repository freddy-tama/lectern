import { ExternalLink, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { EmbedBox, VideoBox } from '../../core/engine/boxes';
import { ACTIVITY_SANDBOX, PAGE_SANDBOX, activityDocument, displayUrl } from '../../core/media/embed';
import { parseVideo, videoEmbedUrl, videoThumbnail } from '../../core/media/video';
import { assetUrl } from '../../data/repo';
import { KindIcon } from '../../ui/KindIcon';

// Clicks and keys inside a playing video belong to the video, not to the presenter's
// "next slide" handlers around it. (Frames keep their own events anyway.)
const keep = {
  onClick: (e: React.SyntheticEvent) => e.stopPropagation(),
  onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation(),
};

function PlayBadge({ size }: { size: number }) {
  return (
    <span className="media-play" style={{ width: size, height: size }} aria-hidden>
      <Play size={size * 0.42} fill="currentColor" strokeWidth={0} />
    </span>
  );
}

/** A video: playing when live, a still with a play mark in thumbnails. */
export function VideoView({ box, live }: { box: VideoBox; live: boolean }) {
  const source = useMemo(() => parseVideo(box.src), [box.src]);
  const fileSrc = source?.provider === 'file' ? source.src : '';
  const [url, setUrl] = useState<string | null>(fileSrc && !fileSrc.startsWith('asset:') ? fileSrc : null);
  useEffect(() => {
    let alive = true;
    if (!fileSrc) setUrl(null);
    else if (fileSrc.startsWith('asset:')) assetUrl(fileSrc).then((u) => alive && setUrl(u));
    else setUrl(fileSrc);
    return () => { alive = false; };
  }, [fileSrc]);
  const badge = Math.round(Math.min(box.w, box.h) * 0.18);
  const style = { background: box.fill, color: box.ink };

  if (!source) {
    return <div className="media-still" style={style}><PlayBadge size={badge} /></div>;
  }
  if (live) {
    if (source.provider !== 'file') {
      return (
        <iframe
          className="media-frame"
          src={videoEmbedUrl(source, { autoplay: box.autoplay, start: box.start, loop: box.loop, muted: box.muted })}
          title={box.title || 'Video'}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      );
    }
    if (!url) return <div className="media-still" style={style}><PlayBadge size={badge} /></div>;
    return (
      <video
        className="media-video"
        src={box.start ? `${url}#t=${box.start}` : url}
        controls
        autoPlay={box.autoplay}
        loop={box.loop}
        muted={box.muted}
        playsInline
        preload="metadata"
        style={{ objectFit: box.fit, background: '#000' }}
        aria-label={box.title || 'Video'}
        {...keep}
      />
    );
  }
  const thumb = videoThumbnail(source);
  return (
    <div className="media-still" style={style}>
      {thumb ? <img src={thumb} alt="" draggable={false} style={{ objectFit: 'cover' }} /> : null}
      {!thumb && url ? <video src={`${url}#t=0.1`} muted playsInline preload="metadata" style={{ objectFit: box.fit }} aria-hidden /> : null}
      <PlayBadge size={badge} />
    </div>
  );
}

/** An activity or a web page: running when live, a titled card in thumbnails. */
export function EmbedView({ box, live }: { box: EmbedBox; live: boolean }) {
  const doc = useMemo(() => (box.html ? activityDocument(box.html) : ''), [box.html]);
  if (live && doc) {
    return <iframe className="media-frame" srcDoc={doc} sandbox={ACTIVITY_SANDBOX} allow="autoplay; fullscreen" title={box.title || 'Activity'} referrerPolicy="no-referrer" style={{ background: box.fill }} />;
  }
  if (live && box.url) {
    return (
      <>
        <iframe
          className="media-frame"
          src={box.url}
          sandbox={PAGE_SANDBOX}
          allow="fullscreen; clipboard-write; autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          title={box.title || 'Web page'}
          loading="lazy"
        />
        {box.openUrl && (
          <a className="embed-open" href={box.openUrl} target="_blank" rel="noopener noreferrer" title="Open in a new tab" {...keep}>
            <ExternalLink size={22} /> Open
          </a>
        )}
      </>
    );
  }
  const icon = Math.round(Math.min(box.w, box.h) * 0.16);
  const detail = box.url ? displayUrl(box.openUrl || box.url) : box.html ? 'Interactive · runs when you present' : '';
  return (
    <div className="media-still embed-still" style={{ background: box.fill, color: box.ink }}>
      <span className="embed-icon" style={{ width: icon * 1.7, height: icon * 1.7, background: box.accent, color: box.onAccent }}>
        <KindIcon name={box.icon ?? 'globe'} size={icon} />
      </span>
      {box.title && <strong style={{ fontSize: Math.max(28, icon * 0.42) }}>{box.title}</strong>}
      {detail && <span style={{ fontSize: Math.max(22, icon * 0.3) }}>{detail}</span>}
    </div>
  );
}
