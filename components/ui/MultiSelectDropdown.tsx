import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

type MultiSelectOption = {
  id: string;
  label: string;
  description?: string;
};

type MultiSelectDropdownProps = {
  buttonTestId?: string;
  label: string;
  options: MultiSelectOption[];
  selectedIds: string[];
  onChange: (nextSelectedIds: string[]) => void;
  selectAllLabel?: string;
  clearLabel?: string;
  disabled?: boolean;
  minButtonWidthClassName?: string;
};

const normalizeUnique = (ids: string[]) => Array.from(new Set(ids.filter(Boolean)));

const buildButtonSummary = (params: { options: MultiSelectOption[]; selectedIds: string[] }): string => {
  const selectedSet = new Set(params.selectedIds);
  const selectedOptions = params.options.filter((opt) => selectedSet.has(opt.id));
  if (selectedOptions.length === 0) return '未選択';
  if (selectedOptions.length === 1) return selectedOptions[0]?.label || '選択中';
  if (selectedOptions.length === params.options.length) return `すべて（${selectedOptions.length}）`;
  return `${selectedOptions.length}件選択`;
};

export const MultiSelectDropdown: React.FC<MultiSelectDropdownProps> = ({
  buttonTestId,
  label,
  options,
  selectedIds,
  onChange,
  selectAllLabel = '全選択',
  clearLabel = '選択解除',
  disabled,
  minButtonWidthClassName = 'min-w-[220px]',
}) => {
  const internalId = useId();
  const listboxId = `multiselect-${internalId}`;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [query, setQuery] = useState('');

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const summary = useMemo(() => buildButtonSummary({ options, selectedIds }), [options, selectedIds]);
  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => {
      const haystack = `${opt.label} ${opt.description || ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [options, query]);

  useEffect(() => {
    if (!isOpen) return;
    setHighlightedIndex((prev) => (filteredOptions.length === 0 ? 0 : Math.min(prev, filteredOptions.length - 1)));
  }, [filteredOptions, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setHighlightedIndex(0);
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const node = containerRef.current;
      if (!node) return;
      if (event.target && node.contains(event.target as Node)) return;
      setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const maxIndex = filteredOptions.length - 1;
        if (maxIndex < 0) return;
        if (event.key === 'ArrowDown') {
          setHighlightedIndex((prev) => (prev >= maxIndex ? 0 : prev + 1));
        } else {
          setHighlightedIndex((prev) => (prev <= 0 ? maxIndex : prev - 1));
        }
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const target = filteredOptions[highlightedIndex];
        if (target) {
          handleToggleOption(target.id);
        }
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown, { passive: true });
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setHighlightedIndex(0);
    window.setTimeout(() => searchInputRef.current?.focus(), 10);
  }, [isOpen]);

  const toggle = () => {
    if (disabled) return;
    setIsOpen((prev) => !prev);
  };

  const handleToggleOption = (id: string) => {
    const next = new Set<string>(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(normalizeUnique(Array.from(next)));
  };

  const handleSelectAll = () => onChange(options.map((opt) => opt.id));
  const handleClear = () => onChange([]);
  const dialogTestId = buttonTestId ? `${buttonTestId}-dialog` : undefined;
  const selectAllTestId = buttonTestId ? `${buttonTestId}-select-all` : undefined;
  const clearTestId = buttonTestId ? `${buttonTestId}-clear` : undefined;
  const searchTestId = buttonTestId ? `${buttonTestId}-search` : undefined;

  return (
    <div ref={containerRef} className={`relative ${disabled ? 'opacity-60' : ''}`}>
      <button
        type="button"
        data-testid={buttonTestId}
        onClick={toggle}
        disabled={disabled}
        className={`h-10 ${minButtonWidthClassName} inline-flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors shadow-sm`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        title={`${label}: ${summary}`}
      >
        <div className="min-w-0 flex items-baseline gap-2">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">{label}</span>
          <span className="text-sm font-bold truncate">{summary}</span>
        </div>
        <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          data-testid={dialogTestId}
          className="absolute right-0 mt-2 w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl shadow-gray-200/60 dark:shadow-black/40 overflow-hidden z-50"
          role="dialog"
          aria-label={`${label} 選択`}
        >
          <div className="p-3 border-b border-gray-100 dark:border-gray-800 space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                <input
                  ref={searchInputRef}
                  data-testid={searchTestId}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="検索..."
                  className="w-full h-9 pl-9 pr-9 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="absolute right-2 top-2 inline-flex items-center justify-center h-5 w-5 rounded-full hover:bg-gray-200/60 dark:hover:bg-gray-700"
                    aria-label="検索をクリア"
                  >
                    <X className="h-3 w-3 text-gray-500" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="h-9 w-9 inline-flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="閉じる"
              >
                <X className="h-4 w-4 text-gray-500" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAll}
                data-testid={selectAllTestId}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200/70 dark:hover:bg-gray-700 transition-colors"
              >
                {selectAllLabel}
              </button>
              <button
                type="button"
                onClick={handleClear}
                data-testid={clearTestId}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200/70 dark:hover:bg-gray-700 transition-colors"
              >
                {clearLabel}
              </button>
              <div className="ml-auto text-xs text-gray-500 dark:text-gray-400">
                選択: {Array.from(selectedSet).filter((id) => options.some((opt) => opt.id === id)).length} / {options.length}
              </div>
            </div>
          </div>

          <div id={listboxId} role="listbox" aria-multiselectable="true" className="max-h-[360px] overflow-y-auto p-2">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400">候補がありません。</div>
            ) : (
              <div className="space-y-1">
                {filteredOptions.map((opt, index) => {
                  const checked = selectedSet.has(opt.id);
                  const isActive = index === highlightedIndex;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="option"
                      aria-selected={checked}
                      onClick={() => handleToggleOption(opt.id)}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      className={`w-full flex items-start gap-3 px-3 py-2 rounded-xl text-left transition-colors ${
                        checked
                          ? 'bg-primary-50 dark:bg-primary-900/20'
                          : isActive
                          ? 'bg-gray-100 dark:bg-gray-800'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                      aria-current={isActive}
                    >
                      <span
                        className={`mt-0.5 inline-flex items-center justify-center h-5 w-5 rounded-md border ${
                          checked
                            ? 'bg-primary-600 border-primary-600 text-white'
                            : 'border-gray-300 dark:border-gray-600 text-transparent'
                        }`}
                        aria-hidden
                      >
                        <Check className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{opt.label}</span>
                        {opt.description && (
                          <span className="block text-xs text-gray-500 dark:text-gray-400 truncate">{opt.description}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
