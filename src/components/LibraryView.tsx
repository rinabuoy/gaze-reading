import React, { useState } from 'react';
import { BookOpen, Plus } from 'lucide-react';
import type { ReadingPassage, ReadingSurface } from '../types/gaze';

interface LibraryViewProps {
  passages: ReadingPassage[];
  activePassageId: string;
  onSelectPassage: (id: string) => void;
  onAddCustomPassage: (passage: ReadingPassage) => void;
  surface: ReadingSurface;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  passages,
  activePassageId,
  onSelectPassage,
  onAddCustomPassage,
  surface,
}) => {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [category, setCategory] = useState('Custom Text');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isDark = surface === 'obsidian';
  const isSepia = surface === 'sepia';

  const bg = isDark
    ? 'bg-[#080B11] text-slate-100'
    : isSepia
      ? 'bg-[#FAF6EE] text-[#29231D]'
      : 'bg-[#FAF9F6] text-stone-900';

  const cardSurface = isDark
    ? 'bg-[#0F141D] border-slate-800'
    : isSepia
      ? 'bg-[#EFE8DB] border-[#DFD6C7]'
      : 'bg-white border-stone-200';

  const inputClass = isDark
    ? 'bg-slate-900 border-slate-700 text-slate-100 placeholder-slate-500'
    : isSepia
      ? 'bg-[#FAF6EE] border-[#D4C8B4] text-[#29231D] placeholder-[#8A7D6E]'
      : 'bg-white border-stone-300 text-stone-900 placeholder-stone-400';

  const mutedText = isDark
    ? 'text-slate-400'
    : isSepia
      ? 'text-[#6E6356]'
      : 'text-stone-500';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedBody = body.trim();
    if (!cleanedBody) {
      setError('Paste or enter at least one paragraph of text to read.');
      return;
    }

    const paragraphs = cleanedBody
      .split(/\n\s*\n|\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    const newPassage: ReadingPassage = {
      id: `custom-${Date.now()}`,
      title: title.trim() || 'Untitled Reading Passage',
      subtitle: 'Custom text imported into Lectoris',
      author: author.trim() || 'Reader Import',
      category: category.trim() || 'Custom Text',
      year: String(new Date().getFullYear()),
      paragraphs,
      isCustom: true,
    };

    onAddCustomPassage(newPassage);
    setTitle('');
    setAuthor('');
    setBody('');
    setError(null);
  };

  return (
    <div className={`flex-1 min-h-[calc(100vh-3.5rem)] p-6 sm:p-10 ${bg}`}>
      <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Passage Catalog */}
        <div className="lg:col-span-7">
          <div className="mb-6">
            <div className={`text-xs uppercase tracking-wider mb-1 ${mutedText}`}>
              Reading Archive
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              Select a Passage
            </h1>
          </div>

          <div className="space-y-4">
            {passages.map((p) => {
              const isCurrent = p.id === activePassageId;
              const wordCount = p.paragraphs
                .join(' ')
                .trim()
                .split(/\s+/).length;

              return (
                <div
                  key={p.id}
                  className={`rounded-lg border p-5 transition-colors ${cardSurface} ${
                    isCurrent ? 'ring-1 ring-sky-500 border-sky-500/70' : ''
                  }`}
                >
                  <div className={`flex items-center gap-2 text-xs mb-1.5 ${mutedText}`}>
                    <span>{p.category}</span>
                    <span aria-hidden="true">·</span>
                    <span>{p.author}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular">{wordCount} words</span>
                  </div>
                  <h2 className="font-display text-xl font-semibold tracking-tight mb-1">
                    {p.title}
                  </h2>
                  <p className={`text-sm leading-relaxed mb-4 ${mutedText}`}>
                    {p.subtitle}
                  </p>
                  <button
                    type="button"
                    onClick={() => onSelectPassage(p.id)}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                      isCurrent
                        ? 'bg-sky-600 text-white'
                        : isDark
                          ? 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                          : 'bg-stone-900 text-white hover:bg-stone-800'
                    }`}
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>{isCurrent ? 'Continue Reading' : 'Open in Reader'}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Custom Text Composer */}
        <div className={`lg:col-span-5 rounded-lg border p-6 ${cardSurface}`}>
          <h2 className="font-display text-xl font-semibold tracking-tight mb-1">
            Import Custom Text
          </h2>
          <p className={`text-xs mb-5 ${mutedText}`}>
            Paste an essay, study passage, or draft to measure eye fixations and reading pace.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Chapter 3 — Visual Perception"
                className={`w-full px-3 py-2 text-sm rounded-md border focus:outline-none focus:ring-2 focus:ring-sky-500 ${inputClass}`}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Author</label>
                <input
                  type="text"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="Optional"
                  className={`w-full px-3 py-2 text-sm rounded-md border focus:outline-none focus:ring-2 focus:ring-sky-500 ${inputClass}`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Category</label>
                <input
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="Essay"
                  className={`w-full px-3 py-2 text-sm rounded-md border focus:outline-none focus:ring-2 focus:ring-sky-500 ${inputClass}`}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Passage Text</label>
              <textarea
                rows={8}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Paste your paragraphs here..."
                className={`w-full px-3 py-2 text-sm rounded-md border leading-relaxed focus:outline-none focus:ring-2 focus:ring-sky-500 ${inputClass}`}
              />
            </div>

            {error && (
              <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
            )}

            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold rounded-md bg-sky-600 text-white hover:bg-sky-700 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Load Passage into Reader</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
