import { state, setState, findFolder, findNote, CONSTANTS } from './state.js';
import {
    folderList, noteList, addNoteBtn, emptyTrashBtn, notesPanelTitle, noteSortSelect,
    editorContainer, placeholderContainer, noteTitleInput, noteContentTextarea, editorFooter,
    itemTemplate, saveStatusIndicator,
    formatDate, sortNotes
} from './components.js';

// --- 헬퍼 함수 ---

const _getDateFilteredViewData = () => {
    const filterDate = new Date(state.dateFilter);
    const dateString = filterDate.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
    
    const sourceNotes = Array.from(state.noteMap.values())
        .map(entry => entry.note)
        .filter(note => {
            const filterDateStr = filterDate.toISOString().split('T')[0];
            const noteDate = new Date(note.createdAt);
            const noteDateStr = `${noteDate.getFullYear()}-${String(noteDate.getMonth() + 1).padStart(2, '0')}-${String(noteDate.getDate()).padStart(2, '0')}`;
            return noteDateStr === filterDateStr;
        });
        
    return {
        name: `${dateString} 노트`,
        notes: sourceNotes,
        isSortable: true,
        canAddNote: false,
        isTrashView: false,
        isDateFilteredView: true,
        icon: '📅'
    };
};

const _getVirtualFolderViewData = (activeFolderData) => {
    // [수정] name 속성에 아이콘이 포함된 displayName을 사용하도록 변경
    return {
        name: activeFolderData.displayName,
        notes: activeFolderData.notes,
        isSortable: activeFolderData.isSortable !== false, // 기본값 true
        canAddNote: !!activeFolderData.canAddNote,
        isTrashView: activeFolderData.id === CONSTANTS.VIRTUAL_FOLDERS.TRASH.id,
        icon: activeFolderData.icon,
    };
};

const _getNormalFolderViewData = (activeFolderData) => {
    return {
        name: `📁 ${activeFolderData.name}`, // [수정] 일반 폴더에도 아이콘을 추가하여 일관성 유지
        notes: activeFolderData.notes,
        isSortable: true,
        canAddNote: true,
        isTrashView: false,
        icon: '📁',
    };
};

// [리팩토링] 각 뷰 타입에 대한 데이터 생성을 헬퍼 함수로 분리
const getActiveViewData = () => {
    // 날짜 필터가 우선순위를 가짐
    if (state.dateFilter) {
        return _getDateFilteredViewData();
    }

    const { activeFolderId } = state;
    const { item: activeFolderData } = findFolder(activeFolderId);

    if (!activeFolderData) {
        return { 
            name: '📝 노트',
            notes: [], 
            isSortable: false, 
            canAddNote: false, 
            needsFolderSelection: true,
            icon: '📝'
        };
    }

    if (activeFolderData.isVirtual) {
        return _getVirtualFolderViewData(activeFolderData);
    }
    
    // 일반 폴더의 경우
    return _getNormalFolderViewData(activeFolderData);
};

