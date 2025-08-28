// renderer.js

import { state, setState, findFolder, findNote, CONSTANTS } from './state.js';
import {
    folderList, noteList, addNoteBtn, emptyTrashBtn, notesPanelTitle, noteSortSelect,
    editorContainer, placeholderContainer, noteTitleInput, noteContentTextarea, noteContentView,
    itemTemplate, saveStatusIndicator,
    formatDate, sortNotes, showToast
} from './components.js';
import { toYYYYMMDD } from './itemActions.js';
// [수정] 정적 임포트를 제거합니다. 이제 동적으로 불러올 것입니다.
// import { marked } from './marked.esm.js';

// [수정] marked 모듈을 저장할 변수를 선언합니다. 한 번 로드하면 재사용합니다.
let markedModule = null;

// [수정] marked 모듈을 안전하게 로드하는 비동기 함수를 추가합니다.
async function getMarkedParser() {
    if (markedModule) {
        return markedModule;
    }
    try {
        // 동적 import()를 사용하여 모듈 로드를 시도합니다.
        const marked = await import('./marked.esm.js');
        // [버그 수정] XSS 방지를 위해 marked의 내장 sanitizer를 활성화합니다.
        // 이 옵션은 잠재적으로 위험한 HTML(예: <script>) 태그를 렌더링 전에 제거합니다.
        marked.marked.setOptions({
            sanitize: true
        });
        markedModule = marked.marked; // 실제 marked 객체를 할당
        return markedModule;
    } catch (error) {
        console.error("Markdown parser (marked.js)를 로드하는 데 실패했습니다.", error);
        showToast("미리보기 기능을 로드할 수 없습니다. 파일이 누락되었을 수 있습니다.", CONSTANTS.TOAST_TYPE.ERROR, 6000);
        
        // 미리보기 버튼을 비활성화하여 사용자 혼란을 방지합니다.
        const markdownToggleBtn = document.getElementById('markdown-toggle-btn');
        if (markdownToggleBtn) {
            markdownToggleBtn.disabled = true;
            markdownToggleBtn.title = "미리보기 기능 로드 실패";
            markdownToggleBtn.style.opacity = '0.5';
            markdownToggleBtn.style.cursor = 'not-allowed';
        }
        // 실패 시, 미리보기 모드를 강제로 해제합니다.
        if (state.isMarkdownView) {
            setState({ isMarkdownView: false });
        }
        return null; // 실패했음을 알리기 위해 null 반환
    }
}


const highlightText = (container, text, term) => {
    const safeText = text ?? '';
    container.innerHTML = '';
    if (!term || !safeText) {
        container.textContent = safeText;
        return;
    }

    const fragment = document.createDocumentFragment();

    // [성능 개선] 기존 split 방식 대신 exec 루프를 사용하여 대용량 텍스트 하이라이트 성능을 개선합니다.
    const escapedTerm = term.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
    const regex = new RegExp(`(${escapedTerm})`, 'gi');

    let lastIndex = 0;
    let match;

    while ((match = regex.exec(safeText)) !== null) {
        // 마지막 인덱스와 현재 찾은 부분 사이의 텍스트 (일치하지 않는 부분)
        if (match.index > lastIndex) {
            fragment.appendChild(document.createTextNode(safeText.substring(lastIndex, match.index)));
        }

        // 일치하는 부분
        const mark = document.createElement('mark');
        mark.textContent = match[0];
        fragment.appendChild(mark);

        lastIndex = regex.lastIndex;
    }

    // 마지막으로 찾은 부분 이후의 나머지 텍스트
    if (lastIndex < safeText.length) {
        fragment.appendChild(document.createTextNode(safeText.substring(lastIndex)));
    }

    container.appendChild(fragment);
};

