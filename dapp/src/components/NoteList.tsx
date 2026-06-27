"use client";

import { useNotes } from "@/hooks/useNotes";
import { formatAmount } from "@/lib/stellar";
import type { StoredNote } from "@/store/notes";

interface NoteListProps {
  assetId: string;
  showSpent?: boolean;
}

export function NoteList({ assetId, showSpent = false }: NoteListProps) {
  const { notes } = useNotes();

  const filtered = notes.filter(
    (n) => n.assetId === assetId && (showSpent || !n.spent)
  );

  if (filtered.length === 0) {
    return (
      <div className="text-center py-8 text-stellar-blue">
        No notes found
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {filtered.map((note) => (
        <NoteCard key={note.id} note={note} />
      ))}
    </div>
  );
}

function NoteCard({ note }: { note: StoredNote }) {
  const amount = formatAmount(BigInt(note.amount));

  return (
    <div
      className={`card flex items-center justify-between ${
        note.spent ? "opacity-50" : ""
      }`}
    >
      <div>
        <div className="font-mono text-sm text-stellar-blue">
          {note.id.slice(0, 20)}...
        </div>
        <div className="text-lg font-semibold">{amount} cXLM</div>
        {note.memo && (
          <div className="text-xs text-stellar-blue">{note.memo}</div>
        )}
      </div>
      <div className="text-right">
        {note.spent ? (
          <span className="badge-error">Spent</span>
        ) : (
          <span className="badge-success">Unspent</span>
        )}
        <div className="text-xs text-stellar-blue mt-1">
          {new Date(note.createdAt).toLocaleDateString()}
        </div>
      </div>
    </div>
  );
}