// [보안 수정] innerHTML 대신 TextNode와 <mark> element를 사용하여 XSS 공격 방지
const highlightText = (container, text, term) => {
    container.innerHTML = ''; 
    if (!term || !text) {
        container.textContent = text ?? '';
        return;
    }

    const fragment = document.createDocumentFragment();
    const regex = new RegExp(`(${term.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);

    parts.forEach(part => {
        if (part.toLowerCase() === term.toLowerCase()) {
            const mark = document.createElement('mark');
            mark.textContent = part;
            fragment.appendChild(mark);
        } else {
            fragment.appendChild(document.createTextNode(part));
        }
    });
    container.appendChild(fragment);
};

// [최적화] 폴더 리스트 아이템 업데이트 로직 분리
const _updateFolderListItemElement = (li, item, isBeingRenamed) => {
    const nameSpan = li.querySelector('.item-name');
    const countSpan = li.querySelector('.item-count');

    // [수정] 표시할 이름을 결정. 가상 폴더는 displayName, 일반 폴더는 name을 사용.
    const displayName = item.displayName || item.name;

    if (!isBeingRenamed) {
        highlightText(nameSpan, displayName, '');
    }
    nameSpan.title = displayName;
    
    let count = -1;
    const { ALL, TRASH, RECENT, FAVORITES } = CONSTANTS.VIRTUAL_FOLDERS;
    if (item.id === ALL.id) {
        count = state.totalNoteCount;
    } else if (item.id === TRASH.id) {
        count = state.trash.length;
    } else if (item.id === FAVORITES.id) {
        count = state.favorites.size;
    } else if (item.id !== RECENT.id) { 
        count = item.notes?.length ?? 0;
    }
    
    if (count > -1) {
        countSpan.textContent = `(${count})`;
        countSpan.style.display = 'inline';
    } else {
        countSpan.style.display = 'none';
    }
};

// [최적화] 노트 리스트 아이템 업데이트 로직 분리
const _updateNoteListItemElement = (li, item, isBeingRenamed) => {
    const nameSpan = li.querySelector('.item-name');
    const countSpan = li.querySelector('.item-count');
    const snippetDiv = li.querySelector('.item-snippet');

    countSpan.style.display = 'none';
    
    const isTrashView = state.activeFolderId === CONSTANTS.VIRTUAL_FOLDERS.TRASH.id;
    let itemName;
    if (isTrashView && item.type === 'folder') {
        itemName = `📁 ${item.name || '제목 없는 폴더'}`;
    } else {
        itemName = (item.title || '📝 제목 없음');
    }

    if (!isBeingRenamed) {
        highlightText(nameSpan, itemName, state.searchTerm);
    }
    nameSpan.title = (isTrashView && item.type === 'folder') ? (item.name || '제목 없는 폴더') : (item.title || '📝 제목 없음');

    const pinBtn = li.querySelector('.pin-btn');
    if (pinBtn) {
        const isPinned = !!item.isPinned;
        pinBtn.textContent = isPinned ? '📍' : '📌';
        pinBtn.title = isPinned ? '📍 노트 고정 해제' : '📌 노트 고정';
        li.classList.toggle(CONSTANTS.CLASSES.PINNED, isPinned);
        pinBtn.classList.toggle('pinned', isPinned);
    }
    
    const favoriteBtn = li.querySelector('.favorite-btn');
    if (favoriteBtn) {
        const isFavorite = state.favorites.has(item.id);
        favoriteBtn.textContent = isFavorite ? '⭐' : '☆';
        favoriteBtn.title = isFavorite ? '⭐ 즐겨찾기에서 제거' : '☆ 즐겨찾기에 추가';
        favoriteBtn.classList.toggle('favorited', isFavorite);
    }

    const content = item.content || '';
    const term = state.searchTerm;
    let snippetText = '';
    let showSnippet = false;

    if (term && content && content.toLowerCase().includes(term.toLowerCase())) {
        const index = content.toLowerCase().indexOf(term.toLowerCase());
        const start = Math.max(0, index - 20);
        const end = Math.min(content.length, index + term.length + 30);
        snippetText = (start > 0 ? '...' : '') + content.substring(start, end) + (end < content.length ? '...' : '');
        showSnippet = true;
    } else if (content) {
        snippetText = content.split('\n')[0];
        showSnippet = true;
    }
    
    if (showSnippet) {
        highlightText(snippetDiv, snippetText, term);
        snippetDiv.style.display = 'block';
    } else {
        snippetDiv.style.display = 'none';
    }
};


const updateListItemElement = (li, item, type) => {
    // --- 공통 로직 ---
    const isActive = item.id === (type === CONSTANTS.ITEM_TYPE.FOLDER ? state.activeFolderId : state.activeNoteId);
    const isFolderAndDateFiltering = type === CONSTANTS.ITEM_TYPE.FOLDER && state.dateFilter;
    li.classList.toggle(CONSTANTS.CLASSES.ACTIVE, isActive && !isFolderAndDateFiltering);
    
    const isVirtual = Object.values(CONSTANTS.VIRTUAL_FOLDERS).some(vf => vf.id === item.id);
    const isTrashView = state.activeFolderId === CONSTANTS.VIRTUAL_FOLDERS.TRASH.id;
    const isBeingRenamed = state.renamingItemId === item.id;
    
    let isDraggable = !isVirtual && !isTrashView;
    if (type === CONSTANTS.ITEM_TYPE.NOTE) {
      isDraggable = !isTrashView;
    }
    
    li.draggable = isDraggable && !isBeingRenamed;

    // --- 타입별 로직 호출 ---
    if (type === CONSTANTS.ITEM_TYPE.FOLDER) {
        _updateFolderListItemElement(li, item, isBeingRenamed);
    } else { // Note
        _updateNoteListItemElement(li, item, isBeingRenamed);
    }
};

const createActionButton = ({ className, textContent, title }) => {
    const button = document.createElement('button');
    button.className = `icon-button ${className}`;
    button.textContent = textContent;
    button.title = title;
    return button;
};

const getActionButtonsConfig = (item, type, isTrashView) => {
    const buttons = [];
    if (isTrashView) {
        const itemTypeStr = item.type === 'folder' ? '폴더' : '노트';
        buttons.push({ className: 'restore-item-btn', textContent: '♻️', title: `📁 ${itemTypeStr} 복원` });
        buttons.push({ className: 'perm-delete-item-btn', textContent: '❌', title: '💥 영구 삭제' });
    } else {
        if (type === CONSTANTS.ITEM_TYPE.NOTE) {
            buttons.push({ className: 'favorite-btn', textContent: '☆', title: '☆ 즐겨찾기에 추가' });
            buttons.push({ className: 'pin-btn', textContent: '📌', title: '📌 노트 고정' });
        }
        if (!Object.values(CONSTANTS.VIRTUAL_FOLDERS).some(vf => vf.id === item.id)) {
            const itemTypeStr = type === CONSTANTS.ITEM_TYPE.NOTE ? '노트' : '폴더';
            buttons.push({ className: 'delete-item-btn', textContent: '🗑️', title: `🗑️ ${itemTypeStr}를 휴지통으로` });
        }
    }
    return buttons;
};

const createListItemElement = (item, type) => {
    const fragment = itemTemplate.content.cloneNode(true);
    const li = fragment.querySelector('.item-list-entry');
    const actionsDiv = fragment.querySelector('.item-actions');

    li.dataset.id = item.id;
    li.dataset.type = item.type ?? type;
    li.tabIndex = -1;
    
    const isTrashView = state.activeFolderId === CONSTANTS.VIRTUAL_FOLDERS.TRASH.id;
    const actionButtons = getActionButtonsConfig(item, type, isTrashView);
    
    actionButtons.forEach(config => actionsDiv.appendChild(createActionButton(config)));
    
    updateListItemElement(li, item, type);
    return li;
};

const updatePinDivider = (listElement, items) => {
    const pinDividerId = 'pin-divider';
    listElement.querySelector(`#${pinDividerId}`)?.remove();
    
    if (state.activeFolderId !== CONSTANTS.VIRTUAL_FOLDERS.TRASH.id) {
        const firstUnpinnedIndex = items.findIndex(item => !item.isPinned);
        if (firstUnpinnedIndex > 0 && firstUnpinnedIndex < items.length) {
            const divider = document.createElement('li');
            divider.id = pinDividerId;
            divider.className = 'pin-divider';
            const firstUnpinnedEl = listElement.querySelector(`[data-id="${items[firstUnpinnedIndex].id}"]`);
            if(firstUnpinnedEl) {
                listElement.insertBefore(divider, firstUnpinnedEl);
            }
        }
    }
};

const renderList = (listElement, items, type) => {
    const itemMap = new Map(items.map(item => [item.id, item]));
    const existingElements = new Map(Array.from(listElement.children).filter(el => el.dataset.id).map(el => [el.dataset.id, el]));

    existingElements.forEach((el, id) => {
        if (!itemMap.has(id)) el.remove();
    });

    let lastElement = null;
    items.forEach(item => {
        let currentEl = existingElements.get(item.id);
        if (currentEl) {
            updateListItemElement(currentEl, item, type);
        } else {
            currentEl = createListItemElement(item, type);
        }

        if (lastElement) {
            if (lastElement.nextElementSibling !== currentEl) {
                lastElement.after(currentEl);
            }
        } else {
            if (listElement.firstElementChild !== currentEl) {
                listElement.prepend(currentEl);
            }
        }
        lastElement = currentEl;
    });
    
    if (type === CONSTANTS.ITEM_TYPE.NOTE) {
        updatePinDivider(listElement, items);
    }
};

export const renderFolders = () => {
    // [수정] .map()을 제거하여 데이터 원본을 수정하지 않도록 함
    const allFolders = [
        CONSTANTS.VIRTUAL_FOLDERS.ALL,
        CONSTANTS.VIRTUAL_FOLDERS.RECENT,
        CONSTANTS.VIRTUAL_FOLDERS.FAVORITES,
        ...state.folders,
        CONSTANTS.VIRTUAL_FOLDERS.TRASH
    ];
    
    renderList(folderList, allFolders, CONSTANTS.ITEM_TYPE.FOLDER);

    const calendarGrid = document.getElementById('calendar-grid');
    if (calendarGrid) {
        const activeDateEl = calendarGrid.querySelector('.active-date');
        if (activeDateEl) activeDateEl.classList.remove('active-date');

        if (state.dateFilter) {
            const dateStr = new Date(state.dateFilter).toISOString().split('T')[0];
            const targetCell = calendarGrid.querySelector(`.date-cell[data-date="${dateStr}"]`);
            if (targetCell) {
                targetCell.classList.add('active-date');
            }
        }
    }
};

export let sortedNotesCache = {
    sourceNotes: null,
    searchTerm: null,
    sortOrder: null,
    result: null
};

export const clearSortedNotesCache = () => {
    sortedNotesCache.sourceNotes = null;
};

const getPlaceholderMessage = (viewData) => {
    if (state.searchTerm) return '🤷‍♂️<br>검색 결과가 없어요.';
    if (viewData.isDateFilteredView) {
        const filterDate = new Date(state.dateFilter);
        const dateString = filterDate.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
        return `🤷‍♂️<br>${dateString}에 작성된 노트가 없습니다.`;
    }
    if (viewData.isTrashView) return '🗑️<br>휴지통이 비어있어요. 깔끔하네요!';
    if (state.activeFolderId === CONSTANTS.VIRTUAL_FOLDERS.RECENT.id) return '🤔<br>아직 노트가 없네요.';
    if (state.activeFolderId === CONSTANTS.VIRTUAL_FOLDERS.ALL.id && state.folders.length === 0) return '✨<br>첫 폴더를 만들고<br>생각을 기록해보세요!';
    
    return '';
};

export const renderNotes = () => {
    const viewData = getActiveViewData();
    
    addNoteBtn.style.display = viewData.canAddNote ? 'block' : 'none';
    emptyTrashBtn.style.display = viewData.isTrashView && state.trash.length > 0 ? 'block' : 'none';
    noteSortSelect.style.display = viewData.isSortable ? 'flex' : 'none';
    
    noteList.innerHTML = '';

    if (viewData.needsFolderSelection) {
        notesPanelTitle.textContent = '📝 노트';
        notesPanelTitle.title = '노트';
        noteList.innerHTML = `<p style="padding:12px; color:var(--font-color-dim); font-size:14px; text-align:center;">👈 먼저 폴더를<br>선택해주세요.</p>`;
        return;
    }

    // [수정] viewData.name에 이미 아이콘과 이름이 모두 포함되어 있으므로 그대로 사용
    notesPanelTitle.textContent = viewData.name;
    notesPanelTitle.title = viewData.name;

    const sourceNotes = viewData.notes;
    let sortedNotes;
    
    if (
        sortedNotesCache.sourceNotes === sourceNotes &&
        sortedNotesCache.searchTerm === state.searchTerm &&
        sortedNotesCache.sortOrder === state.noteSortOrder
    ) {
        sortedNotes = sortedNotesCache.result;
    } else {
        const filteredNotes = sourceNotes.filter(n =>
            (n.title ?? n.name ?? '').toLowerCase().includes(state.searchTerm.toLowerCase()) ||
            (n.content ?? '').toLowerCase().includes(state.searchTerm.toLowerCase())
        );

        if (viewData.isTrashView) {
            sortedNotes = filteredNotes.sort((a,b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
        } else if (viewData.isSortable) {
            sortedNotes = sortNotes(filteredNotes, state.noteSortOrder);
        } else {
            sortedNotes = filteredNotes;
        }

        sortedNotesCache = {
            sourceNotes: sourceNotes,
            searchTerm: state.searchTerm,
            sortOrder: state.noteSortOrder,
            result: sortedNotes
        };
    }
        
    if (viewData.isSortable) {
        noteSortSelect.value = state.noteSortOrder;
    }

    const activeNoteIsVisible = sortedNotes.some(note => note.id === state.activeNoteId);
    if (state.activeNoteId && !activeNoteIsVisible) {
        setState({ activeNoteId: null });
    }

    if (sortedNotes.length === 0) {
        const message = getPlaceholderMessage(viewData);
        noteList.innerHTML = `<div class="placeholder">${message}</div>`;
    } else {
        renderList(noteList, sortedNotes, CONSTANTS.ITEM_TYPE.NOTE);
    }
};

let saveStatusTimer;
export const updateSaveStatus = (status) => {
    clearTimeout(saveStatusTimer);
    if (!saveStatusIndicator) return;

    saveStatusIndicator.classList.add('visible');

    if (status === 'dirty') {
        saveStatusIndicator.textContent = '●';
        saveStatusIndicator.classList.remove('saving');
    } else if (status === 'saving') {
        saveStatusIndicator.textContent = '💾 저장 중...';
        saveStatusIndicator.classList.add('saving');
    } else if (status === 'saved') {
        saveStatusIndicator.textContent = '✅ 저장됨';
        saveStatusIndicator.classList.remove('saving');
        saveStatusTimer = setTimeout(() => {
            saveStatusIndicator.classList.remove('visible');
        }, 2000);
    }
};

export const renderEditor = () => {
    const { item: activeNote, isInTrash } = findNote(state.activeNoteId);

    if (!activeNote) {
        editorContainer.style.display = 'none';
        placeholderContainer.style.display = 'flex';
        return;
    }
    
    editorContainer.style.display = 'flex';
    placeholderContainer.style.display = 'none';

    const isReadOnly = isInTrash;
    noteTitleInput.readOnly = isReadOnly;
    noteContentTextarea.readOnly = isReadOnly;
    editorContainer.classList.toggle(CONSTANTS.CLASSES.READONLY, isReadOnly);

    if (document.activeElement !== noteTitleInput) noteTitleInput.value = activeNote.title ?? '';
    if (document.activeElement !== noteContentTextarea) noteContentTextarea.value = activeNote.content ?? '';
    
    if (isReadOnly) {
        document.getElementById('updated-date').textContent = activeNote.deletedAt ? `🗑️ 삭제일: ${formatDate(activeNote.deletedAt)}` : '';
        document.getElementById('created-date').textContent = `📅 생성일: ${formatDate(activeNote.createdAt)}`;
        document.getElementById('word-count').textContent = '';
        document.getElementById('char-count').textContent = '';
        saveStatusIndicator.classList.remove('visible');
    } else {
        const content = activeNote.content ?? '';
        const charCount = content.length;
        const wordCount = content.split(/\s+/).filter(Boolean).length;

        document.getElementById('updated-date').textContent = `🕒 수정일: ${formatDate(activeNote.updatedAt)}`;
        document.getElementById('created-date').textContent = `📅 생성일: ${formatDate(activeNote.createdAt)}`;
        document.getElementById('word-count').textContent = `✍️ 단어: ${wordCount}`;
        document.getElementById('char-count').textContent = `🔠 글자: ${charCount}`;

        if (!state.isDirty && !saveStatusIndicator.classList.contains('saving') && saveStatusIndicator.textContent !== '✅ 저장됨') {
            saveStatusIndicator.classList.remove('visible');
        }
    }
};

export const renderAll = () => { renderFolders(); renderNotes(); renderEditor(); };