const _updateFolderListItemElement = (li, item, isBeingRenamed) => {
    const nameSpan = li.querySelector('.item-name');
    const countSpan = li.querySelector('.item-count');

    const isVirtual = Object.values(CONSTANTS.VIRTUAL_FOLDERS).some(vf => vf.id === item.id);
    
    if (isBeingRenamed) {
        nameSpan.textContent = item.name;
    } else {
        const displayName = item.displayName || (isVirtual ? item.name : `📁 ${item.name}`);
        highlightText(nameSpan, displayName, '');
    }
    
    nameSpan.title = isVirtual ? (item.displayName || item.name) : item.name;
    
    let count = -1;
    const { ALL, TRASH, RECENT, FAVORITES } = CONSTANTS.VIRTUAL_FOLDERS;
    if (item.id === ALL.id) count = state.totalNoteCount;
    else if (item.id === TRASH.id) count = state.trash.length;
    else if (item.id === FAVORITES.id) count = state.favorites.size;
    else if (item.id !== RECENT.id) count = item.notes?.length ?? 0;
    
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

    // --- [핵심 버그 수정] ---
    // 휴지통에 있는 항목의 실제 타입을 유추하여 올바른 이름을 표시합니다.
    let effectiveType = item.type;
    let displayName = '';
    let displayTitle = '';

    if (isTrashView) {
        if (!effectiveType) {
            // 타입이 없는 경우, .notes 배열 유무로 폴더/노트 구분
            effectiveType = Array.isArray(item.notes) ? 'folder' : 'note';
        }
        
        if (effectiveType === 'folder') {
            displayName = `📁 ${item.name || '제목 없는 폴더'}`;
            displayTitle = item.name || '제목 없는 폴더';
        } else { // note
            displayName = item.title || '📝 제목 없음';
            displayTitle = item.title || '📝 제목 없음';
        }
    } else {
        // 휴지통이 아닌 경우 기존 로직 유지
        displayName = item.title || '📝 제목 없음';
        displayTitle = item.title || '📝 제목 없음';
    }

    if (isBeingRenamed) {
        nameSpan.textContent = item.title || item.name || '제목 없음';
    } else {
        highlightText(nameSpan, displayName, state.searchTerm);
    }
    nameSpan.title = displayTitle;
    // --- [수정 끝] ---

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
        // [버그 수정] 내용이 있는 첫 줄을 찾습니다. (앞뒤 공백 무시)
        const firstNonEmptyLine = content.split('\n').find(line => line.trim() !== '');

        if (firstNonEmptyLine) {
            snippetText = firstNonEmptyLine;
            showSnippet = true;
        }
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
    
    // [BUG FIX] 휴지통에서는 어떤 아이템도 드래그할 수 없도록 로직 수정
    const isDraggable = !isVirtual && !isTrashView;
    
    li.draggable = isDraggable && !isBeingRenamed;

    if (type === CONSTANTS.ITEM_TYPE.FOLDER) {
        _updateFolderListItemElement(li, item, isBeingRenamed);
    } else {
        _updateNoteListItemElement(li, item, isBeingRenamed);
    }
};

const createActionButton = ({ className, textContent, title }) => {
    const button = document.createElement('button');
    button.className = `icon-button ripple-effect ${className}`;
    button.textContent = textContent;
    button.title = title;
    return button;
};

const getActionButtonsConfig = (item, type, isTrashView) => {
    const buttons = [];
    if (isTrashView) {
        if (item.id === CONSTANTS.VIRTUAL_FOLDERS.TRASH.id) {
            return [];
        }
        // [수정] 여기서도 타입을 유추하여 올바른 문자열을 표시
        let itemTypeStr = '항목';
        let effectiveType = item.type;
        if (!effectiveType) {
            effectiveType = Array.isArray(item.notes) ? 'folder' : 'note';
        }
        itemTypeStr = effectiveType === 'folder' ? '폴더' : '노트';
        
        buttons.push({ className: 'restore-item-btn', textContent: '♻️', title: `♻️ ${itemTypeStr} 복원` });
        buttons.push({ className: 'perm-delete-item-btn', textContent: '❌', title: '💥 영구 삭제' });
    } else {
        if (type === CONSTANTS.ITEM_TYPE.NOTE) {
            buttons.push({ className: 'favorite-btn', textContent: '☆', title: '☆ 즐겨찾기에 추가' });
            buttons.push({ className: 'pin-btn', textContent: '📌', title: '📌 노트 고정' });
        }
        if (!Object.values(CONSTANTS.VIRTUAL_FOLDERS).some(vf => vf.id === item.id)) {
            const itemTypeStr = type === CONSTANTS.ITEM_TYPE.NOTE ? '노트' : '폴더';
            buttons.push({ className: 'delete-item-btn', textContent: '🗑️', title: `🗑️ ${itemTypeStr} 휴지통으로` });
        }
    }
    return buttons;
};

