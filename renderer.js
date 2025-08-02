import { state, setState, findFolder, findNote, CONSTANTS } from './state.js';
import {
    folderList, noteList, addNoteBtn, emptyTrashBtn, notesPanelTitle, noteSortSelect,
    editorContainer, placeholderContainer, noteTitleInput, noteContentTextarea, editorFooter,
    itemTemplate, saveStatusIndicator,
    formatDate, sortNotes
} from './components.js';
import { toYYYYMMDD } from './itemActions.js';


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

const _updateFolderListItemElement = (li, item, isBeingRenamed) => {
    const nameSpan = li.querySelector('.item-name');
    const countSpan = li.querySelector('.item-count');

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

    if (type === CONSTANTS.ITEM_TYPE.FOLDER) {
        _updateFolderListItemElement(li, item, isBeingRenamed);
    } else {
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
    if (isTrashView && type === CONSTANTS.ITEM_TYPE.NOTE) {
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
        if (!itemMap.has(id) && !el.classList.contains('item-is-leaving')) {
             el.remove();
        }
    });

    let lastElement = null;
    items.forEach(item => {
        let currentEl = existingElements.get(item.id);
        if (currentEl) {
            updateListItemElement(currentEl, item, type);
        } else {
            currentEl = createListItemElement(item, type);
            currentEl.classList.add('item-newly-added');
            requestAnimationFrame(() => {
                currentEl.classList.remove('item-newly-added');
            });
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

// [개선] 사이드바 스타일 개선을 위해 폴더 렌더링 방식 변경
export const renderFolders = () => {
    const fragment = document.createDocumentFragment();
    const sectionHeaderTemplate = document.getElementById('section-header-template');
    
    const createSectionHeader = (title) => {
        const headerFragment = sectionHeaderTemplate.content.cloneNode(true);
        const li = headerFragment.querySelector('.section-header');
        li.querySelector('span').textContent = title;
        return li;
    };

    // Library Section
    fragment.appendChild(createSectionHeader('라이브러리'));
    [
        CONSTANTS.VIRTUAL_FOLDERS.ALL,
        CONSTANTS.VIRTUAL_FOLDERS.RECENT,
        CONSTANTS.VIRTUAL_FOLDERS.FAVORITES
    ].forEach(folder => {
        fragment.appendChild(createListItemElement(folder, CONSTANTS.ITEM_TYPE.FOLDER));
    });

    // My Folders Section
    if (state.folders.length > 0) {
        fragment.appendChild(createSectionHeader('내 폴더'));
        state.folders.forEach(folder => {
            fragment.appendChild(createListItemElement(folder, CONSTANTS.ITEM_TYPE.FOLDER));
        });
    }
    
    // Trash at the bottom (without a header)
    fragment.appendChild(createListItemElement(CONSTANTS.VIRTUAL_FOLDERS.TRASH, CONSTANTS.ITEM_TYPE.FOLDER));

    folderList.innerHTML = '';
    folderList.appendChild(fragment);

    // Calendar highlight update
    const calendarGrid = document.getElementById('calendar-grid');
    if (calendarGrid) {
        const activeDateEl = calendarGrid.querySelector('.active-date');
        if (activeDateEl) activeDateEl.classList.remove('active-date');

        if (state.dateFilter) {
            const dateStr = toYYYYMMDD(state.dateFilter);
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
    if (state.searchTerm) {
        return '🤷‍♂️<br>검색 결과가 없어요.';
    }
    if (viewData.isDateFilteredView) {
        const filterDate = new Date(state.dateFilter);
        const dateString = filterDate.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
        return `🤷‍♂️<br>${dateString}에 작성된 노트가 없습니다.`;
    }
    if (state.activeFolderId === CONSTANTS.VIRTUAL_FOLDERS.ALL.id && state.folders.length === 0) {
        return '✨<br>첫 폴더를 만들고<br>생각을 기록해보세요!';
    }
    if (viewData.canAddNote) {
        return '✍️<br>첫 노트를 작성해보세요!';
    }
    return '';
};

const getActiveViewData = () => {
    if (state.dateFilter) {
        const filterDate = new Date(state.dateFilter);
        const dateString = filterDate.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
        const sourceNotes = Array.from(state.noteMap.values())
            .map(entry => entry.note)
            .filter(note => toYYYYMMDD(note.createdAt) === toYYYYMMDD(filterDate));
        return { name: `${dateString} 노트`, notes: sourceNotes, isSortable: true, canAddNote: false, isTrashView: false, isDateFilteredView: true, icon: '📅' };
    }
    const { item: activeFolderData } = findFolder(state.activeFolderId);
    if (!activeFolderData) {
        return { name: '📝 노트', notes: [], isSortable: false, canAddNote: false, needsFolderSelection: true, icon: '📝' };
    }
    if (activeFolderData.isVirtual) {
        return { name: activeFolderData.displayName, notes: activeFolderData.notes, isSortable: activeFolderData.isSortable !== false, canAddNote: !!activeFolderData.canAddNote, isTrashView: activeFolderData.id === CONSTANTS.VIRTUAL_FOLDERS.TRASH.id, icon: activeFolderData.icon };
    }
    return { name: `📁 ${activeFolderData.name}`, notes: activeFolderData.notes, isSortable: true, canAddNote: true, isTrashView: false, icon: '📁' };
};

export const renderNotes = () => {
    const viewData = getActiveViewData();
    
    addNoteBtn.style.display = viewData.canAddNote ? 'block' : 'none';
    emptyTrashBtn.style.display = viewData.isTrashView && state.trash.length > 0 ? 'block' : 'none';
    noteSortSelect.style.display = viewData.isSortable ? 'flex' : 'none';
    
    if (viewData.needsFolderSelection) {
        notesPanelTitle.textContent = '📝 노트';
        notesPanelTitle.title = '노트';
        noteList.innerHTML = `<p style="padding:12px; color:var(--font-color-dim); font-size:14px; text-align:center;">👈 먼저 폴더를<br>선택해주세요.</p>`;
        return;
    }

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
    
    noteList.innerHTML = '';

    if (sortedNotes.length === 0) {
        const placeholderMessage = getPlaceholderMessage(viewData);
        if (placeholderMessage) {
            noteList.innerHTML = `<div class="placeholder">${placeholderMessage}</div>`;
        }
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
        
        const placeholderIcon = document.getElementById(CONSTANTS.EDITOR.DOM_IDS.placeholderIcon);
        if (placeholderIcon) {
            const emojis = CONSTANTS.PLACEHOLDER_EMOJIS;
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            placeholderIcon.textContent = randomEmoji;
        }

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
    
    const { DOM_IDS } = CONSTANTS.EDITOR;
    
    if (isReadOnly) {
        document.getElementById(DOM_IDS.updatedDate).textContent = activeNote.deletedAt ? `🗑️ 삭제일: ${formatDate(activeNote.deletedAt)}` : '';
        document.getElementById(DOM_IDS.createdDate).textContent = `📅 생성일: ${formatDate(activeNote.createdAt)}`;
        document.getElementById(DOM_IDS.wordCount).textContent = '';
        document.getElementById(DOM_IDS.charCount).textContent = '';
        saveStatusIndicator.classList.remove('visible');
    } else {
        const content = activeNote.content ?? '';
        const charCount = content.length;
        const wordCount = content.split(/\s+/).filter(Boolean).length;

        document.getElementById(DOM_IDS.updatedDate).textContent = `🕒 수정일: ${formatDate(activeNote.updatedAt)}`;
        document.getElementById(DOM_IDS.createdDate).textContent = `📅 생성일: ${formatDate(activeNote.createdAt)}`;
        document.getElementById(DOM_IDS.wordCount).textContent = `✍️ 단어: ${wordCount}`;
        document.getElementById(DOM_IDS.charCount).textContent = `🔠 글자: ${charCount}`;

        if (!state.isDirty && !saveStatusIndicator.classList.contains('saving') && saveStatusIndicator.textContent !== '✅ 저장됨') {
            saveStatusIndicator.classList.remove('visible');
        }
    }
};

export const renderAll = () => { renderFolders(); renderNotes(); renderEditor(); };