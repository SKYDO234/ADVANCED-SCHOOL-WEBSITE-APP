import { useMemo } from 'react';
import { useApp } from '../store.jsx';

/** Convenience accessors for academic master data from /meta/bootstrap. */
export function useAcademic() {
  const { meta } = useApp();
  return useMemo(() => {
    const academic = meta?.academic || {};
    const classes = academic.classes || [];
    const sections = academic.sections || [];
    const subjects = academic.subjects || [];
    const sessions = academic.sessions || [];
    const periods = academic.periods || [];
    const currentSession = academic.currentSession || sessions.find((s) => s.is_current) || null;

    const sectionsFor = (classId) => sections.filter((s) => s.class_id === classId);
    const classOf = (classId) => classes.find((c) => c.id === classId) || null;
    const sectionOf = (sectionId) => sections.find((s) => s.id === sectionId) || null;
    const subjectOf = (subjectId) => subjects.find((s) => s.id === subjectId) || null;

    return {
      classes,
      sections,
      subjects,
      sessions,
      periods,
      currentSession,
      classOptions: classes.map((c) => ({ value: c.id, label: c.name })),
      subjectOptions: subjects.map((s) => ({ value: s.id, label: s.name })),
      sectionsFor,
      sectionOptions: (classId) => sectionsFor(classId).map((s) => ({ value: s.id, label: s.name })),
      classOf,
      sectionOf,
      subjectOf,
      className: (id) => classOf(id)?.name || '',
      sectionName: (id) => sectionOf(id)?.name || '',
      classLabel: (classId, sectionId) => [classOf(classId)?.name, sectionOf(sectionId)?.name].filter(Boolean).join(' · '),
    };
  }, [meta]);
}

export const WEEKDAYS = [
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
  { value: 7, label: 'Sunday', short: 'Sun' },
];

export function useTeachers() {
  const { meta } = useApp();
  return useMemo(() => (meta?.employees || []).filter((e) => e.role === 'teacher' || e.role === 'principal'), [meta]);
}

export function useEmployeeOptions() {
  const { meta } = useApp();
  return useMemo(() => (meta?.employees || []).map((e) => ({ value: e.id, label: e.name })), [meta]);
}