const createListItemElement = (item, type) => {
    const fragment = itemTemplate.content.cloneNode(true);
    const li = fragment.querySelector('.item-list-entry');
    const actionsDiv = fragment.querySelector('.item-actions');

    li.dataset.id = item.id;
    // [수정] 타입이 없는 레거시 데이터를 위해 타입을 유추해서 data-type에 설정
    let effectiveType = item.type;
    if (!effectiveType) {
        effectiveType = Array.isArray(item.notes) ? 'folder' : 'note';
    }
    li.dataset.type = effectiveType;
    li.tabIndex = -1;
    
    // [버그 수정] isTrashView는 폴더 목록 렌더링 시에는 항상 false여야 합니다.
    // 휴지통 전용 버튼(복원, 영구삭제)은 노트 목록 패널에만 표시되어야 하기 때문입니다.
    const isTrashView = type !== CONSTANTS.ITEM_TYPE.FOLDER && state.activeFolderId === CONSTANTS.VIRTUAL_FOLDERS.TRASH.id;
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
            const firstUnpinnedEl = listElement.children[firstUnpinnedIndex];
            if(firstUnpinnedEl) {
                listElement.insertBefore(divider, firstUnpinnedEl);
            }
        }
    }
};

const renderList = (listElement, items, type) => {
    const fragment = document.createDocumentFragment();
    items.forEach(item => {
        fragment.appendChild(createListItemElement(item, type));
    });
    listElement.innerHTML = '';
    listElement.appendChild(fragment);
    
    if (type === CONSTANTS.ITEM_TYPE.NOTE) {
        updatePinDivider(listElement, items);
    }
};

export const renderFolders = () => {
    const fragment = document.createDocumentFragment();
    const sectionHeaderTemplate = document.getElementById('section-header-template');
    
    const createSectionHeader = (title) => {
        const headerFragment = sectionHeaderTemplate.content.cloneNode(true);
        const li = headerFragment.querySelector('.section-header');
        li.querySelector('span').textContent = title;
        return li;
    };

    fragment.appendChild(createSectionHeader('라이브러리'));
    [CONSTANTS.VIRTUAL_FOLDERS.ALL, CONSTANTS.VIRTUAL_FOLDERS.RECENT, CONSTANTS.VIRTUAL_FOLDERS.FAVORITES]
        .forEach(folder => fragment.appendChild(createListItemElement(folder, CONSTANTS.ITEM_TYPE.FOLDER)));

    if (state.folders.length > 0) {
        fragment.appendChild(createSectionHeader('내 폴더'));
        state.folders.forEach(folder => {
            // [BUG FIX & DEFENSIVE CODE]
            // folder 객체나 folder.id가 유효하지 않은 경우(null, undefined 등),
            // 렌더링을 건너뛰고 콘솔에 경고를 남겨 문제를 즉시 파악할 수 있도록 합니다.
            // 이렇게 하면 손상된 데이터 하나 때문에 전체 폴더 목록 렌더링이 실패하는 것을 방지합니다.
            if (!folder || typeof folder.id === 'undefined' || folder.id === null) {
                console.warn('Skipping rendering of an invalid folder object:', folder);
                return; // 현재 반복을 건너뛰고 다음 폴더로 넘어갑니다.
            }
            fragment.appendChild(createListItemElement(folder, CONSTANTS.ITEM_TYPE.FOLDER));
        });
    }
    
    fragment.appendChild(createListItemElement(CONSTANTS.VIRTUAL_FOLDERS.TRASH, CONSTANTS.ITEM_TYPE.FOLDER));

    folderList.innerHTML = '';
    folderList.appendChild(fragment);

    const calendarGrid = document.getElementById('calendar-grid');
    if (calendarGrid) {
        const activeDateEl = calendarGrid.querySelector('.active-date');
        if (activeDateEl) activeDateEl.classList.remove('active-date');

        if (state.dateFilter) {
            const dateStr = toYYYYMMDD(state.dateFilter);
            const targetCell = calendarGrid.querySelector(`.date-cell[data-date="${dateStr}"]`);
            if (targetCell) targetCell.classList.add('active-date');
        }
    }
};

export let sortedNotesCache = { sourceNotes: null, searchTerm: null, sortOrder: null, result: null };
export const clearSortedNotesCache = () => { sortedNotesCache.sourceNotes = null; };

const getPlaceholderMessage = (viewData) => {
    if (state.searchTerm) {
        if (viewData.isDateFilteredView) {
             const dateString = new Date(state.dateFilter).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
             return `🤷‍♂️<br>${dateString} 내에서<br>검색 결과가 없어요.`;
        }
        return '🤷‍♂️<br>검색 결과가 없어요.';
    }
    if (viewData.isDateFilteredView) {
        const dateString = new Date(state.dateFilter).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
        return `🤷‍♂️<br>${dateString}에 작성된 노트가 없습니다.`;
    }
    if (state.activeFolderId === CONSTANTS.VIRTUAL_FOLDERS.ALL.id && state.folders.length === 0) return '✨<br>첫 폴더를 만들고<br>생각을 기록해보세요!';
    if (viewData.canAddNote) return '✍️<br>첫 노트를 작성해보세요!';
    if (viewData.isTrashView && viewData.notes.length === 0) return '🗑️<br>휴지통이 비어있습니다.';
    if (state.activeFolderId === CONSTANTS.VIRTUAL_FOLDERS.FAVORITES.id && viewData.notes.length === 0) return '⭐<br>즐겨찾는 노트가 없습니다.';
    return '';
};

