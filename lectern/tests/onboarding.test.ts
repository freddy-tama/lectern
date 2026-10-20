import { beforeEach, describe, expect, it } from 'vitest';
import {
  FOCUS_DEFAULTS, defaultProfile, densityFor, forgetAnswer, getProfile, mergeRemembered, normalizeProfile,
  rememberDeckPrefs, saveProfile, shows, updateProfile,
} from '../src/data/profile';

describe('profile', () => {
  beforeEach(() => {
    localStorage.clear();
    saveProfile(defaultProfile());
  });

  it('starts not onboarded, with every part of the app shown', () => {
    const p = defaultProfile();
    expect(p.onboarded).toBe(false);
    expect(p.features).toEqual(['courses', 'schedule', 'notes', 'recordings']);
    expect(p.askQuestions).toBe(true);
  });

  it('repairs bad or partial saves', () => {
    const p = normalizeProfile({ focus: 'nonsense', features: ['notes', 'spaceship'], deck: { purpose: 'pitch', audience: 'martians', minutes: 9999, density: 'visual' }, remembered: [{ key: 'tone', answer: '  ' }, { key: 'ending', question: 'How to end?', answer: 'A call to action' }] });
    expect(p.focus).toBe('all');
    expect(p.features).toEqual(['notes']);
    expect(p.deck.purpose).toBe('pitch');
    expect(p.deck.audience).toBe('adult');
    expect(p.deck.minutes).toBe(30);
    expect(p.deck.density).toBe('visual');
    expect(p.remembered.map((r) => r.key)).toEqual(['ending']);
    expect(normalizeProfile(null)).toEqual(defaultProfile());
  });

  it('saves to localStorage and reads it back', () => {
    updateProfile({ onboarded: true, focus: 'deck', features: [] });
    expect(JSON.parse(localStorage.getItem('lectern.profile')!).focus).toBe('deck');
    expect(getProfile().focus).toBe('deck');
    expect(shows(getProfile(), 'notes')).toBe(false);
  });

  it('remembers the last deck settings and keeps one answer per key, newest first', () => {
    rememberDeckPrefs({ purpose: 'report', minutes: 20 }, [{ key: 'tone', question: 'Tone?', answer: 'Warm', updatedAt: 1 }]);
    rememberDeckPrefs({}, [{ key: 'ending', question: 'End?', answer: 'Questions', updatedAt: 2 }, { key: 'tone', question: 'Tone?', answer: 'Formal', updatedAt: 3 }]);
    const p = getProfile();
    expect(p.deck.purpose).toBe('report');
    expect(p.deck.minutes).toBe(20);
    expect(p.remembered.map((r) => `${r.key}=${r.answer}`)).toEqual(['ending=Questions', 'tone=Formal']);
    forgetAnswer('tone');
    expect(getProfile().remembered.map((r) => r.key)).toEqual(['ending']);
  });

  it('caps remembered answers', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, question: '', answer: 'x', updatedAt: i }));
    expect(mergeRemembered([], many)).toHaveLength(16);
  });

  it('gives young learners mostly pictures, and sensible defaults per focus', () => {
    expect(densityFor('young')).toBe('visual');
    expect(densityFor('adult')).toBe('balanced');
    expect(FOCUS_DEFAULTS.deck.features).toEqual([]);
    expect(FOCUS_DEFAULTS.teach.purpose).toBe('lesson');
    expect(FOCUS_DEFAULTS.present.purpose).toBe('talk');
  });
});
