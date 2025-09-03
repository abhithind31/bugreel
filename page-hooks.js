(function(){
    try {
        const randomId = Math.random().toString(36).slice(2);
        const ORIGIN = location.origin;
        const MAX_BYTES = 1048576; // 1MB
        const CHANNEL = 'BUGREEL_NET_' + randomId;

        // Simple postMessage channel back to the content script
        function send(msg){
            try { window.postMessage({ __BUGREEL__: true, channel: CHANNEL, payload: msg }, ORIGIN); } catch(_) {}
        }

        // Patch fetch
        const origFetch = window.fetch;
        window.fetch = async function(input, init){
            const start = Date.now();
            let url = (typeof input === 'string') ? input : (input && input.url ? input.url : String(input));
            let method = (init && init.method) || (input && input.method) || 'GET';
            try {
                const res = await origFetch.apply(this, arguments);
                try {
                    const ct = res.headers.get('content-type') || '';
                    let bodyText = '';
                    let isText = true;
                    if (/application\/json|\+json|text\//i.test(ct)) {
                        try {
                            const full = await res.clone().text();
                            bodyText = full.length > MAX_BYTES ? full.slice(0, MAX_BYTES) : full;
                        } catch (_) { bodyText = ''; }
                    } else {
                        // best-effort try text; if fails, mark as non-text
                        try {
                            const full = await res.clone().text();
                            bodyText = full.length > MAX_BYTES ? full.slice(0, MAX_BYTES) : full;
                        } catch (_) {
                            bodyText = '';
                            isText = false;
                        }
                    }
                    send({
                        type: 'HOOK_FETCH_RESPONSE',
                        url: url,
                        method: method,
                        status: res.status,
                        contentType: ct,
                        bodyText: bodyText,
                        isText: isText,
                        truncated: typeof bodyText === 'string' && bodyText.length >= MAX_BYTES,
                        ts: Date.now(),
                        duration: Date.now() - start
                    });
                } catch(_){}
                return res;
            } catch (e) {
                send({ type: 'HOOK_FETCH_ERROR', url, method, error: String(e) });
                throw e;
            }
        };

        // Patch XHR for completeness
        const OrigXHR = window.XMLHttpRequest;
        function PatchedXHR(){
            const xhr = new OrigXHR();
            const start = Date.now();
            let url = '';
            let method = 'GET';
            const open = xhr.open;
            xhr.open = function(m,u){ method = m; url = u; return open.apply(xhr, arguments); };
            xhr.addEventListener('loadend', function(){
                try {
                    const ct = xhr.getResponseHeader('content-type') || '';
                    const raw = xhr.responseType === '' || xhr.responseType === 'text' ? (xhr.responseText || '') : '';
                    const text = raw.length > MAX_BYTES ? raw.slice(0, MAX_BYTES) : raw;
                    send({
                        type: 'HOOK_XHR_RESPONSE',
                        url: url,
                        method: method,
                        status: xhr.status,
                        contentType: ct,
                        bodyText: text,
                        isText: true,
                        truncated: typeof text === 'string' && text.length >= MAX_BYTES,
                        ts: Date.now(),
                        duration: Date.now() - start
                    });
                } catch(_){}
            });
            return xhr;
        }
        window.XMLHttpRequest = PatchedXHR;

        // Expose channel so content script can read it
        window.__BUGREEL_NET_CHANNEL__ = CHANNEL;
    } catch(_){}
})();


