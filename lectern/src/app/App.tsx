import { Suspense, lazy } from 'react';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { CoursePage } from '../features/courses/CoursePage';
import { LessonPage } from '../features/courses/LessonPage';
import { DecksPage } from '../features/home/DecksPage';
import { Home } from '../features/home/Home';
import { ModsPage } from '../features/home/ModsPage';
import { PreferencesPage } from '../features/settings/PreferencesPage';
import { ToastProvider } from '../ui/Toast';
import { StorageGuard } from '../features/backup/StorageGuard';
import { SharePanel } from '../features/share/SharePanel';
import { ErrorBoundary } from './ErrorBoundary';
import { Shell } from './Shell';

const Studio = lazy(() => import('../features/studio/Studio'));
const Present = lazy(() => import('../features/present/Present'));
const PresenterView = lazy(() => import('../features/present/PresenterView'));
const Teleprompter = lazy(() => import('../features/present/Teleprompter'));
const Study = lazy(() => import('../features/study/Study'));
const PrintNotes = lazy(() => import('../features/study/PrintNotes'));
const NotesPage = lazy(() => import('../features/notes/NotesPage'));
const SchedulePage = lazy(() => import('../features/schedule/SchedulePage'));
const RecordingsPage = lazy(() => import('../features/recordings/RecordingsPage'));
const RecordingDetail = lazy(() => import('../features/recordings/RecordingDetail'));
const Landing = lazy(() => import('../features/landing/Landing'));
const Onboarding = lazy(() => import('../features/onboarding/Onboarding'));
const MakePage = lazy(() => import('../features/autodeck/MakePage'));
const JoinPage = lazy(() => import('../features/share/JoinPage'));
const SavedDeck = lazy(() => import('../features/share/JoinPage').then((m) => ({ default: m.SavedDeck })));
const PackPage = lazy(() => import('../features/share/PackPage').then((m) => ({ default: m.PackPage })));

function Loading() {
  return (
    <div className="page-loading" aria-busy="true">
      <div className="spinner" />
    </div>
  );
}

export function NotFound({ message = 'This page doesn’t exist, or it was deleted.' }: { message?: string }) {
  return (
    <div className="not-found">
      <h1 className="display">Nothing here</h1>
      <p className="muted">{message}</p>
      <Link className="btn btn-primary" to="/">Go to Home</Link>
    </div>
  );
}

/** Each page gets its own error boundary, reset when the address changes. */
function Guarded({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary resetKey={pathname}>
      <Suspense fallback={<Loading />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

export function App() {
  return (
    <ToastProvider>
      <StorageGuard />
      <BrowserRouter>
        <Guarded>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<Home />} />
              <Route path="courses/:courseId" element={<CoursePage />} />
              <Route path="lessons/:lessonId" element={<LessonPage />} />
              <Route path="schedule" element={<SchedulePage />} />
              <Route path="notes" element={<NotesPage />} />
              <Route path="notes/:noteId" element={<NotesPage />} />
              <Route path="recordings" element={<RecordingsPage />} />
              <Route path="recordings/:recordingId" element={<RecordingDetail />} />
              <Route path="decks" element={<DecksPage />} />
              <Route path="mods" element={<ModsPage />} />
              <Route path="make" element={<MakePage />} />
              <Route path="settings" element={<PreferencesPage />} />
            </Route>
            <Route path="welcome" element={<Landing />} />
            <Route path="start" element={<Onboarding />} />
            <Route path="join" element={<JoinPage />} />
            <Route path="join/:code" element={<JoinPage />} />
            <Route path="phone/:deckId" element={<SavedDeck />} />
            <Route path="pack" element={<PackPage />} />
            <Route path="studio/:deckId" element={<Studio />} />
            <Route path="present/:deckId" element={<Present />} />
            <Route path="presenter/:deckId" element={<PresenterView />} />
            <Route path="prompter/:deckId" element={<Teleprompter />} />
            <Route path="study/:deckId" element={<Study />} />
            <Route path="print/:deckId" element={<PrintNotes />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Guarded>
        <SharePanel />
      </BrowserRouter>
    </ToastProvider>
  );
}
