/**
 * HTTPS fetch for __qaFileUrl materialization (SSRF-safe allowlist, size cap, timeout).
 */
function normalizeHost(hostname) {
    return hostname.trim().toLowerCase();
}
export function isHostnameAllowed(hostname, allowedHosts) {
    const h = normalizeHost(hostname);
    for (const entry of allowedHosts) {
        const e = entry.trim().toLowerCase();
        if (!e)
            continue;
        if (e.startsWith('.')) {
            if (h === e.slice(1) || h.endsWith(e))
                return true;
        }
        else if (h === e) {
            return true;
        }
    }
    return false;
}
function filenameFromUrl(url) {
    const last = url.pathname.split('/').filter(Boolean).pop();
    return last && last.length > 0 ? decodeURIComponent(last) : 'download.bin';
}
/**
 * GET url, enforce allowlist + max bytes + timeout. Follows redirects up to maxRedirects.
 */
export async function fetchFileUrl(urlString, options) {
    const { allowedHosts, maxDownloadBytes, timeoutMs, maxRedirects = 3, allowHttp = false } = options;
    if (!allowedHosts.length) {
        throw new Error('FILE_URL_FETCH_FAILED: fileUrl.allowedHosts is empty');
    }
    let current = urlString.trim();
    let redirects = 0;
    while (redirects <= maxRedirects) {
        let url;
        try {
            url = new URL(current);
        }
        catch {
            throw new Error('FILE_URL_FETCH_FAILED: invalid URL');
        }
        if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
            throw new Error(`FILE_URL_FETCH_FAILED: only ${allowHttp ? 'http and ' : ''}https URLs are allowed`);
        }
        if (!isHostnameAllowed(url.hostname, allowedHosts)) {
            throw new Error(`FILE_URL_HOST_NOT_ALLOWED: ${url.hostname}`);
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let res;
        try {
            res = await fetch(current, {
                method: 'GET',
                redirect: 'manual',
                signal: controller.signal,
            });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : 'fetch failed';
            if (e?.name === 'AbortError') {
                throw new Error(`FILE_URL_FETCH_FAILED: timeout after ${timeoutMs}ms`);
            }
            throw new Error(`FILE_URL_FETCH_FAILED: ${msg}`);
        }
        finally {
            clearTimeout(timer);
        }
        if (res.status >= 300 && res.status < 400) {
            const loc = res.headers.get('location');
            if (!loc)
                throw new Error('FILE_URL_FETCH_FAILED: redirect without Location');
            redirects++;
            if (redirects > maxRedirects)
                throw new Error('FILE_URL_FETCH_FAILED: too many redirects');
            current = new URL(loc, current).href;
            continue;
        }
        if (!res.ok) {
            throw new Error(`FILE_URL_FETCH_FAILED: HTTP ${res.status}`);
        }
        const cl = res.headers.get('content-length');
        if (cl !== null) {
            const n = Number(cl);
            if (Number.isFinite(n) && n > maxDownloadBytes) {
                throw new Error(`FILE_URL_TOO_LARGE: Content-Length ${n} exceeds max ${maxDownloadBytes}`);
            }
        }
        const reader = res.body?.getReader();
        if (!reader) {
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.byteLength > maxDownloadBytes) {
                throw new Error(`FILE_URL_TOO_LARGE: body exceeds max ${maxDownloadBytes}`);
            }
            const contentType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
            return {
                buffer: buf,
                contentType,
                filename: filenameFromUrl(new URL(current)),
            };
        }
        const chunks = [];
        let total = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            if (!value)
                continue;
            const buf = Buffer.from(value);
            total += buf.byteLength;
            if (total > maxDownloadBytes) {
                await reader.cancel().catch(() => { });
                throw new Error(`FILE_URL_TOO_LARGE: body exceeds max ${maxDownloadBytes}`);
            }
            chunks.push(buf);
        }
        const buffer = Buffer.concat(chunks);
        const contentType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
        return {
            buffer,
            contentType,
            filename: filenameFromUrl(new URL(current)),
        };
    }
    throw new Error('FILE_URL_FETCH_FAILED: redirect loop');
}
//# sourceMappingURL=fetch-file-url.js.map