const getActiveViewData = () => {
    if (state.dateFilter) {
        const dateString = new Date(state.dateFilter).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
        const sourceNotes = Array.from(state.noteMap.values()).map(e => e.note).filter(note => toYYYYMMDD(note.createdAt) === toYYYYMMDD(state.dateFilter));
        return { name: `📅 ${dateString}`, notes: sourceNotes, isSortable: true, canAddNote: false, isTrashView: false, isDateFilteredView: true };
    }
    const { item: activeFolderData } = findFolder(state.activeFolderId);
    if (!activeFolderData) return { name: '📝 노트', notes: [], isSortable: false, canAddNote: false, needsFolderSelection: true };
    if (activeFolderData.isVirtual) {
        return { name: activeFolderData.displayName, notes: activeFolderData.getNotes(state), isSortable: activeFolderData.isSortable !== false, canAddNote: !!activeFolderData.canAddNote, isTrashView: activeFolderData.id === CONSTANTS.VIRTUAL_FOLDERS.TRASH.id };
    }
    return { name: `📁 ${activeFolderData.name}`, notes: activeFolderData.notes, isSortable: true, canAddNote: true, isTrashView: false };
};

export const renderNotes = () => {
    const viewData = getActiveViewData();
    
    addNoteBtn.style.display = viewData.canAddNote ? 'flex' : 'none';
    emptyTrashBtn.style.display = viewData.isTrashView && state.trash.length > 0 ? 'flex' : 'none';
    noteSortSelect.style.display = viewData.isSortable ? 'flex' : 'none';
    
    if (viewData.needsFolderSelection) {
        notesPanelTitle.textContent = '📝 노트';
        noteList.innerHTML = `<p class="placeholder" style="padding:12px; font-size:14px;">👈 먼저 폴더를<br>선택해주세요.</p>`;
        return;
    }

    notesPanelTitle.textContent = viewData.name;
    notesPanelTitle.title = viewData.name.replace(/^[^\w\s]+/, '').trim();

    const sourceNotes = viewData.notes;
    let sortedNotes;
    
    if ( sortedNotesCache.sourceNotes === sourceNotes && sortedNotesCache.searchTerm === state.searchTerm && sortedNotesCache.sortOrder === state.noteSortOrder ) {
        sortedNotes = sortedNotesCache.result;
    } else {
        const filteredNotes = sourceNotes.filter(n =>
            (n.title ?? n.name ?? '').toLowerCase().includes(state.searchTerm.toLowerCase()) || (n.content ?? '').toLowerCase().includes(state.searchTerm.toLowerCase())
        );

        if (viewData.isTrashView) sortedNotes = filteredNotes.sort((a,b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
        else if (viewData.isSortable) sortedNotes = sortNotes(filteredNotes, state.noteSortOrder);
        else sortedNotes = filteredNotes;

        sortedNotesCache = { sourceNotes, searchTerm: state.searchTerm, sortOrder: state.noteSortOrder, result: sortedNotes };
    }
        
    if (viewData.isSortable) noteSortSelect.value = state.noteSortOrder;

    if (state.activeNoteId && !sortedNotes.some(note => note.id === state.activeNoteId)) {
        setState({ activeNoteId: sortedNotes[0]?.id ?? null });
    }
    
    noteList.innerHTML = '';
    if (sortedNotes.length === 0) {
        const placeholderMessage = getPlaceholderMessage(viewData);
        if (placeholderMessage) noteList.innerHTML = `<div class="placeholder">${placeholderMessage}</div>`;
    } else {
        renderList(noteList, sortedNotes, CONSTANTS.ITEM_TYPE.NOTE);
    }
};

let saveStatusTimer;
export const updateSaveStatus = (status) => {
    clearTimeout(saveStatusTimer);
    if (!saveStatusIndicator) return;
    saveStatusIndicator.classList.add('visible');
    if (status === 'dirty') { saveStatusIndicator.textContent = '✏️ 변경됨'; saveStatusIndicator.classList.remove('saving'); } 
    else if (status === 'saving') { saveStatusIndicator.textContent = '💾 저장 중...'; saveStatusIndicator.classList.add('saving'); } 
    else if (status === 'saved') {
        saveStatusIndicator.textContent = '✅ 저장됨';
        saveStatusIndicator.classList.remove('saving');
        saveStatusTimer = setTimeout(() => saveStatusIndicator.classList.remove('visible'), 2000);
    }
};

// [수정] 함수를 async로 변경하여 동적 임포트를 처리합니다.
export const renderEditor = async () => {
    const { item: activeNote, isInTrash } = findNote(state.activeNoteId);

    const markdownToggleBtn = document.getElementById('markdown-toggle-btn');
    if (markdownToggleBtn) {
        markdownToggleBtn.style.display = activeNote ? 'flex' : 'none';
        if (state.isMarkdownView) {
            markdownToggleBtn.textContent = '✏️';
            markdownToggleBtn.title = '✏️ 편집 모드로 전환';
        } else {
            markdownToggleBtn.textContent = 'Ⓜ️';
            markdownToggleBtn.title = 'Ⓜ️ 마크다운 미리보기';
        }
    }

    if (!activeNote) {
        editorContainer.style.display = 'none';
        placeholderContainer.style.display = 'flex';
        const placeholderIcon = document.getElementById(CONSTANTS.EDITOR.DOM_IDS.placeholderIcon);
        if (placeholderIcon) {
            const emojis = CONSTANTS.PLACEHOLDER_EMOJIS;
            placeholderIcon.textContent = emojis[Math.floor(Math.random() * emojis.length)];
        }
        return;
    }
    
    editorContainer.style.display = 'flex';
    placeholderContainer.style.display = 'none';

    editorContainer.classList.toggle('markdown-view-mode', state.isMarkdownView);

    const isReadOnly = isInTrash;
    noteTitleInput.readOnly = isReadOnly || state.isMarkdownView;
    noteContentTextarea.readOnly = isReadOnly;
    editorContainer.classList.toggle(CONSTANTS.CLASSES.READONLY, isReadOnly);

    if (document.activeElement !== noteTitleInput) noteTitleInput.value = activeNote.title ?? '';
    if (document.activeElement !== noteContentTextarea) noteContentTextarea.value = activeNote.content ?? '';
    
    // [수정] marked 모듈을 안전하게 불러와서 사용합니다.
    if (state.isMarkdownView) {
        const marked = await getMarkedParser();
        // marked 로드에 성공한 경우에만 파싱을 실행합니다.
        if (marked) {
            noteContentView.innerHTML = marked.parse(activeNote.content ?? '');
        } else {
            // 실패 시 사용자에게 알림 (getMarkedParser 내부에서 처리)
            noteContentView.innerHTML = '<p style="color: var(--danger-color);">미리보기 기능을 로드하는 데 실패했습니다.</p>';
        }
    }
    
    const { DOM_IDS } = CONSTANTS.EDITOR;
    const content = activeNote.content ?? '';
    const charCount = content.length;
    const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
    const lineCount = content ? (content.match(/\n/g) || []).length + 1 : 0;
    
    document.getElementById(DOM_IDS.updatedDate).textContent = `🕒 수정일: ${formatDate(activeNote.updatedAt)}`;
    document.getElementById(DOM_IDS.createdDate).textContent = `📅 생성일: ${formatDate(activeNote.createdAt)}`;
    document.getElementById(DOM_IDS.wordCount).textContent = `✍️ 단어: ${wordCount}`;
    document.getElementById(DOM_IDS.charCount).textContent = `🔠 글자: ${charCount}`;
    document.getElementById(DOM_IDS.lineCount).textContent = `📊 줄: ${lineCount}`;

    if (isReadOnly) {
        document.getElementById(DOM_IDS.updatedDate).textContent = activeNote.deletedAt ? `🗑️ 삭제일: ${formatDate(activeNote.deletedAt)}` : '';
        saveStatusIndicator.classList.remove('visible');
    } else {
        if (!state.isDirty && !saveStatusIndicator.classList.contains('saving') && saveStatusIndicator.textContent !== '✅ 저장됨') {
            saveStatusIndicator.classList.remove('visible');
        }
    }
};

// [수정] renderEditor가 비동기가 되었으므로 renderAll도 비동기로 변경합니다.
export const renderAll = async () => { 
    renderFolders(); 
    renderNotes(); 
    await renderEditor(); 
};