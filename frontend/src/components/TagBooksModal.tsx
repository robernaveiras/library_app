import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Search, X } from "lucide-react";
import { api } from "../api/client";
import type { Book, Tag } from "../types/library";

interface TagBooksModalProps {
  tag: Tag | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export function TagBooksModal({ tag, onClose, onSaved }: TagBooksModalProps) {
  const [books, setBooks] = useState<Book[]>([]);
  const [initialIds, setInitialIds] = useState<Set<number>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tag) return;
    setQuery("");
    setError(null);
    setLoading(true);
    Promise.all([api.listBooks({ sort_by: "title" }), api.listTagBookIds(tag.id)])
      .then(([allBooks, assignedIds]) => {
        setBooks(allBooks);
        const idSet = new Set(assignedIds);
        setInitialIds(idSet);
        setSelectedIds(new Set(idSet));
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "No se pudieron cargar los libros.")
      )
      .finally(() => setLoading(false));
  }, [tag]);

  const filteredBooks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return books;
    return books.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.authors.some((a) => a.toLowerCase().includes(q)) ||
        (b.genre && b.genre.toLowerCase().includes(q))
    );
  }, [books, query]);

  if (!tag) return null;

  const toggle = (bookId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) {
        next.delete(bookId);
      } else {
        next.add(bookId);
      }
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const add_book_ids = Array.from(selectedIds).filter((id) => !initialIds.has(id));
      const remove_book_ids = Array.from(initialIds).filter((id) => !selectedIds.has(id));
      if (add_book_ids.length > 0 || remove_book_ids.length > 0) {
        await api.assignTagBooks(tag.id, {
          add_book_ids,
          remove_book_ids,
          source: "manual",
        });
      }
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron guardar los cambios.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-stone-900/55 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl bg-white shadow-xl border border-stone-200 max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-stone-100 px-5 py-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="h-3.5 w-3.5 rounded-full shrink-0"
              style={{ backgroundColor: tag.color_hex }}
            />
            <h2 className="text-base font-semibold text-stone-900 truncate">
              Libros en «{tag.name}» ({selectedIds.size})
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 border-b border-stone-100">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filtrar libros por título, autor o género..."
              className="w-full rounded-xl border border-stone-300 pl-9 pr-3 py-2 text-sm focus:border-amber-700 focus:outline-none"
            />
          </div>
        </div>

        <div className="overflow-y-auto p-4 space-y-1.5 flex-1">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              {error}
            </div>
          )}

          {loading ? (
            <div className="py-10 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-amber-800" />
            </div>
          ) : filteredBooks.length === 0 ? (
            <p className="py-8 text-center text-sm text-stone-500">No hay libros para mostrar.</p>
          ) : (
            filteredBooks.map((book) => {
              const checked = selectedIds.has(book.id);
              return (
                <label
                  key={book.id}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                    checked
                      ? "border-amber-700/40 bg-amber-50/40"
                      : "border-stone-200/70 hover:bg-stone-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(book.id)}
                    className="h-4 w-4 accent-amber-800"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-stone-900 truncate">{book.title}</p>
                    <p className="text-xs text-stone-500 truncate">
                      {book.authors.length > 0 ? book.authors.join(", ") : "Autor desconocido"}
                      {book.genre ? ` · ${book.genre}` : ""}
                    </p>
                  </div>
                </label>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-stone-100 px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-900 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50 cursor-pointer"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            <span>Guardar</span>
          </button>
        </div>
      </div>
    </div>
  );
}
