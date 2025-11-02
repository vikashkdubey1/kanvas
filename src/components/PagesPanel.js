import React, { useEffect, useMemo, useState } from 'react';

function PageRow({
    page,
    isActive,
    count,
    onActivate,
    onRename,
    onDuplicate,
    onDelete,
    onDragStart,
    onDragEnter,
    onDragLeave,
    onDrop,
    onDragEnd,
    isDragged,
    isDragOver,
}) {
    const [isEditing, setIsEditing] = useState(false);
    const [draftName, setDraftName] = useState(page.name);

    useEffect(() => {
        setDraftName(page.name);
    }, [page.name]);

    const commit = () => {
        const trimmed = draftName.trim();
        if (trimmed && trimmed !== page.name) {
            onRename(page.id, trimmed);
        }
        setIsEditing(false);
    };

    return (
        <div
            draggable
            onDragStart={(event) => {
                onDragStart(page.id);
                event.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnter={() => onDragEnter(page.id)}
            onDragLeave={(event) => onDragLeave(page.id, event)}
            onDragOver={(event) => {
                event.preventDefault();
            }}
            onDrop={(event) => {
                event.preventDefault();
                onDrop(page.id, event);
            }}
            onDragEnd={() => onDragEnd()}
            onClick={() => onActivate(page.id)}
            onDoubleClick={() => setIsEditing(true)}
            style={{
                borderRadius: 8,
                padding: '6px 8px',
                marginBottom: 4,
                cursor: 'pointer',
                background: isActive ? '#eef2ff' : isDragOver ? '#f3f4f6' : 'transparent',
                border: isActive ? '1px solid #6366f1' : isDragged ? '1px dashed #94a3b8' : '1px solid transparent',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                userSelect: 'none',
            }}
        >
            <div style={{ flex: 1, minWidth: 0 }}>
                {isEditing ? (
                    <input
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                        onBlur={commit}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                commit();
                            } else if (event.key === 'Escape') {
                                setDraftName(page.name);
                                setIsEditing(false);
                            }
                        }}
                        autoFocus
                        style={{
                            width: '100%',
                            fontSize: 13,
                            padding: '2px 4px',
                            borderRadius: 4,
                            border: '1px solid #cbd5f5',
                        }}
                    />
                ) : (
                    <div
                        style={{
                            fontSize: 13,
                            fontWeight: 500,
                            color: '#1f2937',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {page.name}
                    </div>
                )}
                <div style={{ fontSize: 11, color: '#6b7280' }}>{count === 1 ? '1 layer' : `${count} layers`}</div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        setIsEditing(true);
                    }}
                    title="Rename"
                    style={{
                        border: '1px solid #d1d5db',
                        borderRadius: 4,
                        background: '#fff',
                        padding: '2px 6px',
                        fontSize: 11,
                    }}
                >
                    Rename
                </button>
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        onDuplicate(page.id);
                    }}
                    title="Duplicate page"
                    style={{
                        border: '1px solid #d1d5db',
                        borderRadius: 4,
                        background: '#fff',
                        padding: '2px 6px',
                        fontSize: 11,
                    }}
                >
                    Duplicate
                </button>
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        onDelete(page.id);
                    }}
                    title="Delete page"
                    style={{
                        border: '1px solid #fca5a5',
                        borderRadius: 4,
                        background: '#fff1f2',
                        padding: '2px 6px',
                        fontSize: 11,
                        color: '#b91c1c',
                    }}
                >
                    Delete
                </button>
            </div>
        </div>
    );
}

export default function PagesPanel({
    pages,
    activePageId,
    counts,
    onActivate,
    onAdd,
    onRename,
    onDuplicate,
    onDelete,
    onReorder,
    style,
}) {
    const [draggedId, setDraggedId] = useState(null);
    const [dragOverId, setDragOverId] = useState(null);

    const orderedPages = useMemo(() => pages.slice(), [pages]);

    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                boxSizing: 'border-box',
                background: '#fbfbfe',
                ...style,
            }}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 12px 8px',
                    borderBottom: '1px solid #e5e7eb',
                }}
            >
                <div style={{ fontWeight: 600, fontSize: 14, color: '#4b5563' }}>Pages</div>
                <button
                    type="button"
                    onClick={onAdd}
                    style={{
                        border: '1px solid #c7d2fe',
                        borderRadius: 6,
                        background: '#eef2ff',
                        color: '#4338ca',
                        padding: '2px 8px',
                        fontSize: 12,
                        fontWeight: 500,
                    }}
                >
                    +
                </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px 12px' }}>
                {orderedPages.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#6b7280' }}>No pages yet</div>
                ) : (
                    orderedPages.map((page) => (
                        <PageRow
                            key={page.id}
                            page={page}
                            isActive={page.id === activePageId}
                            count={counts.get(page.id) || 0}
                            onActivate={onActivate}
                            onRename={onRename}
                            onDuplicate={onDuplicate}
                            onDelete={(id) => onDelete(id)}
                            onDragStart={(id) => setDraggedId(id)}
                            onDragEnter={(id) => setDragOverId(id)}
                            onDragLeave={(id) => {
                                if (dragOverId === id) setDragOverId(null);
                            }}
                            onDrop={(id, event) => {
                                if (draggedId && draggedId !== id) {
                                    const bounds = event.currentTarget.getBoundingClientRect();
                                    const placeAfter = event.clientY > bounds.top + bounds.height / 2;
                                    onReorder(draggedId, id, placeAfter);
                                }
                                setDragOverId(null);
                                setDraggedId(null);
                            }}
                            onDragEnd={() => {
                                setDraggedId(null);
                                setDragOverId(null);
                            }}
                            isDragged={draggedId === page.id}
                            isDragOver={dragOverId === page.id}
                        />
                    ))
                )}
            </div>
        </div>
    );
}
