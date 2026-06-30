// sanitizer.js
// Shared HTML helpers for extension pages. This file deliberately avoids
// third-party runtime dependencies so the MV3 CSP can remain strict.

const ALLOWED_TAGS = new Set([
    'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'col', 'colgroup',
    'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'h1', 'h2', 'h3', 'h4',
    'h5', 'h6', 'hr', 'i', 'img', 'input', 'kbd', 'li', 'mark', 'ol', 'p',
    'pre', 's', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table',
    'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul'
]);

const DROP_WITH_CONTENT_TAGS = new Set([
    'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base',
    'form', 'svg', 'math', 'template', 'video', 'audio', 'source', 'track',
    'canvas'
]);

const GLOBAL_ATTRS = new Set(['title', 'aria-label', 'aria-hidden', 'role']);
const TAG_ATTRS = {
    a: new Set(['href', 'title', 'target', 'rel']),
    img: new Set(['src', 'alt', 'title', 'width', 'height', 'loading']),
    input: new Set(['type', 'checked', 'disabled']),
    th: new Set(['align', 'colspan', 'rowspan']),
    td: new Set(['align', 'colspan', 'rowspan']),
    col: new Set(['span']),
    colgroup: new Set(['span']),
    code: new Set(['class'])
};

const URL_ATTRS = new Set(['href', 'src']);
const SAFE_TARGETS = new Set(['_blank', '_self', '_parent', '_top']);
const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const MAX_ATTR_LENGTH = 1024;

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const isSafeUrl = (value, attrName) => {
    const raw = String(value ?? '').trim();
    if (!raw) return false;
    if (raw.startsWith('#')) return true;

    try {
        const currentLocation = (typeof window !== 'undefined' && window.location) ? window.location : null;
        const base = currentLocation ? currentLocation.href : 'https://invalid.local/';
        const parsed = new URL(raw, base);
        const isSameOrigin = !!currentLocation && (
            parsed.origin === currentLocation.origin
            || (parsed.protocol === currentLocation.protocol && parsed.host === currentLocation.host)
        );

        // Markdown image loads can make silent requests as soon as a note is previewed.
        // Keep links flexible, but restrict rendered image sources to same-origin URLs
        // so a pasted/imported note cannot beacon to arbitrary remote hosts.
        if (attrName === 'src') return isSameOrigin;

        if (SAFE_URL_PROTOCOLS.has(parsed.protocol)) return true;
        if (isSameOrigin) return true;
        return false;
    } catch {
        return false;
    }
};

const sanitizeAttributes = (element) => {
    const tagName = element.tagName.toLowerCase();
    const tagAttrs = TAG_ATTRS[tagName] || new Set();

    for (const attr of Array.from(element.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value ?? '';
        const isAllowed = GLOBAL_ATTRS.has(name) || tagAttrs.has(name);

        if (!isAllowed || name.startsWith('on') || name === 'style' || name === 'srcdoc' || value.length > MAX_ATTR_LENGTH) {
            element.removeAttribute(attr.name);
            continue;
        }

        if (URL_ATTRS.has(name) && !isSafeUrl(value, name)) {
            element.removeAttribute(attr.name);
            continue;
        }

        if (name === 'target' && !SAFE_TARGETS.has(value)) {
            element.removeAttribute(attr.name);
            continue;
        }

        if (tagName === 'code' && name === 'class') {
            const safeClasses = value
                .split(/\s+/)
                .filter(token => /^language-[a-z0-9_+-]+$/i.test(token))
                .join(' ');
            if (safeClasses) element.setAttribute('class', safeClasses);
            else element.removeAttribute(attr.name);
        }

        if ((name === 'colspan' || name === 'rowspan' || name === 'span') && !/^\d{1,3}$/.test(value)) {
            element.removeAttribute(attr.name);
        }

        if ((name === 'width' || name === 'height') && !/^\d{1,4}$/.test(value)) {
            element.removeAttribute(attr.name);
        }
    }

    if (tagName === 'a' && element.hasAttribute('href')) {
        element.setAttribute('rel', 'noopener noreferrer');
        if (!element.hasAttribute('target')) element.setAttribute('target', '_blank');
    }

    if (tagName === 'input') {
        if ((element.getAttribute('type') || '').toLowerCase() !== 'checkbox') {
            element.remove();
            return;
        }
        element.setAttribute('disabled', '');
    }
};

const sanitizeNode = (node) => {
    if (node.nodeType === Node.COMMENT_NODE || node.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
        node.remove();
        return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tagName = node.tagName.toLowerCase();
    if (DROP_WITH_CONTENT_TAGS.has(tagName)) {
        node.remove();
        return;
    }

    for (const child of Array.from(node.childNodes)) {
        sanitizeNode(child);
    }

    if (!ALLOWED_TAGS.has(tagName)) {
        const parent = node.parentNode;
        if (!parent) return;
        while (node.firstChild) parent.insertBefore(node.firstChild, node);
        node.remove();
        return;
    }

    sanitizeAttributes(node);
};

export function sanitizeHtml(dirtyHtml) {
    if (dirtyHtml === null || dirtyHtml === undefined) return '';
    const html = String(dirtyHtml);

    if (typeof DOMParser === 'undefined') {
        // Extremely defensive fallback for non-browser tests. Extension pages use DOMParser.
        return escapeHtml(html);
    }

    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const child of Array.from(doc.body.childNodes)) {
        sanitizeNode(child);
    }
    return doc.body.innerHTML;
}
